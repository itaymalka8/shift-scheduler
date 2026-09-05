/**
 * MATCH CONSEQUENCE ACTIVATION - where a finished match finally changes the
 * players who played it.
 *
 * ================= WHY THIS IS NOT PART OF THE SIMULATION =================
 *
 * The engine writes the WHOLE match at kickoff: final score, every event,
 * every PlayerMatchStats row. The match then plays out on screen over the
 * next ten real minutes. Everything public in this codebase already knows
 * that and gates on `isMatchFinished`, not on `playedAt` (see
 * match/fixture-status.ts, players/profile.ts, halloffame).
 *
 * Player state is different in one fatal way: it has NO gate. /squad,
 * /players, /players/[id] and the transfer market all read Player rows
 * directly and truthfully. So writing `status = "injured"` at kickoff would
 * put the outcome of a live match on the squad screen two minutes in - a
 * reader could learn their striker got hurt in the 78th minute while the
 * broadcast was still in the 20th. Writing fitness at kickoff leaks the same
 * way, more quietly: a starter's condition dropping is proof they played the
 * full match.
 *
 * SO NOTHING IS WRITTEN AT KICKOFF. simulate.ts touches no Player row at all
 * - a source guard asserts it - and every consequence is applied HERE, once
 * the fixture is publicly finished, by the same
 * `scheduledAt <= now - MATCH_REAL_DURATION_MINUTES` predicate the Player
 * Profile already trusts, pushed into SQL.
 *
 * That is the whole anti-spoiler design, and it needs no new gate on any read
 * surface: before the public whistle the new state does not exist yet, so
 * there is nothing for a page to leak. It also settles the effective-time
 * question - a consequence becomes effective for team selection at the
 * moment the match becomes public, never before - and it means the ten
 * minutes of a live match can never alter a manager's XI for another game.
 *
 * ======================= EXACTLY ONCE, AND WHY ============================
 *
 * processDueFixtures is retryable and the cron may run twice concurrently, so
 * "apply the consequences" must be exactly-once or a retry deducts fitness
 * twice and serves a ban that was never served.
 *
 * Fixture.consequencesAppliedAt is that ledger. The whole application runs
 * inside one transaction whose FIRST statement locks the fixture row and
 * re-reads it; a run that finds the column already set commits nothing. The
 * result is the same shape the season lifecycle already uses for players:
 * there is no state where a fixture is marked applied without its writes, or
 * carries its writes without being marked.
 *
 * ===================== ONE EVENT MOVES EVERY COUNTER ======================
 *
 * Fitness recovery, injury countdown and suspension serving all happen at
 * exactly one moment: the public finish of one of that player's club's
 * fixtures. Not per cron tick (which would tick every two minutes), not per
 * calendar day (which would heal people through a postponement), and never on
 * a page load. One event, one ledger, one idempotency proof for all three.
 */
import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { MATCH_REAL_DURATION_MINUTES } from "./timing"
import { nextFitness, injuryMatchesFor, suspensionFromMatch } from "./consequences"
import {
  availabilityUpdate,
  hasSomethingToServe,
  serveOneFixture,
  type PlayerAvailabilityFacts,
} from "@/lib/players/availability"
import { repairTeamLineup } from "@/lib/players/lineup-repair"

/** How many fixtures one activation run handles - keeps a tick bounded. */
export const DEFAULT_CONSEQUENCE_BATCH = 20

/**
 * WHICH COMPETITIONS COUNT.
 *
 * All of them. A title decider and a championship playoff are real
 * competitive matches between the same clubs, so a ban earned in the league
 * is served in them and a booking in one counts toward the same seasonal
 * total. Treating a playoff as a friendly would be exactly the silent
 * special-casing this decision exists to avoid, and V1 is better served by
 * one rule than by two. Written down here so it is a decision rather than an
 * accident of a missing filter.
 */
export const SUSPENSIONS_APPLY_TO_ALL_STAGES = true

export interface FixtureConsequenceSummary {
  fixtureId: string
  applied: boolean
  /** True when another run had already applied this fixture. */
  alreadyApplied: boolean
  playersUpdated: number
  injuriesStarted: number
  suspensionsAdded: number
  suspensionMatchesServed: number
  injuryMatchesServed: number
  lineupsRepaired: number
}

const CONSEQUENCE_PLAYER_SELECT = {
  id: true,
  teamId: true,
  fitness: true,
  stamina: true,
  careerStatus: true,
  injuryMatchesRemaining: true,
  suspensionMatches: true,
} as const

