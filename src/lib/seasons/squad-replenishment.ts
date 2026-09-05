/**
 * SQUAD REPLENISHMENT - the season-boundary guarantee that every continuing
 * club can still field a team.
 *
 * ============================ WHAT IT IS FOR ==============================
 *
 * Retirement is involuntary and unbounded: a club can lose more players in
 * one offseason than its academy can promote (youth caps at 3), and a human
 * who never opens the game promotes none at all. Phase 3L's fail-closed gate
 * then refuses that club's fixtures - honestly, but permanently. This is what
 * stops a league quietly becoming unplayable.
 *
 * ========================== WHAT IT DELIBERATELY IS NOT ===================
 *
 * It is not a reward. It generates the worst footballers in the game
 * (players/fallback-generator.ts) and only as many as the floor arithmetic
 * demands - never depth, never toward the cap.
 *
 * IT SIGNS NO EXISTING FREE AGENT. Not the best one, not the cheapest, not
 * one at any price. A free agent is a scarce, indivisible, valuable asset;
 * awarding one automatically would need a pricing rule and a fair allocation
 * rule between clubs, and without them the recipient is decided by whichever
 * club a worker happens to reach first - which would make a database
 * iteration order sporting. Free agents stay untouched for a future
 * deliberate signing market. This module never queries `teamId: null`.
 *
 * That exclusion is also what keeps the lock order simple: with nothing
 * pre-existing to acquire, replenishment never takes a Player row lock, so
 * it can never invert the Player -> Team order every transfer path relies on.
 *
 *      Season (stage) -> Team (roster lock) -> Player INSERT -> LineupSlot
 *
 * ============================== EXACTLY ONCE ==============================
 *
 * SquadReplenishment, one row per (season, club), written LAST inside the
 * same transaction as the players. A row means all of that club's work
 * committed; no row means none of it did. Deterministic seeds make a rerun
 * reproduce the same footballers, but they are a reproducibility aid - the
 * ledger is the authority.
 */
import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { lockTeamRoster, MAX_ACTIVE_ROSTER_SIZE, pickAvailableShirtNumber } from "@/lib/players/roster"
import { repairTeamLineup, checkTeamLineup } from "@/lib/players/lineup-repair"
import { generateFallbackPlayer } from "@/lib/players/fallback-generator"
import { judgeTeamRoster, type RosterInvariantFailure } from "./roster-invariant"
import {
  MIN_ACTIVE_ROSTER,
  countRoster,
  failedConstraints,
  isResolvableWithinCap,
  planAdditions,
  requiredAdditions,
  rosterDeficits,
  type RosterCounts,
} from "@/lib/players/roster-floor"

/** Clubs handled per stage tick. Keeps one cron run bounded; the ledger makes resumption free. */
export const DEFAULT_REPLENISHMENT_BATCH = 20

export interface RosterUnresolvableDetail {
  teamId: string
  counts: RosterCounts
  deficits: Record<string, number>
  requiredAdditions: number
  cap: number
}

/**
 * A club whose shape cannot be repaired without breaking the 22 cap - 22
 * players and no goalkeeper, say, which would need 24.
 *
 * FAIL CLOSED. Nothing is created, no ledger row is written, and the stage
 * does not advance. The alternatives are all worse: exceeding the cap breaks
 * a hard product rule, dropping a coverage rule ships a club with no
 * goalkeeper, and releasing an existing player to make room is a sporting act
 * that this mechanism must never take on a manager's behalf.
 *
 * Unreachable once the voluntary-departure guard is live (each retirement
 * that creates a deficit also frees the slot to fill it), which is why the
 * guard and this stage ship together. Implemented anyway, because a proof
 * about future states is not a defined behaviour for a legacy one.
 */
export class RosterUnresolvableError extends Error {
  readonly code = "ROSTER_UNRESOLVABLE"
  constructor(readonly detail: RosterUnresolvableDetail) {
    super(
      `ROSTER_UNRESOLVABLE for team ${detail.teamId}: total=${detail.counts.total} ` +
        `GK=${detail.counts.GK} DEF=${detail.counts.DF} MID=${detail.counts.MF} ATT=${detail.counts.FW} ` +
        `deficits=${JSON.stringify(detail.deficits)} requiredAdditions=${detail.requiredAdditions} cap=${detail.cap}`
    )
    this.name = "RosterUnresolvableError"
  }
}

export class ReplenishmentIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReplenishmentIntegrityError"
  }
}

