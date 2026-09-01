import type { Prisma } from "@/generated/prisma"
import { OUTFIELD_ATTRIBUTES, type AttributeKey } from "@/lib/players/attributes"
import { calculatePlayerOverall } from "@/lib/players/overall"
import { calculatePlayerMarketValue } from "@/lib/players/market-value"
import { calculatePlayerSalary } from "@/lib/economy/salary"
import { runPlayerSeasonLifecycle } from "./player-lifecycle"
import { SeasonLifecycleError } from "./errors"

// The service module imports the shared PrismaClient at load time for its
// own transaction wrapper and batch runner; these tests drive
// runPlayerSeasonLifecycle against a stub transaction client instead, so no
// real client is ever needed.
jest.mock("@/lib/prisma", () => ({ prisma: {} }))

const SEASON_ID = "season-1"
const SEASON_NUMBER = 1

type FakePlayer = Record<string, unknown> & {
  id: string
  teamId: string | null
  careerStatus: "ACTIVE" | "RETIRED"
  age: number
  overall: number
  potential: number
  primaryPosition: string
  fitness: number
}

function makePlayer(overrides: Partial<FakePlayer> = {}): FakePlayer {
  const attributes: Record<string, number> = {}
  for (const key of OUTFIELD_ATTRIBUTES) attributes[key] = 60

  const base: FakePlayer = {
    id: "player-1",
    teamId: "team-1",
    careerStatus: "ACTIVE",
    stintNumber: 1,
    firstName: "Test",
    lastName: "Player",
    age: 24,
    overall: 60,
    potential: 85,
    primaryPosition: "ST",
    secondaryPositions: [],
    fitness: 100,
    status: "available",
    marketValue: 1_000_000,
    weeklySalary: 5_000,
    preferredFoot: "right",
    nationality: "IL",
    shirtNumber: 9,
    ...attributes,
  }
  return { ...base, ...overrides }
}

interface TeamRoles {
  captainId: string | null
  penaltyTakerId: string | null
  freeKickTakerId: string | null
  cornerTakerId: string | null
}

function makeTx(
  player: FakePlayer,
  options: { ledger?: Map<string, true>; team?: Partial<TeamRoles> } = {}
) {
  const ledger = options.ledger ?? new Map<string, true>()
  const team: TeamRoles = {
    captainId: null,
    penaltyTakerId: null,
    freeKickTakerId: null,
    cornerTakerId: null,
    ...options.team,
  }

  const stub = {
    $queryRaw: jest.fn(async () => [{ id: player.id }]),
    playerSeasonLifecycle: {
      findUnique: jest.fn(async ({ where }: { where: { seasonId_playerId: { seasonId: string; playerId: string } } }) => {
        const key = `${where.seasonId_playerId.seasonId}:${where.seasonId_playerId.playerId}`
        return ledger.has(key) ? { id: "ledger-1", seasonId: SEASON_ID, playerId: player.id } : null
      }),
      create: jest.fn(async ({ data }: { data: { seasonId: string; playerId: string } }) => {
        ledger.set(`${data.seasonId}:${data.playerId}`, true)
        return { id: "ledger-1", ...data }
      }),
    },
    player: {
      findUnique: jest.fn(async () => (player.id === "missing" ? null : player)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(player, data)
        return player
      }),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    team: {
      findUniqueOrThrow: jest.fn(async () => team),
      update: jest.fn(async () => team),
    },
    transferListing: { updateMany: jest.fn(async () => ({ count: 1 })) },
    lineupSlot: { deleteMany: jest.fn(async () => ({ count: 1 })) },
    playerMatchStats: { deleteMany: jest.fn(), delete: jest.fn(), updateMany: jest.fn() },
    financialTransaction: { create: jest.fn(), findUnique: jest.fn() },
  }

  return { tx: stub as unknown as Prisma.TransactionClient, stub, ledger, player, team }
}

function run(tx: Prisma.TransactionClient, playerId = "player-1") {
  return runPlayerSeasonLifecycle(tx, { seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER, playerId })
}

