import { prisma } from "@/lib/prisma"
import { generateDoubleRoundRobin } from "@/lib/leagues/round-robin"
import { computeMatchdayDate, getNextSeasonStartMonday } from "@/lib/match/schedule"
import { SeasonLifecycleError } from "./errors"
import { verifyNextSeasonMembership } from "./promotion/membership"

// Same reasoning as the league seed's own INSERT_CHUNK: Postgres caps a
// statement at 65535 bound parameters, and this keeps 1140 fixture rows to a
// handful of statements without ever approaching it.
const INSERT_CHUNK = 200

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** A double round-robin between `teamCount` clubs is exactly this many fixtures - 380 for 20 clubs. */
export function expectedFixtureCount(teamCount: number): number {
  return teamCount * (teamCount - 1)
}

export interface NextSeasonStructureResult {
  nextSeasonId: string
  nextSeasonNumber: number
  divisions: number
  memberships: number
  fixturesCreated: number
  /** Fixtures that a previous crashed run left half-written and this run rebuilt. */
  fixturesRepaired: number
  seasonStartMonday: Date
}

/**
 * Builds season N+1's FIXTURES, and nothing else.
 *
 * IT NO LONGER CREATES MEMBERSHIP, AND MUST NEVER DO SO AGAIN. Until Phase 3Q
 * this function mirrored season N's DivisionTeam rows into season N+1 - which
 * was correct only while promotion did not exist, and is now the single most
 * dangerous thing that could come back. A CREATE_NEXT retry that re-copied the
 * old membership on top of a moved league would put clubs in two divisions at
 * once, and the fixture count would not notice: twenty WRONG clubs still
 * produce exactly 380 fixtures, so the repair branch below would see nothing
 * amiss. Membership has exactly one author now,
 * src/lib/seasons/promotion/membership.ts, and this function REFUSES to run
 * until that author has finished.
 *
 * Idempotent and crash-safe, because nothing here relies on remembering how
 * far a previous run got: each piece is checked against the data itself.
 *
 *  - Fixtures are compared against the exact count a double round-robin must
 *    produce. A division left PARTIALLY written by a crash (0 < n < expected)
 *    is rebuilt from scratch rather than topped up - safe only because this
 *    season has never been played, which is asserted before deleting.
 *
 * Deliberately NOT one big interactive transaction. 1140 fixtures in a single
 * Prisma interactive transaction is exactly the shape that produced P2028
 * timeouts in this project before; each division's fixtures commit on their own.
 */
export async function ensureNextSeasonFixtures(
  nextSeasonId: string,
  now: Date = new Date()
): Promise<NextSeasonStructureResult> {
  const nextSeason = await prisma.season.findUnique({
    where: { id: nextSeasonId },
    select: { id: true, number: true },
  })
  if (!nextSeason) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `No such season: ${nextSeasonId}`)
  }

  const divisions = await prisma.division.findMany({
    where: { seasonId: nextSeasonId },
    orderBy: [{ tier: "asc" }, { group: "asc" }],
    select: { id: true, _count: { select: { teams: true } } },
  })
  if (divisions.length === 0) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `Season ${nextSeasonId} has no divisions to schedule`)
  }

  // THE MEMBERSHIP PRECONDITION. Fixtures are generated FROM the membership
  // list, so a division with no members would silently produce a season with
  // no matches, and CREATE_NEXT would report success. Refusing here is what
  // makes "movement first, always" a runtime fact rather than an ordering
  // convention somebody could reorder.
  const empty = divisions.filter((d) => d._count.teams === 0)
  if (empty.length > 0) {
    throw new SeasonLifecycleError(
      "SEASON_NOT_FOUND",
      `Refusing to schedule season ${nextSeasonId}: ${empty.length} division(s) have no members. ` +
        `Membership is written by the PROMOTION_RELEGATION stage and must be complete first.`
    )
  }

  // One schedule anchor for the whole season. Re-derived from fixtures that
  // already exist so a resumed run cannot give different divisions different
  // start dates; only a season with no fixtures at all picks a fresh Monday.
  const earliestExisting = await prisma.fixture.findFirst({
    where: { division: { seasonId: nextSeason.id } },
    orderBy: { scheduledAt: "asc" },
    select: { scheduledAt: true },
  })
  const seasonStartMonday = earliestExisting?.scheduledAt ?? getNextSeasonStartMonday(now)

  let fixturesCreated = 0
  let fixturesRepaired = 0

  for (const division of divisions) {
    const result = await ensureDivisionFixtures(division.id, nextSeason.id, seasonStartMonday)
    fixturesCreated += result.created
    fixturesRepaired += result.repaired
  }

  return {
    nextSeasonId: nextSeason.id,
    nextSeasonNumber: nextSeason.number,
    divisions: divisions.length,
    memberships: divisions.reduce((sum, d) => sum + d._count.teams, 0),
    fixturesCreated,
    fixturesRepaired,
    seasonStartMonday,
  }
}