export interface TeamReplenishmentResult {
  teamId: string
  /** True when a previous run had already completed this club - nothing was created. */
  alreadyCompleted: boolean
  ownedBefore: number
  generated: number
  ownedAfter: number
}

async function readActiveRoster(tx: Prisma.TransactionClient, teamId: string): Promise<RosterCounts> {
  const players = await tx.player.findMany({
    where: { teamId, careerStatus: "ACTIVE" },
    select: { primaryPosition: true },
  })
  return countRoster(players)
}

/**
 * One club, one transaction. The order below is load-bearing end to end.
 *
 * Not split across transactions on purpose: a club half-replenished and
 * committed would be a state no ledger row could describe.
 */
export async function replenishTeamSquad(
  seasonId: string,
  teamId: string,
  now: Date = new Date()
): Promise<TeamReplenishmentResult> {
  return prisma.$transaction(
    async (tx) => {
      // 1. THE CLUB'S ROSTER AUTHORITY. The same helper Transfer Purchase and
      // Youth Promotion take, and deliberately a WRITE rather than a
      // FOR UPDATE - a lock that produces no new row version does not raise a
      // serialization failure for a SERIALIZABLE caller reading from an older
      // snapshot, which is exactly how a squad once ended up at 23.
      if (!(await lockTeamRoster(tx, teamId))) {
        throw new ReplenishmentIntegrityError(`No such team: ${teamId}`)
      }

      // 2. THE LEDGER, UNDER THE LOCK. A second worker that got here later
      // sees the winner's committed row and does nothing at all.
      const existing = await tx.squadReplenishment.findUnique({
        where: { seasonId_teamId: { seasonId, teamId } },
      })
      if (existing) {
        return {
          teamId,
          alreadyCompleted: true,
          ownedBefore: existing.ownedBefore,
          generated: existing.generated,
          ownedAfter: existing.ownedAfter,
        }
      }

      // 3. The roster, counted under the lock so it cannot be stale.
      const before = await readActiveRoster(tx, teamId)

      // 4. The minimum additions that satisfy the count floor AND every
      // positional floor at once - max, never sum, because a generated
      // goalkeeper also increments the total.
      const needed = requiredAdditions(before)
      if (!isResolvableWithinCap(before)) {
        throw new RosterUnresolvableError({
          teamId,
          counts: before,
          deficits: rosterDeficits(before),
          requiredAdditions: needed,
          cap: MAX_ACTIVE_ROSTER_SIZE,
        })
      }

      // 5. Generate exactly that many, into exactly the groups the plan says.
      // Deficits first, goalkeepers before anything else, depth last and
      // never a third goalkeeper.
      const plan = planAdditions(before)
      for (let slotIndex = 0; slotIndex < plan.length; slotIndex++) {
        const generated = generateFallbackPlayer({ seasonId, teamId, slotIndex, group: plan[slotIndex] })
        // Read inside the loop: each insert changes which numbers are free.
        const shirtNumber = await pickAvailableShirtNumber(tx, teamId)
        await tx.player.create({
          data: {
            ...generated,
            teamId,
            careerStatus: "ACTIVE",
            shirtNumber,
            injuryMatchesRemaining: 0,
            suspensionMatches: 0,
            injuryStatus: null,
          },
          select: { id: true },
        })
      }

      // 6. THE CANONICAL REPAIR, not a second lineup algorithm. It keeps every
      // slot the manager chose that is still legal and fills only vacancies.
      await repairTeamLineup(tx, teamId)

      // 7. Re-read and assert, rather than trusting step 5's arithmetic.
      const after = await readActiveRoster(tx, teamId)
      const failed = failedConstraints(after)
      if (failed.length > 0) {
        throw new ReplenishmentIntegrityError(
          `Team ${teamId} still breaches ${failed.join(", ")} after replenishment ` +
            `(total=${after.total} GK=${after.GK} DEF=${after.DF} MID=${after.MF} ATT=${after.FW})`
        )
      }
      if (after.total > MAX_ACTIVE_ROSTER_SIZE) {
        throw new ReplenishmentIntegrityError(`Team ${teamId} exceeds the roster cap: ${after.total}`)
      }
      const lineup = await checkTeamLineup(tx, teamId)
      if (!lineup.legal) {
        throw new ReplenishmentIntegrityError(
          `Team ${teamId} has no legal XI after replenishment: ${lineup.starters}/${lineup.slotCount} [${lineup.problems.join(",")}]`
        )
      }

      // 8. THE LEDGER, LAST. Everything above is committed with it or with
      // nothing. The DB CHECK ownedBefore + generated = ownedAfter refuses a
      // row that does not describe the work that actually happened.
      await tx.squadReplenishment.create({
        data: {
          seasonId,
          teamId,
          ownedBefore: before.total,
          generated: plan.length,
          ownedAfter: after.total,
          floorAtRun: MIN_ACTIVE_ROSTER,
          completedAt: now,
        },
        select: { id: true },
      })

      return { teamId, alreadyCompleted: false, ownedBefore: before.total, generated: plan.length, ownedAfter: after.total }
    },
    { timeout: 30_000, maxWait: 15_000 }
  )
}

