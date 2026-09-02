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
import {
  expectedFixtureCount,
  V1_EXPECTED_DIVISIONS,
  V1_EXPECTED_DIVISION_TEAM_MEMBERSHIPS,
  V1_EXPECTED_TOTAL_FIXTURES,
} from "@/lib/production/league-structure"

export interface OpsPreflightResult {
  pass: boolean
  errors: string[]
  warnings: string[]
  summary: {
    seasons: number
    activeSeasons: number
    divisionCount: number
    divisionTeamCount: number
    fixtureCount: number
    playedFixtureCount: number
  }
}

export async function runPreflightCheck(): Promise<OpsPreflightResult> {
  const errors: string[] = []
  const warnings: string[] = []

  const seasons = await prisma.season.findMany({
    select: { countryCode: true, number: true, status: true, offseasonStage: true, isActive: true },
  })
  const duplicates = findDuplicateActiveSeasons(seasons)
  if (duplicates.length > 0) {
    errors.push(`Duplicate active Season per country: ${duplicates.join(", ")}`)
  }

  const [divisionCount, divisionTeamCount, fixtureCount, playedFixtureCount, qaFixtures] = await Promise.all([
    prisma.division.count(),
    prisma.divisionTeam.count(),
    prisma.fixture.count(),
    prisma.fixture.count({ where: { playedAt: { not: null } } }),
    prisma.fixture.count({ where: { matchday: QA_MATCHDAY } }),
  ])

  if (divisionCount !== V1_EXPECTED_DIVISIONS) {
    errors.push(`Expected ${V1_EXPECTED_DIVISIONS} Divisions for V1, found ${divisionCount}.`)
  }
  if (divisionTeamCount !== V1_EXPECTED_DIVISION_TEAM_MEMBERSHIPS) {
    errors.push(`Expected ${V1_EXPECTED_DIVISION_TEAM_MEMBERSHIPS} DivisionTeam memberships for V1, found ${divisionTeamCount}.`)
  }
  if (fixtureCount !== V1_EXPECTED_TOTAL_FIXTURES) {
    errors.push(`Expected ${V1_EXPECTED_TOTAL_FIXTURES} total Fixtures for V1, found ${fixtureCount}.`)
  }
  if (qaFixtures > 0) {
    errors.push(`${qaFixtures} fixture(s) with matchday=${QA_MATCHDAY} (QA residue) found.`)
  }

  const divisions = await prisma.division.findMany({ select: { _count: { select: { teams: true, fixtures: true } } } })
  for (const d of divisions) {
    const expected = expectedFixtureCount(d._count.teams)
    if (d._count.teams > 0 && d._count.fixtures !== expected) {
      warnings.push(`A division has ${d._count.fixtures} fixtures, expected ${expected} for ${d._count.teams} teams.`)
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
      fixtureCount,
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
