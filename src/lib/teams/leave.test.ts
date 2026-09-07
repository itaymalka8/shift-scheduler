/**
 * The manager leave transition: what it changes, what it must never touch,
 * and what it refuses to do.
 */
import { Prisma } from "@/generated/prisma"

const mockTeamFindUnique = jest.fn()
const mockTransaction = jest.fn()
jest.mock("@/lib/prisma", () => ({
  prisma: {
    team: { findUnique: (...a: unknown[]) => mockTeamFindUnique(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}))

import { TeamLeaveError, leaveManagedTeam } from "./leave"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"

const USER = "user-1"
const TEAM = "team-1"
const NOW = new Date("2026-09-10T12:00:00.000Z")
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

const mockQueryRaw = jest.fn()
const mockTxTeamFindUniqueOrThrow = jest.fn()
const mockTxTeamUpdate = jest.fn()
const mockEraFindMany = jest.fn()
const mockEraFindFirst = jest.fn()
const mockEraUpdate = jest.fn()
const mockEraCreate = jest.fn()
const mockFixtureFindMany = jest.fn()
const mockSeasonFindFirst = jest.fn()

const tx = {
  $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
  team: {
    findUniqueOrThrow: (...a: unknown[]) => mockTxTeamFindUniqueOrThrow(...a),
    update: (...a: unknown[]) => mockTxTeamUpdate(...a),
  },
  teamEra: {
    findMany: (...a: unknown[]) => mockEraFindMany(...a),
    findFirst: (...a: unknown[]) => mockEraFindFirst(...a),
    update: (...a: unknown[]) => mockEraUpdate(...a),
    create: (...a: unknown[]) => mockEraCreate(...a),
  },
  fixture: { findMany: (...a: unknown[]) => mockFixtureFindMany(...a) },
  season: { findFirst: (...a: unknown[]) => mockSeasonFindFirst(...a) },
} as unknown as Prisma.TransactionClient

/** The happy path's reads, each overridable per test. */
function stubHealthyClub(over: { isBot?: boolean; teamUserId?: string | null } = {}) {
  mockTeamFindUnique.mockResolvedValue({ id: TEAM })
  mockQueryRaw.mockResolvedValue([{ id: TEAM }])
  mockTxTeamFindUniqueOrThrow.mockResolvedValue({
    id: TEAM,
    userId: over.teamUserId === undefined ? USER : over.teamUserId,
    isBot: over.isBot ?? false,
    countryCode: "IL",
  })
  mockEraFindMany.mockResolvedValue([{ id: "era-human", type: "HUMAN", userId: USER }])
  mockFixtureFindMany.mockResolvedValue([])
  mockSeasonFindFirst.mockResolvedValue({ id: "season-1" })
  // closeEraAndOpenNext's own reads.
  mockEraFindFirst.mockResolvedValue({ id: "era-human", startedAt: new Date("2026-08-01T00:00:00.000Z") })
  mockEraCreate.mockResolvedValue({ id: "era-bot-2" })
}

beforeEach(() => {
  jest.resetAllMocks()
  mockTransaction.mockImplementation(async (fn: (client: Prisma.TransactionClient) => Promise<unknown>) => fn(tx))
})

describe("leaveManagedTeam", () => {
  it("closes the HUMAN era and opens a BOT era at the SAME instant", async () => {
    stubHealthyClub()

    const result = await leaveManagedTeam(USER, NOW)

    expect(result).toEqual({ teamId: TEAM, closedEraId: "era-human", openedEraId: "era-bot-2", at: NOW })

    const closed = (mockEraUpdate.mock.calls[0][0] as { where: { id: string }; data: { endedAt: Date } })
    const opened = (mockEraCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(closed.where.id).toBe("era-human")
    expect(closed.data.endedAt).toEqual(NOW)
    expect(opened.startedAt).toEqual(NOW)
    // GAPLESS AND NON-OVERLAPPING: byte-identical instants, half-open window.
    expect((closed.data.endedAt as Date).getTime()).toBe((opened.startedAt as Date).getTime())
  })

  it("the new era is a real BOT era: no user, same club, still open", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)

    const opened = (mockEraCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(opened.type).toBe("BOT")
    expect(opened.userId).toBeNull()
    expect(opened.teamId).toBe(TEAM)
    expect(opened.endedAt).toBeUndefined()
  })

  it("sets Team.userId to null and Team.isBot to true, and NOTHING else", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)

    const update = (mockTxTeamUpdate.mock.calls[0][0] as { where: { id: string }; data: Record<string, unknown> })
    expect(update.where.id).toBe(TEAM)
    expect(update.data).toEqual({ userId: null, isBot: true })
  })

  it("DOES NOT RENAME THE CLUB, or touch its crest or colours", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)

    const data = (mockTxTeamUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data
    for (const field of ["name", "crestShape", "crestColor", "crestSecondaryColor", "crestBorderColor", "crestImageUrl"]) {
      expect(data).not.toHaveProperty(field)
    }
  })

  it("takes the Team row lock BEFORE reading anything it decides on", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)

    // The lock is the first statement inside the transaction, and the
    // authoritative club read happens after it - not before.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
    expect(mockTxTeamFindUniqueOrThrow).toHaveBeenCalledTimes(1)
    expect(mockQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockTxTeamFindUniqueOrThrow.mock.invocationCallOrder[0]
    )
  })

  it("records the active season as an ANNOTATION on both eras", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)

    expect((mockEraUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data.endedSeasonId).toBe("season-1")
    expect((mockEraCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data.startedSeasonId).toBe("season-1")
  })

  it("leaves the season annotation NULL rather than inventing one", async () => {
    stubHealthyClub()
    mockSeasonFindFirst.mockResolvedValue(null)

    await leaveManagedTeam(USER, NOW)
    expect((mockEraCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data.startedSeasonId).toBeNull()
  })

  it("never queries a season for a club with no country", async () => {
    stubHealthyClub()
    mockTxTeamFindUniqueOrThrow.mockResolvedValue({ id: TEAM, userId: USER, isBot: false, countryCode: null })

    await leaveManagedTeam(USER, NOW)
    expect(mockSeasonFindFirst).not.toHaveBeenCalled()
    expect((mockEraCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data.startedSeasonId).toBeNull()
  })

  it("TOUCHES NOTHING ELSE - no player, lineup, stadium, finance or fixture write", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)

    // The transaction client exposes only what this path may use. Anything
    // else would have thrown on access, so reaching here proves the point;
    // these assert the writes that DID happen are exactly two.
    expect(mockTxTeamUpdate).toHaveBeenCalledTimes(1)
    expect(mockEraUpdate).toHaveBeenCalledTimes(1)
    expect(mockEraCreate).toHaveBeenCalledTimes(1)
    // Fixtures are READ for the live guard and never written.
    expect(mockFixtureFindMany).toHaveBeenCalledTimes(1)
  })
})

