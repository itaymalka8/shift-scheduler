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

// The plausible secondary-position pool a generated player's primary position
// draws from (see generate.ts) - not consulted at runtime for suitability
// checks, since each player's own secondaryPositions (picked from this pool
// at generation time, and possibly edited later) is the real source of truth
// there - see calculatePositionSuitability in suitability.ts.
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

export function isPlayerPosition(value: string | null | undefined): value is PlayerPosition {
  return !!value && (PLAYER_POSITIONS as string[]).includes(value)
}
