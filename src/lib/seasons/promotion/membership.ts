/**
 * WRITING SEASON N+1's MEMBERSHIP - the PROMOTION_RELEGATION stage's work.
 *
 * Creates NO sporting fixture. Every match that could change who goes up or
 * down was played while season N was still ACTIVE; by the time this runs the
 * results are permanent, so the movement it derives is a pure function of
 * facts that cannot change again. That is what makes this stage idempotent
 * with no ledger table: a retry recomputes the identical answer.
 *
 * ONE ATOMIC WRITE. All sixty rows commit together or none of them do. Sixty
 * rows is nothing - contrast the 1140-fixture write, which is chunked per
 * division precisely because it is not - and writing them together removes a
 * whole class of state: there is no "half-moved league" for a later run, or a
 * changed random number generator, to reinterpret. A partial membership is
 * therefore not a resumable state, it is corruption, and this module says so.
 */
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { deriveDrawSeed } from "../draw"
import { SeasonLifecycleError } from "../errors"
import { computeMovement, divisionKey, type FinalDivision, type PlayoffResult } from "./movement"

export interface MembershipResult {
  nextSeasonId: string
  nextSeasonNumber: number
  /** Rows this run created. 0 on a retry that found the work already done. */
  created: number
  /** True when a previous run had already written the identical membership. */
  attested: boolean
  promoted: string[]
  relegated: string[]
  vacanciesByGroup: Record<string, number>
}

/**
 * The season N+1 row and its LEAGUE divisions - structure with no members and
 * no fixtures. Split out of the old ensureNextSeasonStructure so that
 * membership has exactly one author (this file) and CREATE_NEXT has none.
 */
export async function ensureNextSeasonSkeleton(oldSeasonId: string): Promise<{
  nextSeasonId: string
  nextSeasonNumber: number
  divisionIdByKey: Map<string, string>
}> {
  const oldSeason = await prisma.season.findUnique({
    where: { id: oldSeasonId },
    select: { id: true, countryCode: true, number: true },
  })
  if (!oldSeason) throw new SeasonLifecycleError("SEASON_NOT_FOUND", `No such season: ${oldSeasonId}`)

  const oldDivisions = await prisma.division.findMany({
    where: { seasonId: oldSeasonId },
    orderBy: [{ tier: "asc" }, { group: "asc" }],
    select: { tier: true, group: true, name: true },
  })
  if (oldDivisions.length === 0) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `Season ${oldSeasonId} has no divisions to carry forward`)
  }

  const nextNumber = oldSeason.number + 1
  const nextSeason = await upsertSeasonRow(oldSeason.countryCode, nextNumber)

  const divisionIdByKey = new Map<string, string>()
  for (const old of oldDivisions) {
    // Division.group is nullable but every real row uses "" for a single-group
    // tier: Postgres treats NULLs as distinct in a unique index, so a NULL
    // group would quietly defeat @@unique([seasonId, tier, group]).
    const group = old.group ?? ""
    const division = await ensureDivisionRow(nextSeason.id, old.tier, group, old.name)
    divisionIdByKey.set(divisionKey(old.tier, group), division.id)
  }

  return { nextSeasonId: nextSeason.id, nextSeasonNumber: nextSeason.number, divisionIdByKey }
}

/**
 * Created dormant on purpose: isActive false (season N is still the country's
 * live one, and the partial unique index allows only one) and status OFFSEASON,
 * which is the honest description of a season that exists but is not played.
 *
 * Prisma's upsert is find-then-write rather than an atomic INSERT ... ON
 * CONFLICT, so two concurrent orchestrators both find nothing and both insert.
 * @@unique([countryCode, number]) IS the authority; losing the race means
 * reading back what the winner created.
 */
