/**
 * THE PAYROLL CLOCK - pure arithmetic, no Prisma, no I/O, no `new Date()`
 * except through an explicit argument.
 *
 * Every question about WHEN wages are due is answered here and nowhere else,
 * so the scheduled job, the /economy page, the production diagnostic and the
 * tests all read the same calendar. Phase 3O found these formulas living as
 * private helpers inside the settlement function, untested and impossible to
 * reuse; duplicating them into a cron would have been two clocks pretending
 * to be one.
 *
 * THE CLOCK IS FIXED UTC AND DELIBERATELY NOT DST-AWARE. Thursday 13:00 UTC,
 * always - which is 15:00 Israel Standard Time and 16:00 Israel Daylight
 * Time. That is the contract every PAYROLL_* referenceId already written to
 * the ledger was stamped with, so it cannot move without orphaning history.
 * The transfer window (src/lib/transfers/window.ts) is a true Asia/Jerusalem
 * wall clock and is a DIFFERENT contract on purpose; do not unify them.
 *
 * PAYROLL IS CALENDAR-DRIVEN AND CONTINUES THROUGH THE OFFSEASON. Nothing
 * here reads Season.status or Season.offseasonStage, and nothing should:
 * players are under contract whether or not a fixture is scheduled, and a
 * season-aware payroll would make what a club pays depend on the minute the
 * orchestrator happened to advance a stage.
 */
import { PAYROLL_WEEKDAY, PAYROLL_HOUR_UTC, PAYROLL_AUTOMATION_START, PAYROLL_MAX_CATCHUP_WEEKS } from "./config"

export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const MS_PER_WEEK = 7 * MS_PER_DAY

/**
 * ISO-ish week key for a payroll reference, e.g. "2026_W35" - stable,
 * sortable, and human-readable in the ledger.
 *
 * The format matters beyond display: zero-padded week after a four-digit
 * year means LEXICOGRAPHIC order equals CHRONOLOGICAL order, which is what
 * lets a report sort payroll history without parsing it.
 */
export function payrollWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7)
  return `${d.getUTCFullYear()}_W${String(weekNo).padStart(2, "0")}`
}

/** The ledger idempotency key for one club's wages in one payroll week. */
export function payrollReferenceId(weekKey: string): string {
  return `PAYROLL_${weekKey}`
}

/** The most recent payroll instant at or before `date`, in UTC - never a viewer's local clock. */
export function getMostRecentPayrollTime(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), PAYROLL_HOUR_UTC, 0, 0))
  const diff = (d.getUTCDay() - PAYROLL_WEEKDAY + 7) % 7
  d.setUTCDate(d.getUTCDate() - diff)
  if (d.getTime() > date.getTime()) d.setUTCDate(d.getUTCDate() - 7)
  return d
}

/**
 * The first payroll instant a club born at `createdAt` can owe wages for.
 *
 * A club born at 12:59 on payroll day owes that day's wages an hour later; a
 * club born at 13:01 owes nothing until the following week. The boundary
 * instant itself counts as due - a club created exactly on the stroke pays.
 */
export function getFirstPayrollDueAfter(createdAt: Date): Date {
  const candidate = getMostRecentPayrollTime(createdAt)
  return candidate.getTime() < createdAt.getTime() ? new Date(candidate.getTime() + MS_PER_WEEK) : candidate
}

/** The next payroll instant strictly after `now` - what the economy page shows a manager. */
export function getNextPayrollDate(now: Date = new Date()): Date {
  return new Date(getMostRecentPayrollTime(now).getTime() + MS_PER_WEEK)
}

/** Is `instant` on the payroll grid at all (Thursday, 13:00 UTC, to the second)? */
export function isPayrollInstant(instant: Date): boolean {
  return (
    instant.getUTCDay() === PAYROLL_WEEKDAY &&
    instant.getUTCHours() === PAYROLL_HOUR_UTC &&
    instant.getUTCMinutes() === 0 &&
    instant.getUTCSeconds() === 0 &&
    instant.getUTCMilliseconds() === 0
  )
}

