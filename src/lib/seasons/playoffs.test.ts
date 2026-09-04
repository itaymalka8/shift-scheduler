/**
 * The write layer of a championship playoff: creating it once, drawing once,
 * persisting that draw, and never touching it again.
 */
import { Prisma } from "@/generated/prisma"

const mockPlayoffFindUnique = jest.fn()
const mockPlayoffFindMany = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: {
    championshipPlayoff: {
      findUnique: (...a: unknown[]) => mockPlayoffFindUnique(...a),
      findMany: (...a: unknown[]) => mockPlayoffFindMany(...a),
    },
  },
}))

import {
  createNextKnockoutRound,
  createRoundRobinRound,
  ensureChampionshipPlayoff,
  ensureKnockoutEntered,
  fixturesOfRound,
  knockoutSurvivors,
  latestRound,
  loadPlayoff,
  roundIsComplete,
  type PlayoffFixtureRow,
} from "./playoffs"
import { drawKnockout, parseKnockoutDraw } from "./draw"
import { computeMatchdayDate } from "@/lib/match/schedule"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"

const SEASON_START = computeMatchdayDate(new Date("2026-08-31T19:00:00.000Z"), 1)
const NOW = new Date(SEASON_START.getTime())

const mockTxPlayoffFindUnique = jest.fn()
const mockTxPlayoffCreate = jest.fn()
const mockTxPlayoffUpdate = jest.fn()
const mockTxFixtureFindMany = jest.fn()
const mockTxFixtureFindFirst = jest.fn()
const mockTxFixtureCreate = jest.fn()

const tx = {
  championshipPlayoff: {
    findUnique: (...a: unknown[]) => mockTxPlayoffFindUnique(...a),
    create: (...a: unknown[]) => mockTxPlayoffCreate(...a),
    update: (...a: unknown[]) => mockTxPlayoffUpdate(...a),
  },
  fixture: {
    findMany: (...a: unknown[]) => mockTxFixtureFindMany(...a),
    findFirst: (...a: unknown[]) => mockTxFixtureFindFirst(...a),
    create: (...a: unknown[]) => mockTxFixtureCreate(...a),
  },
} as unknown as Prisma.TransactionClient

const DIVISION = { seasonId: "s1", divisionId: "d1", countryCode: "IL", seasonNumber: 1, tier: 1, group: "A" }

/** The two findFirst calls scheduleAnchor makes: earliest kickoff, last matchday. */
function stubAnchor() {
  mockTxFixtureFindFirst
    .mockResolvedValueOnce({ scheduledAt: SEASON_START })
    .mockResolvedValueOnce({ matchday: 38 })
}

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  })
}

const LEAGUE_RECORD = [
  { scheduledAt: SEASON_START, homeScore: 2, awayScore: 1 },
  { scheduledAt: new Date(SEASON_START.getTime() + 86_400_000), homeScore: 0, awayScore: 0 },
]

function createdFixtures() {
  return mockTxFixtureCreate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data)
}

beforeEach(() => {
  jest.resetAllMocks()
  mockTxFixtureCreate.mockImplementation(async () => ({ id: `fx-${mockTxFixtureCreate.mock.calls.length}` }))
  mockPlayoffFindMany.mockResolvedValue([])
})

