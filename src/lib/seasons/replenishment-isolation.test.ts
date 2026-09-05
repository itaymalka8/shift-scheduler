/**
 * Guards on what squad replenishment must NOT do.
 *
 * Source-level, because every one of these is a property about something
 * ABSENT, and every violation still produces a system that appears to work.
 * A replenishment that signs the best free agent still fills the squad - it
 * just hands a club a millions-worth footballer decided by iteration order.
 * One that fills to 22 still satisfies the floor - it just makes the academy
 * pointless. None of that is visible without a test that looks.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/** The file WITHOUT its imports - ordering assertions are about calls, not import lines. */
function readBody(...parts: string[]): string {
  const source = readCode(...parts)
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+"[^"]+"$/gm)]
  if (imports.length === 0) return source
  const last = imports[imports.length - 1]
  return source.slice((last.index ?? 0) + last[0].length)
}

const SERVICE = ["lib", "seasons", "squad-replenishment.ts"]
const FLOOR = ["lib", "players", "roster-floor.ts"]
const FALLBACK = ["lib", "players", "fallback-generator.ts"]
const GUARD = ["lib", "transfers", "roster-guard.ts"]
const RELEASE = ["lib", "transfers", "release.ts"]
const PURCHASE = ["lib", "transfers", "purchase.ts"]
const LISTING = ["lib", "transfers", "listing.ts"]
const ORCHESTRATOR = ["lib", "seasons", "orchestrator.ts"]
const LIFECYCLE = ["lib", "seasons", "player-lifecycle.ts"]

const at = (source: string, needle: string) => {
  const index = source.indexOf(needle)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

describe("FREE AGENTS ARE NEVER AUTOMATICALLY SIGNED", () => {
  it("the replenishment service never queries for a clubless player", () => {
    const source = readCode(...SERVICE)
    // `teamId: null` as an acquisition pool is the exact shape forbidden:
    // it would allocate a scarce, valuable, pre-existing asset by whichever
    // club a worker happened to reach first.
    expect(source).not.toMatch(/teamId:\s*null/)
    expect(source).not.toMatch(/freeAgent/i)
  })

  it("it only ever INSERTs players - it never takes ownership of an existing one", () => {
    const source = readCode(...SERVICE)
    expect(source).toContain("tx.player.create")
    expect(source).not.toMatch(/\btx\.player\.update(Many)?\b/)
    expect(source).not.toMatch(/data:\s*\{[^}]*\bteamId\b[^}]*\}\s*,?\s*where/)
  })

  it("and therefore never locks a pre-existing Player row", () => {
    const source = readCode(...SERVICE)
    expect(source).not.toContain("lockPlayerRow")
    expect(source).not.toContain('FROM "Player"')
  })

  it("a RETIRED player can never be picked up", () => {
    const source = readCode(...SERVICE)
    // The only careerStatus this module writes or reads is ACTIVE.
    expect(source).not.toContain("RETIRED")
    expect(source).toContain('careerStatus: "ACTIVE"')
  })
})