describe("runPlayerSeasonLifecycle - development and aging", () => {
  // B. A 26-year-old gains no Overall, but still ages.
  it("ages a 26-year-old without developing them", async () => {
    const player = makePlayer({ age: 26, overall: 60 })
    const { tx, stub } = makeTx(player)

    const result = await run(tx)

    expect(result.developed).toBe(false)
    expect(result.oldAge).toBe(26)
    expect(result.newAge).toBe(27)
    expect(result.newOverall).toBe(60)
    expect(stub.player.update).toHaveBeenCalledTimes(1)
    expect(player.age).toBe(27)
  })

  it("develops and ages a young player in one step", async () => {
    const player = makePlayer({ age: 17, overall: 60, potential: 90 })
    const { tx } = makeTx(player)

    const result = await run(tx)

    expect(result.developed).toBe(true)
    expect(result.newOverall).toBeGreaterThan(60)
    expect(result.newAge).toBe(18)
    expect(result.retired).toBe(false)
  })

  // C, at the service boundary: what gets written to Player.overall is
  // exactly what the written attributes grade out at.
  it("writes an overall that is derived from the attributes it writes", async () => {
    const player = makePlayer({ age: 17, overall: 60, potential: 90 })
    const { tx } = makeTx(player)

    await run(tx)

    expect(calculatePlayerOverall(player as unknown as { primaryPosition: string } & Record<AttributeKey, number>)).toBe(
      player.overall
    )
  })

  // Requirement 10: value and salary are re-rated on the NEW overall and the
  // NEW age, not the pre-aging ones.
  it("recomputes market value and salary from the post-development, post-aging state", async () => {
    const player = makePlayer({ age: 17, overall: 60, potential: 90 })
    const { tx, stub } = makeTx(player)

    const result = await run(tx)
    const written = stub.player.update.mock.calls[0][0].data as Record<string, number>

    const expectedRating = {
      overall: result.newOverall,
      age: result.newAge,
      potential: 90,
      primaryPosition: "ST",
    }
    expect(written.marketValue).toBe(calculatePlayerMarketValue({ ...expectedRating, fitness: 100 }))
    expect(written.weeklySalary).toBe(calculatePlayerSalary(expectedRating))
  })

  // D/E at the service boundary.
  it("produces the same result twice for the same player and season, and a different one for another season", async () => {
    const first = await run(makeTx(makePlayer({ age: 17, overall: 60, potential: 95 })).tx)
    const second = await run(makeTx(makePlayer({ age: 17, overall: 60, potential: 95 })).tx)
    expect(second.newOverall).toBe(first.newOverall)

    const overalls = new Set<number>()
    for (let season = 1; season <= 10; season++) {
      const player = makePlayer({ age: 17, overall: 60, potential: 95 })
      const { tx } = makeTx(player)
      const result = await runPlayerSeasonLifecycle(tx, { seasonId: SEASON_ID, seasonNumber: season, playerId: player.id })
      overalls.add(result.newOverall)
    }
    expect(overalls.size).toBeGreaterThan(1)
  })

  it("raises a domain error, never a raw Prisma error, for an unknown player", async () => {
    const { tx } = makeTx(makePlayer({ id: "missing" }))
    await expect(run(tx, "missing")).rejects.toBeInstanceOf(SeasonLifecycleError)
  })
})

