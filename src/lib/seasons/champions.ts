/**
 * Writing a division's champion down, once, at the moment it becomes true.
 *
 * The pure decision lives in ./champion.ts; this module is the part that
 * touches the database. It is split that way on purpose - the tie-breaking
 * chain is the thing that must be provably correct, and it is much easier to
 * prove when it cannot reach a database or a clock.
 *
 * WHEN. Champions are fixed at the ACTIVE -> OFFSEASON boundary, not at
 * COMPLETED. That transition is the instant every fixture in every division
 * has both been played and finished, so the table is final and can never
 * change again. COMPLETED happens much later, on the far side of the whole
 * offseason - including WAITING_HUMANS, which waits on real managers'
 * deadlines - and a human can take over a bot club during that window.
 * Attributing a title at COMPLETED would hand it to a manager who arrived
 * after the season was decided.
 */
import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isMatchFinished } from "@/lib/match/timing"
import { instantBelongsToEra } from "@/lib/teams/era"
import { resolveDivisionTitle, type TitleFixture, type TitleOutcome } from "./champion"

/** One division's answer, plus everything needed to write it down or explain why it cannot be. */
export interface DivisionTitleResolution {
  divisionId: string
  seasonId: string
  outcome: TitleOutcome
  /**
   * MAX(scheduledAt) over the division's countable LEAGUE fixtures - the
   * kickoff of the title-deciding matchday. Null only when nothing counted.
   *
   * Kickoff, never playedAt: playedAt is when the engine happened to run,
   * which src/lib/teams/era.ts already rejects as an attribution instant for
   * exactly this reason. This is that same rule applied to the match that
   * settled the title.
   *
   * Phase 2C replaces this with the TITLE_DECIDER's own scheduledAt whenever
   * a decider was played.
   */
  decidedAt: Date | null
}

export interface SeasonTitleResolution {
  seasonId: string
  divisions: DivisionTitleResolution[]
  /** Every division has exactly one champion and a decidedAt - the only state that may be persisted. */
  fullyResolved: boolean
  /** Divisions still level after every head-to-head criterion. Non-empty means Phase 2C is required. */
  needsDecider: DivisionTitleResolution[]
}

/**
 * Resolves every division of a season from data alone.
 *
 * Read-only, and deliberately run OUTSIDE the season transaction. The
 * caller has already established that the season is over, so the table
 * cannot change underneath this; and computeStandings' own client is the
 * global prisma singleton, so running this kind of read inside an
 * interactive transaction would read outside that transaction anyway.
 * The transaction re-asserts readiness under the lock before writing.
 */
export async function resolveSeasonChampions(
  seasonId: string,
  now: Date = new Date()
): Promise<SeasonTitleResolution> {
  const divisions = await prisma.division.findMany({
    where: { seasonId },
    select: {
      id: true,
      teams: { select: { teamId: true } },
      fixtures: {
        // LEAGUE only. A title decider must never be an input to the
        // calculation that called for it, and a promotion playoff is not
        // the league either.
        where: { stage: "LEAGUE" },
        select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true, scheduledAt: true },
      },
    },
    orderBy: { id: "asc" },
  })

  const resolutions: DivisionTitleResolution[] = divisions.map((division) => {
    // The same two-part gate computeStandings and countsTowardRecord use:
    // the live window has fully played out AND a result is actually stored.
    // The engine writes the final score at kickoff, so a stored score alone
    // would let a match still being watched decide a championship.
    const countable = division.fixtures.filter(
      (f) => isMatchFinished(f.scheduledAt, now) && f.homeScore !== null && f.awayScore !== null
    )

    const titleFixtures: TitleFixture[] = countable.map((f) => ({
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      homeScore: f.homeScore,
      awayScore: f.awayScore,
    }))

    let decidedAt: Date | null = null
    for (const f of countable) {
      if (f.scheduledAt && (!decidedAt || f.scheduledAt.getTime() > decidedAt.getTime())) decidedAt = f.scheduledAt
    }

    return {
      divisionId: division.id,
      seasonId,
      outcome: resolveDivisionTitle(
        division.teams.map((t) => t.teamId),
        titleFixtures
      ),
      decidedAt,
    }
  })

  const needsDecider = resolutions.filter((r) => r.outcome.kind === "decider")
  const fullyResolved =
    resolutions.length > 0 &&
    resolutions.every((r) => r.outcome.kind === "resolved" && r.decidedAt !== null)

  return { seasonId, divisions: resolutions, fullyResolved, needsDecider }
}

/**
 * Which era held this club at `at` - the manager snapshot the title is
 * attributed to.
 *
 * Uses instantBelongsToEra, the project's single ownership-interval rule,
 * rather than a second copy of the half-open window logic. Team.userId is
 * never read: that is CURRENT ownership, and a title is not current.
 *
 * Returns null only if the club genuinely has no era covering that instant,
 * which ensureBotEra and the era backfill between them make impossible in
 * practice. A null is recorded rather than thrown so a data defect can never
 * block a season from ending.
 */
export async function findEraAt(
  tx: Prisma.TransactionClient,
  teamId: string,
  at: Date
): Promise<{ id: string } | null> {
  const eras = await tx.teamEra.findMany({
    where: { teamId },
    select: { id: true, teamId: true, startedAt: true, endedAt: true },
    orderBy: { startedAt: "asc" },
  })
  const match = eras.find((era) => instantBelongsToEra(at, era))
  return match ? { id: match.id } : null
}

export interface PersistedChampion {
  divisionId: string
  teamId: string
  teamEraId: string | null
  decidedAt: Date
  created: boolean
}

/**
 * Writes one champion row per division, inside the caller's transaction.
 *
 * Idempotent twice over: skipDuplicates leans on the
 * SeasonChampion_divisionId_key unique index, so a second run writes
 * nothing rather than failing, and the index means a duplicate is
 * impossible however this is reached. The orchestrator's compare-and-set on
 * (status, offseasonStage) already prevents a second run from getting here
 * at all; this is the structural backstop underneath it.
 *
 * Refuses outright rather than guessing: a division without a unique
 * champion, or without a decidedAt, is not written. Phase 2B never invents a
 * champion, and never creates a decider - it fails closed and leaves the
 * season ACTIVE.
 */
export async function persistSeasonChampions(
  tx: Prisma.TransactionClient,
  resolution: SeasonTitleResolution
): Promise<PersistedChampion[]> {
  if (!resolution.fullyResolved) {
    throw new Error(
      `Refusing to persist champions for season ${resolution.seasonId}: ${resolution.needsDecider.length} division(s) still tied.`
    )
  }

  const rows: PersistedChampion[] = []
  for (const division of resolution.divisions) {
    if (division.outcome.kind !== "resolved" || division.decidedAt === null) continue

    const teamId = division.outcome.teamId
    const decidedAt = division.decidedAt
    const era = await findEraAt(tx, teamId, decidedAt)

    const existing = await tx.seasonChampion.findUnique({
      where: { divisionId: division.divisionId },
      select: { id: true },
    })
    if (!existing) {
      await tx.seasonChampion.create({
        data: {
          seasonId: resolution.seasonId,
          divisionId: division.divisionId,
          teamId,
          teamEraId: era?.id ?? null,
          decidedAt,
        },
      })
    }

    rows.push({
      divisionId: division.divisionId,
      teamId,
      teamEraId: era?.id ?? null,
      decidedAt,
      created: !existing,
    })
  }
  return rows
}
