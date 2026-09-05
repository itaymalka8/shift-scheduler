import type { PlayerPosition } from "./positions"
import type { AttributeKey, PlayerAttributes } from "./attributes"

/**
 * How much each attribute counts toward Overall, per granular position -
 * the single source of truth calculatePlayerOverall reads from. Never
 * duplicated or re-derived in UI code. Weights are percentage points and
 * sum to 100 per position (calculatePositionOverall normalizes anyway, so a
 * future rebalance doesn't have to hit 100 exactly).
 *
 * CB/CM/ST/GK and the wide positions (RB/LB as fullback, RW/LW as winger)
 * come straight from the product spec's own worked examples. CDM, CAM, and
 * RM/LM aren't given explicit examples there, so they're built as
 * deliberate blends of their nearest neighbors: CDM leans CM-toward-CB,
 * CAM leans CM-toward-ST, RM/LM lean winger-toward-CM (more defensively
 * involved than a RW/LW, less advanced).
 */
export const POSITION_ATTRIBUTE_WEIGHTS: Record<PlayerPosition, Partial<Record<AttributeKey, number>>> = {
  GK: {
    reflexes: 18,
    goalkeeperPositioning: 16,
    handling: 14,
    diving: 12,
    oneOnOne: 10,
    aerialAbility: 8,
    penaltySaving: 5,
    distribution: 5,
    composure: 5,
    concentration: 4,
    leadership: 3,
  },
  CB: {
    defensivePositioning: 16,
    marking: 14,
    tackling: 14,
    aerialDuels: 10,
    strength: 10,
    anticipation: 8,
    concentration: 7,
    jumping: 6,
    pace: 5,
    passing: 4,
    composure: 3,
    leadership: 3,
  },
  RB: {
    defensivePositioning: 12,
    tackling: 11,
    marking: 10,
    pace: 10,
    stamina: 9,
    crossing: 9,
    acceleration: 7,
    interceptions: 8,
    passing: 6,
    teamwork: 5,
    strength: 5,
    technique: 4,
    anticipation: 4,
  },
  LB: {
    defensivePositioning: 12,
    tackling: 11,
    marking: 10,
    pace: 10,
    stamina: 9,
    crossing: 9,
    acceleration: 7,
    interceptions: 8,
    passing: 6,
    teamwork: 5,
    strength: 5,
    technique: 4,
    anticipation: 4,
  },
  CDM: {
    tackling: 14,
    interceptions: 13,
    defensivePositioning: 13,
    passing: 10,
    marking: 8,
    strength: 8,
    anticipation: 7,
    stamina: 7,
    concentration: 6,
    teamwork: 6,
    composure: 4,
    vision: 4,
  },
  CM: {
    passing: 16,
    vision: 14,
    technique: 10,
    ballControl: 9,
    decisions: 9,
    stamina: 8,
    teamwork: 7,
    anticipation: 6,
    interceptions: 5,
    defensivePositioning: 4,
    dribbling: 4,
    composure: 4,
    leadership: 2,
    strength: 2,
  },
  CAM: {
    vision: 15,
    passing: 14,
    technique: 12,
    dribbling: 10,
    ballControl: 9,
    decisions: 8,
    shooting: 7,
    composure: 7,
    anticipation: 6,
    teamwork: 5,
    agility: 4,
    finishing: 3,
  },
  RM: {
    crossing: 10,
    pace: 10,
    dribbling: 10,
    passing: 10,
    stamina: 9,
    technique: 8,
    ballControl: 8,
    acceleration: 7,
    defensivePositioning: 6,
    tackling: 5,
    vision: 5,
    teamwork: 5,
    interceptions: 4,
    anticipation: 3,
  },
  LM: {
    crossing: 10,
    pace: 10,
    dribbling: 10,
    passing: 10,
    stamina: 9,
    technique: 8,
    ballControl: 8,
    acceleration: 7,
    defensivePositioning: 6,
    tackling: 5,
    vision: 5,
    teamwork: 5,
    interceptions: 4,
    anticipation: 3,
  },
  RW: {
    pace: 14,
    acceleration: 12,
    dribbling: 14,
    crossing: 12,
    technique: 10,
    ballControl: 9,
    passing: 7,
    vision: 5,
    shooting: 5,
    finishing: 4,
    agility: 4,
    stamina: 4,
  },
  LW: {
    pace: 14,
    acceleration: 12,
    dribbling: 14,
    crossing: 12,
    technique: 10,
    ballControl: 9,
    passing: 7,
    vision: 5,
    shooting: 5,
    finishing: 4,
    agility: 4,
    stamina: 4,
  },
  ST: {
    finishing: 18,
    shooting: 12,
    attackingPositioning: 12,
    composure: 9,
    heading: 8,
    pace: 8,
    acceleration: 6,
    ballControl: 7,
    technique: 6,
    strength: 5,
    dribbling: 4,
    anticipation: 3,
    leadership: 1,
    teamwork: 1,
  },
}

export interface AttributeHighlight {
  key: AttributeKey
  value: number
}

/**
 * The `count` attributes that matter most for a position, by weight - a
 * derivation from POSITION_ATTRIBUTE_WEIGHTS, never a second mapping.
 * Used wherever a compact "headline attributes" view is needed (a youth
 * prospect card showing 3-4 stats instead of all 47). Skips any attribute
 * that's null for this player - a goalkeeper's outfield-only weights, or
 * vice versa - rather than surfacing a placeholder for a field that
 * genuinely doesn't apply to their role.
 */
export function topAttributesForPosition(
  position: PlayerPosition,
  attributes: PlayerAttributes,
  count: number
): AttributeHighlight[] {
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position]
  return (Object.keys(weights) as AttributeKey[])
    .filter((key): key is AttributeKey => typeof attributes[key] === "number")
    .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))
    .slice(0, count)
    .map((key) => ({ key, value: attributes[key] as number }))
}
