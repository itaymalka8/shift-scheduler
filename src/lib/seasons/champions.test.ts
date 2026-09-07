/**
 * The database-facing half of championship persistence: resolving a whole
 * season, attributing a title to the era that held the club at the deciding
 * kickoff, and refusing - loudly - to write anything when the title is not
 * actually settled.
 *
 * The tie-breaking chain itself is proven in ./champion.test.ts; this file
 * is about what surrounds it.
 */
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"

const mockDivisionFindMany = jest.fn()
const mockEraFindMany = jest.fn()
const mockChampionFindUnique = jest.fn()
const mockChampionCreate = jest.fn()
const mockFixtureFindMany = jest.fn()
const mockPlayoffFindMany = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    division: { findMany: (...args: unknown[]) => mockDivisionFindMany(...args) },
    fixture: { findMany: (...args: unknown[]) => mockFixtureFindMany(...args) },
    championshipPlayoff: { findMany: (...args: unknown[]) => mockPlayoffFindMany(...args) },
  },
}))

import { findEraAt, persistSeasonChampions, resolveSeasonChampions } from "./champions"
import type { Prisma } from "@/generated/prisma"

/** Stands in for the interactive transaction client the orchestrator passes in. */
const mockTxTeamFindUnique = jest.fn()

const tx = {
  teamEra: { findMany: (...args: unknown[]) => mockEraFindMany(...args) },
  team: { findUnique: (...args: unknown[]) => mockTxTeamFindUnique(...args) },
  seasonChampion: {
    findUnique: (...args: unknown[]) => mockChampionFindUnique(...args),
    create: (...args: unknown[]) => mockChampionCreate(...args),
  },
} as unknown as Prisma.TransactionClient

beforeEach(() => {
  jest.resetAllMocks()
  mockFixtureFindMany.mockResolvedValue([])
  mockPlayoffFindMany.mockResolvedValue([])
  mockChampionFindUnique.mockResolvedValue(null)
  mockChampionCreate.mockResolvedValue({})
  mockTxTeamFindUnique.mockResolvedValue({ name: "Hapoel Ashdod B" })
})

const NOW = new Date("2026-05-01T12:00:00Z")
const LIVE_WINDOW_MS = MATCH_REAL_DURATION_MINUTES * 60_000
/** A kickoff far enough in the past that its live window has fully played out. */
const finished = (offsetDays: number) =>
  new Date(NOW.getTime() - LIVE_WINDOW_MS - offsetDays * 86_400_000)

const LAST_KICKOFF = finished(0)
const EARLIER_KICKOFF = finished(3)

function division(overrides: Partial<{ id: string; teamIds: string[]; fixtures: unknown[] }> = {}) {
  return {
    id: overrides.id ?? "d1",
    teams: (overrides.teamIds ?? ["A", "B"]).map((teamId) => ({ teamId })),
    fixtures: overrides.fixtures ?? [
      { homeTeamId: "A", awayTeamId: "B", homeScore: 2, awayScore: 0, scheduledAt: EARLIER_KICKOFF },
      { homeTeamId: "B", awayTeamId: "A", homeScore: 0, awayScore: 0, scheduledAt: LAST_KICKOFF },
    ],
  }
}

