import { SeededRandom } from "@/lib/match/engine/rng"
import { POSITION_ATTRIBUTE_WEIGHTS } from "@/lib/players/position-weights"
import { isPlayerPosition, type PlayerPosition } from "@/lib/players/positions"
import { calculatePositionOverall } from "@/lib/players/overall"
import type { AttributeKey, PlayerAttributes } from "@/lib/players/attributes"

/**
 * How much Overall a player can gain in one season, by the age they are
 * BEFORE that season's aging step. These are TARGET OVERALL GROWTH values,
 * not counts of attribute increments - the attribute bumps below are only
 * the means of reaching the target.
 *
 * The last band (26+) is 0/0 on purpose: this V1 has no decline curve, so an
 * older player simply stops improving rather than losing attributes.
 */
export interface DevelopmentGrowthBand {
  maxAge: number
  minGrowth: number
  maxGrowth: number
}

export const DEVELOPMENT_GROWTH_BANDS: DevelopmentGrowthBand[] = [
  { maxAge: 19, minGrowth: 1, maxGrowth: 4 },
  { maxAge: 22, minGrowth: 1, maxGrowth: 3 },
  { maxAge: 25, minGrowth: 0, maxGrowth: 2 },
  { maxAge: Number.POSITIVE_INFINITY, minGrowth: 0, maxGrowth: 0 },
]

export function growthBandForAge(age: number): DevelopmentGrowthBand {
  return DEVELOPMENT_GROWTH_BANDS.find((band) => age <= band.maxAge) ?? DEVELOPMENT_GROWTH_BANDS[DEVELOPMENT_GROWTH_BANDS.length - 1]
}

/**
 * Bounds the attribute-bump loop. Raising EVERY position-relevant attribute
 * by +1 raises the weighted average - and therefore Overall - by exactly +1,
 * so `relevantCount * gap` bumps is what a perfectly even spread would need.
 * Weighted random doesn't spread evenly, but it draws high-weight attributes
 * more often, and those move Overall faster than the even spread does; the
 * safety factor covers the unlucky clustering case. Measured against the
 * real weight tables the expected cost is ~8-11 bumps per Overall point
 * against a `relevantCount` of 11-14, so this bound sits roughly 4-5x above
 * what a run actually consumes - high enough that it never truncates growth
 * short of the target, while still guaranteeing termination.
 */
export const DEVELOPMENT_MAX_STEPS_SAFETY_FACTOR = 4

export function developmentSeed(playerId: string, seasonNumber: number): string {
  return `${playerId}-${seasonNumber}-development`
}

export function retirementSeed(playerId: string, seasonNumber: number): string {
  return `${playerId}-${seasonNumber}-retirement`
}

function resolvePosition(primaryPosition: string): PlayerPosition {
  return isPlayerPosition(primaryPosition) ? primaryPosition : "CM"
}

export interface DevelopPlayerInput {
  /** Age BEFORE this season's aging step - the growth band is read from it. */
  age: number
  potential: number
  primaryPosition: string
  attributes: PlayerAttributes
}

export interface DevelopPlayerResult {
  /** Recomputed from `attributes`, never carried over from Player.overall. */
  currentOverall: number
  rolledGrowth: number
  targetOverall: number
  /** The full attribute set after development (a copy - the input is not mutated). */
  attributes: PlayerAttributes
  /** Only the attributes that actually moved, ready to spread into an update. */
  changed: Partial<Record<AttributeKey, number>>
  /** Derived from `attributes` via the shared calculator - never accumulated. */
  overall: number
  bumps: number
}

/**
 * One season of growth for one player, driven entirely by `rng` so the same
 * player in the same season always develops identically (see
 * developmentSeed). Overall is never incremented: every step raises a single
 * position-relevant attribute by +1 and then re-derives Overall through the
 * same calculatePositionOverall the rest of the game reads, so the returned
 * overall is always exactly what the returned attributes grade out at.
 *
 * Attribute choice is weighted random over POSITION_ATTRIBUTE_WEIGHTS for the
 * player's own primary position - a striker's Finishing is far likelier to
 * improve than their Leadership, and an attribute the position doesn't weight
 * at all is never touched. Attributes that are null (not applicable to the
 * position) or already at 100 are excluded from the draw rather than
 * consuming a step, so a nearly-maxed player still spends every step on a
 * bump that counts.
 */
export function developPlayer(input: DevelopPlayerInput, rng: SeededRandom): DevelopPlayerResult {
  const position = resolvePosition(input.primaryPosition)
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position]
  const relevantKeys = Object.keys(weights) as AttributeKey[]

  const attributes: PlayerAttributes = { ...input.attributes }
  const changed: Partial<Record<AttributeKey, number>> = {}

  const currentOverall = calculatePositionOverall(attributes, position)

  const band = growthBandForAge(input.age)
  const rolledGrowth = band.maxGrowth > 0 ? rng.int(band.minGrowth, band.maxGrowth) : 0
  const targetOverall = Math.min(input.potential, currentOverall + rolledGrowth)

  // Both stop conditions in one ceiling: targetOverall is already capped by
  // potential above, so `overall >= ceiling` covers "reached the target" and
  // "reached potential" alike.
  const ceiling = Math.min(targetOverall, input.potential)
  if (ceiling <= currentOverall) {
    return { currentOverall, rolledGrowth, targetOverall, attributes, changed, overall: currentOverall, bumps: 0 }
  }

  const maxSteps = relevantKeys.length * (ceiling - currentOverall) * DEVELOPMENT_MAX_STEPS_SAFETY_FACTOR
  let overall = currentOverall
  let bumps = 0

  while (bumps < maxSteps && overall < ceiling) {
    const eligible = relevantKeys.filter((key) => {
      const value = attributes[key]
      return typeof value === "number" && value < 100
    })
    // Every position-relevant attribute is maxed - no further growth is
    // reachable no matter how many steps are left.
    if (eligible.length === 0) break

    const key = rng.pickWeighted(eligible, (candidate) => weights[candidate] ?? 0)
    const next = (attributes[key] as number) + 1
    attributes[key] = next
    changed[key] = next
    bumps++
    overall = calculatePositionOverall(attributes, position)
  }

  return { currentOverall, rolledGrowth, targetOverall, attributes, changed, overall, bumps }
}

/**
 * Chance of retiring at a given age, evaluated on the age a player has AFTER
 * that season's aging step. Below 34 nobody retires; from 40 it is certain.
 */
export const RETIREMENT_PROBABILITY_BY_AGE: Record<number, number> = {
  34: 0.08,
  35: 0.15,
  36: 0.25,
  37: 0.4,
  38: 0.65,
  39: 0.85,
}

export const RETIREMENT_CERTAIN_AGE = 40

export function retirementProbability(age: number): number {
  if (age >= RETIREMENT_CERTAIN_AGE) return 1
  return RETIREMENT_PROBABILITY_BY_AGE[age] ?? 0
}

/**
 * Uses its own RNG, seeded separately from development (see retirementSeed),
 * so re-running a season reproduces the same retirement outcome even if the
 * development draw ever changes shape.
 */
export function rollRetirement(age: number, rng: SeededRandom): boolean {
  const probability = retirementProbability(age)
  if (probability <= 0) return false
  if (probability >= 1) return true
  return rng.chance(probability)
}
