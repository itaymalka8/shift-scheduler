import { DEFAULT_SALARY_CONFIG, type SalaryConfig } from "./config"
import { POSITION_TO_BROAD_GROUP } from "@/lib/players/config"
import { isPlayerPosition } from "@/lib/players/positions"

export interface SalaryPlayer {
  overall: number
  age: number
  potential: number
  primaryPosition: string
}

/**
 * A player's weekly wage - dominated by Overall, nudged by age (a prime-career
 * premium, a discount for the very young or the aging), a small potential-gap
 * bonus, and a position multiplier. Never shown as a formula to the user -
 * only the number matters to them - but every coefficient here is configurable
 * for a future balance pass.
 */
export function calculatePlayerSalary(player: SalaryPlayer, config: SalaryConfig = DEFAULT_SALARY_CONFIG): number {
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