describe("resolveSeasonChampions", () => {
  it("resolves a division and dates the title from the LAST league kickoff", async () => {
    mockDivisionFindMany.mockResolvedValue([division()])
    const result = await resolveSeasonChampions("s1", NOW)

    expect(result.fullyResolved).toBe(true)
    expect(result.needsDecider).toHaveLength(0)
    expect(result.divisions[0].outcome).toEqual({ kind: "resolved", teamId: "A", via: "table" })
    // MAX(scheduledAt), not the earliest and not "now".
    expect(result.divisions[0].decidedAt).toEqual(LAST_KICKOFF)
  })

  it("asks the database for LEAGUE fixtures only - a decider must never feed the calculation that called for it", async () => {
    mockDivisionFindMany.mockResolvedValue([division()])
    await resolveSeasonChampions("s1", NOW)

    const args = mockDivisionFindMany.mock.calls[0][0] as {
      where: { seasonId: string }
      select: { fixtures: { where: { stage: string } } }
    }
    expect(args.where.seasonId).toBe("s1")
    expect(args.select.fixtures.where).toEqual({ stage: "LEAGUE" })
  })

  it("ignores a match still inside its live window - a championship is never decided by a match being watched", async () => {
    // The engine writes the final score at kickoff, so this fixture already
    // HAS a stored 9-0 result while the match is still on screen.
    const live = new Date(NOW.getTime() - LIVE_WINDOW_MS / 2)
    mockDivisionFindMany.mockResolvedValue([
      division({
        fixtures: [
          { homeTeamId: "A", awayTeamId: "B", homeScore: 2, awayScore: 0, scheduledAt: EARLIER_KICKOFF },
          { homeTeamId: "B", awayTeamId: "A", homeScore: 9, awayScore: 0, scheduledAt: live },
        ],
      }),
    ])
    const result = await resolveSeasonChampions("s1", NOW)
    // B's 9-0 is excluded, so A still leads - and the title is dated from
    // the last FINISHED kickoff, not the live one.
    expect(result.divisions[0].outcome).toEqual({ kind: "resolved", teamId: "A", via: "table" })
    expect(result.divisions[0].decidedAt).toEqual(EARLIER_KICKOFF)
  })

  it("reports a division that needs a decider, and refuses to call the season resolved", async () => {
    mockDivisionFindMany.mockResolvedValue([
      division({
        fixtures: [
          { homeTeamId: "A", awayTeamId: "B", homeScore: 1, awayScore: 1, scheduledAt: EARLIER_KICKOFF },
          { homeTeamId: "B", awayTeamId: "A", homeScore: 2, awayScore: 2, scheduledAt: LAST_KICKOFF },
        ],
      }),
    ])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.fullyResolved).toBe(false)
    expect(result.needsDecider).toHaveLength(1)
    expect(result.divisions[0].outcome).toEqual({ kind: "decider", tiedTeamIds: ["A", "B"] })
  })

  it("is not fully resolved when ONE of several divisions is tied - the season moves as a whole or not at all", async () => {
    mockDivisionFindMany.mockResolvedValue([
      division({ id: "d1" }),
      division({
        id: "d2",
        teamIds: ["C", "D"],
        fixtures: [
          { homeTeamId: "C", awayTeamId: "D", homeScore: 1, awayScore: 1, scheduledAt: EARLIER_KICKOFF },
          { homeTeamId: "D", awayTeamId: "C", homeScore: 1, awayScore: 1, scheduledAt: LAST_KICKOFF },
        ],
      }),
    ])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.fullyResolved).toBe(false)
    expect(result.needsDecider.map((d) => d.divisionId)).toEqual(["d2"])
  })

  it("crowns nobody in a division where nothing has been played", async () => {
    mockDivisionFindMany.mockResolvedValue([division({ fixtures: [] })])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.divisions[0].outcome).toEqual({ kind: "empty" })
    expect(result.divisions[0].decidedAt).toBeNull()
    expect(result.fullyResolved).toBe(false)
  })

  it("is not fully resolved for a season with no divisions at all", async () => {
    mockDivisionFindMany.mockResolvedValue([])
    expect((await resolveSeasonChampions("s1", NOW)).fullyResolved).toBe(false)
  })
})

