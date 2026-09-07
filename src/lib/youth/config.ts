import { BROAD_GROUP_POSITIONS, DEFAULT_SQUAD_COMPOSITION, FLEXIBLE_PRIMARY_POOL, type BroadPositionGroup } from "@/lib/players/config"
import type { PlayerPosition } from "@/lib/players/positions"

/** Prospects generated per club per season. */
export const PROSPECTS_PER_INTAKE = 5

/** The most prospects one intake may ever promote - also enforced by a DB CHECK on YouthIntake.promotedCount. */
export const MAX_PROMOTIONS_PER_INTAKE = 3

/** How long a human manager's intake stays OPEN before it can be closed. */
export const INTAKE_WINDOW_HOURS = 48

export const YOUTH_AGE_MIN = 16
export const YOUTH_AGE_MAX = 19

/** A prospect's Overall at generation is always inside this band - never above. */
export const YOUTH_OVERALL_MIN = 45
export const YOUTH_OVERALL_MAX = 70

export interface WeightedBand {
  min: number
  max: number
  weight: number
}

/**
 * Initial Overall bands. A prospect is mostly raw: half of every intake
 * lands in the weakest band, and a genuinely ready-made 68-70 teenager is a
 * 3% event.
 */
export const YOUTH_OVERALL_BANDS: WeightedBand[] = [
  { min: 45, max: 54, weight: 50 },
  { min: 55, max: 62, weight: 35 },
  { min: 63, max: 67, weight: 12 },
  { min: 68, max: 70, weight: 3 },
]

/**
 * How far above their current Overall a prospect can eventually reach.
 * Younger prospects carry the wider spread - by 18-19 what you see is closer
 * to what you get. The gap is added to Overall and capped at 100, so
 * potential may exceed the 70 generation ceiling even though Overall cannot.
 */
export const YOUTH_POTENTIAL_GAP_BANDS: Record<"young" | "older", WeightedBand[]> = {
  // Ages 16-17
  young: [
    { min: 3, max: 10, weight: 55 },
    { min: 11, max: 20, weight: 33 },
    { min: 21, max: 30, weight: 10 },
    { min: 31, max: 35, weight: 2 },
  ],
  // Ages 18-19
  older: [
    { min: 3, max: 10, weight: 62 },
    { min: 11, max: 20, weight: 30 },
    { min: 21, max: 30, weight: 7 },
    { min: 31, max: 35, weight: 1 },
  ],
}

export function potentialGapBandsForAge(age: number): WeightedBand[] {
  return age <= 17 ? YOUTH_POTENTIAL_GAP_BANDS.young : YOUTH_POTENTIAL_GAP_BANDS.older
}

/**
 * The position mix a prospect is drawn from - derived from the same squad
 * composition a generated squad uses, so an academy produces goalkeepers,
 * defenders, midfielders and attackers in the proportions a squad actually
 * needs. Deliberately squad-NEUTRAL: it is the shape of a squad in general,
 * never a look at this particular club's holes.
 */
export const YOUTH_POSITION_WEIGHTS: { position: PlayerPosition; weight: number }[] = (() => {
  const totals = new Map<PlayerPosition, number>()
  const add = (position: PlayerPosition, weight: number) => totals.set(position, (totals.get(position) ?? 0) + weight)

  for (const [group, count] of Object.entries(DEFAULT_SQUAD_COMPOSITION.groups) as [BroadPositionGroup, number][]) {
    const options = BROAD_GROUP_POSITIONS[group]
    const groupWeight = options.reduce((sum, o) => sum + o.weight, 0)
    for (const option of options) add(option.position, (count * option.weight) / groupWeight)
  }
  // The flexible slots spread evenly over their own pool.
  const perFlexible = DEFAULT_SQUAD_COMPOSITION.flexibleCount / FLEXIBLE_PRIMARY_POOL.length
  for (const position of FLEXIBLE_PRIMARY_POOL) add(position, perFlexible)

  return [...totals.entries()].map(([position, weight]) => ({ position, weight })).sort((a, b) => a.position.localeCompare(b.position))
})()
