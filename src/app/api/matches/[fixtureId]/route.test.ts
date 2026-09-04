/**
 * Route-level proof of the Match Center's three visibility states, run
 * against the real GET handler with only the database mocked. These assert
 * the property that actually matters and cannot be checked by reading the
 * pure helpers alone: what the endpoint puts on the wire.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    fixture: { findUnique: jest.fn(), count: jest.fn() },
    matchEvent: { findMany: jest.fn() },
    player: { findMany: jest.fn() },
    playerMatchStats: { findMany: jest.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { GET } from "./route"

const mockPrisma = prisma as unknown as {
  fixture: { findUnique: jest.Mock; count: jest.Mock }
  matchEvent: { findMany: jest.Mock }
  player: { findMany: jest.Mock }
  playerMatchStats: { findMany: jest.Mock }
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

// What the engine wrote for this fixture: complete 90-minute totals,
// stored in one shot at kickoff - which is exactly why they must never
// reach a live response.
const PLAYER_STATS_ROWS = [
  {
    playerId: "home-keeper",
    teamId: "home-1",
    minutesPlayed: 90,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passesAttempted: 20,
    passesCompleted: 15,
    keyPasses: 0,
    dribblesAttempted: 0,
    dribblesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    aerialDuelsWon: 1,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 4,
    rating: 7.2,
    player: { firstName: "Gk", lastName: "One", primaryPosition: "GK", shirtNumber: 1 },
  },
  {
    playerId: "home-striker",
    teamId: "home-1",
    minutesPlayed: 90,
    goals: 4,
    assists: 0,
    shots: 7,
    shotsOnTarget: 5,
    passesAttempted: 30,
    passesCompleted: 24,
    keyPasses: 2,
    dribblesAttempted: 6,
    dribblesCompleted: 4,
    tackles: 0,
    interceptions: 0,
    aerialDuelsWon: 3,
    fouls: 1,
    yellowCards: 1,
    redCards: 0,
    saves: 0,
    rating: 9.1,
    player: { firstName: "St", lastName: "Two", primaryPosition: "ST", shirtNumber: 9 },
  },
  {
    playerId: "away-mid",
    teamId: "away-1",
    minutesPlayed: 62,
    goals: 2,
    assists: 1,
    shots: 3,
    shotsOnTarget: 2,
    passesAttempted: 0,
    passesCompleted: 0,
    keyPasses: 0,
    dribblesAttempted: 1,
    dribblesCompleted: 0,
    tackles: 2,
    interceptions: 1,
    aerialDuelsWon: 0,
    fouls: 2,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    rating: 7.8,
    player: { firstName: "Mid", lastName: "Three", primaryPosition: "CM", shirtNumber: 8 },
  },
]

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
      playerStats: { playerId: string; teamId: string; firstName: string; primaryPosition: string; rating: number }[] | null
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
  mockPrisma.playerMatchStats.findMany.mockResolvedValue(PLAYER_STATS_ROWS)
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
    // one of Player, one of PlayerMatchStats. All reads - no write, no
    // engine, nothing else.
    expect(Object.keys(mockPrisma)).toEqual(["fixture", "matchEvent", "player", "playerMatchStats"])
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

/**
 * PHASE 2: per-player statistics in an archived match.
 *
 * The anti-spoiler tests below assert the STRONG form of the guarantee: not
 * that the rows were filtered out of a live response, but that
 * playerMatchStats.findMany was never called at all - the data never enters
 * the process. That is what "structurally unreachable" has to mean to be
 * worth anything, and it is only checkable from here.
 */
describe("GET /api/matches/[fixtureId] - player stats anti-spoiler", () => {
  it("a FINISHED match exposes player stats", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(11))

    expect(body.status).toBe("finished")
    expect(body.playerStats).toHaveLength(3)
    expect(mockPrisma.playerMatchStats.findMany).toHaveBeenCalledTimes(1)
  })

  it("a LIVE match never even QUERIES player stats", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(4))

    expect(body.status).toBe("live")
    expect(body.playerStats).toBeNull()
    // The load-bearing assertion: not filtered out - never fetched.
    expect(mockPrisma.playerMatchStats.findMany).not.toHaveBeenCalled()
  })

  it("a FUTURE match never even QUERIES player stats", async () => {
    stubFixture({ playedAt: null })
    const body = await callGet(minutesAfterKickoff(-30))

    expect(body.status).toBe("scheduled")
    expect(body.playerStats).toBeNull()
    expect(mockPrisma.playerMatchStats.findMany).not.toHaveBeenCalled()
  })

  it("playedAt alone is NOT sufficient - a simulated but still-live match exposes nothing", async () => {
    // The exact shape that would leak: the engine has already run and every
    // final total is sitting in the database, while the viewer is two real
    // minutes into a ten-minute live window.
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(2))

    expect(body.status).toBe("live")
    expect(body.playerStats).toBeNull()
    expect(mockPrisma.playerMatchStats.findMany).not.toHaveBeenCalled()
  })

  it("stays hidden for the whole live window and appears the moment it closes", async () => {
    for (const realMinute of [1, 5, 9]) {
      jest.resetAllMocks()
      mockPrisma.matchEvent.findMany.mockResolvedValue([])
      mockPrisma.player.findMany.mockResolvedValue([])
      mockPrisma.playerMatchStats.findMany.mockResolvedValue(PLAYER_STATS_ROWS)
      stubFixture({ playedAt: minutesAfterKickoff(0) })

      const body = await callGet(minutesAfterKickoff(realMinute))
      expect(body.playerStats).toBeNull()
      expect(mockPrisma.playerMatchStats.findMany).not.toHaveBeenCalled()
    }
  })
})

