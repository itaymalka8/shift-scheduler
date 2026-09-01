import type { Prisma } from "@/generated/prisma"
import { getTransferWindowDefinition } from "@/lib/transfers/window"
import { OUTFIELD_ATTRIBUTES } from "@/lib/players/attributes"

/**
 * Proves the lock-ordering contract documented in locks.ts holds for every
 * path that mutates player ownership or career state: the Player row lock is
 * the FIRST statement in the transaction, before any TransferListing,
 * LineupSlot, Team or financial access. Inconsistent ordering here is what
 * produced real Postgres 40P01 deadlocks between Retirement and
 * Release/Purchase.
 *
 * Each service is driven against a recording transaction client that logs
 * every operation in order; the assertions are about that order, not about
 * return values.
 */

const trace: string[] = []

function record<T>(name: string, value: T): Promise<T> {
  trace.push(name)
  return Promise.resolve(value)
}

const PLAYER_ID = "player-1"
const SELLER_ID = "team-seller"
const BUYER_ID = "team-buyer"
const LISTING_ID = "listing-1"
const WINDOW_ID = "window-1"

const windowDefinition = getTransferWindowDefinition(new Date())
const NOW = new Date(windowDefinition.opensAt.getTime() + 12 * 3600_000)
const CURRENT_WINDOW = getTransferWindowDefinition(NOW)

function makePlayer() {
  const attributes: Record<string, number> = {}
  for (const key of OUTFIELD_ATTRIBUTES) attributes[key] = 60
  return {
    id: PLAYER_ID,
    teamId: SELLER_ID,
    careerStatus: "ACTIVE" as const,
    stintNumber: 1,
    firstName: "Lock",
    lastName: "Order",
    age: 24,
    overall: 60,
    potential: 80,
    primaryPosition: "ST",
    fitness: 100,
    marketValue: 1_000_000,
    weeklySalary: 5_000,
    ...attributes,
  }
}

function makeListing() {
  return {
    id: LISTING_ID,
    playerId: PLAYER_ID,
    sellingTeamId: SELLER_ID,
    askingPrice: 1_000_000,
    status: "OPEN" as const,
    windowId: WINDOW_ID,
    expiresAt: CURRENT_WINDOW.closesAt,
    player: makePlayer(),
  }
}

const teamRoles = { balance: 100_000_000, captainId: null, penaltyTakerId: null, freeKickTakerId: null, cornerTakerId: null }

function makeTx(): Prisma.TransactionClient {
  const stub = {
    // The Player lock is a locking read; the Team roster lock is a write (it
    // has to produce a new row version - see lockTeamRoster). So they arrive
    // on different Prisma raw methods.
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join("?")
      const name = sql.includes('"Player"') ? "LOCK:Player" : "LOCK:other"
      trace.push(name)
      return Promise.resolve([{ id: PLAYER_ID }])
    },
    $executeRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join("?")
      trace.push(sql.includes('"Team"') ? "LOCK:Team" : "LOCK:other")
      return Promise.resolve(1)
    },
    player: {
      findUnique: () => record("player.findUnique", makePlayer()),
      update: () => record("player.update", makePlayer()),
      count: () => record("player.count", 0),
    },
    playerSeasonLifecycle: {
      findUnique: () => record("ledger.findUnique", null),
      create: () => record("ledger.create", {}),
    },
    transferListing: {
      findUnique: () => record("listing.findUnique", makeListing()),
      findFirst: () => record("listing.findFirst", null),
      updateMany: () => record("listing.updateMany", { count: 1 }),
      create: () => record("listing.create", { ...makeListing() }),
    },
    lineupSlot: { deleteMany: () => record("lineupSlot.deleteMany", { count: 0 }) },
    team: {
      findUnique: () => record("team.findUnique", teamRoles),
      findUniqueOrThrow: () => record("team.findUniqueOrThrow", teamRoles),
      update: () => record("team.update", teamRoles),
    },
    financialTransaction: {
      create: () => record("financial.create", { id: "ft-1" }),
      findUnique: () => record("financial.findUnique", null),
      update: () => record("financial.update", { id: "ft-1" }),
    },
  }
  return stub as unknown as Prisma.TransactionClient
}

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(makeTx()),
    transferListing: { findUnique: () => Promise.resolve({ playerId: "player-1" }) },
    transferWindow: { findUnique: () => Promise.resolve(null), create: () => Promise.resolve({ id: "window-1" }) },
  },
}))