describe("findEraAt - manager attribution", () => {
  const bot = { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null as Date | null }

  it("returns the open era when the title was decided inside it", async () => {
    mockEraFindMany.mockResolvedValue([bot])
    expect(await findEraAt(tx, "A", LAST_KICKOFF)).toEqual({ id: "era-bot" })
  })

  it("MID-SEASON TAKEOVER: the human era that was open at the deciding kickoff gets the title", async () => {
    const takeover = finished(10)
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: takeover },
      { id: "era-human", teamId: "A", startedAt: takeover, endedAt: null },
    ])
    expect(await findEraAt(tx, "A", LAST_KICKOFF)).toEqual({ id: "era-human" })
  })

  it("HISTORICAL BOT TITLE: a takeover AFTER the deciding kickoff cannot claim the title", async () => {
    // The bot won it; the human arrived two seasons later.
    const laterTakeover = new Date(NOW.getTime() + 400 * 86_400_000)
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: laterTakeover },
      { id: "era-human", teamId: "A", startedAt: laterTakeover, endedAt: null },
    ])
    expect(await findEraAt(tx, "A", LAST_KICKOFF)).toEqual({ id: "era-bot" })
  })

  it("uses the half-open window: a kickoff exactly at the handover belongs to the NEW era", async () => {
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: LAST_KICKOFF },
      { id: "era-human", teamId: "A", startedAt: LAST_KICKOFF, endedAt: null },
    ])
    expect(await findEraAt(tx, "A", LAST_KICKOFF)).toEqual({ id: "era-human" })
  })

  it("returns null rather than throwing when no era covers the instant - a data defect must not block a season", async () => {
    mockEraFindMany.mockResolvedValue([
      { id: "era-late", teamId: "A", startedAt: new Date(NOW.getTime() + 86_400_000), endedAt: null },
    ])
    expect(await findEraAt(tx, "A", LAST_KICKOFF)).toBeNull()
  })

  it("never reads Team.userId - it asks TeamEra and nothing else", async () => {
    mockEraFindMany.mockResolvedValue([bot])
    await findEraAt(tx, "A", LAST_KICKOFF)
    const args = mockEraFindMany.mock.calls[0][0] as { where: unknown; select: Record<string, boolean> }
    expect(args.where).toEqual({ teamId: "A" })
    // The selected columns are the era window and its id - no user, no team row.
    expect(Object.keys(args.select).sort()).toEqual(["endedAt", "id", "startedAt", "teamId"])
  })
})

describe("persistSeasonChampions", () => {
  const resolved = {
    seasonId: "s1",
    fullyResolved: true,
    needsDecider: [],
    divisions: [
      {
        divisionId: "d1",
        seasonId: "s1",
        outcome: { kind: "resolved" as const, teamId: "A", via: "table" as const },
        decidedAt: LAST_KICKOFF,
        decidedByFixtureId: null,
      },
    ],
    tiedTeamIdsByDivision: new Map<string, string[]>(),
  }

  it("writes one champion row, carrying the era snapshot and the deciding kickoff", async () => {
    mockEraFindMany.mockResolvedValue([
      { id: "era-human", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null },
    ])
    const rows = await persistSeasonChampions(tx, resolved)

    expect(mockChampionCreate).toHaveBeenCalledTimes(1)
    expect(mockChampionCreate.mock.calls[0][0]).toEqual({
      data: {
        seasonId: "s1",
        divisionId: "d1",
        teamId: "A",
        teamEraId: "era-human",
        decidedAt: LAST_KICKOFF,
        decidedByFixtureId: null,
        clubNameAtDecision: "Hapoel Ashdod B",
      },
    })
    expect(rows).toEqual([
      {
        divisionId: "d1",
        teamId: "A",
        teamEraId: "era-human",
        decidedAt: LAST_KICKOFF,
        decidedByFixtureId: null,
        clubNameAtDecision: "Hapoel Ashdod B",
        created: true,
      },
    ])
  })

  it("IDEMPOTENT: a second run writes nothing and reports that it created nothing", async () => {
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null },
    ])
    mockChampionFindUnique.mockResolvedValue({ id: "champ-1" })

    const rows = await persistSeasonChampions(tx, resolved)
    expect(mockChampionCreate).not.toHaveBeenCalled()
    expect(rows[0].created).toBe(false)
  })

  it("SNAPSHOTS THE CLUB NAME as it stands when the title is decided", async () => {
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null },
    ])
    mockTxTeamFindUnique.mockResolvedValue({ name: "Maccabi Bnei Yam" })

    const rows = await persistSeasonChampions(tx, resolved)

    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({
      data: { clubNameAtDecision: "Maccabi Bnei Yam" },
    })
    expect(rows[0].clubNameAtDecision).toBe("Maccabi Bnei Yam")
    // Read inside the SAME transaction that writes the title, by id.
    expect(mockTxTeamFindUnique).toHaveBeenCalledWith({ where: { id: "A" }, select: { name: true } })
  })

  it("snapshots a BOT era's champion name exactly as it does a HUMAN one", async () => {
    // The snapshot is about the CLUB, not the manager - a bot title carries
    // its name for the same reason and by the same code path.
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null },
    ])
    mockTxTeamFindUnique.mockResolvedValue({ name: "FC Bot 17" })

    await persistSeasonChampions(tx, resolved)
    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({
      data: { teamEraId: "era-bot", clubNameAtDecision: "FC Bot 17" },
    })
  })

  it("THE SNAPSHOT IS NEVER AN IDENTITY: teamId still names the champion", async () => {
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null },
    ])
    mockTxTeamFindUnique.mockResolvedValue({ name: "Some Other Club" })

    const rows = await persistSeasonChampions(tx, resolved)
    // Even with a name that resembles a different club, the row's identity
    // is the id the title was resolved to.
    expect(rows[0].teamId).toBe("A")
    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({ data: { teamId: "A" } })
  })

  it("records the name as null rather than inventing one when the club cannot be read", async () => {
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null },
    ])
    mockTxTeamFindUnique.mockResolvedValue(null)

    await persistSeasonChampions(tx, resolved)
    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({ data: { clubNameAtDecision: null } })
  })

  it("records teamEraId as null rather than failing when the club has no covering era", async () => {
    mockEraFindMany.mockResolvedValue([])
    await persistSeasonChampions(tx, resolved)
    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({ data: { teamEraId: null } })
  })

  it("REFUSES to write anything when a division still needs a decider", async () => {
    await expect(
      persistSeasonChampions(tx, {
        seasonId: "s1",
        fullyResolved: false,
        needsDecider: [
          {
            divisionId: "d1",
            seasonId: "s1",
            outcome: { kind: "decider", tiedTeamIds: ["A", "B"] },
            decidedAt: LAST_KICKOFF,
            decidedByFixtureId: null,
          },
        ],
        divisions: [
          {
            divisionId: "d1",
            seasonId: "s1",
            outcome: { kind: "decider", tiedTeamIds: ["A", "B"] },
            decidedAt: LAST_KICKOFF,
            decidedByFixtureId: null,
          },
        ],
        tiedTeamIdsByDivision: new Map([["d1", ["A", "B"]]]),
      })
    ).rejects.toThrow(/still tied/)
    expect(mockChampionCreate).not.toHaveBeenCalled()
  })

  it("never writes a champion for a division that played nothing", async () => {
    await expect(
      persistSeasonChampions(tx, {
        seasonId: "s1",
        fullyResolved: false,
        needsDecider: [],
        divisions: [{ divisionId: "d1", seasonId: "s1", outcome: { kind: "empty" }, decidedAt: null, decidedByFixtureId: null }],
        tiedTeamIdsByDivision: new Map<string, string[]>(),
      })
    ).rejects.toThrow()
    expect(mockChampionCreate).not.toHaveBeenCalled()
  })
})

