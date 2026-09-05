import {
  MS_PER_WEEK,
  activationBoundaryHasPassed,
  getFirstPayrollDueAfter,
  getMostRecentPayrollTime,
  getNextPayrollDate,
  isPayrollDueForTeam,
  isPayrollInstant,
  payrollDueInstantsForTeam,
  payrollReferenceId,
  payrollWeekKey,
  payrollWindow,
} from "./payroll-clock"
import { PAYROLL_AUTOMATION_START, PAYROLL_HOUR_UTC, PAYROLL_MAX_CATCHUP_WEEKS, PAYROLL_WEEKDAY } from "./config"

/**
 * The payroll clock, tested as arithmetic.
 *
 * Phase 3O found these formulas private and effectively untested - two tests
 * covering one exported helper, while the week key, the first payable week
 * and the catch-up loop had none at all. They now decide, autonomously, what
 * sixty clubs pay every Thursday, so every boundary is pinned here: the exact
 * instant, one millisecond either side of it, a club born before it, a club
 * born after it, a year-end week key, and - the one that matters most for
 * cost - that an old club with nothing due does no walking whatsoever.
 */

/** A Thursday 13:00 UTC instant N weeks after the activation boundary. */
const boundary = PAYROLL_AUTOMATION_START
const week = (n: number) => new Date(boundary.getTime() + n * MS_PER_WEEK)

describe("the payroll grid", () => {
  it("the activation boundary is itself on the grid", () => {
    expect(isPayrollInstant(PAYROLL_AUTOMATION_START)).toBe(true)
    expect(PAYROLL_AUTOMATION_START.getUTCDay()).toBe(PAYROLL_WEEKDAY)
    expect(PAYROLL_AUTOMATION_START.getUTCHours()).toBe(PAYROLL_HOUR_UTC)
  })

  it("rejects an instant that is a day, an hour or a second off the grid", () => {
    expect(isPayrollInstant(new Date(boundary.getTime() + 86_400_000))).toBe(false)
    expect(isPayrollInstant(new Date(boundary.getTime() + 3_600_000))).toBe(false)
    expect(isPayrollInstant(new Date(boundary.getTime() + 1_000))).toBe(false)
    expect(isPayrollInstant(new Date(boundary.getTime() + 1))).toBe(false)
  })
})

describe("getMostRecentPayrollTime", () => {
  it("returns the instant itself when now IS a payroll instant", () => {
    expect(getMostRecentPayrollTime(boundary).getTime()).toBe(boundary.getTime())
  })

  it("one millisecond before the instant returns the PREVIOUS week", () => {
    const justBefore = new Date(boundary.getTime() - 1)
    expect(getMostRecentPayrollTime(justBefore).getTime()).toBe(boundary.getTime() - MS_PER_WEEK)
  })

  it("one millisecond after the instant returns that instant", () => {
    const justAfter = new Date(boundary.getTime() + 1)
    expect(getMostRecentPayrollTime(justAfter).getTime()).toBe(boundary.getTime())
  })

  it("is always on the grid, whatever the input", () => {
    for (const offset of [0, 1, 3_600_000, 86_400_000, 3 * 86_400_000, 6 * 86_400_000, MS_PER_WEEK + 17]) {
      expect(isPayrollInstant(getMostRecentPayrollTime(new Date(boundary.getTime() + offset)))).toBe(true)
    }
  })
})

describe("getNextPayrollDate", () => {
  it("is strictly after now, on the grid, at most seven days out", () => {
    const now = new Date("2026-08-30T12:00:00.000Z")
    const next = getNextPayrollDate(now)
    expect(next.getTime()).toBeGreaterThan(now.getTime())
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(MS_PER_WEEK)
    expect(isPayrollInstant(next)).toBe(true)
  })

  it("standing exactly on a payroll instant, the NEXT one is a week away", () => {
    expect(getNextPayrollDate(boundary).getTime()).toBe(boundary.getTime() + MS_PER_WEEK)
  })
})

