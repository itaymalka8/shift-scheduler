import type { PlayerPosition } from "./positions"
import type { PlayerAttributes } from "./attributes"
import { POSITION_ATTRIBUTE_WEIGHTS } from "./position-weights"

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * A weighted average of attributes for a specific position - not
 * necessarily the player's own primary position. This is what makes
 * "Overall in a different position" possible without a second code path:
 * calculatePlayerOverall is just this called with the player's own
 * primaryPosition.
 */
export function calculatePositionOverall(attributes: PlayerAttributes, position: PlayerPosition): number {
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position]
  let weightedSum = 0
  let totalWeight = 0

  for (const [key, weight] of Object.entries(weights)) {
    const value = attributes[key as keyof PlayerAttributes]
    if (value == null) continue
    weightedSum += value * weight
    totalWeight += weight
  }

  if (totalWeight === 0) return 1
  return Math.round(clamp(weightedSum / totalWeight, 1, 100))
}

/**
 * Overall is never an independently-set number - it's always this,
 * calculated from a player's own attributes and natural position. Where
 * it's cached on the Player row (for read performance), that cache must be
 * recomputed here every time an attribute changes, never edited directly.
 */
export function calculatePlayerOverall(player: { primaryPosition: string } & PlayerAttributes): number {
  const position = (player.primaryPosition in POSITION_ATTRIBUTE_WEIGHTS ? player.primaryPosition : "CM") as PlayerPosition
  return calculatePositionOverall(player, position)
}
