// The read-only checks behind /api/internal/production-ops. Unlike
// src/lib/production/*, this module runs INSIDE the app itself, in
// Production, using the app's own already-connected Prisma client
// (@/lib/prisma) - so it may freely import it, and DATABASE_URL never has
// to leave Render for these specific checks. Only the pure, credential-free
// helpers are shared with src/lib/production/ (constants and formulas with
// no imports of their own) - never anything that itself imports @/lib/prisma
// from that package.
import { prisma } from "@/lib/prisma"
import { isMatchFinished } from "@/lib/match/timing"
import { findDuplicateActiveSeasons } from "@/lib/production/duplicate-active-seasons"
import { QA_MATCHDAY } from "@/lib/production/qa-residue"
import { expectedFixtureCount, judgeLeagueStructure } from "@/lib/production/league-structure"

export interface OpsPreflightResult {
  pass: boolean
  errors: string[]
  warnings: string[]
  summary: {
    seasons: number
    activeSeasons: number
    divisionCount: number
    /** LEAGUE fixtures only - what V1_EXPECTED_TOTAL_FIXTURES describes. */
    fixtureCount: number
    /** Title deciders and (later) playoffs. Expected to be 0 until a season ends level. */
    nonLeagueFixtureCount: number
    divisionTeamCount: number
    playedFixtureCount: number
  }
}

