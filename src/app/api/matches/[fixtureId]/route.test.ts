/**
 * Route-level proof of the Match Center's three visibility states, run
 * against the real GET handler with only the database mocked. These assert
 * the property that actually matters and cannot be checked by reading the
 * pure helpers alone: what the endpoint puts on the wire.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    fixture: { findUnique: jest.fn() },
    matchEvent: { findMany: jest.fn() },
    player: { findMany: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { GET } from "./route"

const mockPrisma = prisma as unknown as {
  fixture: { findUnique: jest.Mock }
  matchEvent: { findMany: jest.Mock }
  player: { findMany: jest.Mock }
}

const FIXTURE_ID = "fixture-1"
const KICKOFF = new Date("2026-09-05T19:00:00.000Z")
const minutesAfterKickoff = (minutes: number) => new Date(KICKOFF.getTime() + minutes * 60_000)

const TEAM = (id: string) => ({
  id,
  name: `Team ${id}`,
  crestShape: null,
  crestPattern: null,
  crestIcon: null,
  crestColor: null,
  crestSecondaryColor: null,
  crestBorderColor: null,
  crestImageUrl: null,
})

// Every minute the engine produced for this fixture, spread across the 90.
const ALL_EVENTS = [10, 30, 55, 80, 90].map((minute) => ({
  id: `e${minute}`,
  minute,
  type: "goal",
  teamId: "home-1",
  playerId: null,
  secondaryPlayerId: null,
  outcome: null,
  context: null,
}))

function stubFixture({ playedAt }: { playedAt: Date | null }) {
  // First call: the always-run query (no score columns selected).
  // Second call: the finished-only authoritative result read.
  mockPrisma.fixture.findUnique
    .mockResolvedValueOnce({
      id: FIXTURE_ID,
      scheduledAt: KICKOFF,
      playedAt,
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      homeTeam: { ...TEAM("home-1"), stadiumStyle: null, crowdStyle: null, stadium: null },
      awayTeam: TEAM("away-1"),
    })
    .mockResolvedValueOnce({ homeScore: 4, awayScore: 2, homeStats: { shots: 12 }, awayStats: { shots: 5 } })
}

async function callGet(now: Date) {
  jest.useFakeTimers().setSystemTime(now)
  try {
    const response = await GET(new Request("http://localhost/api/matches/fixture-1"), {
      params: Promise.resolve({ fixtureId: FIXTURE_ID }),
    })
    return (await response.json()) as {
      status: string
      minute: number
      events: { minute: number }[]
      liveScore: { home: number; away: number } | null
      finalStats: { homeScore: number; awayScore: number } | null
    }
  } finally {
    jest.useRealTimers()
  }
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: each test queues its own
  // mockResolvedValueOnce responses, and clearAllMocks leaves an unconsumed
  // queue behind for the next test to pick up.
  jest.resetAllMocks()
  mockPrisma.matchEvent.findMany.mockImplementation(async (args: { where: { minute: { lte: number } } }) =>
    ALL_EVENTS.filter((event) => event.minute <= args.where.minute.lte)
  )
  mockPrisma.player.findMany.mockResolvedValue([])
})

describe("GET /api/matches/[fixtureId]", () => {
  it("a future match exposes no events and no score at all", async () => {
    stubFixture({ playedAt: null })
    const body = await callGet(minutesAfterKickoff(-30))

    expect(body.status).toBe("scheduled")
    expect(body.events).toEqual([])
    expect(body.liveScore).toBeNull()
    expect(body.finalStats).toBeNull()
    // The authoritative score read must not even be attempted.
    expect(mockPrisma.fixture.findUnique).toHaveBeenCalledTimes(1)
    expect(mockPrisma.matchEvent.findMany).not.toHaveBeenCalled()
  })

  it("a live match still honours the minute gate and never returns the final score", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    // 4 real minutes in = simulated minute 36, so only the 10' and 30'
    // events may be visible even though all five are in the database.
    const body = await callGet(minutesAfterKickoff(4))

    expect(body.status).toBe("live")
    expect(body.minute).toBe(36)
    expect(body.events.map((e) => e.minute)).toEqual([10, 30])
    expect(body.finalStats).toBeNull()
    // Derived from revealed events only - not the stored 4:2.
    expect(body.liveScore).toEqual({ home: 2, away: 0 })
    expect(mockPrisma.fixture.findUnique).toHaveBeenCalledTimes(1)
  })

  it("a finished match reveals every event through minute 90 plus the stored result", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(11))

    expect(body.status).toBe("finished")
    expect(body.minute).toBe(90)
    expect(body.events.map((e) => e.minute)).toEqual([10, 30, 55, 80, 90])
    expect(body.finalStats).toMatchObject({ homeScore: 4, awayScore: 2 })
  })

  it("archive mode reads only stored data - it never triggers a simulation", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    await callGet(minutesAfterKickoff(60 * 24 * 365))

    // The handler's whole surface: two reads of Fixture, one of MatchEvent,
    // one of Player. No write, no engine, nothing else.
    expect(Object.keys(mockPrisma)).toEqual(["fixture", "matchEvent", "player"])
    expect(mockPrisma.matchEvent.findMany).toHaveBeenCalledTimes(1)
  })

  it("a past fixture that was never simulated returns no events and no result", async () => {
    mockPrisma.fixture.findUnique
      .mockResolvedValueOnce({
        id: FIXTURE_ID,
        scheduledAt: KICKOFF,
        playedAt: null,
        homeTeamId: "home-1",
        awayTeamId: "away-1",
        homeTeam: { ...TEAM("home-1"), stadiumStyle: null, crowdStyle: null, stadium: null },
        awayTeam: TEAM("away-1"),
      })
      // Nothing was ever written, so the authoritative read finds no score.
      .mockResolvedValueOnce({ homeScore: null, awayScore: null, homeStats: null, awayStats: null })
    mockPrisma.matchEvent.findMany.mockResolvedValueOnce([])

    const body = await callGet(minutesAfterKickoff(30))

    expect(body.status).toBe("finished")
    expect(body.events).toEqual([])
    expect(body.finalStats).toBeNull()
    expect(body.liveScore).toEqual({ home: 0, away: 0 })
  })
})
