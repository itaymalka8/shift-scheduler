import type { AttributeKey, PlayerAttributes } from "@/lib/players/attributes"

/**
 * Attributes that go into a shooting/scoring situation - shared by the
 * team-strength model below and, later, any finer-grained shot-by-shot
 * engine (per the product spec: "ביצירת בעיטה: Shooting, Finishing,
 * Composure, PositioningAttack, Technique").
 */
export const ATTACK_ATTRIBUTE_WEIGHTS: Partial<Record<AttributeKey, number>> = {
  finishing: 20,
  shooting: 15,
  attackingPositioning: 15,
  composure: 10,
  technique: 10,
  dribbling: 10,
  pace: 8,
  crossing: 7,
  heading: 5,
}

/** Attributes that go into winning the ball back / stopping an attack. */
export const DEFENSE_ATTRIBUTE_WEIGHTS: Partial<Record<AttributeKey, number>> = {
  tackling: 20,
  marking: 18,
  defensivePositioning: 18,
  interceptions: 15,
  aerialDuels: 12,
  concentration: 10,
  strength: 7,
}

function weightedAverage(attributes: PlayerAttributes, weights: Partial<Record<AttributeKey, number>>, fallback: number): number {
  let sum = 0
  let totalWeight = 0
  for (const [key, weight] of Object.entries(weights)) {
    const value = attributes[key as AttributeKey]
    if (value == null || weight == null) continue
    sum += value * weight
    totalWeight += weight
  }
  return totalWeight > 0 ? sum / totalWeight : fallback
}

/**
 * How much a player contributes to their team's attack - built from the
 * attributes that actually matter for creating and finishing chances, not
 * a flat Overall. A defender and a striker with the same Overall produce
 * very different attack ratings, because their underlying attributes are
 * different - this is what makes attributes actually change how the team
 * plays, not just what number appears on a card.
 */
export function calculatePlayerAttackRating(player: PlayerAttributes & { overall?: number }): number {
  return weightedAverage(player, ATTACK_ATTRIBUTE_WEIGHTS, player.overall ?? 50)
}

/** The defensive equivalent of calculatePlayerAttackRating. */
export function calculatePlayerDefenseRating(player: PlayerAttributes & { overall?: number }): number {
  return weightedAverage(player, DEFENSE_ATTRIBUTE_WEIGHTS, player.overall ?? 50)
}

// --- Tactic <-> attribute synergy --------------------------------------------

export interface TacticSynergyConfig {
  baseline: number
  maxBonus: number
}

export const DEFAULT_TACTIC_SYNERGY_CONFIG: TacticSynergyConfig = { baseline: 60, maxBonus: 0.15 }

/**
 * Turns a squad's average value in some attribute set into a multiplier
 * around 1.0 - a team that actually has the attributes a tactic calls for
 * gets a real bonus from it; a team that doesn't gets little or nothing.
 * Overall itself is never touched by tactics - this only affects in-match
 * performance, per the product spec.
 */
export function calculateTacticSynergyMultiplier(
  averageAttributeValue: number,
  config: TacticSynergyConfig = DEFAULT_TACTIC_SYNERGY_CONFIG
): number {
  const raw = 1 + (averageAttributeValue - config.baseline) / 100
  return Math.max(1 - config.maxBonus, Math.min(1 + config.maxBonus, raw))
}

// Width="wide" rewards these attributes on attack (per spec: "משחק אגפים
// צריך לתת משמעות גבוהה יותר ל: Crossing, Pace, Dribbling, Heading").
export const WIDTH_SYNERGY_ATTRIBUTES: AttributeKey[] = ["crossing", "pace", "dribbling", "heading"]

// Pressing="high" rewards these attributes on both sides of the ball (per
// spec: "לחץ גבוה צריך לתת משמעות גבוהה יותר ל: Stamina, WorkRate, Pace,
// Teamwork, Anticipation").
export const PRESSING_SYNERGY_ATTRIBUTES: AttributeKey[] = ["stamina", "workRate", "pace", "teamwork", "anticipation"]

export function averageAttribute(playersAttributes: PlayerAttributes[], keys: AttributeKey[]): number {
  const values = playersAttributes.flatMap((attrs) => keys.map((k) => attrs[k]).filter((v): v is number => v != null))
  if (values.length === 0) return DEFAULT_TACTIC_SYNERGY_CONFIG.baseline
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