describe("ensureChampionshipPlayoff", () => {
  it("creates the playoff and its drawSeed in ONE insert", async () => {
    mockTxPlayoffFindUnique.mockResolvedValue(null)
    mockTxFixtureFindMany.mockResolvedValue(LEAGUE_RECORD)
    mockTxPlayoffCreate.mockResolvedValue({ id: "po-1", drawSeed: "IL-S1-T1-deadbeef" })

    const result = await ensureChampionshipPlayoff(tx, DIVISION)

    expect(result.created).toBe(true)
    expect(result.id).toBe("po-1")
    const data = (mockTxPlayoffCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.divisionId).toBe("d1")
    expect(data.seasonId).toBe("s1")
    expect(typeof data.drawSeed).toBe("string")
    expect(data.drawSeed).toMatch(/^IL-S1-T1A-[0-9a-f]{8}$/)
    // The draw itself is NOT run here - only the seed is stored.
    expect(data.knockoutDraw).toBeUndefined()
  })

  it("REUSES an existing playoff rather than creating a second", async () => {
    mockTxPlayoffFindUnique.mockResolvedValue({ id: "po-existing", drawSeed: "IL-S1-T1-aaaaaaaa" })

    const result = await ensureChampionshipPlayoff(tx, DIVISION)

    expect(result).toEqual({ id: "po-existing", drawSeed: "IL-S1-T1-aaaaaaaa", created: false })
    expect(mockTxPlayoffCreate).not.toHaveBeenCalled()
  })

  it("DUPLICATE CRON RUNNERS: losing the race reads back the winner's row", async () => {
    mockTxPlayoffFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "po-winner", drawSeed: "IL-S1-T1-bbbbbbbb" })
    mockTxFixtureFindMany.mockResolvedValue(LEAGUE_RECORD)
    mockTxPlayoffCreate.mockRejectedValue(p2002("ChampionshipPlayoff_divisionId_key"))

    const result = await ensureChampionshipPlayoff(tx, DIVISION)

    expect(result).toEqual({ id: "po-winner", drawSeed: "IL-S1-T1-bbbbbbbb", created: false })
  })

  it("rethrows a P2002 it cannot explain rather than inventing a playoff", async () => {
    mockTxPlayoffFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    mockTxFixtureFindMany.mockResolvedValue(LEAGUE_RECORD)
    mockTxPlayoffCreate.mockRejectedValue(p2002("ChampionshipPlayoff_divisionId_key"))

    await expect(ensureChampionshipPlayoff(tx, DIVISION)).rejects.toThrow("Unique constraint failed")
  })

  it("derives the seed from the LEAGUE record only", async () => {
    mockTxPlayoffFindUnique.mockResolvedValue(null)
    mockTxFixtureFindMany.mockResolvedValue(LEAGUE_RECORD)
    mockTxPlayoffCreate.mockResolvedValue({ id: "po-1", drawSeed: "x" })

    await ensureChampionshipPlayoff(tx, DIVISION)

    const where = (mockTxFixtureFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toEqual({ divisionId: "d1", stage: "LEAGUE" })
  })
})

describe("createRoundRobinRound", () => {
  it("creates every pairing of a three-club round in the league's own cadence", async () => {
    stubAnchor()

    const created = await createRoundRobinRound(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      round: 1,
      teamIds: ["a", "b", "c"],
      now: NOW,
    })

    // Three clubs, single leg: three matches across three slots.
    expect(created).toBe(3)
    const rows = createdFixtures()
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.stage).toBe("TITLE_PLAYOFF")
      expect(row.playoffId).toBe("po-1")
      expect(row.playoffPhase).toBe("ROUND_ROBIN")
      expect(row.playoffRound).toBe(1)
      expect(row.homeScore).toBeUndefined()
      expect(row.playedAt).toBeUndefined()
    }
    // Consecutive matchdays after the final league matchday.
    expect(rows.map((r) => r.matchday)).toEqual([39, 40, 41])
    for (const row of rows) {
      expect(row.scheduledAt).toEqual(computeMatchdayDate(SEASON_START, row.matchday as number))
    }
    // Every club meets every other club exactly once.
    const pairs = rows.map((r) => [r.homeTeamId, r.awayTeamId].sort().join("-")).sort()
    expect(pairs).toEqual(["a-b", "a-c", "b-c"])
  })

  it("a duplicate pairing from a parallel runner is absorbed, not thrown", async () => {
    stubAnchor()
    mockTxFixtureCreate
      .mockRejectedValueOnce(p2002("Fixture_playoff_pairing_key"))
      .mockResolvedValue({ id: "fx" })

    const created = await createRoundRobinRound(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      round: 2,
      teamIds: ["a", "b", "c"],
      now: NOW,
    })

    expect(created).toBe(2)
  })

  it("NO ROUND ROBIN ROUND 4 CAN BE STORED - the cap is enforced before any write", async () => {
    await expect(
      createRoundRobinRound(tx, { playoffId: "po-1", divisionId: "d1", round: 4, teamIds: ["a", "b", "c"], now: NOW })
    ).rejects.toThrow(/exceeds the cap/)
    expect(mockTxFixtureCreate).not.toHaveBeenCalled()
  })

  it("refuses to schedule a division with no league fixtures to anchor to", async () => {
    mockTxFixtureFindFirst.mockResolvedValue(null)

    await expect(
      createRoundRobinRound(tx, { playoffId: "po-1", divisionId: "d1", round: 1, teamIds: ["a", "b"], now: NOW })
    ).rejects.toThrow(/no scheduled LEAGUE fixtures/)
    expect(mockTxFixtureCreate).not.toHaveBeenCalled()
  })
})

