jest.mock("@/lib/prisma", () => ({
  prisma: {
    season: { findMany: jest.fn() },
    division: { count: jest.fn(), findMany: jest.fn() },
    divisionTeam: { count: jest.fn() },
    fixture: { count: jest.fn(), aggregate: jest.fn(), findMany: jest.fn() },
    transferListing: { count: jest.fn() },
    youthIntake: { count: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { runPreflightCheck, runScheduledDryCheck, runSeasonStatusCheck } from "./checks"

const mockPrisma = prisma as unknown as {
  season: { findMany: jest.Mock }
  division: { count: jest.Mock; findMany: jest.Mock }
  divisionTeam: { count: jest.Mock }
  fixture: { count: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock }
  transferListing: { count: jest.Mock }
  youthIntake: { count: jest.Mock }
}

const V1_DIVISIONS = 3
const V1_DIVISION_TEAMS = 60
const V1_FIXTURES = 1140

function mockFixtureCount(
  overrides: { total?: number; nonLeague?: number; played?: number; qa?: number; due?: number } = {}
) {
  mockPrisma.fixture.count.mockImplementation(async (args?: { where?: Record<string, unknown> }) => {
    const where = args?.where
    if (!where) return overrides.total ?? V1_FIXTURES
    if ("matchday" in where) return overrides.qa ?? 0
    if ("playedAt" in where && "scheduledAt" in where) return overrides.due ?? 0
    if ("playedAt" in where) return overrides.played ?? 0
    // The V1 shape is counted over LEAGUE fixtures; title deciders and
    // playoffs are counted separately so they can be surfaced without
    // failing a check that describes the double round-robin.
    if ("stage" in where) {
      const stage = where.stage
      if (stage === "LEAGUE") return overrides.total ?? V1_FIXTURES
      return overrides.nonLeague ?? 0
    }
    return 0
  })
}

function healthySeasons() {
  return [{ countryCode: "IL", number: 1, status: "ACTIVE", offseasonStage: "NONE", isActive: true }]
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.division.findMany.mockResolvedValue([])
})

describe("runPreflightCheck", () => {
  it("passes when the V1 shape and season invariants all hold", async () => {
    mockPrisma.season.findMany.mockResolvedValue(healthySeasons())
    mockPrisma.division.count.mockResolvedValue(V1_DIVISIONS)
    mockPrisma.divisionTeam.count.mockResolvedValue(V1_DIVISION_TEAMS)
    mockFixtureCount({ total: V1_FIXTURES, played: 30, qa: 0 })

    const result = await runPreflightCheck()
    expect(result.pass).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.summary).toMatchObject({ divisionCount: V1_DIVISIONS, divisionTeamCount: V1_DIVISION_TEAMS, fixtureCount: V1_FIXTURES })
  })

  it("stays green with a title decider present - the V1 count describes the LEAGUE, not every row in the table", async () => {
    mockPrisma.season.findMany.mockResolvedValue(healthySeasons())
    mockPrisma.division.count.mockResolvedValue(V1_DIVISIONS)
    mockPrisma.divisionTeam.count.mockResolvedValue(V1_DIVISION_TEAMS)
    // 1140 league fixtures, plus one decider. Before the stage split this
    // would have failed with "found 1141".
    mockFixtureCount({ total: V1_FIXTURES, nonLeague: 1, played: 1140, qa: 0 })

    const result = await runPreflightCheck()
    expect(result.pass).toBe(true)
    expect(result.errors).toEqual([])
    // Surfaced, never silently ignored.
    expect(result.warnings.join(" ")).toMatch(/1 non-LEAGUE fixture/)
    expect(result.summary).toMatchObject({ fixtureCount: V1_FIXTURES, nonLeagueFixtureCount: 1 })
  })

  it("still fails when a LEAGUE fixture is missing - the check was made correct, not lenient", async () => {
    mockPrisma.season.findMany.mockResolvedValue(healthySeasons())
    mockPrisma.division.count.mockResolvedValue(V1_DIVISIONS)
    mockPrisma.divisionTeam.count.mockResolvedValue(V1_DIVISION_TEAMS)
    mockFixtureCount({ total: V1_FIXTURES - 1, nonLeague: 1, qa: 0 })

    const result = await runPreflightCheck()
    expect(result.pass).toBe(false)
    expect(result.errors.join(" ")).toMatch(/Expected 1140 LEAGUE Fixtures/)
  })

  it("fails on duplicate active seasons for the same country", async () => {
    mockPrisma.season.findMany.mockResolvedValue([
      { countryCode: "IL", number: 1, status: "ACTIVE", offseasonStage: "NONE", isActive: true },
      { countryCode: "IL", number: 2, status: "ACTIVE", offseasonStage: "NONE", isActive: true },
    ])
    mockPrisma.division.count.mockResolvedValue(V1_DIVISIONS)
    mockPrisma.divisionTeam.count.mockResolvedValue(V1_DIVISION_TEAMS)
    mockFixtureCount({ total: V1_FIXTURES })

    const result = await runPreflightCheck()
    expect(result.pass).toBe(false)
    expect(result.errors.some((e) => e.includes("Duplicate active Season"))).toBe(true)
  })

  it("fails when QA residue (matchday=999999) is present", async () => {
    mockPrisma.season.findMany.mockResolvedValue(healthySeasons())
    mockPrisma.division.count.mockResolvedValue(V1_DIVISIONS)
    mockPrisma.divisionTeam.count.mockResolvedValue(V1_DIVISION_TEAMS)
    mockFixtureCount({ total: V1_FIXTURES, qa: 2 })

    const result = await runPreflightCheck()
    expect(result.pass).toBe(false)
    expect(result.errors.some((e) => e.includes("QA residue") || e.includes("999999"))).toBe(true)
  })

  it("fails when the division/fixture counts don't match V1's fixed shape", async () => {
    mockPrisma.season.findMany.mockResolvedValue(healthySeasons())
    mockPrisma.division.count.mockResolvedValue(2)
    mockPrisma.divisionTeam.count.mockResolvedValue(40)
    mockFixtureCount({ total: 760 })

    const result = await runPreflightCheck()
    expect(result.pass).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })

  it("reports a division/team fixture-count mismatch as a warning, not a hard failure by itself", async () => {
    mockPrisma.season.findMany.mockResolvedValue(healthySeasons())
    mockPrisma.division.count.mockResolvedValue(V1_DIVISIONS)
    mockPrisma.divisionTeam.count.mockResolvedValue(V1_DIVISION_TEAMS)
    mockFixtureCount({ total: V1_FIXTURES })
    mockPrisma.division.findMany.mockResolvedValue([{ _count: { teams: 20, fixtures: 379 } }])

    const result = await runPreflightCheck()
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe("runSeasonStatusCheck", () => {
  it("summarizes each in-progress season from the aggregate/count queries", async () => {
    mockPrisma.season.findMany.mockResolvedValue([{ id: "s1", countryCode: "IL", number: 1, status: "OFFSEASON", offseasonStage: "WAITING_HUMANS" }])
    mockPrisma.fixture.aggregate.mockResolvedValue({ _count: { _all: 30 }, _max: { matchday: 1 } })
    mockPrisma.fixture.count.mockResolvedValue(0)
    mockPrisma.youthIntake.count.mockResolvedValueOnce(2).mockResolvedValueOnce(5).mockResolvedValueOnce(1)

    const result = await runSeasonStatusCheck()
    expect(result.seasons).toEqual([
      {
        countryCode: "IL",
        number: 1,
        status: "OFFSEASON",
        offseasonStage: "WAITING_HUMANS",
        currentRound: 1,
        playedFixtures: 30,
        dueFixtures: 0,
        openHumanIntakes: 2,
        openBotIntakes: 5,
        expiredIntakesWaitingSettlement: 1,
      },
    ])
  })

  it("returns an empty list when nothing is active or mid-offseason", async () => {
    mockPrisma.season.findMany.mockResolvedValue([])
    const result = await runSeasonStatusCheck()
    expect(result.seasons).toEqual([])
  })
})

describe("runScheduledDryCheck", () => {
  it("counts due fixtures and expiring listings, and evaluates transition-possible for ACTIVE seasons", async () => {
    mockPrisma.fixture.count.mockResolvedValue(3)
    mockPrisma.transferListing.count.mockResolvedValue(2)
    mockPrisma.season.findMany.mockResolvedValue([{ id: "s1", countryCode: "IL", number: 1, status: "ACTIVE", offseasonStage: "NONE" }])
    // A fixture that kicked off well over an hour ago is finished regardless of exact test-run time.
    mockPrisma.fixture.findMany.mockResolvedValue([{ playedAt: new Date(), scheduledAt: new Date(Date.now() - 3600_000) }])

    const result = await runScheduledDryCheck()
    expect(result.dueFixtures).toBe(3)
    expect(result.expiringListings).toBe(2)
    expect(result.seasons[0].transitionPossible).toBe(true)
  })

  it("reports transitionPossible=false when a fixture hasn't kicked off yet", async () => {
    mockPrisma.fixture.count.mockResolvedValue(0)
    mockPrisma.transferListing.count.mockResolvedValue(0)
    mockPrisma.season.findMany.mockResolvedValue([{ id: "s1", countryCode: "IL", number: 1, status: "ACTIVE", offseasonStage: "NONE" }])
    mockPrisma.fixture.findMany.mockResolvedValue([{ playedAt: null, scheduledAt: new Date(Date.now() + 3600_000) }])

    const result = await runScheduledDryCheck()
    expect(result.seasons[0].transitionPossible).toBe(false)
  })

  it("reports transitionPossible=null for a season already mid-offseason", async () => {
    mockPrisma.fixture.count.mockResolvedValue(0)
    mockPrisma.transferListing.count.mockResolvedValue(0)
    mockPrisma.season.findMany.mockResolvedValue([{ id: "s1", countryCode: "IL", number: 1, status: "OFFSEASON", offseasonStage: "YOUTH_GENERATION" }])

    const result = await runScheduledDryCheck()
    expect(result.seasons[0].transitionPossible).toBeNull()
    expect(mockPrisma.fixture.findMany).not.toHaveBeenCalled()
  })
})
