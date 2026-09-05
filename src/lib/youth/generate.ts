import { SeededRandom } from "@/lib/match/engine/rng"
import { generateAttributesForTargetOverall } from "@/lib/players/attribute-generation"
import { convergeToTargetOverall } from "@/lib/players/overall-converge"
import { SECONDARY_POSITIONS, type PlayerPosition } from "@/lib/players/positions"
import { generatePlayerName } from "@/lib/players/names"
import { DEFAULT_NATIONALITY_POOL, PREFERRED_FOOT_WEIGHTS } from "@/lib/players/config"
import type { PlayerAttributes } from "@/lib/players/attributes"
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