describe("getFirstPayrollDueAfter", () => {
  it("a club born exactly on the instant owes that instant", () => {
    expect(getFirstPayrollDueAfter(boundary).getTime()).toBe(boundary.getTime())
  })

  it("a club born one millisecond before owes that instant", () => {
    expect(getFirstPayrollDueAfter(new Date(boundary.getTime() - 1)).getTime()).toBe(boundary.getTime())
  })

  it("a club born one millisecond after waits a full week", () => {
    expect(getFirstPayrollDueAfter(new Date(boundary.getTime() + 1)).getTime()).toBe(
      boundary.getTime() + MS_PER_WEEK
    )
  })
})

describe("payrollWeekKey", () => {
  it("is zero-padded, so lexicographic order IS chronological order", () => {
    const keys = [week(0), week(1), week(2), week(3)].map(payrollWeekKey)
    expect([...keys].sort()).toEqual(keys)
    expect(keys[0]).toMatch(/^\d{4}_W\d{2}$/)
  })

  it("keeps sorting correctly across a year end", () => {
    const dec = payrollWeekKey(new Date("2026-12-31T13:00:00.000Z"))
    const jan = payrollWeekKey(new Date("2027-01-07T13:00:00.000Z"))
    expect(jan > dec).toBe(true)
  })

  it("puts an early-January Thursday in the ISO week its Thursday belongs to", () => {
    // 2027-01-07 is a Thursday, so ISO week 1 of 2027 - not week 53 of 2026.
    expect(payrollWeekKey(new Date("2027-01-07T13:00:00.000Z"))).toBe("2027_W01")
  })

  it("the reference id is the week key with the one stable prefix", () => {
    expect(payrollReferenceId("2026_W37")).toBe("PAYROLL_2026_W37")
  })
})

describe("the activation boundary", () => {
  it("nothing is due before it, however old the club", () => {
    const ancient = { createdAt: new Date("2020-01-01T00:00:00.000Z") }
    const justBefore = new Date(boundary.getTime() - 1)
    expect(payrollWindow(justBefore).instants).toEqual([])
    expect(payrollDueInstantsForTeam(ancient, justBefore)).toEqual([])
  })

  it("a pre-boundary instant is never due, even for a club that existed then", () => {
    const ancient = { createdAt: new Date("2020-01-01T00:00:00.000Z") }
    expect(isPayrollDueForTeam(new Date(boundary.getTime() - MS_PER_WEEK), ancient)).toBe(false)
    expect(isPayrollDueForTeam(new Date(boundary.getTime() - 26 * MS_PER_WEEK), ancient)).toBe(false)
  })

  it("the boundary instant itself IS due once it has passed", () => {
    const ancient = { createdAt: new Date("2020-01-01T00:00:00.000Z") }
    expect(payrollDueInstantsForTeam(ancient, boundary).map((d) => d.getTime())).toEqual([boundary.getTime()])
  })

  it("reports whether it has already passed - the pre-deploy safety question", () => {
    expect(activationBoundaryHasPassed(new Date(boundary.getTime() - 1))).toBe(false)
    expect(activationBoundaryHasPassed(boundary)).toBe(true)
    expect(activationBoundaryHasPassed(new Date(boundary.getTime() + 1))).toBe(true)
  })
})

describe("per-club eligibility", () => {
  const ancient = { createdAt: new Date("2020-01-01T00:00:00.000Z") }
  const bornMidWindow = { createdAt: new Date(week(2).getTime() + 3_600_000) }

  it("a club created AFTER the boundary is not charged for weeks before it existed", () => {
    const now = week(4)
    const due = payrollDueInstantsForTeam(bornMidWindow, now).map((d) => d.getTime())
    expect(due).toEqual([week(3).getTime(), week(4).getTime()])
  })

  it("a club created BEFORE the boundary starts at the boundary, not at its own birth", () => {
    const now = week(2)
    const due = payrollDueInstantsForTeam(ancient, now).map((d) => d.getTime())
    expect(due).toEqual([week(0).getTime(), week(1).getTime(), week(2).getTime()])
  })

  it("two clubs of very different ages owe the SAME weeks once both are past the boundary", () => {
    const now = week(6)
    const old = payrollDueInstantsForTeam(ancient, now).map((d) => d.getTime())
    const young = payrollDueInstantsForTeam({ createdAt: new Date(boundary.getTime() - 1) }, now).map((d) =>
      d.getTime()
    )
    expect(old).toEqual(young)
  })
})

