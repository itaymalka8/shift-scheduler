/**
 * THE CONTINUITY FALLBACK - the worst footballers in the world, generated on
 * purpose.
 *
 * A club that has lost players to retirement and has no academy intake left
 * to promote must still be able to fulfil its fixtures. This is what it gets:
 * enough bodies to satisfy the roster floor, and nothing more.
 *
 * ====================== IT IS NOT A REWARD, BY DESIGN =====================
 *
 * Overall 40-52 sits at or below the "low" tier a normal squad carries three
 * of, and below the midpoint of the youth band (45-70) - a promoted prospect
 * is almost always better on day one and always better by season three.
 *
 * POTENTIAL = OVERALL + 0..2 IS THE LOAD-BEARING ANTI-EXPLOIT LEVER.
 * player-development.ts has nothing to grow, and market value's
 * potentialGapWeight contributes essentially nothing, so this player is
 * worth less every season he exists. Deliberately gutting a squad to farm
 * these destroys far more value than it creates.
 *
 * Age 24-31 is chosen from both ends: not young, so there is no upside and
 * this is never a youth substitute; not 32+, so he does not retire within a
 * season or two and re-trigger the very fallback that made him.
 *
 * ========================== FULLY SEEDED ==================================
 *
 * Every draw comes from a SeededRandom keyed by (season, team, slot). No
 * Math.random touches this path - the primitives it composes
 * (generateAttributesForTargetOverall, generatePlayerName) already accept an
 * injectable source precisely so youth generation could be reproducible, and
 * this reuses that. Each decision draws from its OWN stream, keyed by what it
 * is for, for the same two reasons youth generation documents: independence
 * (a draw's offset must not depend on how many draws something earlier
 * consumed) and stability (adding a draw later must not re-roll everything
 * after it).
 */
import { SeededRandom } from "@/lib/match/engine/rng"
import { generateAttributesForTargetOverall } from "./attribute-generation"
import { convergeToTargetOverall } from "./overall-converge"
import { generatePlayerName } from "./names"
import { calculatePlayerMarketValue } from "./market-value"
import { calculatePlayerSalary } from "@/lib/economy/salary"
import { SECONDARY_POSITIONS, type PlayerPosition, type PositionGroup } from "./positions"
import {
  BROAD_GROUP_POSITIONS,
  DEFAULT_NATIONALITY_POOL,
  DEFAULT_SQUAD_COMPOSITION,
  FLEXIBLE_PRIMARY_POOL,
  PREFERRED_FOOT_WEIGHTS,
  type BroadPositionGroup,
} from "./config"
import { rosterGroupOf } from "./roster-floor"
import type { PlayerAttributes } from "./attributes"

/** The band a fallback's DERIVED Overall must land inside. A hard invariant, not a clamp. */
export const FALLBACK_OVERALL_MIN = 40
export const FALLBACK_OVERALL_MAX = 52
export const FALLBACK_AGE_MIN = 24
export const FALLBACK_AGE_MAX = 31
/** Potential above Overall. Two points is not a career - that is the point. */
export const FALLBACK_POTENTIAL_GAP_MAX = 2

export class FallbackIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FallbackIntegrityError"
  }
}

/**
 * The squad's own position shape, as a weight per granular position.
 *
 * Derived from DEFAULT_SQUAD_COMPOSITION and BROAD_GROUP_POSITIONS - the
 * same two tables the initial squad and the youth academy already draw from
 * - so a fallback defender is a CB, RB or LB in the proportions a real squad
 * has them. NO NEW DISTRIBUTION IS INVENTED HERE; a test asserts this table
 * equals the academy's YOUTH_POSITION_WEIGHTS, which is derived identically.
 */
const SQUAD_SHAPE_WEIGHTS: { position: PlayerPosition; weight: number }[] = (() => {
  const totals = new Map<PlayerPosition, number>()
  const add = (position: PlayerPosition, weight: number) =>
    totals.set(position, (totals.get(position) ?? 0) + weight)

  for (const [group, count] of Object.entries(DEFAULT_SQUAD_COMPOSITION.groups) as [BroadPositionGroup, number][]) {
    const options = BROAD_GROUP_POSITIONS[group]
    const groupWeight = options.reduce((sum, o) => sum + o.weight, 0)
    for (const option of options) add(option.position, (count * option.weight) / groupWeight)
  }
  const perFlexible = DEFAULT_SQUAD_COMPOSITION.flexibleCount / FLEXIBLE_PRIMARY_POOL.length
  for (const position of FLEXIBLE_PRIMARY_POOL) add(position, perFlexible)

  return [...totals.entries()]
    .map(([position, weight]) => ({ position, weight }))
    .sort((a, b) => a.position.localeCompare(b.position))
})()