jest.mock("@/lib/transfers/window", () => {
  const actual = jest.requireActual("@/lib/transfers/window")
  return {
    ...actual,
    // The stored-window bookkeeping is not what this test is about; the real
    // window maths above still decides the instant.
    ensureTransferWindowExists: jest.fn(async () => ({
      id: "window-1",
      weekKey: "qa",
      opensAt: new Date(),
      closesAt: new Date(Date.now() + 86400_000),
    })),
  }
})

// Imported after the mocks above are registered.
import { runPlayerSeasonLifecycle } from "@/lib/seasons/player-lifecycle"
import { releasePlayer } from "@/lib/transfers/release"
import { createTransferListing } from "@/lib/transfers/listing"
import { purchaseTransferListing } from "@/lib/transfers/purchase"

/** Every operation that must never precede the Player lock. */
const ORDERED_AFTER = ["listing.", "lineupSlot.", "team.", "financial.", "player.update", "LOCK:Team"]

function assertPlayerLockFirst() {
  expect(trace.length).toBeGreaterThan(1)
  expect(trace[0]).toBe("LOCK:Player")
  const lockIndex = trace.indexOf("LOCK:Player")
  for (const [i, op] of trace.entries()) {
    if (ORDERED_AFTER.some((prefix) => op.startsWith(prefix))) {
      expect(i).toBeGreaterThan(lockIndex)
    }
  }
}

async function settle(promise: Promise<unknown>) {
  try {
    await promise
  } catch {
    // A domain rejection is fine - the ordering up to that point is the
    // subject of this test, not the outcome.
  }
}

describe("player lock-ordering contract", () => {
  beforeEach(() => {
    trace.length = 0
  })

  it("Retirement lifecycle locks the Player row before anything else", async () => {
    await settle(runPlayerSeasonLifecycle(makeTx(), { seasonId: "s1", seasonNumber: 1, playerId: PLAYER_ID }))
    assertPlayerLockFirst()
    // And specifically: before the ledger read it gates on.
    expect(trace.indexOf("LOCK:Player")).toBeLessThan(trace.indexOf("ledger.findUnique"))
  })

  it("Release locks the Player row before the listing, lineup, team and ownership writes", async () => {
    await settle(releasePlayer({ teamId: SELLER_ID, playerId: PLAYER_ID }))
    assertPlayerLockFirst()
    expect(trace).toContain("listing.updateMany")
    expect(trace).toContain("player.update")
  })

  it("Create Listing locks the Player row before touching any listing row", async () => {
    await settle(createTransferListing({ teamId: SELLER_ID, playerId: PLAYER_ID, askingPrice: 1_000_000, now: NOW }))
    assertPlayerLockFirst()
    expect(trace).toContain("listing.create")
  })

  it("Purchase locks the Player row first, then both club rows, before any team or financial access", async () => {
    await settle(purchaseTransferListing({ buyingTeamId: BUYER_ID, listingId: LISTING_ID, now: NOW }))
    assertPlayerLockFirst()

    const teamLock = trace.indexOf("LOCK:Team")
    expect(teamLock).toBeGreaterThan(-1)
    // Both clubs are locked - one call each, in ascending id order.
    expect(trace.filter((op) => op === "LOCK:Team")).toHaveLength(2)
    // ...before any team read/write or ledger write.
    for (const op of ["team.findUnique", "team.findUniqueOrThrow", "team.update", "financial.create"]) {
      const at = trace.indexOf(op)
      if (at !== -1) expect(at).toBeGreaterThan(teamLock)
    }
  })
})