export interface PayrollWindow {
  /** Payroll instants the league may settle on this tick, OLDEST FIRST. */
  instants: Date[]
  /** The most recent payroll instant at or before `now` - the newest settleable week. */
  through: Date
  /**
   * Post-activation weeks that fell outside the look-back window and are NOT
   * in `instants`. Non-zero only after an outage longer than
   * PAYROLL_MAX_CATCHUP_WEEKS, which is an incident, not a backlog - the
   * caller must report it rather than let wages vanish silently.
   */
  weeksOutsideWindow: number
}

/**
 * THE LEAGUE-WIDE CANDIDATE WINDOW.
 *
 * Bounded by the ACTIVATION BOUNDARY and by a fixed look-back, never by how
 * old a club is. This is what kills the defect Phase 3O named C-1: the old
 * settlement walked forward from Team.createdAt on every single call, so an
 * idle tick a year from now would have issued 52 queries per club and found
 * nothing 3,120 times over. Here the number of candidate instants depends
 * only on the calendar, and the number of QUERIES the caller issues does not
 * depend on it at all.
 */
export function payrollWindow(now: Date, activationStart: Date = PAYROLL_AUTOMATION_START): PayrollWindow {
  const through = getMostRecentPayrollTime(now)
  const firstEligible = getFirstPayrollDueAfter(activationStart)
  if (through.getTime() < firstEligible.getTime()) {
    return { instants: [], through, weeksOutsideWindow: 0 }
  }

  const totalWeeks = Math.floor((through.getTime() - firstEligible.getTime()) / MS_PER_WEEK) + 1
  const kept = Math.min(totalWeeks, PAYROLL_MAX_CATCHUP_WEEKS)
  const oldestKept = new Date(through.getTime() - (kept - 1) * MS_PER_WEEK)

  const instants: Date[] = []
  for (let i = 0; i < kept; i++) instants.push(new Date(oldestKept.getTime() + i * MS_PER_WEEK))

  return { instants, through, weeksOutsideWindow: totalWeeks - kept }
}

/**
 * Whether a club is on the hook for a given payroll instant.
 *
 * TWO INDEPENDENT GATES, both of which must pass:
 *   1. the instant is at or after the activation boundary - START-LINE
 *      ACTIVATION, so a week that closed before autonomous payroll existed is
 *      permanently outside it and is NEVER charged, whether or not it has a
 *      ledger row;
 *   2. the instant is at or after the club's own first payable week, so a
 *      club born last Friday is not charged for last Thursday.
 */
export function isPayrollDueForTeam(
  instant: Date,
  team: { createdAt: Date },
  activationStart: Date = PAYROLL_AUTOMATION_START
): boolean {
  if (instant.getTime() < getFirstPayrollDueAfter(activationStart).getTime()) return false
  return instant.getTime() >= getFirstPayrollDueAfter(team.createdAt).getTime()
}

/** Every payroll instant a single club could owe, oldest first - the per-club view of `payrollWindow`. */
export function payrollDueInstantsForTeam(
  team: { createdAt: Date },
  now: Date,
  activationStart: Date = PAYROLL_AUTOMATION_START
): Date[] {
  return payrollWindow(now, activationStart).instants.filter((instant) =>
    isPayrollDueForTeam(instant, team, activationStart)
  )
}

/**
 * Has the activation boundary already passed?
 *
 * The first Production deploy that turns autonomous payroll on MUST happen
 * while this is false. Deploying after the boundary has passed would make the
 * very first tick settle a week that closed before anybody could observe the
 * new behaviour - a retroactive charge by accident, which is the one thing
 * this whole design exists to prevent. The pre-deploy check fails closed on
 * it; see scripts/production/check-payroll-activation.ts.
 */
export function activationBoundaryHasPassed(
  now: Date,
  activationStart: Date = PAYROLL_AUTOMATION_START
): boolean {
  return now.getTime() >= activationStart.getTime()
}
