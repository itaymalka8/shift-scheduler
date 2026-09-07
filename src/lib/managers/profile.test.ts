/**
 * The profile reader: what it fetches, how many times, and what it refuses to
 * count.
 */
const mockUserFindUnique = jest.fn()
const mockEraFindMany = jest.fn()
const mockFixtureFindMany = jest.fn()
const mockChampionFindMany = jest.fn()
const mockSeasonFindFirst = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    teamEra: { findMany: (...a: unknown[]) => mockEraFindMany(...a) },
    fixture: { findMany: (...a: unknown[]) => mockFixtureFindMany(...a) },
    seasonChampion: { findMany: (...a: unknown[]) => mockChampionFindMany(...a) },
    season: { findFirst: (...a: unknown[]) => mockSeasonFindFirst(...a) },
  },
}))

import { loadManagerProfile } from "./profile"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"

const at = (iso: string) => new Date(iso)
const NOW = at("2027-06-01T00:00:00.000Z")
const USER = "user-1"

const club = (id: string, name: string) => ({
  id,
  name,
  countryCode: "IL",
  crestShape: null,
  crestPattern: null,
  crestIcon: null,
  crestColor: null,
  crestSecondaryColor: null,
  crestBorderColor: null,
  crestImageUrl: null,
})

const eraRow = (id: string, teamId: string, name: string, startedAt: string, endedAt: string | null) => ({
  id,
  teamId,
  startedAt: at(startedAt),
  endedAt: endedAt ? at(endedAt) : null,
  team: club(teamId, name),
  startedSeason: { number: 1, countryCode: "IL" },
  endedSeason: endedAt ? { number: 2, countryCode: "IL" } : null,
})

const fixture = (home: string, away: string, kickoff: string, hs: number, as: number, seasonId = "season-1") => ({
  homeTeamId: home,
  awayTeamId: away,
  scheduledAt: at(kickoff),
  playedAt: at(kickoff),
  homeScore: hs,
  awayScore: as,
  division: { seasonId },
})

beforeEach(() => {
  jest.resetAllMocks()
  mockUserFindUnique.mockResolvedValue({ id: USER, name: "Itay", image: null })
  mockEraFindMany.mockResolvedValue([])
  mockFixtureFindMany.mockResolvedValue([])
  mockChampionFindMany.mockResolvedValue([])
  mockSeasonFindFirst.mockResolvedValue({ id: "season-1", number: 1, countryCode: "IL" })
})