/**
 * Applies one publicly-finished fixture's consequences, or does nothing.
 *
 * ORDER INSIDE THE TRANSACTION IS LOAD-BEARING:
 *
 *   1. lock the fixture and re-read the ledger under the lock
 *   2. SERVE - everyone who sat this one out steps a counter down
 *   3. APPLY - everyone who played gets their fitness, injury and cards
 *
 * Serving before applying is what stops a red card in THIS match from being
 * served by THIS match. And serving is scoped to players who did not appear,
 * so it can never shorten a ban for somebody who was on the pitch.
 */
export async function applyFixtureConsequences(fixtureId: string, now: Date = new Date()): Promise<FixtureConsequenceSummary> {
  const empty: FixtureConsequenceSummary = {
    fixtureId,
    applied: false,
    alreadyApplied: false,
    playersUpdated: 0,
    injuriesStarted: 0,
    suspensionsAdded: 0,
    suspensionMatchesServed: 0,
    injuryMatchesServed: 0,
    lineupsRepaired: 0,
  }

  return prisma.$transaction(async (tx) => {
    // 1. THE LEDGER, UNDER A LOCK. Two concurrent runs serialize here and the
    // loser sees the winner's committed row.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Fixture" WHERE id = ${fixtureId} FOR UPDATE`
    if (locked.length === 0) return empty

    const fixture = await tx.fixture.findUniqueOrThrow({
      where: { id: fixtureId },
      select: {
        id: true,
        matchSeed: true,
        playedAt: true,
        scheduledAt: true,
        consequencesAppliedAt: true,
        homeTeamId: true,
        awayTeamId: true,
        division: { select: { seasonId: true } },
      },
    })
    if (fixture.consequencesAppliedAt !== null) return { ...empty, alreadyApplied: true }
    if (fixture.playedAt === null || fixture.scheduledAt === null) return empty
    // Belt and braces on top of the caller's SQL predicate: never activate a
    // match the public has not seen finish.
    const publicCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)
    if (fixture.scheduledAt > publicCutoff) return empty

    const teamIds = [fixture.homeTeamId, fixture.awayTeamId]
    const stats = await tx.playerMatchStats.findMany({
      where: { fixtureId },
      select: { playerId: true, minutesPlayed: true, yellowCards: true, redCards: true },
    })
    const statsByPlayer = new Map(stats.map((row) => [row.playerId, row]))

    const players = await tx.player.findMany({ where: { teamId: { in: teamIds } }, select: CONSEQUENCE_PLAYER_SELECT })

    // The injured, straight from the match the engine already played. No
    // second injury is rolled here - only the duration of one that happened.
    const injuryEvents = await tx.matchEvent.findMany({
      where: { fixtureId, type: "injury", playerId: { not: null } },
      select: { playerId: true },
    })
    const injuredIds = new Set(injuryEvents.map((event) => event.playerId).filter((id): id is string => id !== null))

    // Season-to-date yellows BEFORE this fixture, for the accumulation
    // threshold. Summed from PlayerMatchStats - the canonical disciplinary
    // record - rather than from a counter that could drift.
    const bookedIds = stats.filter((row) => row.yellowCards > 0).map((row) => row.playerId)
    const yellowsBefore = new Map<string, number>()
    if (bookedIds.length > 0) {
      const priorRows = await tx.playerMatchStats.groupBy({
        by: ["playerId"],
        where: {
          playerId: { in: bookedIds },
          fixtureId: { not: fixtureId },
          fixture: {
            playedAt: { not: null },
            scheduledAt: { not: null, lt: fixture.scheduledAt },
            division: { seasonId: fixture.division.seasonId },
          },
        },
        _sum: { yellowCards: true },
      })
      for (const row of priorRows) yellowsBefore.set(row.playerId, row._sum.yellowCards ?? 0)
    }

    let playersUpdated = 0
    let injuriesStarted = 0
    let suspensionsAdded = 0
    let suspensionMatchesServed = 0
    let injuryMatchesServed = 0

    for (const player of players) {
      if (player.careerStatus !== "ACTIVE") continue
      const appearance = statsByPlayer.get(player.id)

      // 2. SERVE - only for players who did NOT appear in this fixture.
      let facts: PlayerAvailabilityFacts = {
        careerStatus: player.careerStatus,
        injuryMatchesRemaining: player.injuryMatchesRemaining,
        suspensionMatches: player.suspensionMatches,
      }
      if (!appearance && hasSomethingToServe(facts)) {
        if (facts.suspensionMatches > 0) suspensionMatchesServed++
        if (facts.injuryMatchesRemaining > 0) injuryMatchesServed++
        facts = serveOneFixture(facts)
      }

      // 3. APPLY - the match's own consequences, on top.
      const fitness = nextFitness(player.fitness, appearance ? appearance.minutesPlayed : null, player.stamina)

      let injuryStatus: string | null | undefined
      if (appearance && injuredIds.has(player.id) && fixture.matchSeed) {
        const matches = injuryMatchesFor(fixture.matchSeed, player.id)
        // An injury replaces whatever was left of an older one rather than
        // stacking: a player cannot be hurt twice over at the same moment.
        facts = { ...facts, injuryMatchesRemaining: Math.max(facts.injuryMatchesRemaining, matches) }
        injuryStatus = "matchInjury"
        injuriesStarted++
      }

      if (appearance) {
        const added = suspensionFromMatch({
          yellowsBefore: yellowsBefore.get(player.id) ?? 0,
          yellowsInMatch: appearance.yellowCards,
          redsInMatch: appearance.redCards,
        })
        if (added > 0) {
          facts = { ...facts, suspensionMatches: facts.suspensionMatches + added }
          suspensionsAdded += added
        }
      }

      const update = availabilityUpdate(facts, injuryStatus)
      const unchanged =
        fitness === player.fitness &&
        update.injuryMatchesRemaining === player.injuryMatchesRemaining &&
        update.suspensionMatches === player.suspensionMatches
      if (unchanged && update.injuryStatus === undefined) continue

      await tx.player.update({ where: { id: player.id }, data: { fitness, ...update } })
      playersUpdated++
    }

    // A new injury or ban can leave a starter ineligible, so both clubs are
    // repaired in the SAME transaction - the XI is never briefly illegal.
    let lineupsRepaired = 0
    for (const teamId of teamIds) {
      const repair = await repairTeamLineup(tx, teamId)
      if (repair.replaced > 0) lineupsRepaired++
    }

    await tx.fixture.update({ where: { id: fixtureId }, data: { consequencesAppliedAt: now } })

    return {
      fixtureId,
      applied: true,
      alreadyApplied: false,
      playersUpdated,
      injuriesStarted,
      suspensionsAdded,
      suspensionMatchesServed,
      injuryMatchesServed,
      lineupsRepaired,
    }
  })
}