describe("THE FLOOR IS A MINIMUM, NOT A TARGET", () => {
  it("required additions is MAX, never SUM", () => {
    const source = readCode(...FLOOR)
    expect(source).toContain("return Math.max(positionalAdditions(counts), countAdditions(counts))")
    expect(source).not.toMatch(/positionalAdditions\(counts\)\s*\+\s*countAdditions\(counts\)/)
  })

  it("the service generates exactly the planned additions and nothing else", () => {
    const source = readBody(...SERVICE)
    expect(source).toContain("const plan = planAdditions(before)")
    expect(source).toContain("for (let slotIndex = 0; slotIndex < plan.length; slotIndex++)")
    // No filling toward the cap, and no "top up to 16" arithmetic.
    expect(source).not.toMatch(/MAX_ACTIVE_ROSTER_SIZE\s*-\s*/)
    expect(source).not.toMatch(/MIN_ACTIVE_ROSTER\s*-\s*/)
  })

  it("depth never adds a goalkeeper", () => {
    const source = readCode(...FLOOR)
    expect(source).toContain('export const DEPTH_CYCLE: readonly PositionGroup[] = ["DF", "MF", "DF", "MF", "FW"]')
  })

  it("the cap is imported, never restated as 22", () => {
    for (const path of [FLOOR, SERVICE]) {
      const source = readCode(...path)
      expect(source).toContain("MAX_ACTIVE_ROSTER_SIZE")
      expect(source).not.toMatch(/(?<![\w.])22(?![\w.])/)
    }
  })

  it("temporary availability is never an input to the floor", () => {
    for (const path of [FLOOR, SERVICE, GUARD]) {
      const source = readCode(...path)
      expect(source).not.toContain("injuryMatchesRemaining: { ")
      expect(source).not.toMatch(/where:\s*\{[^}]*suspensionMatches/)
      expect(source).not.toMatch(/where:\s*\{[^}]*fitness/)
    }
  })
})