describe("the candidate window is bounded by the CALENDAR, never by a club's age", () => {
  it("an idle moment right after a boundary offers exactly one candidate week", () => {
    const window = payrollWindow(new Date(boundary.getTime() + 60_000))
    expect(window.instants.map((d) => d.getTime())).toEqual([boundary.getTime()])
    expect(window.weeksOutsideWindow).toBe(0)
  })

  it("a club a year old with nothing due still walks no more weeks than a brand-new one", () => {
    // The regression that matters: the old implementation looped forward from
    // Team.createdAt on every call, so this club would have examined 52 weeks
    // and issued 52 queries to discover it owed nothing.
    const veteran = { createdAt: new Date(boundary.getTime() - 52 * MS_PER_WEEK) }
    const newborn = { createdAt: new Date(boundary.getTime() - 1) }
    const now = new Date(boundary.getTime() + 60_000)
    expect(payrollDueInstantsForTeam(veteran, now)).toHaveLength(1)
    expect(payrollDueInstantsForTeam(newborn, now)).toHaveLength(1)
  })

  it("three missed boundaries produce exactly three candidates, oldest first", () => {
    const window = payrollWindow(new Date(week(2).getTime() + 60_000))
    expect(window.instants.map((d) => d.getTime())).toEqual([week(0).getTime(), week(1).getTime(), week(2).getTime()])
    expect(window.instants[0].getTime()).toBeLessThan(window.instants[2].getTime())
  })

  it("caps the look-back and REPORTS what it left out rather than dropping it silently", () => {
    // Both ends are inclusive: standing N weeks past the boundary means N+1
    // weeks have closed since it, so N+5 weeks out leaves 6 outside a cap of N.
    const overshoot = 5
    const far = new Date(boundary.getTime() + (PAYROLL_MAX_CATCHUP_WEEKS + overshoot) * MS_PER_WEEK)
    const window = payrollWindow(far)
    expect(window.instants).toHaveLength(PAYROLL_MAX_CATCHUP_WEEKS)
    expect(window.weeksOutsideWindow).toBe(overshoot + 1)
    // The newest week is always in the window - a cap must never cost the
    // league the week it is actually standing in.
    expect(window.instants.at(-1)!.getTime()).toBe(window.through.getTime())
  })

  it("every candidate is on the grid and one week apart", () => {
    const window = payrollWindow(week(5))
    for (const instant of window.instants) expect(isPayrollInstant(instant)).toBe(true)
    for (let i = 1; i < window.instants.length; i++) {
      expect(window.instants[i].getTime() - window.instants[i - 1].getTime()).toBe(MS_PER_WEEK)
    }
  })
})

describe("the clock is fixed UTC and DST-unaware, on purpose", () => {
  it("a summer instant and a winter instant are both 13:00 UTC", () => {
    const summer = getMostRecentPayrollTime(new Date("2026-07-15T20:00:00.000Z"))
    const winter = getMostRecentPayrollTime(new Date("2026-12-15T20:00:00.000Z"))
    expect(summer.getUTCHours()).toBe(PAYROLL_HOUR_UTC)
    expect(winter.getUTCHours()).toBe(PAYROLL_HOUR_UTC)
    expect(summer.getUTCDay()).toBe(PAYROLL_WEEKDAY)
    expect(winter.getUTCDay()).toBe(PAYROLL_WEEKDAY)
  })

  it("the grid never shifts by an hour across an Israeli DST change", () => {
    // Israel leaves DST in late October; the payroll instant must not move.
    const before = getMostRecentPayrollTime(new Date("2026-10-20T20:00:00.000Z"))
    const after = getMostRecentPayrollTime(new Date("2026-11-10T20:00:00.000Z"))
    expect((after.getTime() - before.getTime()) % MS_PER_WEEK).toBe(0)
  })
})

