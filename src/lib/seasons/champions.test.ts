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

jest.mock("@/lib/prisma", () => ({
  prisma: {
    division: { findMany: (...args: unknown[]) => mockDivisionFindMany(...args) },
  },
}))

import { findEraAt, persistSeasonChampions, resolveSeasonChampions } from "./champions"
import type { Prisma } from "@/generated/prisma"

/** Stands in for the interactive transaction client the orchestrator passes in. */
const tx = {
  teamEra: { findMany: (...args: unknown[]) => mockEraFindMany(...args) },
  seasonChampion: {
    findUnique: (...args: unknown[]) => mockChampionFindUnique(...args),
    create: (...args: unknown[]) => mockChampionCreate(...args),
  },
} as unknown as Prisma.TransactionClient

beforeEach(() => {
  jest.resetAllMocks()
  mockChampionFindUnique.mockResolvedValue(null)
  mockChampionCreate.mockResolvedValue({})
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
      },
    ],
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
      },
    })
    expect(rows).toEqual([
      { divisionId: "d1", teamId: "A", teamEraId: "era-human", decidedAt: LAST_KICKOFF, created: true },
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
          },
        ],
        divisions: [
          {
            divisionId: "d1",
            seasonId: "s1",
            outcome: { kind: "decider", tiedTeamIds: ["A", "B"] },
            decidedAt: LAST_KICKOFF,
          },
        ],
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
        divisions: [{ divisionId: "d1", seasonId: "s1", outcome: { kind: "empty" }, decidedAt: null }],
      })
    ).rejects.toThrow()
    expect(mockChampionCreate).not.toHaveBeenCalled()
  })
})