export interface SeasonReplenishmentSummary {
  seasonId: string
  teamsConsidered: number
  teamsProcessed: number
  teamsAlreadyCompleted: number
  playersGenerated: number
  remaining: number
  failures: { teamId: string; error: unknown }[]
}

/** Every club that will continue into the next season - the clubs in this season's divisions. */
export async function continuingTeamIds(seasonId: string): Promise<string[]> {
  const rows = await prisma.divisionTeam.findMany({
    where: { division: { seasonId } },
    select: { teamId: true },
    orderBy: { teamId: "asc" },
  })
  return [...new Set(rows.map((row) => row.teamId))]
}

/**
 * One bounded batch of clubs.
 *
 * Ascending club id purely for reproducible logs and resumption. Ordering
 * carries NO sporting meaning here, and that is structural rather than a
 * promise: nothing pre-existing is allocated, so there is nothing an order
 * could award. Every club receives players generated from its own deficits
 * and its own seed.
 */
export async function replenishSeasonSquads(
  seasonId: string,
  batchSize: number = DEFAULT_REPLENISHMENT_BATCH,
  now: Date = new Date()
): Promise<SeasonReplenishmentSummary> {
  const teamIds = await continuingTeamIds(seasonId)
  const done = await prisma.squadReplenishment.findMany({ where: { seasonId }, select: { teamId: true } })
  const completed = new Set(done.map((row) => row.teamId))
  const pending = teamIds.filter((teamId) => !completed.has(teamId))

  const summary: SeasonReplenishmentSummary = {
    seasonId,
    teamsConsidered: teamIds.length,
    teamsProcessed: 0,
    teamsAlreadyCompleted: completed.size,
    playersGenerated: 0,
    remaining: pending.length,
    failures: [],
  }

  for (const teamId of pending.slice(0, batchSize)) {
    try {
      const result = await replenishTeamSquad(seasonId, teamId, now)
      if (!result.alreadyCompleted) {
        summary.teamsProcessed++
        summary.playersGenerated += result.generated
      }
      summary.remaining--
    } catch (error) {
      // One unresolvable club must not strand the other fifty-nine, but it
      // must also stop the stage advancing - which it does, because it never
      // gets a ledger row.
      summary.failures.push({ teamId, error })
    }
  }

  return summary
}


/**
 * THE PRE-CREATE_NEXT LEAGUE GATE.
 *
 * Re-derived from the database, never inferred from the ledger. Counting
 * ledger rows is not enough: transfers execute on the calendar Thursday
 * window regardless of season state (window.ts reads no Season row), so a
 * club replenished on Wednesday can be sold from on Thursday. The voluntary
 * guard should refuse such a sale, and this proves it did.
 */
export async function verifySeasonRosterInvariant(seasonId: string): Promise<{
  ok: boolean
  teamsChecked: number
  failures: RosterInvariantFailure[]
}> {
  const teamIds = await continuingTeamIds(seasonId)
  const ledger = new Set(
    (await prisma.squadReplenishment.findMany({ where: { seasonId }, select: { teamId: true } })).map((r) => r.teamId)
  )
  const failures: RosterInvariantFailure[] = []

  for (const teamId of teamIds) {
    const replenished = ledger.has(teamId)
    // A club with no ledger row is judged on that alone, so the reads below
    // are skipped rather than gathered as evidence for a verdict that is
    // already decided.
    const counts = replenished
      ? await prisma.$transaction((tx) => readActiveRoster(tx, teamId))
      : { total: 0, GK: 0, DF: 0, MF: 0, FW: 0 }
    const lineup = replenished
      ? await prisma.$transaction((tx) => checkTeamLineup(tx, teamId))
      : { legal: true, starters: 0, slotCount: 0, problems: [] }

    // ONE verdict, shared with the production verifier - see roster-invariant.ts.
    const failure = judgeTeamRoster({ teamId, replenished, counts, lineup })
    if (failure) failures.push(failure)
  }

  return { ok: failures.length === 0, teamsChecked: teamIds.length, failures }
}
