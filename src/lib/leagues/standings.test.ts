/**
 * The league table must be the LEAGUE's table.
 *
 * A championship decider is a fixture of the division, between two of its
 * clubs, played precisely because the table could not separate them - so
 * letting it into the aggregation would change the very numbers it exists
 * to settle. This is a query-shape test because that is where the property
 * lives: the decider is excluded at the database, so its result never
 * reaches the arithmetic at all.
 */
const mockDivisionTeamFindMany = jest.fn()
const mockFixtureFindMany = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    divisionTeam: { findMany: (...args: unknown[]) => mockDivisionTeamFindMany(...args) },
    fixture: { findMany: (...args: unknown[]) => mockFixtureFindMany(...args) },
  },
}))

import { computeStandings } from "./standings"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"

beforeEach(() => {
  jest.resetAllMocks()
  mockDivisionTeamFindMany.mockResolvedValue([
    { teamId: "A", team: { name: "Alpha", isBot: true } },
    { teamId: "B", team: { name: "Beta", isBot: true } },
  ])
  mockFixtureFindMany.mockResolvedValue([])
})

const NOW = new Date()
const finishedKickoff = new Date(NOW.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000 - 60_000)

describe("computeStandings", () => {
  it("asks the database for LEAGUE fixtures only", async () => {
    await computeStandings("d1")
    expect(mockFixtureFindMany).toHaveBeenCalledWith({
      where: { divisionId: "d1", stage: "LEAGUE", homeScore: { not: null }, awayScore: { not: null } },
    })
  })

  it("a title decider cannot reach the table - it is filtered before the arithmetic", async () => {
    // What the database returns under the stage filter: the league match
    // only. The 5-0 decider below is what would come back WITHOUT it.
    mockFixtureFindMany.mockResolvedValue([
      { homeTeamId: "A", awayTeamId: "B", homeScore: 1, awayScore: 1, scheduledAt: finishedKickoff },
    ])
    const table = await computeStandings("d1")
    const a = table.find((r) => r.teamId === "A")!
    const b = table.find((r) => r.teamId === "B")!

    // Level, exactly as they were - which is why a decider was needed.
    expect([a.points, a.played, a.goalsFor, a.goalDiff]).toEqual([1, 1, 1, 0])
    expect([b.points, b.played, b.goalsFor, b.goalDiff]).toEqual([1, 1, 1, 0])
  })

  it("still awards 3/1/0 and computes goal difference over league matches", async () => {
    mockFixtureFindMany.mockResolvedValue([
      { homeTeamId: "A", awayTeamId: "B", homeScore: 3, awayScore: 1, scheduledAt: finishedKickoff },
    ])
    const table = await computeStandings("d1")
    expect(table[0]).toMatchObject({ teamId: "A", points: 3, won: 1, goalsFor: 3, goalsAgainst: 1, goalDiff: 2 })
    expect(table[1]).toMatchObject({ teamId: "B", points: 0, lost: 1, goalDiff: -2 })
  })

  it("still excludes a match inside its live window, so the table never spoils a result", async () => {
    const live = new Date(NOW.getTime() - 60_000)
    mockFixtureFindMany.mockResolvedValue([
      { homeTeamId: "A", awayTeamId: "B", homeScore: 4, awayScore: 0, scheduledAt: live },
    ])
    const table = await computeStandings("d1")
    expect(table.every((r) => r.played === 0 && r.points === 0)).toBe(true)
  })
})
