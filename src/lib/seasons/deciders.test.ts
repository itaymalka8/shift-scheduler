/**
 * Creating exactly one title decider, under concurrency, without ever
 * transitioning the season.
 */
import { Prisma } from "@/generated/prisma"

const mockFixtureFindMany = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: { fixture: { findMany: (...a: unknown[]) => mockFixtureFindMany(...a) } },
}))

import { ensureTitleDecider, findDecider, loadDecidersForSeason } from "./deciders"
import { computeMatchdayDate } from "@/lib/match/schedule"

const mockFindFirst = jest.fn()
const mockCreate = jest.fn()

const tx = {
  fixture: {
    findFirst: (...a: unknown[]) => mockFindFirst(...a),
    create: (...a: unknown[]) => mockCreate(...a),
  },
} as unknown as Prisma.TransactionClient

const SEASON_START = computeMatchdayDate(new Date("2026-08-31T19:00:00.000Z"), 1)
const NOW = new Date(SEASON_START.getTime())

/** findFirst is called for: existing decider, schedule anchor, last matchday. */
function stubQueries(existingDecider: unknown) {
  mockFindFirst
    .mockResolvedValueOnce(existingDecider)
    .mockResolvedValueOnce({ scheduledAt: SEASON_START })
    .mockResolvedValueOnce({ matchday: 38 })
}

beforeEach(() => {
  jest.resetAllMocks()
  mockFixtureFindMany.mockResolvedValue([])
})

describe("ensureTitleDecider", () => {
  it("creates one decider, with the lower teamId as technical home", async () => {
    stubQueries(null)
    mockCreate.mockResolvedValue({ id: "dec-1" })

    const result = await ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["zzz", "aaa"], now: NOW })

    expect(result.created).toBe(true)
    expect(result.fixtureId).toBe("dec-1")
    expect(result.homeTeamId).toBe("aaa")
    expect(result.awayTeamId).toBe("zzz")

    const data = (mockCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.stage).toBe("TITLE_DECIDER")
    expect(data.divisionId).toBe("d1")
    expect(data.matchday).toBe(39)
    expect(data.scheduledAt).toEqual(computeMatchdayDate(SEASON_START, 39))
    // No score, no playedAt - it has not been played.
    expect(data.homeScore).toBeUndefined()
    expect(data.playedAt).toBeUndefined()
  })

  it("REUSES an existing decider rather than creating a second", async () => {
    stubQueries({
      id: "dec-existing",
      homeTeamId: "aaa",
      awayTeamId: "zzz",
      scheduledAt: SEASON_START,
      matchday: 39,
    })

    const result = await ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["zzz", "aaa"], now: NOW })
    expect(result.created).toBe(false)
    expect(result.fixtureId).toBe("dec-existing")
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("LOSING A RACE is not an error - it reads back the winner's fixture", async () => {
    // Both runners saw nothing, both tried to create; the partial unique
    // index rejected this one.
    stubQueries(null)
    mockCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" })
    )
    mockFindFirst.mockResolvedValueOnce({
      id: "dec-winner",
      homeTeamId: "aaa",
      awayTeamId: "zzz",
      scheduledAt: SEASON_START,
      matchday: 39,
    })

    const result = await ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["aaa", "zzz"], now: NOW })
    expect(result.created).toBe(false)
    expect(result.fixtureId).toBe("dec-winner")
  })

  it("rethrows anything that is not the uniqueness race", async () => {
    stubQueries(null)
    mockCreate.mockRejectedValue(new Error("connection lost"))
    await expect(
      ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["a", "b"], now: NOW })
    ).rejects.toThrow(/connection lost/)
  })

  it("refuses a division with no scheduled league fixtures to anchor to", async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    await expect(
      ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["a", "b"], now: NOW })
    ).rejects.toThrow(/no scheduled LEAGUE fixtures/)
  })

  it("refuses to build a decider for anything but exactly two clubs", async () => {
    stubQueries(null)
    await expect(
      ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["a", "b", "c"], now: NOW })
    ).rejects.toThrow(/exactly two/)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("anchors its schedule on LEAGUE fixtures only", async () => {
    stubQueries(null)
    mockCreate.mockResolvedValue({ id: "dec-1" })
    await ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["a", "b"], now: NOW })
    const anchorCall = mockFindFirst.mock.calls[1][0] as { where: Record<string, unknown> }
    const lastCall = mockFindFirst.mock.calls[2][0] as { where: Record<string, unknown> }
    expect(anchorCall.where).toMatchObject({ stage: "LEAGUE" })
    expect(lastCall.where).toMatchObject({ stage: "LEAGUE" })
  })

  it("takes no Division or Fixture lock - it introduces no new lock ordering", async () => {
    stubQueries(null)
    mockCreate.mockResolvedValue({ id: "dec-1" })
    await ensureTitleDecider(tx, { divisionId: "d1", tiedTeamIds: ["a", "b"], now: NOW })
    // The transaction client is only ever used for findFirst/create here;
    // a $queryRaw FOR UPDATE would show up as a missing method.
    expect(Object.keys(tx)).toEqual(["fixture"])
  })
})

describe("findDecider / loadDecidersForSeason", () => {
  it("asks only for TITLE_DECIDER fixtures", async () => {
    mockFindFirst.mockResolvedValue(null)
    await findDecider(tx, "d1")
    expect((mockFindFirst.mock.calls[0][0] as { where: unknown }).where).toEqual({
      divisionId: "d1",
      stage: "TITLE_DECIDER",
    })
  })

  it("indexes a season's deciders by division", async () => {
    mockFixtureFindMany.mockResolvedValue([
      { id: "dec-1", divisionId: "d1", homeTeamId: "a", awayTeamId: "b", scheduledAt: NOW, playedAt: null, homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null },
    ])
    const map = await loadDecidersForSeason("s1")
    expect(map.get("d1")?.id).toBe("dec-1")
    expect((mockFixtureFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where).toMatchObject({
      stage: "TITLE_DECIDER",
    })
  })
})