describe("loadManagerProfile", () => {
  it("returns null for a user who does not exist", async () => {
    mockUserFindUnique.mockResolvedValue(null)
    expect(await loadManagerProfile(USER, NOW)).toBeNull()
  })

  it("A USER WHO HAS NEVER MANAGED is a real person with an empty career", async () => {
    const profile = await loadManagerProfile(USER, NOW)

    expect(profile).not.toBeNull()
    expect(profile!.name).toBe("Itay")
    expect(profile!.spells).toEqual([])
    expect(profile!.currentClub).toBeNull()
    expect(profile!.currentSeasonRecord).toBeNull()
    expect(profile!.summary.record.matches).toBe(0)
    expect(profile!.summary.winPercentage).toBeNull()
    // No fixtures are read for a career with no eras.
    expect(mockFixtureFindMany).not.toHaveBeenCalled()
  })

  it("reads ONLY HUMAN eras of this user, oldest first", async () => {
    await loadManagerProfile(USER, NOW)
    const args = mockEraFindMany.mock.calls[0][0] as { where: unknown; orderBy: unknown }
    expect(args.where).toEqual({ userId: USER, type: "HUMAN" })
    expect(args.orderBy).toEqual({ startedAt: "asc" })
  })

  it("NO N+1: one fixture query for a whole multi-era career", async () => {
    mockEraFindMany.mockResolvedValue([
      eraRow("e1", "team-a", "Alpha", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
      eraRow("e2", "team-b", "Beta", "2026-05-01T00:00:00Z", "2026-09-01T00:00:00Z"),
      eraRow("e3", "team-a", "Alpha", "2027-01-01T00:00:00Z", null),
    ])

    await loadManagerProfile(USER, NOW)

    expect(mockFixtureFindMany).toHaveBeenCalledTimes(1)
    expect(mockEraFindMany).toHaveBeenCalledTimes(1)
    expect(mockChampionFindMany).toHaveBeenCalledTimes(1)
    expect(mockUserFindUnique).toHaveBeenCalledTimes(1)
    // One season read, and only because there is a current club.
    expect(mockSeasonFindFirst).toHaveBeenCalledTimes(1)
  })

  it("bounds the fixture read to the career's clubs, its start, and finished matches", async () => {
    mockEraFindMany.mockResolvedValue([
      eraRow("e1", "team-a", "Alpha", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
      eraRow("e2", "team-b", "Beta", "2026-05-01T00:00:00Z", null),
    ])

    await loadManagerProfile(USER, NOW)

    const where = (mockFixtureFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where.OR).toEqual([
      { homeTeamId: { in: ["team-a", "team-b"] } },
      { awayTeamId: { in: ["team-a", "team-b"] } },
    ])
    expect(where.scheduledAt).toEqual({
      gte: at("2026-01-01T00:00:00Z"),
      lte: new Date(NOW.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000),
    })
    expect(where.playedAt).toEqual({ not: null })
  })

  it("A LIVE MATCH IS NEVER SELECTED - the anti-spoiler is in the SQL", async () => {
    mockEraFindMany.mockResolvedValue([eraRow("e1", "team-a", "Alpha", "2026-01-01T00:00:00Z", null)])
    await loadManagerProfile(USER, NOW)

    const where = (mockFixtureFindMany.mock.calls[0][0] as { where: { scheduledAt: { lte: Date } } }).where
    // Ten real minutes before now: exactly isMatchFinished, pushed down.
    expect(NOW.getTime() - where.scheduledAt.lte.getTime()).toBe(MATCH_REAL_DURATION_MINUTES * 60_000)
  })

  it("skips the fixture query entirely when the career is younger than the live window", async () => {
    mockEraFindMany.mockResolvedValue([
      eraRow("e1", "team-a", "Alpha", new Date(NOW.getTime() - 60_000).toISOString(), null),
    ])
    await loadManagerProfile(USER, NOW)
    expect(mockFixtureFindMany).not.toHaveBeenCalled()
  })
})

describe("loadManagerProfile - career shape", () => {
  const ERAS = [
    eraRow("e1", "team-a", "Alpha", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
    eraRow("e2", "team-b", "Beta", "2026-05-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    eraRow("e3", "team-a", "Alpha", "2027-01-01T00:00:00Z", null),
  ]
  const FIXTURES = [
    fixture("team-a", "x", "2026-02-01T19:00:00Z", 2, 0),
    fixture("team-a", "z", "2026-06-01T19:00:00Z", 0, 4), // the bot gap
    fixture("team-b", "p", "2026-06-01T19:00:00Z", 3, 1),
    fixture("team-a", "r", "2027-02-01T19:00:00Z", 1, 1, "season-2"),
  ]

  beforeEach(() => {
    mockEraFindMany.mockResolvedValue(ERAS)
    mockFixtureFindMany.mockResolvedValue(FIXTURES)
  })

  it("returns one spell per era with its own club attached", async () => {
    const profile = await loadManagerProfile(USER, NOW)
    expect(profile!.spells.map((s) => [s.id, s.club.id])).toEqual([
      ["e1", "team-a"],
      ["e2", "team-b"],
      ["e3", "team-a"],
    ])
  })

  it("THE BOT GAP IS EXCLUDED from career totals", async () => {
    const profile = await loadManagerProfile(USER, NOW)
    expect(profile!.summary.record).toEqual({
      matches: 3,
      wins: 2,
      draws: 1,
      losses: 0,
      goalsFor: 6,
      goalsAgainst: 2,
    })
  })

  it("CURRENT CLUB COMES FROM THE OPEN ERA, never Team.userId", async () => {
    const profile = await loadManagerProfile(USER, NOW)
    expect(profile!.currentClub?.id).toBe("team-a")
    expect(profile!.currentSpell?.id).toBe("e3")
  })

  it("A MANAGER WHO HAS LEFT HAS NO CURRENT CLUB and no season record", async () => {
    mockEraFindMany.mockResolvedValue([ERAS[0], ERAS[1]])
    const profile = await loadManagerProfile(USER, NOW)

    expect(profile!.currentClub).toBeNull()
    expect(profile!.currentSpell).toBeNull()
    expect(profile!.currentSeasonRecord).toBeNull()
    // The season is not even queried without a current club.
    expect(mockSeasonFindFirst).not.toHaveBeenCalled()
    // The titles and matches they already earned are untouched.
    expect(profile!.summary.record.matches).toBe(2)
  })

  it("the current season record covers only the ACTIVE season's fixtures", async () => {
    mockSeasonFindFirst.mockResolvedValue({ id: "season-2", number: 2, countryCode: "IL" })
    const profile = await loadManagerProfile(USER, NOW)

    expect(profile!.currentSeasonRecord).toMatchObject({
      seasonNumber: 2,
      countryCode: "IL",
      record: { matches: 1, wins: 0, draws: 1, losses: 0 },
    })
  })

  it("the current season record excludes matches from before the takeover", async () => {
    // season-1 holds both an in-era match and a bot-gap match for team-a.
    mockSeasonFindFirst.mockResolvedValue({ id: "season-1", number: 1, countryCode: "IL" })
    const profile = await loadManagerProfile(USER, NOW)
    // Only e3 is current, and e3 has no season-1 fixture at all.
    expect(profile!.currentSeasonRecord!.record.matches).toBe(0)
  })

  it("has no current season record for a club with no country", async () => {
    mockEraFindMany.mockResolvedValue([{ ...ERAS[2], team: { ...club("team-a", "Alpha"), countryCode: null } }])
    const profile = await loadManagerProfile(USER, NOW)
    expect(profile!.currentSeasonRecord).toBeNull()
    expect(mockSeasonFindFirst).not.toHaveBeenCalled()
  })
})