describe("runPlayerSeasonLifecycle - retirement", () => {
  // F + the full retirement transaction.
  it("retires a 39-year-old (who turns 40) and frees them from their team", async () => {
    const player = makePlayer({ age: 39, overall: 70, potential: 70 })
    const { tx } = makeTx(player, { team: { captainId: "player-1" } })

    const result = await run(tx)

    expect(result.retired).toBe(true)
    expect(result.newAge).toBe(40)
    expect(result.oldTeamId).toBe("team-1")
    expect(result.newTeamId).toBeNull()
    expect(player.careerStatus).toBe("RETIRED")
    expect(player.teamId).toBeNull()
  })

  // L. No OPEN listing may survive a retirement.
  it("cancels every OPEN transfer listing for the retiring player", async () => {
    const player = makePlayer({ age: 39, overall: 70, potential: 70 })
    const { tx, stub } = makeTx(player)

    await run(tx)

    expect(stub.transferListing.updateMany).toHaveBeenCalledWith({
      where: { playerId: "player-1", status: "OPEN" },
      data: { status: "CANCELLED" },
    })
  })

  // M. Squad roles and the lineup slot are cleared through the shared helper.
  it("clears the lineup slot and only the retiring player's own team roles", async () => {
    const player = makePlayer({ age: 39, overall: 70, potential: 70 })
    const { tx, stub } = makeTx(player, { team: { captainId: "player-1", penaltyTakerId: "someone-else" } })

    await run(tx)

    expect(stub.lineupSlot.deleteMany).toHaveBeenCalledWith({ where: { playerId: "player-1" } })
    expect(stub.team.update).toHaveBeenCalledWith({ where: { id: "team-1" }, data: { captainId: null } })
  })

  // K + "never DELETE a Player".
  it("never deletes the player row and never touches their match stats", async () => {
    const player = makePlayer({ age: 39, overall: 70, potential: 70 })
    const { tx, stub } = makeTx(player)

    await run(tx)

    expect(stub.player.delete).not.toHaveBeenCalled()
    expect(stub.player.deleteMany).not.toHaveBeenCalled()
    expect(stub.playerMatchStats.deleteMany).not.toHaveBeenCalled()
    expect(stub.playerMatchStats.delete).not.toHaveBeenCalled()
    expect(stub.playerMatchStats.updateMany).not.toHaveBeenCalled()
  })

  // N. Retiring is not a transfer - it costs nothing.
  it("creates no financial transaction", async () => {
    const player = makePlayer({ age: 39, overall: 70, potential: 70 })
    const { tx, stub } = makeTx(player)

    await run(tx)

    expect(stub.financialTransaction.create).not.toHaveBeenCalled()
  })

  it("leaves market value and salary untouched for a retiring player", async () => {
    const player = makePlayer({ age: 39, overall: 70, potential: 70 })
    const { tx, stub } = makeTx(player)

    await run(tx)
    const written = stub.player.update.mock.calls[0][0].data as Record<string, unknown>

    expect(written).not.toHaveProperty("marketValue")
    expect(written).not.toHaveProperty("weeklySalary")
    expect(player.marketValue).toBe(1_000_000)
    expect(player.weeklySalary).toBe(5_000)
  })

  // H. A free agent still ages and can still retire - with no team cleanup.
  it("ages and retires an ACTIVE free agent without any team cleanup", async () => {
    const player = makePlayer({ age: 39, teamId: null, overall: 70, potential: 70 })
    const { tx, stub } = makeTx(player)

    const result = await run(tx)

    expect(result.retired).toBe(true)
    expect(result.newAge).toBe(40)
    expect(result.oldTeamId).toBeNull()
    expect(result.newTeamId).toBeNull()
    expect(player.careerStatus).toBe("RETIRED")
    expect(stub.team.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(stub.transferListing.updateMany).not.toHaveBeenCalled()
    expect(stub.lineupSlot.deleteMany).not.toHaveBeenCalled()
  })

  it("ages an ACTIVE free agent who is too young to retire", async () => {
    const player = makePlayer({ age: 24, teamId: null })
    const { tx } = makeTx(player)

    const result = await run(tx)

    expect(result.retired).toBe(false)
    expect(result.newAge).toBe(25)
    expect(player.careerStatus).toBe("ACTIVE")
  })
})

describe("runPlayerSeasonLifecycle - idempotency and concurrency", () => {
  // G. An already-RETIRED player is not processed, and gets no ledger row.
  it("skips a RETIRED player entirely, writing nothing at all", async () => {
    const player = makePlayer({ careerStatus: "RETIRED", teamId: null, age: 41 })
    const { tx, stub } = makeTx(player)

    const result = await run(tx)

    expect(result.skippedNotActive).toBe(true)
    expect(result.alreadyProcessed).toBe(false)
    expect(result.newAge).toBe(41)
    expect(stub.player.update).not.toHaveBeenCalled()
    expect(stub.playerSeasonLifecycle.create).not.toHaveBeenCalled()
  })

  // I. The ledger row is what makes a re-run safe.
  it("does nothing on a second call once a ledger row exists", async () => {
    const player = makePlayer({ age: 17, potential: 90 })
    const ledger = new Map<string, true>()
    const first = makeTx(player, { ledger })

    const firstResult = await run(first.tx)
    expect(firstResult.alreadyProcessed).toBe(false)
    const ageAfterFirst = player.age

    const second = makeTx(player, { ledger })
    const secondResult = await run(second.tx)

    expect(secondResult.alreadyProcessed).toBe(true)
    expect(second.stub.player.update).not.toHaveBeenCalled()
    expect(second.stub.playerSeasonLifecycle.create).not.toHaveBeenCalled()
    expect(player.age).toBe(ageAfterFirst)
  })

  it("checks the ledger only after taking the row lock", async () => {
    const player = makePlayer()
    const { tx, stub } = makeTx(player)

    await run(tx)

    const lockOrder = stub.$queryRaw.mock.invocationCallOrder[0]
    const ledgerOrder = stub.playerSeasonLifecycle.findUnique.mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(ledgerOrder)
  })

  // J. Two concurrent calls for the same player process it exactly once.
  it("processes a player exactly once under two concurrent calls", async () => {
    const player = makePlayer({ age: 24 })
    const ledger = new Map<string, true>()

    // The real row lock serializes the two transactions; this mirrors that,
    // so what the test actually exercises is the lock-then-recheck-ledger
    // ordering inside the service.
    let gate: Promise<unknown> = Promise.resolve()
    const serialized = <T,>(fn: () => Promise<T>): Promise<T> => {
      const result = gate.then(fn)
      gate = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }

    const a = makeTx(player, { ledger })
    const b = makeTx(player, { ledger })

    const [first, second] = await Promise.all([serialized(() => run(a.tx)), serialized(() => run(b.tx))])

    const processed = [first, second].filter((r) => !r.alreadyProcessed)
    const skipped = [first, second].filter((r) => r.alreadyProcessed)
    expect(processed).toHaveLength(1)
    expect(skipped).toHaveLength(1)

    // Aged exactly once, not twice.
    expect(player.age).toBe(25)
    const creates = a.stub.playerSeasonLifecycle.create.mock.calls.length + b.stub.playerSeasonLifecycle.create.mock.calls.length
    expect(creates).toBe(1)
    const updates = a.stub.player.update.mock.calls.length + b.stub.player.update.mock.calls.length
    expect(updates).toBe(1)
  })

  it("writes the ledger row last, after the player mutation", async () => {
    const player = makePlayer({ age: 17, potential: 90 })
    const { tx, stub } = makeTx(player)

    await run(tx)

    expect(stub.player.update.mock.invocationCallOrder[0]).toBeLessThan(
      stub.playerSeasonLifecycle.create.mock.invocationCallOrder[0]
    )
  })
})