describe("ensureKnockoutEntered", () => {
  const ENTRANTS = ["a", "b", "c", "d", "e"]

  it("PERSISTS THE DRAW BEFORE creating any fixture", async () => {
    mockTxPlayoffFindUnique.mockResolvedValue({ knockoutDraw: null })
    stubAnchor()
    const order: string[] = []
    mockTxPlayoffUpdate.mockImplementation(async () => {
      order.push("draw")
      return {}
    })
    mockTxFixtureCreate.mockImplementation(async () => {
      order.push("fixture")
      return { id: "fx" }
    })

    const result = await ensureKnockoutEntered(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      drawSeed: "IL-S1-T1-12345678",
      entrants: ENTRANTS,
      now: NOW,
    })

    expect(result.drawPersisted).toBe(true)
    expect(order[0]).toBe("draw")
    expect(order.slice(1).every((step) => step === "fixture")).toBe(true)
  })

  it("persists exactly what the seed produces, and builds the bracket from it", async () => {
    mockTxPlayoffFindUnique.mockResolvedValue({ knockoutDraw: null })
    stubAnchor()

    const result = await ensureKnockoutEntered(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      drawSeed: "IL-S1-T1-12345678",
      entrants: ENTRANTS,
      now: NOW,
    })

    const expected = drawKnockout(ENTRANTS, "IL-S1-T1-12345678")
    expect(result.draw).toEqual(expected)
    const written = (mockTxPlayoffUpdate.mock.calls[0][0] as { data: { knockoutDraw: unknown } }).data.knockoutDraw
    expect(parseKnockoutDraw(written)).toEqual(expected)

    // Five entrants: three byes, one first-round match.
    expect(expected.byes).toHaveLength(3)
    expect(result.fixturesCreated).toBe(1)
    const row = createdFixtures()[0]
    expect(row.playoffPhase).toBe("KNOCKOUT")
    expect(row.playoffRound).toBe(1)
    expect([row.homeTeamId, row.awayTeamId]).toEqual([
      expected.firstRound.pairings[0].homeTeamId,
      expected.firstRound.pairings[0].awayTeamId,
    ])
  })

  it("DRAW RESULT REUSED AFTER RESTART - a stored draw is never redrawn or updated", async () => {
    const stored = drawKnockout(ENTRANTS, "IL-S1-T1-12345678")
    mockTxPlayoffFindUnique.mockResolvedValue({ knockoutDraw: stored })
    stubAnchor()

    const result = await ensureKnockoutEntered(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      // A DIFFERENT seed: the stored draw must still win.
      drawSeed: "IL-S1-T1-ffffffff",
      entrants: ENTRANTS,
      now: NOW,
    })

    expect(mockTxPlayoffUpdate).not.toHaveBeenCalled()
    expect(result.drawPersisted).toBe(false)
    expect(result.draw).toEqual(stored)
    expect(result.draw).not.toEqual(drawKnockout(ENTRANTS, "IL-S1-T1-ffffffff"))
  })

  it("DRAW RESULT DOES NOT CHANGE AFTER A TEAM RENAME OR A MANAGER TAKEOVER", async () => {
    // Neither a club's name nor its manager is an input to the draw: the same
    // seed and the same team ids give the same bracket, whoever owns them.
    const before = drawKnockout(ENTRANTS, "IL-S1-T1-12345678")
    mockTxPlayoffFindUnique.mockResolvedValue({ knockoutDraw: before })
    stubAnchor()

    const result = await ensureKnockoutEntered(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      drawSeed: "IL-S1-T1-12345678",
      entrants: ENTRANTS,
      now: NOW,
    })

    expect(result.draw).toEqual(before)
    expect(mockTxPlayoffUpdate).not.toHaveBeenCalled()
  })

  it("a second runner that already lost the fixture race still returns the stored draw", async () => {
    const stored = drawKnockout(ENTRANTS, "IL-S1-T1-12345678")
    mockTxPlayoffFindUnique.mockResolvedValue({ knockoutDraw: stored })
    stubAnchor()
    mockTxFixtureCreate.mockRejectedValue(p2002("Fixture_playoff_pairing_key"))

    const result = await ensureKnockoutEntered(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      drawSeed: "IL-S1-T1-12345678",
      entrants: ENTRANTS,
      now: NOW,
    })

    expect(result.fixturesCreated).toBe(0)
    expect(result.draw).toEqual(stored)
  })
})

