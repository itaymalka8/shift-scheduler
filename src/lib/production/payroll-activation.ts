/**
 * THE ONE QUESTION THAT MUST BE ANSWERED BEFORE AUTONOMOUS PAYROLL SHIPS:
 * is the activation boundary still in the future?
 *
 * Pure - no Prisma, no clock of its own. The caller supplies `now` and how
 * many post-boundary wage rows already exist; this decides.
 *
 * WHY IT FAILS CLOSED. The boundary is a committed constant set to a payroll
 * instant AFTER the deploy that turns the clock on. If that deploy slips past
 * it, the very first scheduled tick would settle a week that closed before
 * anybody could watch the new behaviour - a retroactive charge to sixty clubs,
 * arrived at by accident, which is precisely what start-line activation exists
 * to prevent. Better to refuse the deploy and move the literal forward by one
 * week than to explain the charge afterwards.
 *
 * AND WHY IT STOPS COMPLAINING ONCE PAYROLL IS LIVE. After the first real
 * settlement the boundary is history, and it obviously lies in the past
 * forever after. The presence of post-boundary wage rows is what tells the two
 * situations apart - so the check needs no extra state, no flag and no
 * migration to know which side of activation it is standing on.
 */

export type ActivationVerdict =
  | "READY_TO_ACTIVATE"
  | "ALREADY_ACTIVE"
  | "BOUNDARY_EXPIRED"

export interface ActivationReading {
  now: Date
  activationStart: Date
  /**
   * How many playerSalaries rows exist whose payroll week is AT OR AFTER the
   * activation boundary. Zero means autonomous payroll has never run here;
   * legacy pre-boundary rows must NOT be counted, or a club that paid wages
   * under the old page-triggered rules would be mistaken for proof that the
   * clock is already running.
   */
  postBoundaryPayrollRows: number
}

export interface ActivationCheck {
  ok: boolean
  verdict: ActivationVerdict
  detail: string
  /** Whole days until the boundary; negative once it has passed. */
  daysUntilBoundary: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function evaluateActivationReadiness(reading: ActivationReading): ActivationCheck {
  const { now, activationStart, postBoundaryPayrollRows } = reading
  const daysUntilBoundary = Math.floor((activationStart.getTime() - now.getTime()) / MS_PER_DAY)
  const passed = now.getTime() >= activationStart.getTime()

  if (postBoundaryPayrollRows > 0) {
    return {
      ok: true,
      verdict: "ALREADY_ACTIVE",
      detail:
        `autonomous payroll is already live here (${postBoundaryPayrollRows} post-boundary wage row(s)); ` +
        `the boundary ${activationStart.toISOString()} is historical configuration and must not be moved`,
      daysUntilBoundary,
    }
  }

  if (passed) {
    return {
      ok: false,
      verdict: "BOUNDARY_EXPIRED",
      detail:
        `PAYROLL_AUTOMATION_START ${activationStart.toISOString()} has already passed and no payroll has ever ` +
        `settled from it. Deploying now would retroactively charge a week that closed before the clock was ` +
        `visible. Move the literal to the next future Thursday 13:00 UTC, revalidate and re-run preflight.`,
      daysUntilBoundary,
    }
  }

  return {
    ok: true,
    verdict: "READY_TO_ACTIVATE",
    detail: `boundary ${activationStart.toISOString()} is ${daysUntilBoundary} day(s) away - safe to deploy`,
    daysUntilBoundary,
  }
}
