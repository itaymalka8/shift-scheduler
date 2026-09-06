/**
 * THE SALARY AUTHORITY - what a player earns, and which of the two eras of
 * this game decided it.
 *
 * There are exactly two wage functions in this codebase and they are both
 * here. `calculateUncompressedPlayerSalary` is the shape: the pre-Phase-3R
 * curve, still authoritative before the activation boundary, and still the
 * input the calibrated curve compresses. `calculatePhase3RSalary` is that
 * shape with the approved Phase 3R curve applied. Nothing else may price a
 * player - and after activation, `calculateAuthoritativeSalary` is the only
 * entry point any writer should be calling.
 *
 * THE INPUTS ARE CLOSED AND THEY ARE THE POINT. Every function here reads
 * exactly four columns - overall, age, potential, primaryPosition - and never
 * the player's current weeklySalary. That is what makes repricing a pure
 * function of state it does not itself modify, and therefore idempotent: a
 * retry after a crash and a retry after a redeploy are the same call with the
 * same answer. A wage derived from a wage would compound on every retry, and
 * would be unrecoverable because no salary history is persisted anywhere.
 */
import { DEFAULT_SALARY_CONFIG, PHASE_3R_ACTIVATION_START, type SalaryConfig } from "./config"
import { economyEraAt } from "./activation"
import { applyCalibratedSalaryCurve } from "./salary-curve"
import { POSITION_TO_BROAD_GROUP } from "@/lib/players/config"
import { isPlayerPosition } from "@/lib/players/positions"

export interface SalaryPlayer {
  overall: number
  age: number
  potential: number
  primaryPosition: string
}

/** Which era priced a player at `at`. */
export type SalaryAuthority = "legacy" | "phase3r"

/**
 * THE ERA SWITCH, delegated rather than restated.
 *
 * Salary does not get its own boundary: Phase 3R was calibrated as one
 * economy, so the wage curve turns on at exactly the instant the sponsor,
 * maintenance and attendance models do. Reimplementing the comparison here
 * would create a second copy that a future edit could move independently -
 * which is the mixed-authority period the activation design forbids.
 */
export function salaryAuthorityAt(at: Date, activationStart: Date = PHASE_3R_ACTIVATION_START): SalaryAuthority {
  return economyEraAt(at, activationStart)
}

/**
 * The wage curve as it stood before Phase 3R - dominated by Overall, nudged
 * by age (a prime-career premium, a discount for the very young or the
 * aging), a small potential-gap bonus, and a position multiplier.
 *
 * Still authoritative before the activation boundary, and still meaningful
 * after it: this is the UNCOMPRESSED wage the calibrated curve takes as its
 * input, which is why it is exported under a name that says so rather than
 * being buried as a private helper.
 */
export function calculateUncompressedPlayerSalary(
  player: SalaryPlayer,
  config: SalaryConfig = DEFAULT_SALARY_CONFIG
): number {
  const band =
    config.overallBands.find((b) => player.overall >= b.min && player.overall <= b.max) ??
    config.overallBands[config.overallBands.length - 1]
  const bandRatio = band.max > band.min ? (player.overall - band.min) / (band.max - band.min) : 1
  const base = band.salaryMin + bandRatio * (band.salaryMax - band.salaryMin)

  const ageBand = config.ageCurve.find((b) => player.age <= b.maxAge) ?? config.ageCurve[config.ageCurve.length - 1]
  const ageModifier = ageBand.multiplier

  const potentialGap = Math.max(0, player.potential - player.overall)
  const potentialModifier = 1 + potentialGap * config.potentialGapWeight

  const group = isPlayerPosition(player.primaryPosition) ? POSITION_TO_BROAD_GROUP[player.primaryPosition] : "MF"
  const positionModifier = config.positionMultiplier[group]

  const raw = base * ageModifier * potentialModifier * positionModifier
  return Math.max(config.minSalary, Math.round(raw / config.roundingUnit) * config.roundingUnit)
}

/**
 * The calibrated Phase 3R wage: the uncompressed shape, compressed and
 * levelled by the approved constants. This is the exact composition the
 * economic proof simulated - the curve is applied to the FINISHED wage, after
 * the age, potential and position modifiers, because that is what was
 * measured. See salary-curve.ts for why it cannot instead be folded into the
 * band table.
 */
export function calculatePhase3RSalary(player: SalaryPlayer, config: SalaryConfig = DEFAULT_SALARY_CONFIG): number {
  return applyCalibratedSalaryCurve(calculateUncompressedPlayerSalary(player, config))
}

/**
 * THE ONE ENTRY POINT EVERY WRITER USES.
 *
 * `at` is the instant the wage is being decided for - a settlement boundary,
 * or `new Date()` for a player being created right now. It is a required
 * argument on purpose: a default would let a caller silently price a player
 * against the wrong era, and "which era" is the single thing this function
 * exists to answer.
 */
export function calculateAuthoritativeSalary(
  player: SalaryPlayer,
  at: Date,
  config: SalaryConfig = DEFAULT_SALARY_CONFIG,
  activationStart: Date = PHASE_3R_ACTIVATION_START
): number {
  return salaryAuthorityAt(at, activationStart) === "phase3r"
    ? calculatePhase3RSalary(player, config)
    : calculateUncompressedPlayerSalary(player, config)
}