/** The squad-shape weights restricted to one roster group, deterministically ordered. */
export function positionWeightsForGroup(group: PositionGroup): { position: PlayerPosition; weight: number }[] {
  const options = SQUAD_SHAPE_WEIGHTS.filter((entry) => rosterGroupOf(entry.position) === group)
  if (options.length === 0) throw new FallbackIntegrityError(`No positions available for roster group ${group}`)
  return options
}

export interface FallbackSeedInput {
  seasonId: string
  teamId: string
  /** 0-based position within THIS club's replenishment plan for this season. */
  slotIndex: number
}

/**
 * Stable per-player seed. Same season, club and slot reproduces the
 * identical footballer, so a retried transaction can never turn one club's
 * three replacements into three different ones.
 */
export function fallbackSeed(input: FallbackSeedInput): string {
  return `replenishment:${input.seasonId}:${input.teamId}:${input.slotIndex}`
}

/**
 * Its own stream per decision - see the header. Deliberately a local helper
 * rather than one shared with youth generation: each domain owns its seed
 * namespace, and sharing the helper would couple two generators that must be
 * free to change their draws independently.
 */
function streamFor(seed: string, purpose: string): SeededRandom {
  return new SeededRandom(`${seed}-${purpose}`)
}

export interface GeneratedFallbackPlayer extends PlayerAttributes {
  firstName: string
  lastName: string
  age: number
  overall: number
  potential: number
  primaryPosition: PlayerPosition
  secondaryPositions: PlayerPosition[]
  preferredFoot: "left" | "right" | "both"
  nationality: string
  fitness: number
  status: "available"
  marketValue: number
  weeklySalary: number
}

export interface GenerateFallbackInput extends FallbackSeedInput {
  /** Which roster group this slot exists to fill - decided by the deficit plan. */
  group: PositionGroup
}

/**
 * One fallback player, fully determined by (season, team, slot, group).
 *
 * Overall is NEVER assigned: a target is drawn inside the band, attributes
 * are built for it through the same generator squad and youth creation use,
 * and the stored Overall is what those attributes actually grade out at
 * after convergence. If convergence ever left it outside the band that is a
 * bug to surface, not something to paper over by writing a different number
 * than the attributes support.
 */
export function generateFallbackPlayer(input: GenerateFallbackInput): GeneratedFallbackPlayer {
  const seed = fallbackSeed(input)

  const primaryPosition = streamFor(seed, "position").pickWeighted(
    positionWeightsForGroup(input.group),
    (option) => option.weight
  ).position

  const targetOverall = streamFor(seed, "overall").int(FALLBACK_OVERALL_MIN, FALLBACK_OVERALL_MAX)
  const age = streamFor(seed, "age").int(FALLBACK_AGE_MIN, FALLBACK_AGE_MAX)

  const attributes = generateAttributesForTargetOverall(
    primaryPosition,
    targetOverall,
    undefined,
    streamFor(seed, "attributes")
  )
  const overall = convergeToTargetOverall(attributes, primaryPosition, targetOverall)

  if (overall < FALLBACK_OVERALL_MIN || overall > FALLBACK_OVERALL_MAX) {
    throw new FallbackIntegrityError(
      `Generated fallback overall ${overall} is outside the band ${FALLBACK_OVERALL_MIN}-${FALLBACK_OVERALL_MAX}`
    )
  }

  const potential = Math.min(
    100,
    overall + streamFor(seed, "potential").int(0, FALLBACK_POTENTIAL_GAP_MAX)
  )

  const secondaryRng = streamFor(seed, "secondary")
  const pool = SECONDARY_POSITIONS[primaryPosition]
  const secondaryCount = pool.length === 0 ? 0 : secondaryRng.int(1, Math.min(2, pool.length))
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secondaryRng.int(0, i)
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const { firstName, lastName } = generatePlayerName(streamFor(seed, "name"))
  const nationality = streamFor(seed, "nationality").pick(DEFAULT_NATIONALITY_POOL)
  const preferredFoot = streamFor(seed, "foot").pickWeighted(PREFERRED_FOOT_WEIGHTS, (f) => f.weight).foot

  return {
    ...attributes,
    firstName,
    lastName,
    age,
    overall,
    potential,
    primaryPosition,
    secondaryPositions: shuffled.slice(0, secondaryCount),
    preferredFoot,
    nationality,
    fitness: 100,
    status: "available",
    // The canonical formulas, unchanged. At this Overall they produce a wage
    // at or near SALARY_MIN and a value roughly an order of magnitude below a
    // real squad player's - which is the whole economic story.
    marketValue: calculatePlayerMarketValue({ overall, age, potential, primaryPosition, fitness: 100 }),
    weeklySalary: calculatePlayerSalary({ overall, age, potential, primaryPosition }),
  }
}
