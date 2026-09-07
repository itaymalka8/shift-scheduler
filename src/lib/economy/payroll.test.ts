import { getNextPayrollDate } from "./payroll"
import { PAYROLL_WEEKDAY, PAYROLL_HOUR_UTC } from "./config"

describe("getNextPayrollDate", () => {
  it("lands on the configured payroll weekday and hour, strictly after `now`, at most 7 days out", () => {
    // 2026-08-30 is a Sunday (UTC) - an arbitrary fixed point, unrelated to
    // the payroll weekday, so the test doesn't depend on when it happens to run.
    const now = new Date(Date.UTC(2026, 7, 30, 12, 0, 0))

    const next = getNextPayrollDate(now)

    expect(next.getUTCDay()).toBe(PAYROLL_WEEKDAY)
    expect(next.getUTCHours()).toBe(PAYROLL_HOUR_UTC)
    expect(next.getTime()).toBeGreaterThan(now.getTime())
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000)
  })

  it("is deterministic for the same input", () => {
    const now = new Date(Date.UTC(2026, 2, 10, 8, 0, 0))
    expect(getNextPayrollDate(now).getTime()).toBe(getNextPayrollDate(now).getTime())
  })
})