export async function runPreflightCheck(): Promise<OpsPreflightResult> {
  const errors: string[] = []
  const warnings: string[] = []

  const seasons = await prisma.season.findMany({
    select: { id: true, countryCode: true, number: true, status: true, offseasonStage: true, isActive: true },
  })
  const duplicates = findDuplicateActiveSeasons(seasons)
  if (duplicates.length > 0) {
    errors.push(`Duplicate active Season per country: ${duplicates.join(", ")}`)
  }

  // The contract describes the LEAGUE of ONE season - three divisions of
  // twenty clubs playing a double round-robin. It is scoped both ways, and
  // both scopings are load-bearing.
  //
  // BY STAGE: a championship decider, a boundary decider and a promotion
  // playoff are all real, wanted fixtures that are not part of that shape;
  // counting them here would turn a correct season-end into a failed
  // preflight. The check stays exact - 1140 LEAGUE fixtures, no more and no
  // fewer - and non-LEAGUE fixtures are reported separately.
  //
  // BY SEASON. Global counts were correct while exactly one
  // season existed; the moment season 2 is created they become 6 / 120 / 2280
  // and a hard-coded 3 / 60 / 1140 fails preflight, blocking every deploy
  // including the one that would fix it.
  const activeSeason = seasons.find((s) => s.isActive) ?? null
  const seasonScope = activeSeason ? { seasonId: activeSeason.id } : { seasonId: "__none__" }
  const [divisionCount, divisionTeamCount, leagueFixtureCount, nonLeagueFixtureCount, playedFixtureCount, qaFixtures] =
    await Promise.all([
      prisma.division.count({ where: seasonScope }),
      // Through the RELATION, never through DivisionTeam.seasonId: this runs
      // as a pre-deploy gate against a database that may be one migration
      // behind, and a verifier should not depend on the denormalisation it is
      // verifying.
      prisma.divisionTeam.count({ where: { division: seasonScope } }),
      prisma.fixture.count({ where: { stage: "LEAGUE", division: seasonScope } }),
      prisma.fixture.count({ where: { stage: { not: "LEAGUE" }, division: seasonScope } }),
      prisma.fixture.count({ where: { playedAt: { not: null } } }),
      prisma.fixture.count({ where: { matchday: QA_MATCHDAY } }),
    ])

  const structure = judgeLeagueStructure({
    activeSeasons: seasons.filter((s) => s.isActive).length,
    divisions: divisionCount,
    memberships: divisionTeamCount,
    leagueFixtures: leagueFixtureCount,
    nonLeagueFixtures: nonLeagueFixtureCount,
  })
  errors.push(...structure.errors)
  warnings.push(...structure.notes)

  if (qaFixtures > 0) {
    errors.push(`${qaFixtures} fixture(s) with matchday=${QA_MATCHDAY} (QA residue) found.`)
  }

  const divisions = await prisma.division.findMany({
    where: seasonScope,
    select: { _count: { select: { teams: true, fixtures: { where: { stage: "LEAGUE" } } } } },
  })
  for (const d of divisions) {
    const expected = expectedFixtureCount(d._count.teams)
    if (d._count.teams > 0 && d._count.fixtures !== expected) {
      warnings.push(`A division has ${d._count.fixtures} LEAGUE fixtures, expected ${expected} for ${d._count.teams} teams.`)
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
    summary: {
      seasons: seasons.length,
      activeSeasons: seasons.filter((s) => s.isActive).length,
      divisionCount,
      divisionTeamCount,
      fixtureCount: leagueFixtureCount,
      nonLeagueFixtureCount,
      playedFixtureCount,
    },
  }
}

export interface OpsSeasonStatus {
  countryCode: string
  number: number
  status: string
  offseasonStage: string
  currentRound: number
  playedFixtures: number
  dueFixtures: number
  openHumanIntakes: number
  openBotIntakes: number
  expiredIntakesWaitingSettlement: number
}

export async function runSeasonStatusCheck(): Promise<{ seasons: OpsSeasonStatus[] }> {
  const now = new Date()
  const seasons = await prisma.season.findMany({
    where: { status: { not: "COMPLETED" }, OR: [{ isActive: true }, { status: "OFFSEASON" }] },
    select: { id: true, countryCode: true, number: true, status: true, offseasonStage: true },
    orderBy: [{ countryCode: "asc" }, { number: "asc" }],
  })

  const details: OpsSeasonStatus[] = []
  for (const season of seasons) {
    const [playedAgg, due, openHuman, openBot, expiredWaiting] = await Promise.all([
      prisma.fixture.aggregate({
        where: { division: { seasonId: season.id }, playedAt: { not: null } },
        _count: { _all: true },
        _max: { matchday: true },
      }),
      prisma.fixture.count({ where: { division: { seasonId: season.id }, playedAt: null, scheduledAt: { lte: now } } }),
      prisma.youthIntake.count({ where: { seasonId: season.id, status: "OPEN", team: { isBot: false } } }),
      prisma.youthIntake.count({ where: { seasonId: season.id, status: "OPEN", team: { isBot: true } } }),
      prisma.youthIntake.count({ where: { seasonId: season.id, status: "OPEN", closesAt: { lte: now }, team: { isBot: false } } }),
    ])
    details.push({
      countryCode: season.countryCode,
      number: season.number,
      status: season.status,
      offseasonStage: season.offseasonStage,
      currentRound: playedAgg._max.matchday ?? 0,
      playedFixtures: playedAgg._count._all,
      dueFixtures: due,
      openHumanIntakes: openHuman,
      openBotIntakes: openBot,
      expiredIntakesWaitingSettlement: expiredWaiting,
    })
  }

  return { seasons: details }
}

export interface OpsScheduledDryCheckSeason {
  countryCode: string
  number: number
  status: string
  offseasonStage: string
  transitionPossible: boolean | null
}

export interface OpsScheduledDryCheckResult {
  dueFixtures: number
  expiringListings: number
  seasons: OpsScheduledDryCheckSeason[]
}

export async function runScheduledDryCheck(): Promise<OpsScheduledDryCheckResult> {
  const now = new Date()

  // Mirrors processDueFixtures()'s own WHERE clause - src/lib/match/simulate.ts.
  const dueFixtures = await prisma.fixture.count({ where: { playedAt: null, scheduledAt: { lte: now } } })
  // Mirrors expireDueTransferListings()'s own WHERE clause - src/lib/transfers/expiration.ts.
  const expiringListings = await prisma.transferListing.count({ where: { status: "OPEN", expiresAt: { lte: now } } })

  const seasons = await prisma.season.findMany({
    where: { status: { not: "COMPLETED" }, OR: [{ isActive: true }, { status: "OFFSEASON" }] },
    select: { id: true, countryCode: true, number: true, status: true, offseasonStage: true },
    orderBy: { id: "asc" },
  })

  const seasonChecks: OpsScheduledDryCheckSeason[] = []
  for (const season of seasons) {
    let transitionPossible: boolean | null = null
    if (season.status === "ACTIVE") {
      const fixtures = await prisma.fixture.findMany({
        where: { division: { seasonId: season.id } },
        select: { playedAt: true, scheduledAt: true },
      })
      transitionPossible = fixtures.length > 0 && fixtures.every((f) => f.playedAt !== null && isMatchFinished(f.scheduledAt, now))
    }
    seasonChecks.push({
      countryCode: season.countryCode,
      number: season.number,
      status: season.status,
      offseasonStage: season.offseasonStage,
      transitionPossible,
    })
  }

  return { dueFixtures, expiringListings, seasons: seasonChecks }
}