export interface ConsequenceActivationSummary {
  fixturesFound: number
  fixturesApplied: number
  playersUpdated: number
  injuriesStarted: number
  suspensionsAdded: number
  failures: { fixtureId: string; error: unknown }[]
}

/**
 * The cron step. FIXTURE-DRIVEN, never a scan of every player: the due set is
 * exactly "played, publicly finished, not yet applied", served by the
 * (consequencesAppliedAt, scheduledAt) index and shrinking to nothing as the
 * work is done.
 *
 * Oldest first, so a backlog is served in the order the matches were played
 * and a ban is never served by a fixture that came after the one that should
 * have served it.
 */
export async function activateDueMatchConsequences(
  now: Date = new Date(),
  batchSize: number = DEFAULT_CONSEQUENCE_BATCH
): Promise<ConsequenceActivationSummary> {
  const publicCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)
  const due = await prisma.fixture.findMany({
    where: {
      consequencesAppliedAt: null,
      playedAt: { not: null },
      scheduledAt: { not: null, lte: publicCutoff },
    },
    orderBy: { scheduledAt: "asc" },
    take: batchSize,
    select: { id: true },
  })

  const summary: ConsequenceActivationSummary = {
    fixturesFound: due.length,
    fixturesApplied: 0,
    playersUpdated: 0,
    injuriesStarted: 0,
    suspensionsAdded: 0,
    failures: [],
  }

  for (const fixture of due) {
    try {
      const result = await applyFixtureConsequences(fixture.id, now)
      if (result.applied) {
        summary.fixturesApplied++
        summary.playersUpdated += result.playersUpdated
        summary.injuriesStarted += result.injuriesStarted
        summary.suspensionsAdded += result.suspensionsAdded
      }
    } catch (error) {
      // One fixture failing must not strand every later one.
      summary.failures.push({ fixtureId: fixture.id, error })
    }
  }

  return summary
}

/** Exposed for the preflight validator - the same predicate, one definition. */
export function publicFinishCutoff(now: Date): Date {
  return new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)
}

export type { Prisma }
