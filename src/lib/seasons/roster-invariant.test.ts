import { readFileSync } from "node:fs"
import { join } from "node:path"
import { judgeTeamRoster, type TeamRosterReading } from "./roster-invariant"
import { MAX_ACTIVE_ROSTER_SIZE } from "@/lib/players/roster"

/**
 * The verdict the orchestrator's pre-CREATE_NEXT gate and the production
 * next-season verifier both use. If these two ever disagreed about what
 * "ready" means, a season could roll past a gate that a human report calls
 * broken - so there is one function, and it is tested here.
 */

const READY: TeamRosterReading = {
  teamId: "t-1",
  replenished: true,
  counts: { total: 18, GK: 2, DF: 6, MF: 6, FW: 4 },
  lineup: { legal: true, starters: 11, slotCount: 11, problems: [] },
}

describe("judgeTeamRoster", () => {
  it("passes a replenished club with a legal squad and a legal eleven", () => {
    expect(judgeTeamRoster(READY)).toBeNull()
  })

  it("fails a club with no ledger row, whatever else is true of it", () => {
    const failure = judgeTeamRoster({ ...READY, replenished: false })
    expect(failure).toEqual({ teamId: "t-1", reason: "no SquadReplenishment ledger row" })
  })

  it("reports the missing ledger row FIRST, before counts it has not been given", () => {
    // The gate skips the roster and lineup reads for an unreplenished club, so
    // it passes placeholder zeroes. Judging those as a floor breach would
    // report the wrong problem entirely.
    const failure = judgeTeamRoster({
      teamId: "t-2",
      replenished: false,
      counts: { total: 0, GK: 0, DF: 0, MF: 0, FW: 0 },
      lineup: { legal: true, starters: 0, slotCount: 0, problems: [] },
    })
    expect(failure!.reason).toBe("no SquadReplenishment ledger row")
  })

  it("fails a club under the total floor, and names the constraint", () => {
    const failure = judgeTeamRoster({ ...READY, counts: { total: 15, GK: 2, DF: 5, MF: 5, FW: 3 } })
    expect(failure!.reason).toContain("TOTAL")
    expect(failure!.reason).toContain("total=15")
  })

  it("fails a club with one goalkeeper even when it has plenty of players", () => {
    const failure = judgeTeamRoster({ ...READY, counts: { total: 20, GK: 1, DF: 7, MF: 7, FW: 5 } })
    expect(failure!.reason).toContain("GK")
    expect(failure!.reason).toContain("GK=1")
  })

  it("names every breached constraint at once, not just the first", () => {
    const failure = judgeTeamRoster({ ...READY, counts: { total: 16, GK: 1, DF: 3, MF: 8, FW: 4 } })
    expect(failure!.reason).toContain("GK")
    expect(failure!.reason).toContain("DEF")
  })

  it("fails a club over the roster cap", () => {
    const over = MAX_ACTIVE_ROSTER_SIZE + 1
    const failure = judgeTeamRoster({
      ...READY,
      counts: { total: over, GK: 3, DF: 8, MF: 8, FW: 4 },
    })
    expect(failure!.reason).toBe(`exceeds the roster cap: ${over}`)
  })

  it("fails a club that cannot field a legal eleven, and says how short it is", () => {
    const failure = judgeTeamRoster({
      ...READY,
      lineup: { legal: false, starters: 10, slotCount: 11, problems: ["WRONG_STARTER_COUNT", "SLOT_GAP"] },
    })
    expect(failure!.reason).toBe("no legal XI: 10/11 [WRONG_STARTER_COUNT,SLOT_GAP]")
  })

  it("checks the squad before the lineup - a squad too small is the real problem", () => {
    const failure = judgeTeamRoster({
      ...READY,
      counts: { total: 12, GK: 2, DF: 4, MF: 4, FW: 2 },
      lineup: { legal: false, starters: 9, slotCount: 11, problems: ["SLOT_GAP"] },
    })
    expect(failure!.reason).toContain("TOTAL")
    expect(failure!.reason).not.toContain("no legal XI")
  })

  it("accepts a club exactly on the floor and exactly on the cap", () => {
    expect(judgeTeamRoster({ ...READY, counts: { total: 16, GK: 2, DF: 4, MF: 4, FW: 6 } })).toBeNull()
    expect(
      judgeTeamRoster({ ...READY, counts: { total: MAX_ACTIVE_ROSTER_SIZE, GK: 2, DF: 8, MF: 8, FW: 4 } })
    ).toBeNull()
  })
})

describe("there is exactly ONE verdict", () => {
  const root = join(__dirname, "..", "..", "..")
  const gate = readFileSync(join(root, "src", "lib", "seasons", "squad-replenishment.ts"), "utf8")
  const verifier = readFileSync(join(root, "scripts", "production", "verify-next-season.ts"), "utf8")

  it("the orchestrator's gate reaches its verdict through judgeTeamRoster", () => {
    expect(gate).toContain("judgeTeamRoster(")
  })

  it("the production verifier reaches its verdict through the same function", () => {
    expect(verifier).toContain("judgeTeamRoster(")
  })

  /**
   * Just the gate function's own body. The replenishment SERVICE elsewhere in
   * the same file has post-write integrity errors that read similarly on
   * purpose - those are a different check, and a whole-file match would
   * wrongly accuse them.
   */
  const gateBody = gate.slice(gate.indexOf("export async function verifySeasonRosterInvariant"))

  it("the gate decides nothing for itself - it reads, then asks", () => {
    expect(gateBody).not.toContain("failedConstraints")
    expect(gateBody).not.toContain("MAX_ACTIVE_ROSTER_SIZE")
    expect(gateBody).not.toContain("lineup.legal")
  })

  it("neither of them re-implements the gate's reasons", () => {
    for (const source of [gateBody, verifier]) {
      expect(source).not.toContain("no SquadReplenishment ledger row")
      expect(source).not.toContain("exceeds the roster cap")
      expect(source).not.toContain("no legal XI")
    }
  })
})