describe("createNextKnockoutRound", () => {
  it("pairs survivors in the PERSISTED bracket order, without reshuffling", async () => {
    const draw = drawKnockout(["a", "b", "c", "d"], "IL-S1-T1-12345678")
    stubAnchor()

    const created = await createNextKnockoutRound(tx, {
      playoffId: "po-1",
      divisionId: "d1",
      draw,
      round: 2,
      survivorsInBracketOrder: [draw.order[0], draw.order[2]],
      now: NOW,
    })

    expect(created).toBe(1)
    const row = createdFixtures()[0]
    expect(row.playoffPhase).toBe("KNOCKOUT")
    expect(row.playoffRound).toBe(2)
    expect(row.homeTeamId).toBe(draw.order[0])
    expect(row.awayTeamId).toBe(draw.order[2])
  })
})

describe("loadPlayoff", () => {
  it("parses a stored draw and drops rows the CHECKs cannot produce", async () => {
    const draw = drawKnockout(["a", "b", "c"], "IL-S1-T1-12345678")
    mockPlayoffFindUnique.mockResolvedValue({
      id: "po-1",
      divisionId: "d1",
      drawSeed: "IL-S1-T1-12345678",
      knockoutDraw: draw,
      fixtures: [
        {
          id: "fx-1",
          homeTeamId: "a",
          awayTeamId: "b",
          homeScore: 1,
          awayScore: 0,
          homeShootoutScore: null,
          awayShootoutScore: null,
          playoffPhase: "ROUND_ROBIN",
          playoffRound: 1,
          scheduledAt: SEASON_START,
          playedAt: SEASON_START,
        },
        // Defensive: a row without phase/round cannot exist under the CHECK
        // constraints, and must never be ranked if it somehow does.
        {
          id: "fx-bad",
          homeTeamId: "a",
          awayTeamId: "c",
          homeScore: 3,
          awayScore: 0,
          homeShootoutScore: null,
          awayShootoutScore: null,
          playoffPhase: null,
          playoffRound: null,
          scheduledAt: SEASON_START,
          playedAt: SEASON_START,
        },
      ],
    })

    const state = await loadPlayoff("d1")

    expect(state?.knockoutDraw).toEqual(draw)
    expect(state?.fixtures.map((f) => f.id)).toEqual(["fx-1"])
  })

  it("returns null for a division that has never had a playoff", async () => {
    mockPlayoffFindUnique.mockResolvedValue(null)
    expect(await loadPlayoff("d1")).toBeNull()
  })
})

