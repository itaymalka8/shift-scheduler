import type { Prisma, PrismaClient } from "@/generated/prisma"
import { generatePlayerName } from "./names"
import { DEFAULT_FORMATION } from "./formations"
import { computeRecommendedLineup } from "./recommend"
import { SECONDARY_POSITIONS, type PlayerPosition } from "./positions"
import { calculatePlayerMarketValue } from "./market-value"
import { calculatePlayerSalary } from "@/lib/economy/salary"
import { DEFAULT_SALARY_CONFIG, INITIAL_SQUAD_SALARY_RANGE, type SalaryConfig } from "@/lib/economy/config"
import { generateAttributesForTargetOverall } from "./attribute-generation"
import { calculatePositionOverall } from "./overall"
import { POSITION_ATTRIBUTE_WEIGHTS } from "./position-weights"
import type { PlayerAttributes } from "./attributes"
import {
  BROAD_GROUP_POSITIONS,
  DEFAULT_SQUAD_GENERATION_CONFIG,
  FLEXIBLE_PRIMARY_POOL,
  PREFERRED_FOOT_WEIGHTS,
  DEFAULT_NATIONALITY_POOL,
  PLAYER_TIERS,
  type BroadPositionGroup,
  type PlayerTierId,
  type SquadGenerationConfig,
} from "./config"

type DbClient = PrismaClient | Prisma.TransactionClient

export interface GeneratedPlayer extends PlayerAttributes {
  firstName: string
  lastName: string
  age: number
  overall: number
  potential: number
  primaryPosition: PlayerPosition
  secondaryPositions: PlayerPosition[]
  fitness: number
  status: "available"
  marketValue: number
  weeklySalary: number
  preferredFoot: "left" | "right" | "both"
  nationality: string
  shirtNumber: number
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

function pickWeighted<T>(options: { value: T; weight: number }[]): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0)
  let roll = Math.random() * total
  for (const option of options) {
    roll -= option.weight
    if (roll <= 0) return option.value
  }
  return options[options.length - 1].value
}

/** Distributes `count` slots across weighted options, exact-summing via largest remainder. */
function distributeByWeight<T>(count: number, options: { value: T; weight: number }[]): T[] {
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0)
  const raw = options.map((o) => ({ value: o.value, exact: (o.weight / totalWeight) * count }))
  const base = raw.map((r) => ({ value: r.value, floor: Math.floor(r.exact), remainder: r.exact - Math.floor(r.exact) }))
  let assigned = base.reduce((sum, b) => sum + b.floor, 0)
  const byRemainder = [...base].sort((a, b) => b.remainder - a.remainder)
  let i = 0
  while (assigned < count) {
    byRemainder[i % byRemainder.length].floor += 1
    assigned++
    i++
  }
  const result: T[] = []
  for (const b of base) result.push(...Array.from({ length: b.floor }, () => b.value))
  return result
}

/** The 22 primary positions a new squad's slots get, before tiers/ages/names are layered on. */
function buildPositionSlots(config: SquadGenerationConfig): PlayerPosition[] {
  const slots: PlayerPosition[] = []
  for (const [group, count] of Object.entries(config.composition.groups) as [BroadPositionGroup, number][]) {
    const options = BROAD_GROUP_POSITIONS[group].map((o) => ({ value: o.position, weight: o.weight }))
    slots.push(...distributeByWeight(count, options))
  }
  for (let i = 0; i < config.composition.flexibleCount; i++) {
    slots.push(FLEXIBLE_PRIMARY_POOL[randomInt(0, FLEXIBLE_PRIMARY_POOL.length - 1)])
  }
  return slots
}

/** The 22 tier bands a new squad's slots get - deliberately uneven, per newTeamTierDistribution. */
function buildTierSlots(config: SquadGenerationConfig): PlayerTierId[] {
  return shuffle(config.quality.newTeamTierDistribution.flatMap((d) => Array(d.count).fill(d.tier) as PlayerTierId[]))
}