/**
 * One division's full fixture list, written exactly once.
 *
 * The whole thing runs inside a transaction that LOCKS the division row
 * first, because counting fixtures and then creating them is otherwise a
 * plain read-then-write race: two concurrent runs both counted zero and both
 * inserted, leaving a division with twice its schedule. With the lock, the
 * loser waits, re-counts, finds the schedule already complete, and does
 * nothing.
 *
 * The transaction is deliberately scoped to ONE division - 380 rows in two
 * chunked statements - rather than the whole 1140-fixture season, which is
 * the transaction size that has caused P2028 timeouts in this project
 * before. It is the same granularity the league seed already commits at.
 */
async function ensureDivisionFixtures(
  divisionId: string,
  seasonId: string,
  seasonStartMonday: Date
): Promise<{ created: number; repaired: number }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Division" WHERE id = ${divisionId} FOR UPDATE`

      // Read back under the lock, so a concurrent run's memberships are
      // included and fixtures are paired against what actually exists.
      const teamIds = (
        await tx.divisionTeam.findMany({
          where: { divisionId },
          orderBy: { joinedAt: "asc" },
          select: { teamId: true },
        })
      ).map((m) => m.teamId)

      const expected = expectedFixtureCount(teamIds.length)
      // LEAGUE only: expectedFixtureCount describes a double round-robin,
      // so counting anything else against it would compare two different
      // things. A prepared season has no decider yet, but the count must
      // mean what its name says regardless of when it happens to run.
      const existing = await tx.fixture.count({ where: { divisionId, stage: "LEAGUE" } })
      if (existing === expected) return { created: 0, repaired: 0 }

      let repaired = 0
      if (existing > 0) {
        // A crash mid-insert. Rebuilding is only safe because this season
        // has never kicked off - assert that rather than trust it.
        // Deliberately NOT filtered by stage: this asks "has anything at
        // all been played here", and the answer must be yes for a decider
        // too. It guards a deleteMany, so it errs toward refusing.
        const played = await tx.fixture.count({ where: { divisionId, playedAt: { not: null } } })
        if (played > 0) {
          throw new SeasonLifecycleError(
            "SEASON_NOT_FOUND",
            `Division ${divisionId} of season ${seasonId} has ${played} played fixtures - refusing to rebuild its schedule`
          )
        }
        await tx.fixture.deleteMany({ where: { divisionId } })
        repaired = existing
      }

      const fixtures = generateDoubleRoundRobin(teamIds)
      for (const batch of chunk(fixtures, INSERT_CHUNK)) {
        await tx.fixture.createMany({
          data: batch.map((f) => ({
            divisionId,
            matchday: f.matchday,
            homeTeamId: f.homeTeamId,
            awayTeamId: f.awayTeamId,
            scheduledAt: computeMatchdayDate(seasonStartMonday, f.matchday),
          })),
        })
      }
      return { created: fixtures.length, repaired }
    },
    { timeout: 30_000 }
  )
}

/**
 * Pushes a prepared season's whole schedule forward if its first kickoff is
 * no longer far enough away - which happens when a crash (or a long
 * human-decision window) leaves a structure built days before it is
 * switched on. Only ever touches a season with nothing played.
 */
export async function rescheduleIfStale(nextSeasonId: string, now: Date = new Date()): Promise<Date | null> {
  const earliest = await prisma.fixture.findFirst({
    where: { division: { seasonId: nextSeasonId } },
    orderBy: { scheduledAt: "asc" },
    select: { scheduledAt: true },
  })
  if (!earliest?.scheduledAt) return null

  const freshStart = getNextSeasonStartMonday(now)
  if (earliest.scheduledAt.getTime() >= freshStart.getTime()) return null

  const played = await prisma.fixture.count({
    where: { division: { seasonId: nextSeasonId }, playedAt: { not: null } },
  })
  if (played > 0) return null

  const fixtures = await prisma.fixture.findMany({
    where: { division: { seasonId: nextSeasonId } },
    select: { id: true, matchday: true },
  })
  for (const batch of chunk(fixtures, INSERT_CHUNK)) {
    await prisma.$transaction(
      batch.map((f) =>
        prisma.fixture.update({
          where: { id: f.id },
          data: { scheduledAt: computeMatchdayDate(freshStart, f.matchday) },
        })
      )
    )
  }
  return freshStart
}

