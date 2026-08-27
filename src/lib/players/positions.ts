export type PlayerPosition = "GK" | "CB" | "RB" | "LB" | "CDM" | "CM" | "CAM" | "RM" | "LM" | "RW" | "LW" | "ST"

export const PLAYER_POSITIONS: PlayerPosition[] = [
  "GK", "CB", "RB", "LB", "CDM", "CM", "CAM", "RM", "LM", "RW", "LW", "ST",
]

export type PositionGroup = "GK" | "DF" | "MF" | "FW"

export const POSITION_GROUP: Record<PlayerPosition, PositionGroup> = {
  GK: "GK",
  CB: "DF",
  RB: "DF",
  LB: "DF",
  CDM: "MF",
  CM: "MF",
  CAM: "MF",
  RM: "MF",
  LM: "MF",
  RW: "FW",
  LW: "FW",
  ST: "FW",
}

// A player's "secondary" positions - reasonable to field there without being
// their specialty. Anything not natural and not listed here is unsuitable.
export const SECONDARY_POSITIONS: Record<PlayerPosition, PlayerPosition[]> = {
  GK: [],
  CB: ["RB", "LB", "CDM"],
  RB: ["CB", "RM"],
  LB: ["CB", "LM"],
  CDM: ["CB", "CM"],
  CM: ["CDM", "CAM"],
  CAM: ["CM", "ST"],
  RM: ["RB", "RW"],
  LM: ["LB", "LW"],
  RW: ["RM", "ST"],
  LW: ["LM", "ST"],
  ST: ["RW", "LW", "CAM"],
}

export type PositionFit = "natural" | "secondary" | "unsuitable"

export function getPositionFit(natural: PlayerPosition, slot: PlayerPosition): PositionFit {
  if (natural === slot) return "natural"
  if (SECONDARY_POSITIONS[natural]?.includes(slot)) return "secondary"
  return "unsuitable"
}

export function isPlayerPosition(value: string | null | undefined): value is PlayerPosition {
  return !!value && (PLAYER_POSITIONS as string[]).includes(value)
}
