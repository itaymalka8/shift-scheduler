/**
 * Unit coverage for the human-facing wrappers around the shared engines:
 * ownership/isBot/deadline branching in promoteYouthProspectAsManager
 * (promote.ts) and finalizeYouthIntake (intake.ts). The transactional
 * mechanics themselves (locking, the shared promotion core, roster caps)
 * are already covered by promote.test.ts and the real-Postgres DB QA - this
 * file is about the authorization and deadline gates in front of them.
 */
import { promoteYouthProspectAsManager } from "./promote"
import { finalizeYouthIntake } from "./intake"
import { YouthError } from "./errors"

const mockProspectFindUnique = jest.fn()
const mockTeamFindUnique = jest.fn()
const mockIntakeFindUnique = jest.fn()
const mockTransaction = jest.fn()

jest.mock("@/lib/prisma", () => ({
  prisma: {
    youthProspect: { findUnique: (...args: unknown[]) => mockProspectFindUnique(...args) },
    team: { findUnique: (...args: unknown[]) => mockTeamFindUnique(...args) },
    youthIntake: { findUnique: (...args: unknown[]) => mockIntakeFindUnique(...args) },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe("promoteYouthProspectAsManager - authorization and deadline gates", () => {
  it("rejects an unknown prospect without touching the transaction", async () => {
    mockProspectFindUnique.mockResolvedValue(null)
    await expect(promoteYouthProspectAsManager({ teamId: "team-1", prospectId: "missing" })).rejects.toMatchObject({
      code: "PROSPECT_NOT_FOUND",
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("rejects a prospect belonging to another team's intake", async () => {
    mockProspectFindUnique.mockResolvedValue({ id: "p1", youthIntakeId: "i1", youthIntake: { teamId: "other-team" } })
    await expect(promoteYouthProspectAsManager({ teamId: "team-1", prospectId: "p1" })).rejects.toMatchObject({
      code: "INTAKE_NOT_OWNED",
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("rejects when the calling team is a bot", async () => {
    mockProspectFindUnique.mockResolvedValue({ id: "p1", youthIntakeId: "i1", youthIntake: { teamId: "team-1" } })
    mockTeamFindUnique.mockResolvedValue({ isBot: true })
    await expect(promoteYouthProspectAsManager({ teamId: "team-1", prospectId: "p1" })).rejects.toMatchObject({
      code: "TEAM_IS_BOT",
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("rejects when the calling team no longer exists", async () => {
    mockProspectFindUnique.mockResolvedValue({ id: "p1", youthIntakeId: "i1", youthIntake: { teamId: "team-1" } })
    mockTeamFindUnique.mockResolvedValue(null)
    await expect(promoteYouthProspectAsManager({ teamId: "team-1", prospectId: "p1" })).rejects.toMatchObject({
      code: "TEAM_NOT_FOUND",
    })
  })

  it("raises INTAKE_EXPIRED, never calling the promotion core, once the deadline has passed", async () => {
    mockProspectFindUnique.mockResolvedValue({ id: "p1", youthIntakeId: "i1", youthIntake: { teamId: "team-1" } })
    mockTeamFindUnique.mockResolvedValue({ isBot: false })

    const now = new Date("2026-01-10T00:00:00Z")
    const pastIntake = { id: "i1", teamId: "team-1", status: "OPEN", closesAt: new Date("2026-01-01T00:00:00Z"), promotedCount: 0 }
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "i1" }]),
      youthIntake: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(pastIntake),
        update: jest.fn().mockResolvedValue({ ...pastIntake, status: "CLOSED", closedAt: now }),
      },
      youthProspect: { updateMany: jest.fn().mockResolvedValue({ count: 5 }) },
    }
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))

    await expect(promoteYouthProspectAsManager({ teamId: "team-1", prospectId: "p1", now })).rejects.toMatchObject({
      code: "INTAKE_EXPIRED",
    })
    // The deadline settlement actually closed it - a promotion attempt that
    // just misses the deadline still leaves the intake correctly CLOSED.
    expect(tx.youthIntake.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "CLOSED", closedAt: now },
    })
    expect(tx.youthProspect.updateMany).toHaveBeenCalledWith({
      where: { youthIntakeId: "i1", status: "PENDING" },
      data: { status: "EXPIRED" },
    })
  })
})

describe("promoteYouthProspectAsManager - deadline settlement must survive rejection", () => {
  it("commits the settlement's close+expire even though the call itself throws INTAKE_EXPIRED", async () => {
    // Regression test for a real bug: Prisma's interactive $transaction
    // rolls back every write the callback made the instant it throws. The
    // very first version of this function ran settleIntakeDeadline and then
    // threw INTAKE_EXPIRED inside the SAME transaction - which discarded
    // the settlement's own CLOSED/EXPIRED writes along with the rejection,
    // leaving the intake incorrectly OPEN in the database. The fix returns
    // a sentinel from the transaction and throws only after it commits.
    mockProspectFindUnique.mockResolvedValue({ id: "p1", youthIntakeId: "i1", youthIntake: { teamId: "team-1" } })
    mockTeamFindUnique.mockResolvedValue({ isBot: false })

    const now = new Date("2026-01-10T00:00:00Z")
    const pastIntake = { id: "i1", teamId: "team-1", status: "OPEN", closesAt: new Date("2026-01-01T00:00:00Z"), promotedCount: 0 }
    let committedStatus: string | null = null
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "i1" }]),
      youthIntake: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(pastIntake),
        update: jest.fn().mockImplementation(({ data }: { data: { status: string } }) => {
          committedStatus = data.status
          return Promise.resolve({ ...pastIntake, ...data })
        }),
      },
      youthProspect: { updateMany: jest.fn().mockResolvedValue({ count: 5 }) },
    }
    // Simulates Prisma's real commit-on-resolve, rollback-on-throw
    // semantics: the writes above only "count" here if the callback
    // resolves rather than throws.
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      try {
        return await fn(tx)
      } catch (error) {
        committedStatus = null // the transaction rolled back - undo any write it made
        throw error
      }
    })

    await expect(promoteYouthProspectAsManager({ teamId: "team-1", prospectId: "p1", now })).rejects.toMatchObject({
      code: "INTAKE_EXPIRED",
    })

    // The whole point: even though the call rejected, the settlement's own
    // write must have actually committed.
    expect(committedStatus).toBe("CLOSED")
  })
})