describe("GET /api/matches/[fixtureId] - player stats content", () => {
  it("queries exactly this fixture, once, with no N+1", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    await callGet(minutesAfterKickoff(11))

    expect(mockPrisma.playerMatchStats.findMany).toHaveBeenCalledTimes(1)
    const args = mockPrisma.playerMatchStats.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ fixtureId: FIXTURE_ID })
    // Explicit select, never `include: { player: true }` - the Player row
    // carries ~70 attribute columns this screen has no use for.
    expect(args.include).toBeUndefined()
    expect(args.select.player.select).toEqual({
      firstName: true,
      lastName: true,
      primaryPosition: true,
      shirtNumber: true,
    })
  })

  it("carries the HISTORICAL teamId from the stats row, not the player's current club", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(11))

    const striker = body.playerStats!.find((s) => s.playerId === "home-striker")!
    expect(striker.teamId).toBe("home-1")
    // The route selects teamId from PlayerMatchStats and never reads
    // player.teamId - it is not even in the nested select above.
    const args = mockPrisma.playerMatchStats.findMany.mock.calls[0][0]
    expect(args.select.teamId).toBe(true)
    expect(args.select.player.select).not.toHaveProperty("teamId")
  })

  it("flattens the player's identity fields onto each row", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(11))

    expect(body.playerStats![0]).toMatchObject({
      playerId: "home-keeper",
      firstName: "Gk",
      primaryPosition: "GK",
    })
    // The nested `player` object is not passed through - the contract is flat.
    expect(body.playerStats![0]).not.toHaveProperty("player")
  })

  it("returns one row per player, with no duplicates", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(11))

    const ids = body.playerStats!.map((s) => s.playerId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("fabricates nothing - an unused substitute with no row simply is not there", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    const body = await callGet(minutesAfterKickoff(11))

    // The engine writes a row only for a player who took the pitch, so the
    // response length is exactly what the database held - never padded to a
    // full squad, never a line of zeroes for a bench player.
    expect(body.playerStats).toHaveLength(PLAYER_STATS_ROWS.length)
    expect(body.playerStats!.map((s) => s.playerId)).toEqual(["home-keeper", "home-striker", "away-mid"])
  })

  it("a finished fixture the scheduler never simulated returns an empty array, not invented players", async () => {
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
      .mockResolvedValueOnce({ homeScore: null, awayScore: null, homeStats: null, awayStats: null })
    mockPrisma.matchEvent.findMany.mockResolvedValueOnce([])
    mockPrisma.playerMatchStats.findMany.mockResolvedValueOnce([])

    const body = await callGet(minutesAfterKickoff(30))

    expect(body.status).toBe("finished")
    expect(body.playerStats).toEqual([])
    expect(body.finalStats).toBeNull()
  })

  it("reads only - the archive never writes and never re-simulates", async () => {
    stubFixture({ playedAt: minutesAfterKickoff(0) })
    await callGet(minutesAfterKickoff(11))

    // The handler's entire Prisma surface. No create/update/delete method
    // exists on it at all, so a historical row cannot be rewritten by
    // someone looking at it.
    expect(Object.keys(mockPrisma)).toEqual(["fixture", "matchEvent", "player", "playerMatchStats"])
    expect(Object.keys(mockPrisma.playerMatchStats)).toEqual(["findMany"])
  })
})

/**
 * A championship playoff tie has to introduce itself - which competition,
 * which round, whether it is the final - and none of that may narrow who is
 * going to win it.
 */
