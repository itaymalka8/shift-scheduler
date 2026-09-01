import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { ensureStadiumForTeam } from "./actions"

jest.mock("@/lib/prisma", () => ({
  prisma: { stadium: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn() } },
}))

const stadium = (prisma as unknown as {
  stadium: {
    findUnique: jest.Mock
    findUniqueOrThrow: jest.Mock
    create: jest.Mock
  }
}).stadium

const TEAM_ID = "team-1"
const EXISTING = { id: "stadium-1", teamId: TEAM_ID, name: "Existing Park" }

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`teamId`)", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["teamId"] },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("ensureStadiumForTeam", () => {
  it("returns the existing stadium without creating a second one", async () => {
    stadium.findUnique.mockResolvedValue(EXISTING)

    await expect(ensureStadiumForTeam(TEAM_ID)).resolves.toBe(EXISTING)
    expect(stadium.create).not.toHaveBeenCalled()
  })

  it("creates one when the club has none yet", async () => {
    stadium.findUnique.mockResolvedValue(null)
    stadium.create.mockResolvedValue(EXISTING)

    await expect(ensureStadiumForTeam(TEAM_ID, "New Park")).resolves.toBe(EXISTING)
    expect(stadium.create).toHaveBeenCalledTimes(1)
    expect(stadium.create.mock.calls[0][0].data).toMatchObject({ teamId: TEAM_ID, name: "New Park" })
  })

  // The race this function used to lose: two scheduled runs (or two page
  // loads) both find no stadium, both insert, and Stadium.teamId is unique.
  // The loser must adopt the winner's row, not surface a raw P2002 - which
  // is what took down two of three concurrent scheduled runs before the fix.
  it("adopts the row the winner created when it loses the insert race", async () => {
    stadium.findUnique.mockResolvedValue(null)
    stadium.create.mockRejectedValue(p2002())
    stadium.findUniqueOrThrow.mockResolvedValue(EXISTING)

    await expect(ensureStadiumForTeam(TEAM_ID)).resolves.toBe(EXISTING)
    expect(stadium.findUniqueOrThrow).toHaveBeenCalledWith({ where: { teamId: TEAM_ID } })
  })

  it("still surfaces any other database error", async () => {
    stadium.findUnique.mockResolvedValue(null)
    const boom = new Error("connection reset")
    stadium.create.mockRejectedValue(boom)

    await expect(ensureStadiumForTeam(TEAM_ID)).rejects.toBe(boom)
    expect(stadium.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