// Reverse of tiers.ts's getPlayerTier (overall -> tier): here we need a tier
// id's [min,max] overall band, to know what range a slot's overall can roll in.
function tierBand(tierId: PlayerTierId): { min: number; max: number } {
  const tier = PLAYER_TIERS.find((t) => t.id === tierId)
  if (!tier) throw new Error(`Unknown player tier: ${tierId}`)
  return { min: tier.min, max: tier.max }
}

/**
 * Picks a target squad quality first, then builds 22 players whose overalls
 * sum to exactly that target - never generates players independently and
 * hopes the total lands right. Position and tier assignments are shuffled
 * independently of each other so quality never correlates with position
 * (e.g. every goalkeeper being weak).
 */
export function generateInitialSquad(config: SquadGenerationConfig = DEFAULT_SQUAD_GENERATION_CONFIG): GeneratedPlayer[] {
  const { quality, ageBands, marketValue } = config
  const positions = shuffle(buildPositionSlots(config))
  const tiers = buildTierSlots(config)

  const targetQuality = randomInt(
    quality.newTeamTargetQuality - quality.newTeamQualityVariance,
    quality.newTeamTargetQuality + quality.newTeamQualityVariance
  )

  const bands = tiers.map((tierId) => tierBand(tierId))
  const overalls = bands.map((band) => Math.round((band.min + band.max) / 2))

  // Nudge overalls (each clamped to its own tier band) until the sum hits
  // targetQuality exactly - this is what guarantees the final Total Quality
  // always lands in the configured range, since targetQuality itself does.
  let delta = targetQuality - overalls.reduce((sum, o) => sum + o, 0)
  let guard = 0
  while (delta !== 0 && guard < 10_000) {
    const i = guard % overalls.length
    const band = bands[i]
    if (delta > 0 && overalls[i] < band.max) {
      overalls[i]++
      delta--
    } else if (delta < 0 && overalls[i] > band.min) {
      overalls[i]--
      delta++
    }
    guard++
  }
  // Extremely unlikely fallback if tier bands can't absorb the full delta -
  // spill into the global overall range instead of leaving quality off-target.
  guard = 0
  while (delta !== 0 && guard < 10_000) {
    const i = guard % overalls.length
    if (delta > 0 && overalls[i] < quality.overallRange.max) {
      overalls[i]++
      delta--
    } else if (delta < 0 && overalls[i] > quality.overallRange.min) {
      overalls[i]--
      delta++
    }
    guard++
  }

  const shirtNumbers = shuffle(Array.from({ length: positions.length }, (_, i) => i + 1))

  // These are targets fed into attribute generation, not the final stored
  // Overall - Overall is never picked directly, only ever derived below from
  // whatever attributes actually come out (see calculatePlayerOverall).
  const targetOveralls = overalls.map((o) => Math.max(quality.overallRange.min, Math.min(quality.overallRange.max, o)))

  const playerAttributes = positions.map((primaryPosition, i) =>
    generateAttributesForTargetOverall(primaryPosition, targetOveralls[i])
  )

  // The per-player correction inside generateAttributesForTargetOverall
  // gets each player's derived Overall very close to its target, but rarely
  // exactly on it (integer rounding, occasional attribute clamping at 1/100)
  // - this closes whatever's left so the squad-wide Total Quality still
  // lands in the configured range, by nudging individual attribute points
  // (never Overall itself) a handful of times.
  nudgeSquadOverallToTarget(positions, playerAttributes, targetOveralls.reduce((sum, o) => sum + o, 0))

  const squad = positions.map((primaryPosition, i) => {
    const attributes = playerAttributes[i]
    const overall = calculatePositionOverall(attributes, primaryPosition)
    const ageBand = pickWeighted(ageBands.map((b) => ({ value: b, weight: b.weight })))
    const age = randomInt(ageBand.min, ageBand.max)
    const potential = Math.max(
      overall,
      Math.min(quality.potentialRange.max, overall + randomInt(0, ageBand.maxPotentialGap))
    )
    const pool = SECONDARY_POSITIONS[primaryPosition]
    const secondaryPositions = shuffle(pool).slice(0, Math.min(pool.length, randomInt(1, 2)))
    const preferredFoot = pickWeighted(PREFERRED_FOOT_WEIGHTS.map((f) => ({ value: f.foot, weight: f.weight })))
    const nationality = DEFAULT_NATIONALITY_POOL[randomInt(0, DEFAULT_NATIONALITY_POOL.length - 1)]
    const { firstName, lastName } = generatePlayerName()

    return {
      ...attributes,
      firstName,
      lastName,
      age,
      overall,
      potential,
      primaryPosition,
      secondaryPositions,
      fitness: 100,
      status: "available" as const,
      marketValue: calculatePlayerMarketValue({ overall, age, potential, primaryPosition, fitness: 100 }, marketValue),
      weeklySalary: calculatePlayerSalary({ overall, age, potential, primaryPosition }, DEFAULT_SALARY_CONFIG),
      preferredFoot,
      nationality,
      shirtNumber: shirtNumbers[i],
    }
  })

  scaleSquadSalariesToRange(squad, INITIAL_SQUAD_SALARY_RANGE, DEFAULT_SALARY_CONFIG)
  return squad
}

