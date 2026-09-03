import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { generateDoubleRoundRobin } from "@/lib/leagues/round-robin"
import { computeMatchdayDate, getNextSeasonStartMonday } from "@/lib/match/schedule"
import { SeasonLifecycleError } from "./errors"

// Same reasoning as the league seed's own INSERT_CHUNK: Postgres caps a
// statement at 65535 bound parameters, and this keeps 1140 fixture rows to a
// handful of statements without ever approaching it.
const INSERT_CHUNK = 200

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The season N+1 row, created at most once however many runs race for it.
 *
 * Prisma's upsert is find-then-write, not an atomic INSERT ... ON CONFLICT,
 * so two concurrent orchestrators both find nothing and both insert - one
 * wins and the other gets a raw P2002 on @@unique([countryCode, number]).
 * That constraint IS the authority here; losing the race just means reading
 * back what the winner created, exactly as the youth intake generator does
 * for its own uniqueness race.
 */
async function upsertNextSeasonRow(countryCode: string, number: number): Promise<{ id: string; number: number }> {
  const existing = await prisma.season.findUnique({
    where: { countryCode_number: { countryCode, number } },
    select: { id: true, number: true },
  })
  if (existing) return existing

  try {
    // Created dormant on purpose: isActive false (season N is still the
    // country's live one, and the partial unique index allows only one), and
    // status OFFSEASON because that is the honest description of a season
    // that exists but is not being played. Nothing here claims it is under
    // way - that only becomes true in activateNextSeason below.
    return await prisma.season.create({
      data: { countryCode, number, isActive: false, status: "OFFSEASON", offseasonStage: "NONE" },
      select: { id: true, number: true },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.season.findUnique({
        where: { countryCode_number: { countryCode, number } },
        select: { id: true, number: true },
      })
      if (winner) return winner
    }
    throw error
  }
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
 * Builds season N+1's whole structure - the season row, its divisions, their
 * memberships and their fixtures - without ever switching it on. Idempotent
 * and crash-safe at every step, because nothing here relies on remembering
 * how far a previous run got: each piece is checked against the data itself.
 *
 *  - The season row is an upsert on the existing @@unique([countryCode,
 *    number]), so two concurrent runs produce one season, not two.
 *  - Divisions are upserts on @@unique([seasonId, tier, group]).
 *  - Memberships are createMany({ skipDuplicates }) behind
 *    @@unique([divisionId, teamId]).
 *  - Fixtures are compared against the exact count a double round-robin must
 *    produce. A division left PARTIALLY written by a crash (0 < n < expected)
 *    is rebuilt from scratch rather than topped up - safe only because this
 *    season has never been played, which is asserted before deleting.
 *
 * Deliberately NOT one big interactive transaction. 1 season + 3 divisions +
 * 60 memberships + 1140 fixtures in a single Prisma interactive transaction
 * is exactly the shape that produced P2028 timeouts in this project before;
 * each division's fixtures commit on their own instead.
 *
 * Promotion and relegation are out of scope for V1, so every club stays in
 * the division it was in: the new structure mirrors season N's own divisions
 * and memberships rather than re-deriving anything from league config.
 */
export async function ensureNextSeasonStructure(
  oldSeasonId: string,
  now: Date = new Date()
): Promise<NextSeasonStructureResult> {
  const oldSeason = await prisma.season.findUnique({
    where: { id: oldSeasonId },
    select: { id: true, countryCode: true, number: true },
  })
  if (!oldSeason) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `No such season: ${oldSeasonId}`)
  }

  const nextNumber = oldSeason.number + 1

  const nextSeason = await upsertNextSeasonRow(oldSeason.countryCode, nextNumber)

  const oldDivisions = await prisma.division.findMany({
    where: { seasonId: oldSeason.id },
    orderBy: [{ tier: "asc" }, { group: "asc" }],
    select: {
      tier: true,
      group: true,
      name: true,
      teams: { orderBy: { joinedAt: "asc" }, select: { teamId: true } },
    },
  })
  if (oldDivisions.length === 0) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `Season ${oldSeasonId} has no divisions to carry forward`)
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

  let memberships = 0
  let fixturesCreated = 0
  let fixturesRepaired = 0

  for (const oldDivision of oldDivisions) {
    // Division.group is nullable in the schema but every real row uses a
    // string ("" for a single-group tier). Normalising null to "" here is
    // also the safer carry-forward: Postgres treats NULLs as distinct in a
    // unique index, so a NULL group would quietly defeat the
    // @@unique([seasonId, tier, group]) this upsert relies on.
    const group = oldDivision.group ?? ""
    const division = await ensureDivisionRow(nextSeason.id, oldDivision.tier, group, oldDivision.name)

    const created = await prisma.divisionTeam.createMany({
      data: oldDivision.teams.map((t) => ({ divisionId: division.id, teamId: t.teamId })),
      skipDuplicates: true,
    })
    memberships += created.count

    const result = await ensureDivisionFixtures(division.id, nextSeason.id, seasonStartMonday)
    fixturesCreated += result.created
    fixturesRepaired += result.repaired
  }

  return {
    nextSeasonId: nextSeason.id,
    nextSeasonNumber: nextSeason.number,
    divisions: oldDivisions.length,
    memberships,
    fixturesCreated,
    fixturesRepaired,
    seasonStartMonday,
  }
}

/**
 * The division row for season N+1, created at most once under concurrency -
 * same find-then-create race, and same resolution, as upsertNextSeasonRow.
 */
async function ensureDivisionRow(
  seasonId: string,
  tier: number,
  group: string,
  name: string
): Promise<{ id: string }> {
  const existing = await prisma.division.findUnique({
    where: { seasonId_tier_group: { seasonId, tier, group } },
    select: { id: true },
  })
  if (existing) return existing

  try {
    return await prisma.division.create({ data: { seasonId, tier, group, name }, select: { id: true } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.division.findUnique({
        where: { seasonId_tier_group: { seasonId, tier, group } },
        select: { id: true },
      })
      if (winner) return winner
    }
    throw error
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

/** Whether a prepared season's structure is complete enough to switch on - checked against the data, never a stored flag. */
export async function isNextSeasonStructureComplete(nextSeasonId: string, expectedDivisions: number): Promise<boolean> {
  const divisions = await prisma.division.findMany({
    where: { seasonId: nextSeasonId },
    select: {
      id: true,
      _count: { select: { teams: true, fixtures: { where: { stage: "LEAGUE" } } } },
    },
  })
  if (divisions.length !== expectedDivisions) return false
  // Compared against expectedFixtureCount, which counts a double
  // round-robin - so the count it is compared with must be league fixtures
  // and nothing else.
  return divisions.every((d) => d._count.teams > 0 && d._count.fixtures === expectedFixtureCount(d._count.teams))
}