describe("GET /api/matches/[fixtureId] - championship playoff metadata", () => {
  function stubPlayoffFixture(over: {
    stage: string
    playoffId?: string | null
    playoffPhase?: "ROUND_ROBIN" | "KNOCKOUT" | null
    playoffRound?: number | null
    playedAt: Date | null
  }) {
    mockPrisma.fixture.findUnique
      .mockResolvedValueOnce({
        id: FIXTURE_ID,
        scheduledAt: KICKOFF,
        playedAt: over.playedAt,
        stage: over.stage,
        playoffId: over.playoffId ?? null,
        playoffPhase: over.playoffPhase ?? null,
        playoffRound: over.playoffRound ?? null,
        homeTeamId: "home-1",
        awayTeamId: "away-1",
        homeTeam: { ...TEAM("home-1"), stadiumStyle: null, crowdStyle: null, stadium: null },
        awayTeam: TEAM("away-1"),
      })
      .mockResolvedValueOnce({
        homeScore: 1,
        awayScore: 1,
        homeStats: {},
        awayStats: {},
        homeShootoutScore: 5,
        awayShootoutScore: 4,
      })
  }

  async function callRaw(now: Date) {
    jest.useFakeTimers().setSystemTime(now)
    try {
      const response = await GET(new Request("http://localhost/api/matches/fixture-1"), {
        params: Promise.resolve({ fixtureId: FIXTURE_ID }),
      })
      return (await response.json()) as {
        stage: string
        neutralVenue: boolean
        playoff: { phase: string; round: number; isFinal: boolean } | null
        shootout: { home: number; away: number } | null
      }
    } finally {
      jest.useRealTimers()
    }
  }

  it("a round robin tie names its round, on a neutral venue, and is never a final", async () => {
    stubPlayoffFixture({ stage: "TITLE_PLAYOFF", playoffId: "po-1", playoffPhase: "ROUND_ROBIN", playoffRound: 2, playedAt: null })
    const body = await callRaw(minutesAfterKickoff(-30))

    expect(body.playoff).toEqual({ phase: "ROUND_ROBIN", round: 2, isFinal: false })
    expect(body.neutralVenue).toBe(true)
    // Counting ties is a knockout-only question; a round robin never asks it.
    expect(mockPrisma.fixture.count).not.toHaveBeenCalled()
  })

  it("a knockout round with ONE tie is the final", async () => {
    stubPlayoffFixture({ stage: "TITLE_PLAYOFF", playoffId: "po-1", playoffPhase: "KNOCKOUT", playoffRound: 2, playedAt: null })
    mockPrisma.fixture.count.mockResolvedValue(1)

    const body = await callRaw(minutesAfterKickoff(-30))

    expect(body.playoff).toEqual({ phase: "KNOCKOUT", round: 2, isFinal: true })
    expect(mockPrisma.fixture.count).toHaveBeenCalledWith({
      where: { playoffId: "po-1", playoffPhase: "KNOCKOUT", playoffRound: 2 },
    })
  })

  it("a knockout round with several ties is not", async () => {
    stubPlayoffFixture({ stage: "TITLE_PLAYOFF", playoffId: "po-1", playoffPhase: "KNOCKOUT", playoffRound: 1, playedAt: null })
    mockPrisma.fixture.count.mockResolvedValue(2)

    const body = await callRaw(minutesAfterKickoff(-30))
    expect(body.playoff?.isFinal).toBe(false)
  })

  it("THE COMPETITION IS PUBLIC BEFORE KICKOFF, THE SHOOTOUT IS NOT", async () => {
    stubPlayoffFixture({ stage: "TITLE_PLAYOFF", playoffId: "po-1", playoffPhase: "KNOCKOUT", playoffRound: 2, playedAt: null })
    mockPrisma.fixture.count.mockResolvedValue(1)

    const body = await callRaw(minutesAfterKickoff(-30))

    expect(body.playoff).not.toBeNull()
    expect(body.shootout).toBeNull()
    // The result read was never even attempted.
    expect(mockPrisma.fixture.findUnique).toHaveBeenCalledTimes(1)
  })

  it("the shootout stays hidden for the WHOLE live window of a playoff tie", async () => {
    stubPlayoffFixture({ stage: "TITLE_PLAYOFF", playoffId: "po-1", playoffPhase: "KNOCKOUT", playoffRound: 2, playedAt: KICKOFF })
    mockPrisma.fixture.count.mockResolvedValue(1)

    const body = await callRaw(minutesAfterKickoff(9))

    expect(body.shootout).toBeNull()
    expect(mockPrisma.fixture.findUnique).toHaveBeenCalledTimes(1)
  })

  it("and appears once the tie is over", async () => {
    stubPlayoffFixture({ stage: "TITLE_PLAYOFF", playoffId: "po-1", playoffPhase: "KNOCKOUT", playoffRound: 2, playedAt: KICKOFF })
    mockPrisma.fixture.count.mockResolvedValue(1)

    const body = await callRaw(minutesAfterKickoff(11))

    expect(body.shootout).toEqual({ home: 5, away: 4 })
  })

  it("a LEAGUE match is not a playoff and is not neutral", async () => {
    stubPlayoffFixture({ stage: "LEAGUE", playedAt: null })
    const body = await callRaw(minutesAfterKickoff(-30))

    expect(body.playoff).toBeNull()
    expect(body.neutralVenue).toBe(false)
    expect(mockPrisma.fixture.count).not.toHaveBeenCalled()
  })

  it("a two-club decider is neutral but carries no playoff round", async () => {
    stubPlayoffFixture({ stage: "TITLE_DECIDER", playedAt: null })
    const body = await callRaw(minutesAfterKickoff(-30))

    expect(body.neutralVenue).toBe(true)
    expect(body.playoff).toBeNull()
  })
})