describe("leaveManagedTeam - fail closed", () => {
  it("a user with no club cannot leave, and no transaction is opened", async () => {
    mockTeamFindUnique.mockResolvedValue(null)

    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "NO_TEAM" })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("A LOST RACE fails closed: the club is no longer this user's", async () => {
    // Both requests read the club outside the lock; the winner nulled
    // Team.userId, so the loser sees that under the lock.
    stubHealthyClub({ teamUserId: null })

    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "NOT_MANAGER" })
    expect(mockEraUpdate).not.toHaveBeenCalled()
    expect(mockEraCreate).not.toHaveBeenCalled()
    expect(mockTxTeamUpdate).not.toHaveBeenCalled()
  })

  it("a club another manager now holds is refused", async () => {
    stubHealthyClub({ teamUserId: "user-2" })
    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "NOT_MANAGER" })
  })

  it("an already-unmanaged club is refused rather than double-closed", async () => {
    stubHealthyClub({ isBot: true })
    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "ALREADY_BOT" })
    expect(mockEraCreate).not.toHaveBeenCalled()
  })

  it("a club whose era history disagrees with its state is NOT repaired", async () => {
    stubHealthyClub()
    mockEraFindMany.mockResolvedValue([])

    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "ERA_MISMATCH" })
    expect(mockEraCreate).not.toHaveBeenCalled()
    expect(mockTxTeamUpdate).not.toHaveBeenCalled()
  })

  it("two open eras is a defect, not something to pick a winner from", async () => {
    stubHealthyClub()
    mockEraFindMany.mockResolvedValue([
      { id: "a", type: "HUMAN", userId: USER },
      { id: "b", type: "BOT", userId: null },
    ])
    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "ERA_MISMATCH" })
  })

  it("an open era belonging to a different user is refused", async () => {
    stubHealthyClub()
    mockEraFindMany.mockResolvedValue([{ id: "era-x", type: "HUMAN", userId: "user-2" }])
    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "ERA_MISMATCH" })
  })

  it("an open BOT era on a club marked human is refused", async () => {
    stubHealthyClub()
    mockEraFindMany.mockResolvedValue([{ id: "era-b", type: "BOT", userId: null }])
    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "ERA_MISMATCH" })
  })
})

