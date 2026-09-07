/**
 * THE ACTIVATION BOUNDARY, ASSERTED RATHER THAN TRUSTED.
 *
 * Phase 3R turns five things on at once - the compressed salary curve, the
 * repricing, weekly sponsor income, weekly stadium maintenance and the
 * calibrated attendance model. They were calibrated together and only make
 * sense together, so the rules below are about the boundary being ONE thing
 * that cannot drift into five.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PAYROLL_HOUR_UTC, PAYROLL_WEEKDAY, PAYROLL_AUTOMATION_START, PHASE_3R_ACTIVATION_START } from "./config"
import { economyEraAt, phase3rBoundaryHasPassed, phase3rIsActive } from "./activation"
import { isPayrollInstant } from "./payroll-clock"
import { salaryAuthorityAt } from "./salary"

const ROOT = join(__dirname, "..", "..", "..")
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8")
const CONFIG = read("src", "lib", "economy", "config.ts")

describe("the boundary is an explicit committed instant", () => {
  it("is a literal Date, not derived from deploy time, an env var or a database row", () => {
    expect(CONFIG).toMatch(/PHASE_3R_ACTIVATION_START = new Date\("\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"\)/)
    const line = CONFIG.slice(CONFIG.indexOf("export const PHASE_3R_ACTIVATION_START")).split("\n")[0]
    expect(line).not.toContain("process.env")
    expect(line).not.toContain("Date.now")
    expect(line).not.toContain("new Date()")
  })

  it("sits on the payroll grid, so repricing and every settlement share one instant", () => {
    // Load-bearing, not cosmetic: sponsor, maintenance and payroll all settle
    // at a payroll instant and the repricing runs in the same transaction
    // ahead of them. If the boundary were NOT on that grid, the first
    // calibrated week would settle against a league nothing had repriced.
    expect(isPayrollInstant(PHASE_3R_ACTIVATION_START)).toBe(true)
    expect(PHASE_3R_ACTIVATION_START.getUTCDay()).toBe(PAYROLL_WEEKDAY)
    expect(PHASE_3R_ACTIVATION_START.getUTCHours()).toBe(PAYROLL_HOUR_UTC)
  })

  it("is at or after autonomous payroll's own boundary", () => {
    // The calibrated economy assumes wages are actually being charged. Turning
    // it on before payroll automation would model a league that pays nobody.
    expect(PHASE_3R_ACTIVATION_START.getTime()).toBeGreaterThanOrEqual(PAYROLL_AUTOMATION_START.getTime())
  })
})

describe("one era function, and everything asks it", () => {
  it("switches at the boundary instant itself, not one tick later", () => {
    const before = new Date(PHASE_3R_ACTIVATION_START.getTime() - 1)
    expect(economyEraAt(before)).toBe("legacy")
    expect(economyEraAt(PHASE_3R_ACTIVATION_START)).toBe("phase3r")
    expect(phase3rIsActive(before)).toBe(false)
    expect(phase3rIsActive(PHASE_3R_ACTIVATION_START)).toBe(true)
  })

  it("gives the salary authority the same answer as everything else, at every instant", () => {
    // NO MIXED PERIOD: the wage curve does not get its own boundary. A second
    // copy of the comparison is exactly how one subsystem drifts a week away
    // from the others.
    for (const offset of [-86_400_000, -1, 0, 1, 86_400_000]) {
      const at = new Date(PHASE_3R_ACTIVATION_START.getTime() + offset)
      expect(salaryAuthorityAt(at)).toBe(economyEraAt(at))
    }
  })

  it("is delegated, not reimplemented, in the salary module", () => {
    const salary = read("src", "lib", "economy", "salary.ts")
    const fn = salary.slice(salary.indexOf("export function salaryAuthorityAt"))
    expect(fn).toContain("economyEraAt(at, activationStart)")
    // The comparison itself must appear exactly once in the codebase's economy
    // modules - in activation.ts - so there is nothing to keep in sync.
    expect(fn).not.toContain("getTime() >=")
  })

  it("takes the economic instant being settled, never the wall clock, in the settlement", () => {
    // A weekly settlement that runs late is settling ITS OWN boundary instant
    // and must be judged against the era that instant belonged to. Passing
    // `new Date()` there would let a delayed cron tick decide history.
    const settlement = read("src", "lib", "economy", "weekly-settlement.ts")
    expect(settlement).toContain("economyEraAt(instant)")
    expect(settlement).not.toContain("economyEraAt(new Date())")
  })
})

describe("fail closed: the deploy must land before the boundary", () => {
  it("reports the boundary as not yet passed for an instant before it", () => {
    expect(phase3rBoundaryHasPassed(new Date(PHASE_3R_ACTIVATION_START.getTime() - 1))).toBe(false)
    expect(phase3rBoundaryHasPassed(PHASE_3R_ACTIVATION_START)).toBe(true)
  })

  it("is still in the future as this build stands", () => {
    // The one assertion that will legitimately fail with time, and should:
    // when it does, the boundary needs moving to the next payroll instant
    // through a reviewed code change, which is exactly the intended process.
    // Deploying past it would settle a sponsor week and a maintenance week
    // that closed before anybody could observe the new behaviour.
    expect(PHASE_3R_ACTIVATION_START.getTime()).toBeGreaterThan(Date.now())
  })
})

describe("no historical catch-up", () => {
  it("settles sponsor and maintenance only for weeks at or after the boundary", () => {
    const settlement = read("src", "lib", "economy", "weekly-settlement.ts")
    const runner = settlement.slice(settlement.indexOf("export async function settleWeeklyEconomy"))
    // Both new settlements are gated on the era of the week being settled. The
    // gate is the FIRST condition in each, before any completeness fast path,
    // so a pre-boundary week is refused on era rather than on happening to
    // look settled.
    const sponsorCall = runner.slice(runner.indexOf("const sponsor ="), runner.indexOf("const maintenance ="))
    const maintenanceCall = runner.slice(runner.indexOf("const maintenance ="), runner.indexOf("const payroll ="))
    expect(sponsorCall).toContain('era === "phase3r" &&')
    expect(sponsorCall).toContain("settleSponsorWeek(instant)")
    expect(sponsorCall).toContain(": null")
    expect(maintenanceCall).toContain('era === "phase3r" &&')
    expect(maintenanceCall).toContain("settleMaintenanceWeek(instant)")
    expect(maintenanceCall).toContain(": null")
    // Payroll is NOT gated on the 3R boundary - it has its own, older one, and
    // a pre-3R week must still pay its wages exactly as it does today.
    const payrollCall = runner.slice(runner.indexOf("const payroll ="), runner.indexOf("const didWork"))
    expect(payrollCall).toContain("await settlePayrollWeek(instant)")
    expect(payrollCall).not.toContain("phase3r")
  })

  it("has no path that back-dates a settlement to a pre-boundary week", () => {
    const settlement = read("src", "lib", "economy", "weekly-settlement.ts")
    // The boundary is never IMPORTED here, which is the thing that matters: a
    // settlement that could reference the activation constant could compute a
    // week from it. Prose mentioning it in a comment is not a code path, so
    // this asserts the import rather than the string - the earlier form broke
    // the moment the file explained why the crossing's history rows carry the
    // settlement instant.
    expect(settlement).not.toContain("PHASE_3R_ACTIVATION_START }")
    expect(settlement).not.toMatch(/import\s*\{[^}]*PHASE_3R_ACTIVATION_START/)
    // The window it iterates is the payroll calendar, bounded by payroll's own
    // activation start - there is no separate backfill loop to go wrong.
    expect(settlement).toContain("payrollWindow(now)")
  })
})
