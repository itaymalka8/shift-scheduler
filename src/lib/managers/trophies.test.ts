/**
 * The manager cabinet's entry point: SeasonChampion, through the era, never
 * through current ownership.
 */
const mockChampionFindMany = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: { seasonChampion: { findMany: (...a: unknown[]) => mockChampionFindMany(...a) } },
}))

import { championshipsByEra, getManagerTrophies } from "./trophies"

const at = (iso: string) => new Date(iso)
const NOW = at("2030-01-01T00:00:00.000Z")

const row = (id: string, eraId: string | null, decidedAt: string) => ({
  id,
  teamId: "team-1",
  teamEraId: eraId,
  decidedAt: at(decidedAt),
  decidedByFixtureId: null,
  clubNameAtDecision: "Hapoel Ashdod B",
  season: { number: 1, countryCode: "IL" },
  division: { tier: 1, group: "A", name: "Premier" },
  team: {
    id: "team-1",
    name: "Now Called Something Else",
    crestShape: null,
    crestPattern: null,
    crestIcon: null,
    crestColor: null,
    crestSecondaryColor: null,
    crestBorderColor: null,
    crestImageUrl: null,
  },
  decidedByFixture: null,
})

beforeEach(() => {
  jest.resetAllMocks()
  mockChampionFindMany.mockResolvedValue([])
})

describe("getManagerTrophies", () => {
  it("ENTERS THROUGH THE ERA: HUMAN, and this user", async () => {
    await getManagerTrophies("user-1", NOW)
    const args = mockChampionFindMany.mock.calls[0][0] as { where: unknown }
    expect(args.where).toEqual({ teamEra: { is: { type: "HUMAN", userId: "user-1" } } })
  })

  it("NEVER filters on Team.userId or on the club at all", async () => {
    await getManagerTrophies("user-1", NOW)
    const where = JSON.stringify((mockChampionFindMany.mock.calls[0][0] as { where: unknown }).where)
    expect(where).not.toContain("teamId")
    expect(where).not.toContain("isBot")
    // The relation filter implies teamEraId IS NOT NULL, so a title with no
    // era - and therefore a bot title - cannot be returned.
    expect(where).toContain("HUMAN")
  })

  it("returns most recent first", async () => {
    mockChampionFindMany.mockResolvedValue([
      row("old", "era-1", "2026-01-01T00:00:00Z"),
      row("new", "era-2", "2028-01-01T00:00:00Z"),
      row("mid", "era-1", "2027-01-01T00:00:00Z"),
    ])
    const trophies = await getManagerTrophies("user-1", NOW)
    expect(trophies.map((t) => t.id)).toEqual(["new", "mid", "old"])
  })

  it("uses the historical club name, not the club's current one", async () => {
    mockChampionFindMany.mockResolvedValue([row("a", "era-1", "2026-01-01T00:00:00Z")])
    const [trophy] = await getManagerTrophies("user-1", NOW)
    expect(trophy.clubName).toBe("Hapoel Ashdod B")
    expect(trophy.clubNameIsHistorical).toBe(true)
  })

  it("A MANAGER WITH NO TITLES gets an empty cabinet, not an error", async () => {
    expect(await getManagerTrophies("user-1", NOW)).toEqual([])
  })
})

describe("championshipsByEra", () => {
  it("counts titles per era so a spell can show its own", async () => {
    mockChampionFindMany.mockResolvedValue([
      row("a", "era-1", "2026-01-01T00:00:00Z"),
      row("b", "era-1", "2027-01-01T00:00:00Z"),
      row("c", "era-2", "2028-01-01T00:00:00Z"),
    ])
    const counts = championshipsByEra(await getManagerTrophies("user-1", NOW))
    expect(counts.get("era-1")).toBe(2)
    expect(counts.get("era-2")).toBe(1)
    expect(counts.get("era-never")).toBeUndefined()
  })

  it("ignores a title with no era rather than counting it against nobody", async () => {
    mockChampionFindMany.mockResolvedValue([row("a", null, "2026-01-01T00:00:00Z")])
    expect(championshipsByEra(await getManagerTrophies("user-1", NOW)).size).toBe(0)
  })
})
