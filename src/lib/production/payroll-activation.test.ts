import { evaluateActivationReadiness } from "./payroll-activation"
import { PAYROLL_AUTOMATION_START } from "@/lib/economy/config"
import { isPayrollInstant } from "@/lib/economy/payroll-clock"

/**
 * The gate that stops autonomous payroll shipping late.
 *
 * The whole design rests on one thing being true at deploy time: the
 * activation boundary has not passed yet. If it has, the first tick charges a
 * week retroactively - the exact failure start-line activation exists to
 * prevent - so this check must fail closed, and these tests are what prove it
 * actually does rather than merely intending to.
 */

const BOUNDARY = new Date("2026-09-10T13:00:00.000Z")

describe("the committed boundary itself", () => {
  it("sits on the payroll grid", () => {
    // A boundary a day or an hour off the grid would settle nothing on the day
    // it names and everything a week later - wrong in a way a log will not show.
    expect(isPayrollInstant(PAYROLL_AUTOMATION_START)).toBe(true)
  })
})

describe("before the boundary - the state a deploy must be in", () => {
  it("passes, and says how long there is", () => {
    const check = evaluateActivationReadiness({
      now: new Date("2026-09-05T16:00:00.000Z"),
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 0,
    })
    expect(check.ok).toBe(true)
    expect(check.verdict).toBe("READY_TO_ACTIVATE")
    expect(check.daysUntilBoundary).toBe(4)
  })

  it("still passes one millisecond before", () => {
    const check = evaluateActivationReadiness({
      now: new Date(BOUNDARY.getTime() - 1),
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 0,
    })
    expect(check.ok).toBe(true)
    expect(check.verdict).toBe("READY_TO_ACTIVATE")
  })
})

describe("AFTER the boundary with payroll never having run - FAIL CLOSED", () => {
  it("fails the instant the boundary is reached", () => {
    const check = evaluateActivationReadiness({
      now: BOUNDARY,
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 0,
    })
    expect(check.ok).toBe(false)
    expect(check.verdict).toBe("BOUNDARY_EXPIRED")
  })

  it("fails days later, and says exactly what to do about it", () => {
    const check = evaluateActivationReadiness({
      now: new Date(BOUNDARY.getTime() + 3 * 86_400_000),
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 0,
    })
    expect(check.ok).toBe(false)
    expect(check.detail).toContain("retroactively")
    expect(check.detail).toContain("next future Thursday 13:00 UTC")
    expect(check.daysUntilBoundary).toBeLessThan(0)
  })

  it("legacy PRE-boundary rows do not count as proof the clock is running", () => {
    // The caller counts only rows at or after the boundary. A club that paid
    // wages under the old page-triggered rules must never make this check
    // think autonomous payroll is already live.
    const check = evaluateActivationReadiness({
      now: new Date(BOUNDARY.getTime() + 1),
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 0,
    })
    expect(check.verdict).toBe("BOUNDARY_EXPIRED")
  })
})

describe("once payroll is genuinely live", () => {
  it("stops complaining, because the boundary is now history", () => {
    const check = evaluateActivationReadiness({
      now: new Date(BOUNDARY.getTime() + 60 * 86_400_000),
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 480,
    })
    expect(check.ok).toBe(true)
    expect(check.verdict).toBe("ALREADY_ACTIVE")
  })

  it("says the boundary must not be moved forward", () => {
    const check = evaluateActivationReadiness({
      now: new Date(BOUNDARY.getTime() + 86_400_000),
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 60,
    })
    expect(check.detail).toContain("must not be moved")
  })

  it("a single settled club is enough to prove it - the ledger is the evidence", () => {
    const check = evaluateActivationReadiness({
      now: new Date(BOUNDARY.getTime() + 1),
      activationStart: BOUNDARY,
      postBoundaryPayrollRows: 1,
    })
    expect(check.verdict).toBe("ALREADY_ACTIVE")
  })
})
