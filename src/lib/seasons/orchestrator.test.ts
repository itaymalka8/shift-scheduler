/**
 * Unit coverage for the parts of the orchestrator that are pure decisions:
 * completion detection, and the fixture-count arithmetic the next-season
 * build checks itself against. The stage machine's transactional behaviour
 * (locking, advancing, idempotency, concurrency) is exercised end-to-end
 * against real Postgres in the season-end DB QA.
 */
import { isSeasonReadyForOffseason } from "./orchestrator"
import { expectedFixtureCount } from "./next-season"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"

const mockFindMany = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    fixture: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}))

beforeEach(() => jest.clearAllMocks())

const NOW = new Date("2026-05-01T12:00:00Z")
const LIVE_WINDOW_MS = MATCH_REAL_DURATION_MINUTES * 60_000

describe("isSeasonReadyForOffseason", () => {
  it("is false for a season with no fixtures at all", async () => {
    mockFindMany.mockResolvedValue([])
    expect(await isSeasonReadyForOffseason("s1", NOW)).toBe(false)
  })

  it("is false while any fixture is still unplayed", async () => {
    mockFindMany.mockResolvedValue([
      { playedAt: new Date("2026-04-01T19:00:00Z"), scheduledAt: new Date("2026-04-01T19:00:00Z") },
      { playedAt: null, scheduledAt: new Date("2026-04-03T19:00:00Z") },
    ])
    expect(await isSeasonReadyForOffseason("s1", NOW)).toBe(false)
  })

  it("is false while the last match is still inside its live window, even though it is already played", async () => {
    // The case playedAt alone gets wrong: the simulation is written at
    // kickoff, so a match can be "played" and still on screen.
    const kickoff = new Date(NOW.getTime() - LIVE_WINDOW_MS / 2)
    mockFindMany.mockResolvedValue([{ playedAt: kickoff, scheduledAt: kickoff }])
    expect(await isSeasonReadyForOffseason("s1", NOW)).toBe(false)
  })

  it("is true once every fixture is played and its live window has fully elapsed", async () => {
    const kickoff = new Date(NOW.getTime() - LIVE_WINDOW_MS - 60_000)
    mockFindMany.mockResolvedValue([
      { playedAt: kickoff, scheduledAt: kickoff },
      { playedAt: kickoff, scheduledAt: new Date(kickoff.getTime() - 86_400_000) },
    ])
    expect(await isSeasonReadyForOffseason("s1", NOW)).toBe(true)
  })

  it("becomes true exactly when the live window closes, not a moment before", async () => {
    const kickoff = new Date(NOW.getTime() - LIVE_WINDOW_MS)
    mockFindMany.mockResolvedValue([{ playedAt: kickoff, scheduledAt: kickoff }])
    expect(await isSeasonReadyForOffseason("s1", NOW)).toBe(true)

    const justShort = new Date(NOW.getTime() - LIVE_WINDOW_MS + 1000)
    mockFindMany.mockResolvedValue([{ playedAt: justShort, scheduledAt: justShort }])
    expect(await isSeasonReadyForOffseason("s1", NOW)).toBe(false)
  })

  it("only ever looks at fixtures belonging to the season it was asked about", async () => {
    mockFindMany.mockResolvedValue([])
    await isSeasonReadyForOffseason("season-42", NOW)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { division: { seasonId: "season-42" } } })
    )
  })
})

describe("expectedFixtureCount", () => {
  it("matches a real double round-robin: 20 clubs is 380 fixtures over 38 matchdays", () => {
    expect(expectedFixtureCount(20)).toBe(380)
    expect(expectedFixtureCount(20) / 10).toBe(38) // 10 fixtures per matchday
  })

  it("scales with the club count", () => {
    expect(expectedFixtureCount(2)).toBe(2)
    expect(expectedFixtureCount(4)).toBe(12)
    expect(expectedFixtureCount(6)).toBe(30)
  })
})
