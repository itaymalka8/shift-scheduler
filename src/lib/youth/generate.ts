import { SeededRandom } from "@/lib/match/engine/rng"
import { generateAttributesForTargetOverall } from "@/lib/players/attribute-generation"
import { calculatePositionOverall } from "@/lib/players/overall"
import { POSITION_ATTRIBUTE_WEIGHTS } from "@/lib/players/position-weights"
import { SECONDARY_POSITIONS, type PlayerPosition } from "@/lib/players/positions"
import { generatePlayerName } from "@/lib/players/names"
import { DEFAULT_NATIONALITY_POOL, PREFERRED_FOOT_WEIGHTS } from "@/lib/players/config"
import type { AttributeKey, PlayerAttributes } from "@/lib/players/attributes"
import { YouthError } from "./errors"
import {
  YOUTH_AGE_MAX,
  YOUTH_AGE_MIN,
  YOUTH_OVERALL_BANDS,
  YOUTH_OVERALL_MAX,
  YOUTH_POSITION_WEIGHTS,
  potentialGapBandsForAge,
  type WeightedBand,
} from "./config"

/**
 * Everything a prospect is, decided once at generation and never rerolled.
 * Promotion copies this onto a real Player as-is - see promote.ts.
 */
export interface GeneratedProspect extends PlayerAttributes {
  firstName: string
  lastName: string
  age: number
  nationality: string
  primaryPosition: PlayerPosition
  secondaryPositions: PlayerPosition[]
  preferredFoot: "right" | "left" | "both"
  overall: number
  potential: number
}

export interface ProspectSeedInput {
  seasonId: string
  teamId: string
  /** 0-based position within this club's intake. */
  index: number
}

/**
 * Stable per-prospect seed. Re-running generation for the same season, club
 * and slot reproduces the identical prospect, so a retried transaction can
 * never turn one intake's five players into five different ones.
 */
export function prospectSeed(input: ProspectSeedInput): string {
  return `${input.seasonId}-${input.teamId}-${input.index}-youth`
}

/**
 * Each decision draws from its OWN stream, keyed by what it is for, rather
 * than from one shared sequential stream. Two reasons, both load-bearing:
 *
 *  - Independence. With a single stream, the offset at which the potential
 *    roll lands depends on how many draws attribute generation happened to
 *    consume, which itself depends on the position and target drawn
 *    earlier. That correlation is measurable: it visibly skewed the
 *    potential-gap distribution away from its configured weights, and made
 *    an elite gap unreachable for older prospects entirely.
 *  - Stability. Adding or removing a draw in one part of generation no
 *    longer shifts every draw after it, so a future change to (say)
 *    secondary positions cannot silently re-roll everyone's Overall.
 */
function streamFor(seed: string, purpose: string): SeededRandom {
  return new SeededRandom(`${seed}-${purpose}`)
}

function rollBand(bands: WeightedBand[], rng: SeededRandom): number {
  const band = rng.pickWeighted(bands, (b) => b.weight)
  return rng.int(band.min, band.max)
}

/**
 * Walks attribute points until the DERIVED Overall lands exactly on
 * `target`. generateAttributesForTargetOverall gets close but can miss by
 * several points either way, and for youth that matters: a miss upward would
 * put a prospect above the 70 ceiling. Overall is never written to - only
 * position-relevant attributes move, ±1 at a time, exactly as squad
 * generation's own nudge pass does, so the attributes and the Overall they
 * grade out at stay consistent by construction.
 */
function convergeToTargetOverall(
  attributes: PlayerAttributes,
  position: PlayerPosition,
  target: number
): number {
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position]
  // Deterministic, weight-descending round-robin: the attributes that move
  // Overall most are adjusted first, so convergence is quick and repeatable.
  const keys = (Object.keys(weights) as AttributeKey[]).sort(
    (a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || a.localeCompare(b)
  )

  let overall = calculatePositionOverall(attributes, position)
  const maxSteps = keys.length * 40
  let steps = 0

  while (overall !== target && steps < maxSteps) {
    const key = keys[steps % keys.length]
    const value = attributes[key]
    steps++
    if (typeof value !== "number") continue
    if (overall < target && value < 100) attributes[key] = value + 1
    else if (overall > target && value > 1) attributes[key] = value - 1
    else continue
    overall = calculatePositionOverall(attributes, position)
  }

  return overall
}

/**
 * One youth prospect, fully determined by its seed. Overall is drawn from
 * the weighted bands (45-70), attributes are built for that target through
 * the same generator squad creation uses, and the stored Overall is then the
 * value those attributes actually grade out at - never a number set
 * independently.
 */
export function generateYouthProspect(input: ProspectSeedInput): GeneratedProspect {
  const seed = prospectSeed(input)

  const age = streamFor(seed, "age").int(YOUTH_AGE_MIN, YOUTH_AGE_MAX)
  const targetOverall = rollBand(YOUTH_OVERALL_BANDS, streamFor(seed, "overall"))
  const primaryPosition = streamFor(seed, "position").pickWeighted(YOUTH_POSITION_WEIGHTS, (p) => p.weight).position

  const attributes = generateAttributesForTargetOverall(
    primaryPosition,
    targetOverall,
    undefined,
    streamFor(seed, "attributes")
  )
  const overall = convergeToTargetOverall(attributes, primaryPosition, targetOverall)

  // The ceiling is a hard invariant, not a clamp: if convergence ever failed
  // to land at or below it, that is a bug to surface, never something to
  // paper over by writing a different Overall than the attributes support.
  if (overall > YOUTH_OVERALL_MAX) {
    throw new YouthError(
      "PROSPECT_INTEGRITY",
      `Generated prospect overall ${overall} exceeds the youth ceiling ${YOUTH_OVERALL_MAX}`
    )
  }

  const potential = Math.min(100, overall + rollBand(potentialGapBandsForAge(age), streamFor(seed, "potential")))

  const secondaryRng = streamFor(seed, "secondary")
  const pool = SECONDARY_POSITIONS[primaryPosition]
  const secondaryCount = pool.length === 0 ? 0 : secondaryRng.int(1, Math.min(2, pool.length))
  const shuffledPool = [...pool]
  for (let i = shuffledPool.length - 1; i > 0; i--) {
    const j = secondaryRng.int(0, i)
    ;[shuffledPool[i], shuffledPool[j]] = [shuffledPool[j], shuffledPool[i]]
  }

  const { firstName, lastName } = generatePlayerName(streamFor(seed, "name"))

  return {
    ...attributes,
    firstName,
    lastName,
    age,
    nationality: streamFor(seed, "nationality").pick(DEFAULT_NATIONALITY_POOL),
    primaryPosition,
    secondaryPositions: shuffledPool.slice(0, secondaryCount),
    preferredFoot: streamFor(seed, "foot").pickWeighted(PREFERRED_FOOT_WEIGHTS, (f) => f.weight).foot,
    overall,
    potential,
  }
}

/** The whole intake for one club in one season - PROSPECTS_PER_INTAKE prospects, each independently seeded. */
export function generateYouthProspects(seasonId: string, teamId: string, count: number): GeneratedProspect[] {
  return Array.from({ length: count }, (_, index) => generateYouthProspect({ seasonId, teamId, index }))
}