describe("a division settled by a title decider", () => {
  const DECIDER_KICKOFF = finished(0)
  const tiedFixtures = [
    { homeTeamId: "A", awayTeamId: "B", homeScore: 1, awayScore: 1, scheduledAt: EARLIER_KICKOFF },
    { homeTeamId: "B", awayTeamId: "A", homeScore: 2, awayScore: 2, scheduledAt: LAST_KICKOFF },
  ]

  function decider(overrides: Record<string, unknown> = {}) {
    return {
      id: "dec-1",
      divisionId: "d1",
      homeTeamId: "A",
      awayTeamId: "B",
      scheduledAt: DECIDER_KICKOFF,
      playedAt: new Date(),
      homeScore: 2,
      awayScore: 1,
      homeShootoutScore: null,
      awayShootoutScore: null,
      ...overrides,
    }
  }

  beforeEach(() => {
    mockDivisionFindMany.mockResolvedValue([division({ fixtures: tiedFixtures })])
  })

  it("the 90-minute winner becomes champion, dated from the DECIDER's kickoff", async () => {
    mockFixtureFindMany.mockResolvedValue([decider()])
    const result = await resolveSeasonChampions("s1", NOW)

    expect(result.fullyResolved).toBe(true)
    expect(result.divisions[0].outcome).toEqual({ kind: "resolved", teamId: "A", via: "decider" })
    // Not the last league matchday - the decider IS the title-deciding match.
    expect(result.divisions[0].decidedAt).toEqual(DECIDER_KICKOFF)
    expect(result.divisions[0].decidedByFixtureId).toBe("dec-1")
  })

  it("a drawn decider is settled by the shootout", async () => {
    mockFixtureFindMany.mockResolvedValue([
      decider({ homeScore: 1, awayScore: 1, homeShootoutScore: 3, awayShootoutScore: 4 }),
    ])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.divisions[0].outcome).toEqual({ kind: "resolved", teamId: "B", via: "decider" })
  })

  it("WAITS while the decider has not kicked off - no champion, not resolved", async () => {
    const future = new Date(NOW.getTime() + 86_400_000)
    mockFixtureFindMany.mockResolvedValue([decider({ scheduledAt: future, playedAt: null, homeScore: null, awayScore: null })])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.fullyResolved).toBe(false)
    expect(result.divisions[0].awaitingDeciderFixtureId).toBe("dec-1")
  })

  it("WAITS while the decider is LIVE, even though its score is already stored", async () => {
    // The engine writes the result at kickoff, so this decider already has
    // 2-1 in the database while the match is still on screen. Crowning a
    // champion from it would announce the result to someone watching.
    const live = new Date(NOW.getTime() - LIVE_WINDOW_MS / 2)
    mockFixtureFindMany.mockResolvedValue([decider({ scheduledAt: live })])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.fullyResolved).toBe(false)
    expect(result.divisions[0].outcome.kind).toBe("decider")
    expect(result.divisions[0].awaitingDeciderFixtureId).toBe("dec-1")
  })

  it("WAITS for a decider whose live window elapsed but which was never simulated", async () => {
    mockFixtureFindMany.mockResolvedValue([decider({ playedAt: null, homeScore: null, awayScore: null })])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.fullyResolved).toBe(false)
  })

  it("FAILS CLOSED on a finished decider that is drawn with no shootout", async () => {
    mockFixtureFindMany.mockResolvedValue([decider({ homeScore: 1, awayScore: 1 })])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.fullyResolved).toBe(false)
    expect(result.divisions[0].awaitingDeciderFixtureId).toBe("dec-1")
  })

  it("reports the tied clubs so the caller can create the decider without re-resolving", async () => {
    mockFixtureFindMany.mockResolvedValue([])
    const result = await resolveSeasonChampions("s1", NOW)
    expect(result.tiedTeamIdsByDivision.get("d1")).toEqual(["A", "B"])
    expect(result.needsDecider).toHaveLength(1)
  })

  it("persists decidedByFixtureId so a trophy cabinet can say how it was won", async () => {
    mockFixtureFindMany.mockResolvedValue([decider()])
    mockEraFindMany.mockResolvedValue([
      { id: "era-human", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null },
    ])
    const resolution = await resolveSeasonChampions("s1", NOW)
    await persistSeasonChampions(tx, resolution)
    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({
      data: { teamId: "A", decidedAt: DECIDER_KICKOFF, decidedByFixtureId: "dec-1" },
    })
  })

  it("HUMAN TAKEOVER BEFORE THE DECIDER receives the manager title", async () => {
    mockFixtureFindMany.mockResolvedValue([decider()])
    const takeover = new Date(DECIDER_KICKOFF.getTime() - 3600_000)
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: takeover },
      { id: "era-human", teamId: "A", startedAt: takeover, endedAt: null },
    ])
    const resolution = await resolveSeasonChampions("s1", NOW)
    await persistSeasonChampions(tx, resolution)
    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({ data: { teamEraId: "era-human" } })
  })

  it("HUMAN TAKEOVER AFTER THE DECIDER does not - the bot era keeps it", async () => {
    mockFixtureFindMany.mockResolvedValue([decider()])
    const takeover = new Date(DECIDER_KICKOFF.getTime() + 3600_000)
    mockEraFindMany.mockResolvedValue([
      { id: "era-bot", teamId: "A", startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: takeover },
      { id: "era-human", teamId: "A", startedAt: takeover, endedAt: null },
    ])
    const resolution = await resolveSeasonChampions("s1", NOW)
    await persistSeasonChampions(tx, resolution)
    expect(mockChampionCreate.mock.calls[0][0]).toMatchObject({ data: { teamEraId: "era-bot" } })
  })
})
