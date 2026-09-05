import type { AttributeKey } from "@/lib/players/attributes"
import { calculatePositionSuitability } from "@/lib/players/suitability"
import type { PlayerPosition } from "@/lib/players/positions"
import type { GameBalanceConfig } from "./config"
import type { SnapshotPlayer } from "./snapshot"

/** A player's live, in-match state - everything that changes as the match runs. */
export interface LivePlayer {
  snapshot: SnapshotPlayer
  /** 0..1, starts from fitness and drains as the match goes on. */
  energy: number
  onPitch: boolean
  minutesPlayed: number
  yellowCards: number
  sentOff: boolean
  injured: boolean
  /** The slot role they're currently filling (can change on a substitution). */
  currentRole: PlayerPosition | null
}

export interface EffectiveContext {
  /** Team-wide multiplier from crowd, momentum, captain, home advantage, etc. */
  teamMultiplier: number
  config: GameBalanceConfig
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * How much a player is degraded by being played out of position. Uses their
 * OWN secondary positions (not a generic table), so a versatile player
 * genuinely suffers less than a specialist asked to do the same job.
 */
export function positionMismatchMultiplier(player: SnapshotPlayer, role: PlayerPosition | null, config: GameBalanceConfig): number {
  if (!role) return 1
  const fit = calculatePositionSuitability(
    { primaryPosition: player.primaryPosition, secondaryPositions: player.secondaryPositions },
    role
  )
  if (fit === "natural") return 1
  if (fit === "secondary") return 1 - config.maxPositionMismatchPenalty * 0.35
  return 1 - config.maxPositionMismatchPenalty
}

/** Fatigue multiplier - Stamina blunts part of the loss, so it's a real attribute choice. */
export function fatigueMultiplier(live: LivePlayer, config: GameBalanceConfig): number {
  const stamina = (live.snapshot.attributes.stamina ?? 50) / 100
  const energyLoss = 1 - clamp(live.energy, 0, 1)
  const protectedLoss = energyLoss * (1 - stamina * config.staminaEnergyProtection)
  return 1 - protectedLoss * config.maxFatiguePenalty
}

/**
 * The value the engine actually uses for an attribute in a given moment.
 * Never the raw stored number: fatigue, position mismatch, and the team's
 * situational multiplier (crowd/momentum/home/captain) all apply first.
 */
export function effectiveAttribute(
  live: LivePlayer,
  key: AttributeKey,
  context: EffectiveContext,
  fallback = 45
): number {
  const base = live.snapshot.attributes[key] ?? fallback
  const value =
    base *
    fatigueMultiplier(live, context.config) *
    positionMismatchMultiplier(live.snapshot, live.currentRole, context.config) *
    context.teamMultiplier
  return clamp(value, 1, 100)
}

/** A weighted blend of several effective attributes - the standard way the engine scores an action. */
export function effectiveWeighted(
  live: LivePlayer,
  weights: Partial<Record<AttributeKey, number>>,
  context: EffectiveContext,
  fallback = 45
): number {
  let sum = 0
  let totalWeight = 0
  for (const [key, weight] of Object.entries(weights)) {
    if (weight == null) continue
    sum += effectiveAttribute(live, key as AttributeKey, context, fallback) * weight
    totalWeight += weight
  }
  return totalWeight > 0 ? sum / totalWeight : fallback
}

/** The same blend across a group of players (e.g. the whole back line). */
export function groupEffectiveWeighted(
  players: LivePlayer[],
  weights: Partial<Record<AttributeKey, number>>,
  context: EffectiveContext,
  fallback = 45
): number {
  if (players.length === 0) return fallback
  return players.reduce((sum, p) => sum + effectiveWeighted(p, weights, context, fallback), 0) / players.length
}

/**
 * Turns two opposing ratings into the probability that the attacking side
 * wins this duel. A better player wins more often but never always, and a
 * weaker one always keeps a real chance - that's what lets an upset happen
 * without making quality meaningless. Callers roll against this themselves,
 * so a single RNG draw per event keeps the match deterministic and easy to
 * follow.
 */
export function contestProbability(
  attackerRating: number,
  defenderRating: number,
  baseChance: number,
  config: GameBalanceConfig
): number {
  const edge = (attackerRating - defenderRating) * config.contestSharpness
  return clamp(baseChance * (1 + edge / 20), 0.02, 0.97)
}

export { clamp }
