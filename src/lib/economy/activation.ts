/**
 * THE PHASE 3R ACTIVATION AUTHORITY - one instant, one answer, for every
 * subsystem the calibrated economy touches.
 *
 * Phase 3R is not four independent switches that happen to share a date. The
 * salary curve, the one-time repricing, weekly sponsor income, weekly stadium
 * maintenance and the attendance model were calibrated TOGETHER, as one
 * economy, and they were proven together. Turning one on without the others
 * would be running a model nobody simulated - a compressed wage bill with no
 * sponsor to pay it, or a sponsor funding wages that were never compressed.
 * So there is exactly one era function and everything asks it.
 *
 * IT IS PURE. No database read, no deploy timestamp, no environment variable,
 * no feature flag row - just a comparison against a committed literal. That is
 * what lets a web request, a cron tick and a test all reach the same answer
 * for the same instant without coordinating, and it is why the boundary cannot
 * be moved by anything other than a reviewed code change with a diff.
 *
 * THE ARGUMENT IS THE ECONOMIC INSTANT BEING SETTLED, NOT "NOW". A weekly
 * settlement that runs late is settling ITS OWN boundary instant, and must be
 * judged against the era that instant belonged to. Passing `new Date()` there
 * would let a delayed cron tick decide history.
 */
import { PHASE_3R_ACTIVATION_START } from "./config"

export type EconomyEra = "legacy" | "phase3r"

/** Which economy governs `at`. The boundary instant itself is already Phase 3R. */
export function economyEraAt(at: Date, activationStart: Date = PHASE_3R_ACTIVATION_START): EconomyEra {
  return at.getTime() >= activationStart.getTime() ? "phase3r" : "legacy"
}

/** Convenience for the many call sites that only need the boolean. */
export function phase3rIsActive(at: Date, activationStart: Date = PHASE_3R_ACTIVATION_START): boolean {
  return economyEraAt(at, activationStart) === "phase3r"
}

/**
 * Has the boundary already passed?
 *
 * The deploy that ships Phase 3R MUST land while this is false. Deploying
 * after it had passed would mean the very first tick settles a sponsor week
 * and a maintenance week that closed before anybody could observe the new
 * behaviour - a retroactive charge by accident, which is the single thing the
 * start-line design exists to prevent. `prod:economy:activation` fails closed
 * on exactly this, and the rule when a deploy slips is NOT to catch up: move
 * the boundary to the next payroll boundary through a reviewed code change and
 * deploy again.
 */
export function phase3rBoundaryHasPassed(now: Date, activationStart: Date = PHASE_3R_ACTIVATION_START): boolean {
  return now.getTime() >= activationStart.getTime()
}
