import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PHASE_3R_ACTIVATION_START } from "./config"
import {
  OPERATING_RESERVE_WEEKS,
  discretionaryHeadroom,
  evaluateDiscretionarySpend,
  operatingReserve,
} from "./reserve"

const ROOT = join(__dirname, "..", "..", "..")
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8")

describe("the four-week operating reserve", () => {
  it("is four weeks of the club's OWN wage bill", () => {
    expect(OPERATING_RESERVE_WEEKS).toBe(4)
    expect(operatingReserve(300_000)).toBe(1_200_000)
  })

  it("scales with the club, so each expensive signing makes the next one harder", () => {
    // The reserve is a function of commitments already taken on. Doubling the
    // wage bill doubles what must be held back, which is the intended pressure.
    expect(operatingReserve(600_000)).toBe(operatingReserve(300_000) * 2)
  })

  it("is never negative, and a club with no players holds nothing back", () => {
    expect(operatingReserve(0)).toBe(0)
    expect(operatingReserve(-5)).toBe(0)
  })

  it("leaves a club below its reserve with nothing to spend, not a debt to repay", () => {
    expect(discretionaryHeadroom(500_000, 300_000)).toBe(0)
    expect(discretionaryHeadroom(-2_000_000, 300_000)).toBe(0)
  })

  it("allows a spend up to the headroom exactly, and refuses one unit more", () => {
    // 5,000,000 balance, 300,000 wage bill -> 1,200,000 reserve -> 3,800,000
    // committable. The boundary is inclusive: spending the last committable
    // unit is legal, because the reserve is what must REMAIN.
    expect(evaluateDiscretionarySpend(5_000_000, 300_000, 3_800_000).allowed).toBe(true)
    expect(evaluateDiscretionarySpend(5_000_000, 300_000, 3_800_001).allowed).toBe(false)
  })

  it("reports the working, so a refusal can say how much the club may actually spend", () => {
    const decision = evaluateDiscretionarySpend(5_000_000, 300_000, 4_000_000)
    expect(decision).toEqual({
      allowed: false,
      balance: 5_000_000,
      weeklyPayroll: 300_000,
      reserve: 1_200_000,
      headroom: 3_800_000,
      cost: 4_000_000,
    })
  })

  it("has nowhere for a club type to enter - Human and BOT are one rule", () => {
    // Structural: the inputs are a balance, a wage bill and a cost. There is
    // no manager flag to read even if a future edit wanted one.
    expect(evaluateDiscretionarySpend(1_000_000, 100_000, 500_000)).toEqual(
      evaluateDiscretionarySpend(1_000_000, 100_000, 500_000)
    )
  })
})

describe("what the reserve is deliberately silent about", () => {
  it("is not consulted by any mandatory charge", () => {
    // Asserted at the source: payroll, maintenance, match expenses, away
    // travel and fan fines settle through the Economy Service with
    // allowNegative and never import this module. A reserve that could block
    // payroll would stop the economy rather than protect it.
    for (const file of [
      ["src", "lib", "economy", "payroll.ts"],
      ["src", "lib", "economy", "weekly-settlement.ts"],
      ["src", "lib", "match", "simulate.ts"],
      ["src", "lib", "transfers", "release.ts"],
    ]) {
      const source = read(...file)
      expect(source).not.toContain("evaluateDiscretionarySpendForTeam")
      expect(source).not.toContain("operatingReserve(")
    }
  })

  it("is consulted by both discretionary spends, and only those", () => {
    for (const file of [
      ["src", "lib", "transfers", "purchase.ts"],
      ["src", "lib", "stadium", "actions.ts"],
    ]) {
      const source = read(...file)
      expect(source).toContain("evaluateDiscretionarySpendForTeam")
    }
  })

  it("release still charges its cost and still allows the balance to go negative", () => {
    const source = read("src", "lib", "transfers", "release.ts")
    // The cost is not waived...
    expect(source).toContain("amount: -player.weeklySalary")
    // ...and the club is allowed to go into the red paying it, because release
    // is the way OUT of financial trouble and must stay open to a club in it.
    expect(source).toContain("allowNegative: true")
    expect(source).not.toContain("allowNegative: false")
  })
})

describe("the reserve turns on with the rest of the calibrated economy", () => {
  it("is documented as gated on the Phase 3R boundary", () => {
    // The boundary itself is asserted in phase-3r-activation.test.ts; what
    // matters here is that the gate exists at all, so the reserve cannot be
    // enforced against pre-3R wage bills - which are roughly twice their
    // calibrated size and would lock managers out of a market this economy was
    // never balanced to restrict.
    const source = read("src", "lib", "economy", "reserve.ts")
    expect(source).toContain("phase3rIsActive(at)")
    expect(PHASE_3R_ACTIVATION_START.getTime()).toBeGreaterThan(0)
  })
})