async function upsertSeasonRow(countryCode: string, number: number): Promise<{ id: string; number: number }> {
  const existing = await prisma.season.findUnique({
    where: { countryCode_number: { countryCode, number } },
    select: { id: true, number: true },
  })
  if (existing) return existing
  try {
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

/** Same find-then-create race, same resolution, on @@unique([seasonId, tier, group]). */
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

/** The draw seed for the relegation group assignment - tier 1's own record. */
export function relegationDrawSeed(input: {
  countryCode: string
  seasonNumber: number
  tier1Fixtures: { scheduledAt: Date | null; homeScore: number | null; awayScore: number | null }[]
}): string {
  // "RELEGATION" is a pure domain separator so this draw can never share a
  // seed with a tier 1 title knockout draw of the same season. The fold
  // itself is commutative, so the order the fixtures arrive in cannot matter.
  return deriveDrawSeed(
    { countryCode: input.countryCode, seasonNumber: input.seasonNumber, tier: 1, group: "RELEGATION" },
    input.tier1Fixtures
  )
}

/**
 * Derive the movement and write it - or attest that a previous run wrote
 * exactly this.
 *
 * Three states, and only three:
 *   no membership      -> write all sixty atomically
 *   the expected sixty -> compare as SETS; equal is a no-op, different is
 *                         corruption and fails closed
 *   anything between   -> corruption. One atomic write cannot produce a
 *                         partial result, so a partial result means something
 *                         other than this stage wrote it.
 */
export async function materialiseNextSeasonMembership(input: {
  oldSeasonId: string
  finalDivisions: FinalDivision[]
  playoffResults: PlayoffResult[]
}): Promise<MembershipResult> {
  const season = await prisma.season.findUnique({
    where: { id: input.oldSeasonId },
    select: { countryCode: true, number: true },
  })
  if (!season) throw new SeasonLifecycleError("SEASON_NOT_FOUND", `No such season: ${input.oldSeasonId}`)

  const tier1 = input.finalDivisions.find((d) => d.tier === 1)
  if (!tier1) throw new SeasonLifecycleError("SEASON_NOT_FOUND", "Season has no tier 1 division")

  const tier1Fixtures = await prisma.fixture.findMany({
    where: { divisionId: tier1.divisionId, stage: "LEAGUE" },
    select: { scheduledAt: true, homeScore: true, awayScore: true },
  })

  const plan = computeMovement({
    divisions: input.finalDivisions,
    playoffResults: input.playoffResults,
    drawSeed: relegationDrawSeed({
      countryCode: season.countryCode,
      seasonNumber: season.number,
      tier1Fixtures,
    }),
  })

  const skeleton = await ensureNextSeasonSkeleton(input.oldSeasonId)

  const rows: { divisionId: string; seasonId: string; teamId: string }[] = []
  for (const [key, teamIds] of plan.byDivisionKey) {
    const divisionId = skeleton.divisionIdByKey.get(key)
    if (!divisionId) {
      throw new SeasonLifecycleError("SEASON_NOT_FOUND", `Next season has no division for ${key}`)
    }
    for (const teamId of teamIds) rows.push({ divisionId, seasonId: skeleton.nextSeasonId, teamId })
  }

  const written = await prisma.$transaction(async (tx) => {
    // The next season row is the ordering root, exactly as season N's is for
    // every stage transition. Two runners are serialised here.
    await tx.$queryRaw`SELECT id FROM "Season" WHERE id = ${skeleton.nextSeasonId} FOR UPDATE`

    const existing = await tx.divisionTeam.findMany({
      where: { seasonId: skeleton.nextSeasonId },
      select: { divisionId: true, teamId: true },
    })

    if (existing.length === 0) {
      const result = await tx.divisionTeam.createMany({ data: rows })
      return { created: result.count, attested: false }
    }

    if (existing.length !== rows.length) {
      throw new SeasonLifecycleError(
        "SEASON_NOT_FOUND",
        `Season ${skeleton.nextSeasonId} holds ${existing.length} membership row(s), expected ${rows.length}. ` +
          `Membership is written in ONE transaction, so a partial count is corruption rather than a resumable state.`
      )
    }

    // Attestation: the same clubs in the same divisions. Compared as a set of
    // (division, club) pairs, because membership has no order and pretending
    // it does would fail a run for a reason that is not a difference.
    const key = (row: { divisionId: string; teamId: string }) => `${row.divisionId}:${row.teamId}`
    const persisted = new Set(existing.map(key))
    const derived = rows.map(key)
    const missing = derived.filter((k) => !persisted.has(k))
    if (missing.length > 0 || persisted.size !== derived.length) {
      throw new SeasonLifecycleError(
        "SEASON_NOT_FOUND",
        `Season ${skeleton.nextSeasonId}'s persisted membership does not match the derived movement ` +
          `(${missing.length} row(s) differ). Refusing to proceed.`
      )
    }
    return { created: 0, attested: true }
  })

  return {
    nextSeasonId: skeleton.nextSeasonId,
    nextSeasonNumber: skeleton.nextSeasonNumber,
    created: written.created,
    attested: written.attested,
    promoted: plan.promoted,
    relegated: plan.relegated,
    vacanciesByGroup: Object.fromEntries(plan.vacanciesByGroup),
  }
}

export interface MembershipVerdict {
  ok: boolean
  failures: string[]
  divisions: { tier: number; group: string; teams: number }[]
  clubs: number
}

/**
 * Every structural invariant the next season must satisfy, re-derived from
 * the database rather than from anything the writer remembered.
 */
export async function verifyNextSeasonMembership(
  oldSeasonId: string,
  nextSeasonId: string
): Promise<MembershipVerdict> {
  const [oldRows, nextDivisions] = await Promise.all([
    prisma.divisionTeam.findMany({ where: { seasonId: oldSeasonId }, select: { teamId: true } }),
    prisma.division.findMany({
      where: { seasonId: nextSeasonId },
      orderBy: [{ tier: "asc" }, { group: "asc" }],
      select: { id: true, tier: true, group: true, teams: { select: { teamId: true } } },
    }),
  ])

  const failures: string[] = []
  const oldCohort = new Set(oldRows.map((r) => r.teamId))
  const oldSizeByKey = new Map<string, number>()
  const oldDivisions = await prisma.division.findMany({
    where: { seasonId: oldSeasonId },
    select: { tier: true, group: true, _count: { select: { teams: true } } },
  })
  for (const d of oldDivisions) oldSizeByKey.set(divisionKey(d.tier, d.group ?? ""), d._count.teams)

  if (nextDivisions.length !== oldDivisions.length) {
    failures.push(`next season has ${nextDivisions.length} divisions, season N had ${oldDivisions.length}`)
  }

  const allNext: string[] = []
  for (const division of nextDivisions) {
    const group = division.group ?? ""
    const expected = oldSizeByKey.get(divisionKey(division.tier, group))
    if (expected === undefined) {
      failures.push(`next season has a division tier ${division.tier}${group} that season N did not`)
    } else if (division.teams.length !== expected) {
      failures.push(`division tier ${division.tier}${group} has ${division.teams.length} clubs, expected ${expected}`)
    }
    allNext.push(...division.teams.map((t) => t.teamId))
  }

  const nextCohort = new Set(allNext)
  // Two counts, not one: equality of the distinct count alone would hide a
  // club that appears twice while another has vanished.
  if (nextCohort.size !== allNext.length) {
    failures.push(`${allNext.length - nextCohort.size} club(s) appear in more than one division`)
  }
  if (nextCohort.size !== oldCohort.size) {
    failures.push(`next season holds ${nextCohort.size} clubs, season N held ${oldCohort.size}`)
  }
  for (const teamId of oldCohort) {
    if (!nextCohort.has(teamId)) failures.push(`club ${teamId} is missing from the next season`)
  }
  for (const teamId of nextCohort) {
    if (!oldCohort.has(teamId)) failures.push(`club ${teamId} appears next season but did not play season N`)
  }

  return {
    ok: failures.length === 0,
    failures,
    divisions: nextDivisions.map((d) => ({ tier: d.tier, group: d.group ?? "", teams: d.teams.length })),
    clubs: nextCohort.size,
  }
}
