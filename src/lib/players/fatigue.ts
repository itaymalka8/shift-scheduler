import type { PlayerAttributes } from "./attributes"
import { calculatePositionOverall } from "./overall"
import type { PlayerPosition } from "./positions"

export interface FatigueConfig {
  // At 0 fitness, an attribute is scaled down to this fraction of its base
  // value; at 100 fitness, the full value applies. Linear in between.
  fitnessFloor: number
  // Stamina reduces how much fitness loss actually costs a player - high
  // Stamina players hold their attributes better at the same fitness level.
  staminaProtection: number
}

export const DEFAULT_FATIGUE_CONFIG: FatigueConfig = {
  fitnessFloor: 0.75,
  staminaProtection: 0.3,
}

/**
 * A single attribute's in-match value once fitness (and the player's own
 * Stamina, which blunts some of the drop-off) are accounted for - the
 * stored attribute itself never changes, this is purely a read-time view
 * for the match engine.
 */
export function calculateEffectiveAttribute(
  baseValue: number,
  fitness: number,
  stamina: number | null | undefined,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG
): number {
  const fitnessRatio = Math.max(0, Math.min(100, fitness)) / 100
  const staminaRatio = Math.max(0, Math.min(100, stamina ?? 50)) / 100

  // A high-Stamina player recovers part of the fitness penalty - at full
  // Stamina, up to staminaProtection of the drop is clawed back.
  const protectedRatio = fitnessRatio + (1 - fitnessRatio) * staminaRatio * config.staminaProtection
  const floorAdjusted = config.fitnessFloor + (1 - config.fitnessFloor) * protectedRatio

  return Math.round(baseValue * floorAdjusted)
}

/** Every attribute run through calculateEffectiveAttribute - the fatigued version of a player's whole profile. */
export function calculateEffectiveAttributes(
  attributes: PlayerAttributes,
  fitness: number,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG
): PlayerAttributes {
  const stamina = attributes.stamina
  const effective: PlayerAttributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    effective[key as keyof PlayerAttributes] = value == null ? null : calculateEffectiveAttribute(value, fitness, stamina, config)
  }
  return effective
}

/**
 * Overall recomputed from fatigued attributes, for the match engine only -
 * the player's real (stored) Overall never changes because of fitness.
 */
export function calculateEffectiveOverall(
  player: { primaryPosition: string } & PlayerAttributes,
  fitness: number,
  config: FatigueConfig = DEFAULT_FATIGUE_CONFIG
): number {
  const position = (player.primaryPosition as PlayerPosition) ?? "CM"
  const effectiveAttributes = calculateEffectiveAttributes(player, fitness, config)
  return calculatePositionOverall(effectiveAttributes, position)
}
