import type { PlayerPosition } from "./positions"

export type PositionFit = "natural" | "secondary" | "unsuitable"

export interface SuitabilityPlayer {
  primaryPosition: string
  secondaryPositions: string[]
}

/**
 * Whether a specific player suits a specific position - based on that
 * player's own primaryPosition/secondaryPositions, not a generic per-position
 * lookup table. Two CBs can have different secondary positions; this is what
 * lets that show up.
 */
export function calculatePositionSuitability(player: SuitabilityPlayer, position: PlayerPosition): PositionFit {
  if (player.primaryPosition === position) return "natural"
  if (player.secondaryPositions.includes(position)) return "secondary"
  return "unsuitable"
}