describe("round readers", () => {
  function row(over: Partial<PlayoffFixtureRow> & { id: string }): PlayoffFixtureRow {
    return {
      homeTeamId: "a",
      awayTeamId: "b",
      homeScore: 1,
      awayScore: 0,
      homeShootoutScore: null,
      awayShootoutScore: null,
      playoffPhase: "ROUND_ROBIN",
      playoffRound: 1,
      scheduledAt: SEASON_START,
      playedAt: SEASON_START,
      ...over,
    }
  }

  const state = {
    id: "po-1",
    divisionId: "d1",
    drawSeed: "s",
    knockoutDraw: null,
    fixtures: [
      row({ id: "r2", playoffRound: 2, scheduledAt: new Date(SEASON_START.getTime() + 172_800_000) }),
      row({ id: "r1b", scheduledAt: new Date(SEASON_START.getTime() + 3_600_000) }),
      row({ id: "r1a" }),
      row({ id: "k1", playoffPhase: "KNOCKOUT", playoffRound: 1 }),
    ],
  }

  it("fixturesOfRound filters by phase and round, in kickoff order", () => {
    expect(fixturesOfRound(state, "ROUND_ROBIN", 1).map((f) => f.id)).toEqual(["r1a", "r1b"])
    expect(fixturesOfRound(state, "KNOCKOUT", 1).map((f) => f.id)).toEqual(["k1"])
  })

  it("latestRound is per phase", () => {
    expect(latestRound(state, "ROUND_ROBIN")).toBe(2)
    expect(latestRound(state, "KNOCKOUT")).toBe(1)
    expect(latestRound({ ...state, fixtures: [] }, "KNOCKOUT")).toBe(0)
  })

  describe("roundIsComplete", () => {
    const finished = new Date(SEASON_START.getTime() + (MATCH_REAL_DURATION_MINUTES + 1) * 60_000)

    it("is false for an empty round - nothing to conclude from no matches", () => {
      expect(roundIsComplete([], finished)).toBe(false)
    })

    it("is false while the live window is still running, even with a score stored", () => {
      // The engine writes the result at kickoff; the match is still on screen.
      expect(roundIsComplete([row({ id: "x" })], new Date(SEASON_START.getTime() + 60_000))).toBe(false)
    })

    it("is false when the window has passed but nothing was played", () => {
      expect(
        roundIsComplete([row({ id: "x", playedAt: null, homeScore: null, awayScore: null })], finished)
      ).toBe(false)
    })

    it("is false when a finished match is still level with no shootout", () => {
      expect(roundIsComplete([row({ id: "x", homeScore: 1, awayScore: 1 })], finished)).toBe(false)
    })

    it("is true once every match has finished with a decided outcome", () => {
      expect(
        roundIsComplete(
          [row({ id: "x" }), row({ id: "y", homeScore: 1, awayScore: 1, homeShootoutScore: 4, awayShootoutScore: 3 })],
          finished
        )
      ).toBe(true)
    })
  })

  it("knockoutSurvivors returns winners AND byes, in persisted bracket order", () => {
    const draw = drawKnockout(["a", "b", "c", "d", "e"], "IL-S1-T1-12345678")
    const playing = draw.firstRound.pairings[0]
    const survivors = knockoutSurvivors(
      draw,
      [row({ id: "k", homeTeamId: playing.homeTeamId, awayTeamId: playing.awayTeamId, homeScore: 2, awayScore: 0 })],
      draw.byes
    )

    expect(survivors).toHaveLength(draw.byes.length + 1)
    expect(survivors).toContain(playing.homeTeamId)
    expect(survivors).not.toContain(playing.awayTeamId)
    // Bracket order, not the order the winners happened to be discovered in.
    expect(survivors).toEqual(draw.order.filter((t) => survivors.includes(t)))
  })
})
