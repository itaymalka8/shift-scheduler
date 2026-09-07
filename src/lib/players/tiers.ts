import { PLAYER_TIERS, type PlayerTierConfig, type PlayerTierId } from "./config"

/** Looks up which tier an overall rating falls into - the single source of truth for tier thresholds. */
export function getPlayerTier(overall: number): PlayerTierConfig {
  const tier = PLAYER_TIERS.find((t) => overall >= t.min && overall <= t.max)
  return tier ?? PLAYER_TIERS[0]
}

export function getPlayerTierId(overall: number): PlayerTierId {
  return getPlayerTier(overall).id
}

export type FitnessLevel = "excellent" | "good" | "average" | "low"

/** Fitness is shown to players as a qualitative label, not a raw number. */
export function getFitnessLevel(fitness: number): FitnessLevel {
  if (fitness >= 90) return "excellent"
  if (fitness >= 70) return "good"
  if (fitness >= 45) return "average"
  return "low"
}

export type PlayerStatus = "available" | "injured" | "suspended" | "unavailable"

export function isPlayerStatus(value: string | null | undefined): value is PlayerStatus {
  return value === "available" || value === "injured" || value === "suspended" || value === "unavailable"
}

// The 6 states a user actually sees: the 4 intrinsic ones stored on the
// player, plus "starting"/"bench" which only exist relative to the current
// lineup - never stored (a lineup change would instantly make a stored value
// stale), always derived here from LineupSlot membership.
export type DisplayPlayerStatus = "starting" | "bench" | PlayerStatus

export function getDisplayStatus(status: PlayerStatus, isInStartingLineup: boolean): DisplayPlayerStatus {
  if (status !== "available") return status
  return isInStartingLineup ? "starting" : "bench"
}