describe("finalizeYouthIntake - authorization and idempotency", () => {
  it("rejects an unknown intake", async () => {
    mockIntakeFindUnique.mockResolvedValue(null)
    await expect(finalizeYouthIntake({ teamId: "team-1", intakeId: "missing" })).rejects.toMatchObject({
      code: "INTAKE_NOT_FOUND",
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("rejects an intake owned by another team", async () => {
    mockIntakeFindUnique.mockResolvedValue({ teamId: "other-team" })
    await expect(finalizeYouthIntake({ teamId: "team-1", intakeId: "i1" })).rejects.toMatchObject({
      code: "INTAKE_NOT_OWNED",
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("rejects when the calling team is a bot", async () => {
    mockIntakeFindUnique.mockResolvedValue({ teamId: "team-1" })
    mockTeamFindUnique.mockResolvedValue({ isBot: true })
    await expect(finalizeYouthIntake({ teamId: "team-1", intakeId: "i1" })).rejects.toMatchObject({ code: "TEAM_IS_BOT" })
  })

  it("is idempotent when the intake is already CLOSED, without touching any prospect", async () => {
    mockIntakeFindUnique.mockResolvedValue({ teamId: "team-1" })
    mockTeamFindUnique.mockResolvedValue({ isBot: false })
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "i1" }]),
      youthIntake: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "i1", teamId: "team-1", status: "CLOSED", promotedCount: 2 }),
        update: jest.fn(),
      },
      youthProspect: { updateMany: jest.fn() },
    }
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))

    const result = await finalizeYouthIntake({ teamId: "team-1", intakeId: "i1" })

    expect(result).toEqual({ intakeId: "i1", status: "CLOSED", promotedCount: 2, alreadyClosed: true })
    expect(tx.youthIntake.update).not.toHaveBeenCalled()
    expect(tx.youthProspect.updateMany).not.toHaveBeenCalled()
  })

  it("closes an OPEN intake immediately, expiring PENDING, even before its deadline", async () => {
    mockIntakeFindUnique.mockResolvedValue({ teamId: "team-1" })
    mockTeamFindUnique.mockResolvedValue({ isBot: false })
    const now = new Date("2026-01-05T00:00:00Z")
    const openIntake = { id: "i1", teamId: "team-1", status: "OPEN", closesAt: new Date("2026-02-01T00:00:00Z"), promotedCount: 1 }
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "i1" }]),
      youthIntake: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(openIntake),
        update: jest.fn().mockResolvedValue({ ...openIntake, status: "CLOSED", closedAt: now }),
      },
      youthProspect: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) },
    }
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx))

    const result = await finalizeYouthIntake({ teamId: "team-1", intakeId: "i1", now })

    expect(result.alreadyClosed).toBe(false)
    expect(result.status).toBe("CLOSED")
    expect(tx.youthProspect.updateMany).toHaveBeenCalledWith({
      where: { youthIntakeId: "i1", status: "PENDING" },
      data: { status: "EXPIRED" },
    })
    expect(tx.youthIntake.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { status: "CLOSED", closedAt: now } })
  })
})

it("YouthError carries a stable code for every branch exercised above", () => {
  const error = new YouthError("INTAKE_EXPIRED")
  expect(error.code).toBe("INTAKE_EXPIRED")
})
