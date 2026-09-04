/**
 * The club cabinet: every title the club ever won, and the right manager -
 * or none - against each.
 */
const mockChampionFindMany = jest.fn()
const mockTeamFindUnique = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: {
    seasonChampion: { findMany: (...a: unknown[]) => mockChampionFindMany(...a) },
    team: { findUnique: (...a: unknown[]) => mockTeamFindUnique(...a) },
  },
}))

import { getClubIdentity, getClubTrophies } from "./history"

const at = (iso: string) => new Date(iso)
const NOW = at("2030-01-01T00:00:00.000Z")

const row = (
  id: string,
  era: { id: string; type: "BOT" | "HUMAN"; userId: string | null; user: { id: string; name: string | null; image: string | null } | null } | null,
  decidedAt: string
) => ({
  id,
  teamId: "team-1",
  teamEraId: era?.id ?? null,
  decidedAt: at(decidedAt),
  decidedByFixtureId: null,
  clubNameAtDecision: "Hapoel Ashdod B",
  season: { number: 1, countryCode: "IL" },
  division: { tier: 1, group: null, name: "Premier" },
  team: {
    id: "team-1",
    name: "Maccabi Galaxy",
    crestShape: null,
    crestPattern: null,
    crestIcon: null,
    crestColor: null,
    crestSecondaryColor: null,
    crestBorderColor: null,
    crestImageUrl: null,
  },
  decidedByFixture: null,
  teamEra: era,
})

const botEra = { id: "era-bot", type: "BOT" as const, userId: null, user: null }
const humanEra = {
  id: "era-human",
  type: "HUMAN" as const,
  userId: "user-1",
  user: { id: "user-1", name: "Itay", image: null },
}

beforeEach(() => {
  jest.resetAllMocks()
  mockChampionFindMany.mockResolvedValue([])
})

describe("getClubTrophies", () => {
  it("ENTERS THROUGH teamId - the champion's identity", async () => {
    await getClubTrophies("team-1", NOW)
    expect((mockChampionFindMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ teamId: "team-1" })
  })

  it("A BOT TITLE IS A CLUB TITLE, with no manager credited", async () => {
    mockChampionFindMany.mockResolvedValue([row("a", botEra, "2026-01-01T00:00:00Z")])
    const [trophy] = await getClubTrophies("team-1", NOW)

    expect(trophy.wonUnderBot).toBe(true)
    expect(trophy.manager).toBeNull()
    // It is still in the cabinet - the club won it.
    expect(trophy.id).toBe("a")
  })

  it("a HUMAN title names the manager who actually won it", async () => {
    mockChampionFindMany.mockResolvedValue([row("a", humanEra, "2026-01-01T00:00:00Z")])
    const [trophy] = await getClubTrophies("team-1", NOW)

    expect(trophy.wonUnderBot).toBe(false)
    expect(trophy.manager).toEqual({ userId: "user-1", name: "Itay", image: null })
  })

  it("NO CURRENT MANAGER IS EVER SHOWN AGAINST AN OLD TITLE", async () => {
    // A bot title and a human title on the same club. The bot one must stay
    // manager-less however many humans have held the club since.
    mockChampionFindMany.mockResolvedValue([
      row("bot-title", botEra, "2026-01-01T00:00:00Z"),
      row("human-title", humanEra, "2027-01-01T00:00:00Z"),
    ])
    const trophies = await getClubTrophies("team-1", NOW)

    expect(trophies.find((t) => t.id === "bot-title")!.manager).toBeNull()
    expect(trophies.find((t) => t.id === "human-title")!.manager?.userId).toBe("user-1")
    // Nothing in the query mentions current ownership.
    const where = JSON.stringify((mockChampionFindMany.mock.calls[0][0] as { where: unknown }).where)
    expect(where).not.toContain("userId")
    expect(where).not.toContain("isBot")
  })

  it("shows the historical name, never the club's current one", async () => {
    mockChampionFindMany.mockResolvedValue([row("a", humanEra, "2026-01-01T00:00:00Z")])
    const [trophy] = await getClubTrophies("team-1", NOW)
    expect(trophy.clubName).toBe("Hapoel Ashdod B")
    expect(trophy.clubNameIsHistorical).toBe(true)
  })

  it("reports no manager for a HUMAN era whose user cannot be read, rather than guessing", async () => {
    mockChampionFindMany.mockResolvedValue([
      row("a", { id: "era-x", type: "HUMAN", userId: "gone", user: null }, "2026-01-01T00:00:00Z"),
    ])
    expect((await getClubTrophies("team-1", NOW))[0].manager).toBeNull()
  })

  it("returns most recent first", async () => {
    mockChampionFindMany.mockResolvedValue([
      row("old", botEra, "2026-01-01T00:00:00Z"),
      row("new", humanEra, "2028-01-01T00:00:00Z"),
    ])
    expect((await getClubTrophies("team-1", NOW)).map((t) => t.id)).toEqual(["new", "old"])
  })

  it("A CLUB WITH NO TITLES gets an empty cabinet", async () => {
    expect(await getClubTrophies("team-1", NOW)).toEqual([])
  })
})

describe("getClubIdentity", () => {
  it("reads the club's CURRENT presentation, by id", async () => {
    mockTeamFindUnique.mockResolvedValue({ id: "team-1", name: "Maccabi Galaxy" })
    await getClubIdentity("team-1")
    expect((mockTeamFindUnique.mock.calls[0][0] as { where: unknown }).where).toEqual({ id: "team-1" })
  })
})
