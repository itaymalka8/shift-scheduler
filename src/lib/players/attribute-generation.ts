import type { PlayerPosition } from "./positions"
import {
  OUTFIELD_ATTRIBUTES,
  GOALKEEPING_ATTRIBUTES,
  GOALKEEPER_SHARED_ATTRIBUTES,
  type AttributeKey,
  type PlayerAttributes,
} from "./attributes"
import { POSITION_ATTRIBUTE_WEIGHTS } from "./position-weights"
import { calculatePositionOverall } from "./overall"

export interface AttributeGenerationConfig {
  // Weighted (position-relevant) attributes are scattered around the target
  // overall - the most heavily-weighted attribute for a position varies the
  // least (minVariance), the least-weighted varies the most (maxVariance).
  minVariance: number
  maxVariance: number
  // Non-weighted "flavor" attributes: still plausible for the target
  // overall, but looser and skewed a bit below it - a player's specialty is
  // what the weights reward, everything else is just the rest of their game.
  flavorVarianceLow: number
  flavorVarianceHigh: number
  correctionPasses: number
}

export const DEFAULT_ATTRIBUTE_GENERATION_CONFIG: AttributeGenerationConfig = {
  minVariance: 6,
  maxVariance: 20,
  flavorVarianceLow: 25,
  flavorVarianceHigh: 8,
  correctionPasses: 6,
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Builds a full, internally-consistent attribute set for a position whose
 * DERIVED Overall (via calculatePositionOverall) lands on `targetOverall` -
 * never the other way around. Two players generated with the same position
 * and target overall will still look completely different underneath: each
 * weighted attribute gets its own real variance (scaled by how much that
 * attribute matters for the position - the most important one varies the
 * least), so a striker's Finishing and Pace can trade places between two
 * players who still grade out at the same Overall. A short correction pass
 * nudges the weighted attributes just enough to close the gap between the
 * scattered draw and the actual target, preserving the shape of the
 * player's profile rather than flattening it.
 */
export function generateAttributesForTargetOverall(
  position: PlayerPosition,
  targetOverall: number,
  config: AttributeGenerationConfig = DEFAULT_ATTRIBUTE_GENERATION_CONFIG
): PlayerAttributes {
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position]
  const weightedKeys = shuffle(Object.keys(weights) as AttributeKey[])
  const sortedByWeight = [...weightedKeys].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))

  const attributes: PlayerAttributes = {}

  sortedByWeight.forEach((key, i) => {
    const rank = sortedByWeight.length > 1 ? i / (sortedByWeight.length - 1) : 0
    const variance = config.minVariance + (config.maxVariance - config.minVariance) * rank
    attributes[key] = clamp(Math.round(targetOverall + randomInt(-variance, variance)), 1, 100)
  })

  for (let pass = 0; pass < config.correctionPasses; pass++) {
    const computed = calculatePositionOverall(attributes, position)
    const gap = targetOverall - computed
    if (gap === 0) break
    const share = gap / sortedByWeight.length
    for (const key of sortedByWeight) {
      attributes[key] = clamp(Math.round((attributes[key] ?? targetOverall) + share), 1, 100)
    }
  }

  const isGoalkeeper = position === "GK"
  const fullAttributeSet: AttributeKey[] = isGoalkeeper
    ? [...GOALKEEPING_ATTRIBUTES, ...GOALKEEPER_SHARED_ATTRIBUTES]
    : [...OUTFIELD_ATTRIBUTES]

  for (const key of fullAttributeSet) {
    if (attributes[key] != null) continue // already set as a weighted attribute above
    attributes[key] = clamp(Math.round(targetOverall + randomInt(-config.flavorVarianceLow, config.flavorVarianceHigh)), 1, 100)
  }

  return attributes
}
