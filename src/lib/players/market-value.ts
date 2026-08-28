import { DEFAULT_MARKET_VALUE_CONFIG, POSITION_TO_BROAD_GROUP, type MarketValueConfig } from "./config"
import { getPlayerTierId } from "./tiers"
import { isPlayerPosition } from "./positions"

export interface MarketValuePlayer {
  overall: number
  age: number
  potential: number
  primaryPosition: string
  fitness: number
}

/**
 * A player's market value from the factors the product spec calls for -
 * overall, age, potential (as a gap over overall - a young player with room
 * to grow is worth more than their current overall alone suggests), position,
 * and fitness. Every curve/weight lives in MarketValueConfig, so rebalancing
 * the game's economy never means touching this formula.
 */
export function calculatePlayerMarketValue(
  player: MarketValuePlayer,
  config: MarketValueConfig = DEFAULT_MARKET_VALUE_CONFIG
): number {
  const base = config.baseUnit * Math.pow(player.overall / config.baseOverall, config.exponent)

  const ageBand = config.ageCurveBands.find((b) => player.age <= b.maxAge) ?? config.ageCurveBands[config.ageCurveBands.length - 1]
  const ageFactor = ageBand.multiplier

  const potentialGap = Math.max(0, player.potential - player.overall)
  const potentialFactor = 1 + potentialGap * config.potentialGapWeight

  const broadGroup = isPlayerPosition(player.primaryPosition) ? POSITION_TO_BROAD_GROUP[player.primaryPosition] : "MF"
  const positionFactor = config.positionMultiplier[broadGroup]

  const tierFactor = config.tierMultiplier[getPlayerTierId(player.overall)]

  const fitnessFactor = config.fitnessFloor + (1 - config.fitnessFloor) * (player.fitness / 100)

  const raw = base * ageFactor * potentialFactor * positionFactor * tierFactor * fitnessFactor
  return Math.max(config.roundingUnit, Math.round(raw / config.roundingUnit) * config.roundingUnit)
}