describe("leaveManagedTeam - the live match guard", () => {
  const liveFixture = { scheduledAt: minutesAgo(3), playedAt: minutesAgo(3) }

  it("A LIVE MATCH BLOCKS LEAVING, with no partial write", async () => {
    stubHealthyClub()
    mockFixtureFindMany.mockResolvedValue([liveFixture])

    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "MATCH_LIVE" })
    expect(mockEraUpdate).not.toHaveBeenCalled()
    expect(mockEraCreate).not.toHaveBeenCalled()
    expect(mockTxTeamUpdate).not.toHaveBeenCalled()
  })

  it("a match that has NOT been simulated is still live and still blocks", async () => {
    // playedAt is not the definition - the clock is. A kicked-off match the
    // scheduler has not reached yet is inside its window all the same.
    stubHealthyClub()
    mockFixtureFindMany.mockResolvedValue([{ scheduledAt: minutesAgo(2), playedAt: null }])
    await expect(leaveManagedTeam(USER, NOW)).rejects.toMatchObject({ reason: "MATCH_LIVE" })
  })

  it("a FINISHED match does not block - the window has played out", async () => {
    stubHealthyClub()
    mockFixtureFindMany.mockResolvedValue([
      { scheduledAt: minutesAgo(MATCH_REAL_DURATION_MINUTES + 1), playedAt: minutesAgo(MATCH_REAL_DURATION_MINUTES + 1) },
    ])
    await expect(leaveManagedTeam(USER, NOW)).resolves.toMatchObject({ teamId: TEAM })
  })

  it("A FUTURE MATCH DOES NOT BLOCK LEAVING", async () => {
    stubHealthyClub()
    mockFixtureFindMany.mockResolvedValue([{ scheduledAt: new Date(NOW.getTime() + 86_400_000), playedAt: null }])
    await expect(leaveManagedTeam(USER, NOW)).resolves.toMatchObject({ teamId: TEAM })
  })

  it("the guard reads BOTH sides of the fixture, bounded to the live window", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)

    const where = (mockFixtureFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where.OR).toEqual([{ homeTeamId: TEAM }, { awayTeamId: TEAM }])
    expect(where.scheduledAt).toEqual({
      gt: new Date(NOW.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000),
      lte: NOW,
    })
  })

  it("the guard runs BEFORE any write", async () => {
    stubHealthyClub()
    await leaveManagedTeam(USER, NOW)
    expect(mockFixtureFindMany.mock.invocationCallOrder[0]).toBeLessThan(mockEraUpdate.mock.invocationCallOrder[0])
  })
})

describe("TeamLeaveError", () => {
  it("carries a stable reason an API route can map without parsing text", () => {
    const error = new TeamLeaveError("MATCH_LIVE", "anything")
    expect(error.reason).toBe("MATCH_LIVE")
    expect(error.name).toBe("TeamLeaveError")
    expect(error).toBeInstanceOf(Error)
  })
})