export interface ActivationResult {
  completedSeasonId: string
  activatedSeasonId: string
  alreadyActivated: boolean
}

/**
 * The single moment season N hands over to season N+1. Both writes happen in
 * one short transaction, so the country is never left without an active
 * season and never briefly has two.
 *
 * Order inside the transaction is load-bearing: N is deactivated BEFORE N+1
 * is activated. The Season_countryCode_active_key partial unique index
 * (UNIQUE(countryCode) WHERE isActive) is a plain index, not a deferrable
 * constraint, so it is enforced per statement - activating N+1 first would
 * fail on the spot.
 */
export async function activateNextSeason(
  oldSeasonId: string,
  nextSeasonId: string
): Promise<ActivationResult> {
  return prisma.$transaction(async (tx) => {
    // Locked in a fixed id order so two concurrent orchestrators can never
    // take these two rows in opposite orders and deadlock.
    const [firstId, secondId] = [oldSeasonId, nextSeasonId].sort()
    await tx.$queryRaw`SELECT id FROM "Season" WHERE id = ${firstId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "Season" WHERE id = ${secondId} FOR UPDATE`

    const oldSeason = await tx.season.findUniqueOrThrow({ where: { id: oldSeasonId } })
    const nextSeason = await tx.season.findUniqueOrThrow({ where: { id: nextSeasonId } })

    // The loser of a race finds the handover already done and reports it,
    // rather than trying to redo it.
    if (nextSeason.isActive && !oldSeason.isActive) {
      return { completedSeasonId: oldSeasonId, activatedSeasonId: nextSeasonId, alreadyActivated: true }
    }

    await tx.season.update({
      where: { id: oldSeasonId },
      data: { isActive: false, status: "COMPLETED", offseasonStage: "DONE" },
    })
    await tx.season.update({
      where: { id: nextSeasonId },
      data: { isActive: true, status: "ACTIVE", offseasonStage: "NONE" },
    })

    return { completedSeasonId: oldSeasonId, activatedSeasonId: nextSeasonId, alreadyActivated: false }
  })
}

/**
 * Whether a prepared season may be switched on - checked against the data,
 * never against a stored flag, and never against "greater than zero".
 *
 * Until Phase 3Q this asked only that every division had SOME clubs and the
 * right number of fixtures for however many it had. That was sufficient while
 * membership was a verbatim copy of a known-good season. It is not sufficient
 * once movement decides membership: a division with nineteen clubs produces
 * exactly the fixture count nineteen clubs should have, so the old check would
 * have passed a broken league and activated it.
 *
 * What it now proves, all of it re-derived from the database:
 *   - the same number of divisions as season N, at the same sizes
 *   - exactly the season N cohort, every club exactly once
 *   - no club in two divisions of the season
 *   - a complete double round-robin per division
 *   - every LEAGUE fixture played between members of its own division
 *
 * That last one is scoped to LEAGUE deliberately. A PROMOTION_PLAYOFF fixture
 * is filed on the tier 1 division and played by four tier 2 clubs; it is not
 * the league, and FixtureStage is what says so. The membership rule is a
 * league rule.
 */
export async function isNextSeasonStructureComplete(
  oldSeasonId: string,
  nextSeasonId: string
): Promise<{ ok: boolean; failures: string[] }> {
  const verdict = await verifyNextSeasonMembership(oldSeasonId, nextSeasonId)
  const failures = [...verdict.failures]

  const divisions = await prisma.division.findMany({
    where: { seasonId: nextSeasonId },
    orderBy: [{ tier: "asc" }, { group: "asc" }],
    select: {
      id: true,
      tier: true,
      group: true,
      teams: { select: { teamId: true } },
      fixtures: {
        where: { stage: "LEAGUE" },
        select: { homeTeamId: true, awayTeamId: true },
      },
    },
  })

  for (const division of divisions) {
    const label = `tier ${division.tier}${division.group ?? ""}`
    const expected = expectedFixtureCount(division.teams.length)
    if (division.fixtures.length !== expected) {
      failures.push(`${label} has ${division.fixtures.length} LEAGUE fixtures, expected ${expected}`)
      continue
    }
    const members = new Set(division.teams.map((t) => t.teamId))
    for (const fixture of division.fixtures) {
      if (!members.has(fixture.homeTeamId) || !members.has(fixture.awayTeamId)) {
        failures.push(`${label} has a LEAGUE fixture between clubs that are not both its members`)
        break
      }
    }
  }

  return { ok: failures.length === 0, failures }
}