describe("THE FIRST AUTONOMOUS PAYROLL LANDS ON THE BOUNDARY ITSELF", () => {
  /**
   * The due rule reads `instant >= getFirstPayrollDueAfter(activationStart)`,
   * and `getFirstPayrollDueAfter` is the function that pushes a club born at
   * 13:01 into the following week. If it ever pushed the BOUNDARY into the
   * following week too, the first autonomous payroll would silently slip from
   * 2026-09-10 to 2026-09-17 and nothing in a log would say so.
   *
   * Every assertion below is written against the LITERAL instant and the
   * LITERAL week key rather than against arithmetic derived from the constant,
   * so an off-by-one-week regression cannot move the expectation with it.
   */
  const LITERAL_BOUNDARY = new Date("2026-09-10T13:00:00.000Z")
  const ancient = { createdAt: new Date("2026-08-01T00:00:00.000Z") }

  it("the committed constant is the instant this suite reasons about", () => {
    expect(PAYROLL_AUTOMATION_START.toISOString()).toBe("2026-09-10T13:00:00.000Z")
    expect(LITERAL_BOUNDARY.getUTCDay()).toBe(PAYROLL_WEEKDAY)
  })

  it("getFirstPayrollDueAfter(boundary) returns the boundary, NOT a week later", () => {
    expect(getFirstPayrollDueAfter(LITERAL_BOUNDARY).toISOString()).toBe("2026-09-10T13:00:00.000Z")
    expect(getFirstPayrollDueAfter(LITERAL_BOUNDARY).toISOString()).not.toBe("2026-09-17T13:00:00.000Z")
  })

  it("the boundary week is 2026_W37, keyed PAYROLL_2026_W37", () => {
    expect(payrollWeekKey(LITERAL_BOUNDARY)).toBe("2026_W37")
    expect(payrollReferenceId(payrollWeekKey(LITERAL_BOUNDARY))).toBe("PAYROLL_2026_W37")
  })

  it("with now === activationStart === the boundary, 2026_W37 is due", () => {
    expect(isPayrollDueForTeam(LITERAL_BOUNDARY, ancient, LITERAL_BOUNDARY)).toBe(true)
  })

  it("settleDuePayroll's window offers exactly PAYROLL_2026_W37 at that instant", () => {
    // settleDuePayroll settles precisely the instants payrollWindow returns.
    const window = payrollWindow(LITERAL_BOUNDARY, LITERAL_BOUNDARY)
    expect(window.instants.map((i) => payrollReferenceId(payrollWeekKey(i)))).toEqual(["PAYROLL_2026_W37"])
    expect(window.weeksOutsideWindow).toBe(0)
  })

  it("one millisecond earlier there is nothing to settle at all", () => {
    const window = payrollWindow(new Date(LITERAL_BOUNDARY.getTime() - 1), LITERAL_BOUNDARY)
    expect(window.instants).toEqual([])
  })

  it("2026_W36 - the week the one legacy ledger row belongs to - is never due", () => {
    const previous = new Date("2026-09-03T13:00:00.000Z")
    expect(payrollWeekKey(previous)).toBe("2026_W36")
    expect(isPayrollDueForTeam(previous, ancient, LITERAL_BOUNDARY)).toBe(false)
  })

  it("a tick that arrives late still settles W37 rather than skipping it", () => {
    const window = payrollWindow(new Date("2026-09-17T13:00:00.000Z"), LITERAL_BOUNDARY)
    expect(window.instants.map((i) => payrollWeekKey(i))).toEqual(["2026_W37", "2026_W38"])
  })
})