/**
 * Closes any small residual gap between a squad's actual (derived) Total
 * Quality and its target by nudging individual attribute points on a few
 * players - never Overall directly. Bounded well beyond what should ever be
 * needed in practice (the per-player correction pass already gets very
 * close), just to guarantee termination.
 */
function nudgeSquadOverallToTarget(
  positions: PlayerPosition[],
  attributesList: PlayerAttributes[],
  targetTotal: number,
  maxPasses = 300
): void {
  for (let pass = 0; pass < maxPasses; pass++) {
    const overalls = positions.map((position, i) => calculatePositionOverall(attributesList[i], position))
    const gap = targetTotal - overalls.reduce((sum, o) => sum + o, 0)
    if (gap === 0) return

    const i = pass % positions.length
    const weights = POSITION_ATTRIBUTE_WEIGHTS[positions[i]]
    const keys = Object.keys(weights) as (keyof PlayerAttributes)[]
    if (keys.length === 0) continue
    const key = keys[pass % keys.length]
    const current = attributesList[i][key] ?? 50
    attributesList[i][key] = Math.max(1, Math.min(100, current + Math.sign(gap)))
  }
}

/**
 * A new squad's combined weekly wage bill must land in the configured
 * range regardless of how the quality/tier roll happened to shake out -
 * without this, a lucky high-overall generation could saddle a brand-new
 * manager with a wage bill their starting budget can't sustain. Scales
 * every player's already-computed salary by the same factor rather than
 * recomputing from scratch, so relative pay between players is preserved.
 */
function scaleSquadSalariesToRange(
  squad: GeneratedPlayer[],
  range: { min: number; max: number },
  config: SalaryConfig
): void {
  const total = squad.reduce((sum, p) => sum + p.weeklySalary, 0)
  if (total >= range.min && total <= range.max) return

  const target = (range.min + range.max) / 2
  const factor = total > 0 ? target / total : 1
  for (const player of squad) {
    player.weeklySalary = Math.max(config.minSalary, Math.round((player.weeklySalary * factor) / config.roundingUnit) * config.roundingUnit)
  }
}

/**
 * Creates a full squad for a team and picks a recommended starting XI in
 * DEFAULT_FORMATION so the team never starts with an empty pitch.
 */
export async function generateSquad(
  db: DbClient,
  teamId: string,
  config: SquadGenerationConfig = DEFAULT_SQUAD_GENERATION_CONFIG
): Promise<void> {
  const squad = generateInitialSquad(config)

  const created: { id: string; primaryPosition: string; overall: number; fitness: number; status: string }[] = []
  for (const player of squad) {
    const row = await db.player.create({ data: { teamId, ...player } })
    created.push({ id: row.id, primaryPosition: row.primaryPosition, overall: row.overall, fitness: row.fitness, status: row.status })
  }

  const assignments = computeRecommendedLineup(DEFAULT_FORMATION, created)
  for (const assignment of assignments) {
    await db.lineupSlot.create({
      data: { teamId, playerId: assignment.playerId, slotIndex: assignment.slotIndex },
    })
  }

  await db.team.update({
    where: { id: teamId },
    data: { formation: DEFAULT_FORMATION, mentality: "balanced", tempo: "normal", pressing: "normal", width: "balanced" },
  })
}