describe("EXACTLY ONCE: the ledger is the authority", () => {
  it("the ledger is checked under the team lock, before any generation", () => {
    const source = readBody(...SERVICE)
    const lock = at(source, "lockTeamRoster(tx, teamId)")
    const check = at(source, "tx.squadReplenishment.findUnique")
    const create = at(source, "tx.player.create")
    expect(lock).toBeLessThan(check)
    expect(check).toBeLessThan(create)
  })

  it("the ledger row is written LAST, in the same transaction as the players", () => {
    const source = readBody(...SERVICE)
    const write = at(source, "tx.squadReplenishment.create")
    expect(write).toBeGreaterThan(at(source, "tx.player.create"))
    expect(write).toBeGreaterThan(at(source, "repairTeamLineup(tx, teamId)"))
    expect(write).toBeGreaterThan(at(source, "checkTeamLineup(tx, teamId)"))
  })

  it("deterministic seeds are a reproducibility aid, never the idempotency mechanism", () => {
    const source = readCode(...SERVICE)
    // Player ids stay database-generated; nothing here sets one.
    expect(source).not.toMatch(/id:\s*`/)
    expect(source).not.toContain("skipDuplicates")
  })

  it("one club is one transaction - never split", () => {
    const source = readBody(...SERVICE)
    expect(source.match(/prisma\.\$transaction/g)?.length).toBeGreaterThanOrEqual(1)
    const fn = source.slice(at(source, "export async function replenishTeamSquad"), at(source, "export interface SeasonReplenishmentSummary"))
    expect(fn.match(/prisma\.\$transaction/g)).toHaveLength(1)
  })
})

describe("FAIL CLOSED on an impossible roster shape", () => {
  it("the cap is checked before anything is created", () => {
    const source = readBody(...SERVICE)
    expect(at(source, "isResolvableWithinCap(before)")).toBeLessThan(at(source, "tx.player.create"))
    expect(source).toContain("throw new RosterUnresolvableError")
  })

  it("it never releases an existing player to make room", () => {
    const source = readCode(...SERVICE)
    expect(source).not.toContain("removePlayerFromSquad")
    expect(source).not.toMatch(/\bdelete(Many)?\b/)
  })

  it("the post-generation state is re-read and asserted, not assumed", () => {
    const source = readBody(...SERVICE)
    const reread = at(source, "const after = await readActiveRoster(tx, teamId)")
    expect(reread).toBeGreaterThan(at(source, "tx.player.create"))
    expect(reread).toBeLessThan(at(source, "tx.squadReplenishment.create"))
    expect(source).toContain("failedConstraints(after)")
  })
})

describe("VOLUNTARY DEPARTURES: one validator, two call sites", () => {
  it("release checks the floor before it mutates anything", () => {
    const source = readBody(...RELEASE)
    const guard = at(source, "assertDepartureKeepsRosterLegal(tx, input.teamId, player)")
    expect(guard).toBeLessThan(at(source, "tx.transferListing.updateMany"))
    expect(guard).toBeLessThan(at(source, "removePlayerFromSquad"))
    expect(guard).toBeLessThan(at(source, "tx.player.update"))
    expect(guard).toBeLessThan(at(source, "createFinancialTransaction"))
  })

  it("purchase checks the SELLER's floor at execution time, under its locks", () => {
    const source = readBody(...PURCHASE)
    const guard = at(source, "assertDepartureKeepsRosterLegal(tx, listing.sellingTeamId, player)")
    expect(guard).toBeGreaterThan(at(source, "lockTeamRosters(tx,"))
    expect(guard).toBeLessThan(at(source, "removePlayerFromSquad"))
    expect(guard).toBeLessThan(at(source, "tx.player.update"))
  })

  it("there is exactly ONE validator, not a release copy and a transfer copy", () => {
    const guard = readCode(...GUARD)
    expect(guard).toContain("countsAfterDeparture")
    expect(guard).toContain("failedConstraints")
    for (const path of [RELEASE, PURCHASE]) {
      const source = readCode(...path)
      expect(source).toContain("assertDepartureKeepsRosterLegal")
      // Neither path re-implements the arithmetic.
      expect(source).not.toContain("countsAfterDeparture")
      expect(source).not.toContain("failedConstraints")
      expect(source).not.toContain("MIN_ACTIVE_ROSTER")
    }
  })

  it("LISTING is not blocked - it moves nobody", () => {
    const source = readCode(...LISTING)
    expect(source).not.toContain("assertDepartureKeepsRosterLegal")
    expect(source).not.toContain("SQUAD_FLOOR_REACHED")
  })

  it("RETIREMENT is not guarded - it is involuntary, and the offseason repairs it", () => {
    const source = readCode(...LIFECYCLE)
    expect(source).not.toContain("assertDepartureKeepsRosterLegal")
    expect(source).not.toContain("SQUAD_FLOOR_REACHED")
  })
})

describe("OFFSEASON PLACEMENT", () => {
  it("replenishment sits between WAITING_HUMANS and CREATE_NEXT", () => {
    const source = readBody(...ORCHESTRATOR)
    expect(source).toContain('{ status: "OFFSEASON", stage: "WAITING_HUMANS" }, { stage: "SQUAD_REPLENISHMENT" }')
    expect(source).toContain('{ status: "OFFSEASON", stage: "SQUAD_REPLENISHMENT" }')
    expect(at(source, 'season.offseasonStage === "SQUAD_REPLENISHMENT"')).toBeLessThan(
      at(source, 'season.offseasonStage === "CREATE_NEXT"')
    )
  })

  it("the stage never advances on the ledger alone - the roster is re-derived", () => {
    const source = readBody(...ORCHESTRATOR)
    const verify = at(source, "verifySeasonRosterInvariant(seasonId)")
    expect(verify).toBeLessThan(at(source, '{ stage: "CREATE_NEXT" }'))
  })

  it("no prospect is promoted on a manager's behalf by this stage", () => {
    const source = readCode(...SERVICE)
    expect(source).not.toContain("promoteYouthProspect")
    expect(source).not.toContain("youthIntake")
  })
})

describe("NO PLAYER ORIGIN CLASS", () => {
  it("nothing marks a generated player as different, anywhere", () => {
    const schema = readFileSync(join(SRC, "..", "prisma", "schema.prisma"), "utf8")
    for (const forbidden of ["origin", "isEmergency", "isFallback", "acquisitionType", "transferBan"]) {
      expect(schema).not.toContain(`  ${forbidden} `)
    }
    const source = readCode(...FALLBACK)
    expect(source).not.toMatch(/isEmergency|isFallback|acquisitionType/)
  })
})
