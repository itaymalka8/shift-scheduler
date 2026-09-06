/**
 * THE SHARED MULTI-SEASON PROJECTION - one trajectory generator, used by both
 * the calibration that CHOSE the constants and the regression that checks the
 * RUNTIME reproduces them.
 *
 * WHY THIS IS A MODULE AND NOT COPIED. The regression's whole question is
 * "does the implemented economy still land where the calibrated model landed?"
 * That question is only answerable if both are asked of the SAME trajectory -
 * the same retirements, the same development rolls, the same youth intakes,
 * the same promotions, the same crowd noise, from the same seed. Two copies
 * that drifted by one RNG draw would produce a difference nobody could
 * attribute to the runtime formulas, which is the one thing the regression
 * exists to measure.
 *
 * IT IMPORTS THE GAME'S OWN FUNCTIONS. Retirement, development, youth
 * generation and the roster floor are not re-modelled here; the real ones are
 * called. A projection built on a hand-rolled approximation of the season roll
 * would be measuring the approximation.
 *
 * DIAGNOSTIC ONLY. Nothing here reads or writes a database.
 */
import { SeededRandom } from "../../src/lib/match/engine/rng"
import { extractPlayerAttributes, type PlayerAttributes } from "../../src/lib/players/attributes"
import { developPlayer, rollRetirement } from "../../src/lib/seasons/player-development"
import { generateFallbackPlayer } from "../../src/lib/players/fallback-generator"
import {
  countRoster,
  planAdditions,
  isResolvableWithinCap,
  countsAfterAdditions,
  rosterGroupOf,
} from "../../src/lib/players/roster-floor"
import { MAX_ACTIVE_ROSTER_SIZE } from "../../src/lib/players/roster"
import { generateYouthProspects } from "../../src/lib/youth/generate"
import { PROSPECTS_PER_INTAKE, MAX_PROMOTIONS_PER_INTAKE } from "../../src/lib/youth/config"
import { DEFAULT_GAME_BALANCE_CONFIG } from "../../src/lib/match/engine/config"
import { calculateUncompressedPlayerSalary } from "../../src/lib/economy/salary"
import type { SeatCounts } from "../../src/lib/stadium/config"

// --- Calendar and match-day constants, as measured in the Phase 3R audit -----
// 20 clubs, double round robin = 38 matchdays, 19 of them at home; Mon/Wed/Sat
// puts matchday 38 eighty-six days after matchday 1, which is 13 payroll weeks.
export const HOME_PER_SEASON = 19
export const AWAY_PER_SEASON = 19
export const WEEKS_PER_SEASON = 13
export const RANDOM_VARIANCE = 0.12

export interface SalaryInputs {
  overall: number
  age: number
  potential: number
  primaryPosition: string
}

export interface SimPlayer extends SalaryInputs {
  attributes: PlayerAttributes
}

export interface ClubMeta {
  id: string
  isBot: boolean
  ultras: boolean
  startTier: number
  startBalance: number
  seats: SeatCounts
}

export interface SeasonClubState {
  /** Pre-compression wages, so a scale sweep is arithmetic rather than a re-roll. */
  canonicalWages: number[]
  quality: number
  squadSize: number
  averageOverall: number
  tier: number
  /** One crowd-noise draw per home fixture. */
  noise: number[]
  fines: number
}

export interface Trajectory {
  seasons: SeasonClubState[][]
  /** The league's own median quality, per season - the attendance neutral. */
  neutrals: number[]
}

export function canonicalWage(player: SalaryInputs): number {
  return calculateUncompressedPlayerSalary(player)
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5))]
}

/**
 * One season roll for one club, through the game's own retirement,
 * development, youth-intake and roster-floor rules.
 */
export function rollSquad(
  players: SimPlayer[],
  clubId: string,
  seasonNumber: number,
  rng: SeededRandom
): SimPlayer[] {
  const survivors: SimPlayer[] = []
  for (const player of players) {
    if (rollRetirement(player.age, rng)) continue
    const d = developPlayer(
      {
        age: player.age,
        potential: player.potential,
        primaryPosition: player.primaryPosition,
        attributes: player.attributes,
      },
      rng
    )
    survivors.push({
      age: player.age + 1,
      potential: player.potential,
      primaryPosition: player.primaryPosition,
      overall: Math.min(player.potential, player.overall + Math.max(0, d.overall - d.currentOverall)),
      attributes: d.attributes,
    })
  }

  const prospects = generateYouthProspects(`sim-${seasonNumber}`, clubId, PROSPECTS_PER_INTAKE)
    .slice()
    .sort((a, b) => b.overall - a.overall || b.potential - a.potential)
  let promoted = 0
  for (const prospect of prospects) {
    if (promoted >= MAX_PROMOTIONS_PER_INTAKE) break
    const after = countsAfterAdditions(countRoster(survivors), [rosterGroupOf(prospect.primaryPosition)])
    if (after.total > MAX_ACTIVE_ROSTER_SIZE || !isResolvableWithinCap(after)) break
    survivors.push({
      age: prospect.age,
      potential: prospect.potential,
      primaryPosition: prospect.primaryPosition,
      overall: prospect.overall,
      attributes: extractPlayerAttributes(prospect as unknown as Record<string, unknown>),
    })
    promoted++
  }

  const counts = countRoster(survivors)
  if (!isResolvableWithinCap(counts)) return survivors
  for (const [slot, group] of planAdditions(counts).entries()) {
    const g = generateFallbackPlayer({ seasonId: `sim-${seasonNumber}`, teamId: clubId, slotIndex: slot, group })
    survivors.push({
      age: g.age,
      potential: g.potential,
      primaryPosition: g.primaryPosition,
      overall: g.overall,
      attributes: extractPlayerAttributes(g as unknown as Record<string, unknown>),
    })
  }
  return survivors
}

/**
 * Build one seed's full multi-season trajectory.
 *
 * `qualityOf` is INJECTED rather than hard-coded, and that is the point of
 * this signature: the calibration passes its own implementation of the decided
 * attendance formula and the regression passes the RUNTIME's. If the two ever
 * disagree, the regression's numbers move - which is exactly the failure this
 * whole exercise is meant to be able to see.
 */
export function buildTrajectory(
  clubs: ClubMeta[],
  squads: SimPlayer[][],
  seasons: number,
  seed: string,
  qualityOf: (players: readonly SimPlayer[]) => number
): Trajectory {
  const rng = new SeededRandom(seed)
  const live = squads.map((squad) => squad.map((p) => ({ ...p, attributes: { ...p.attributes } })))
  const tiers = clubs.map((club) => club.startTier)
  const out: SeasonClubState[][] = []
  const neutrals: number[] = []

  for (let season = 1; season <= seasons; season++) {
    const row: SeasonClubState[] = []
    for (let i = 0; i < clubs.length; i++) {
      const players = live[i]
      const noise: number[] = []
      for (let f = 0; f < HOME_PER_SEASON; f++) noise.push((rng.next() * 2 - 1) * RANDOM_VARIANCE)
      let fines = 0
      if (clubs[i].ultras) {
        const { crowd } = DEFAULT_GAME_BALANCE_CONFIG
        for (let f = 0; f < HOME_PER_SEASON; f++) {
          if (rng.next() < crowd.ultrasIncidentBaseChance) {
            fines +=
              Math.round(
                (crowd.incidentFineMin + rng.next() * (crowd.incidentFineMax - crowd.incidentFineMin)) / 1000
              ) * 1000
          }
        }
      }
      row.push({
        canonicalWages: players.map(canonicalWage),
        quality: qualityOf(players),
        squadSize: players.length,
        averageOverall: players.length ? players.reduce((s, p) => s + p.overall, 0) / players.length : 0,
        tier: tiers[i],
        noise,
        fines,
      })
    }
    out.push(row)
    neutrals.push(median(row.map((state) => state.quality)))

    for (let i = 0; i < clubs.length; i++) live[i] = rollSquad(live[i], clubs[i].id, season, rng)

    // Promotion and relegation, four clubs each way, deterministic from the
    // seed. Sporting merit is not modelled - the economy only cares that the
    // tier population churns, not who churns.
    const key = (i: number) => new SeededRandom(`${seed}-${season}-${clubs[i].id}`).next()
    const up = clubs.map((_, i) => i).filter((i) => tiers[i] === 1).sort((a, b) => key(a) - key(b))
    const down = clubs.map((_, i) => i).filter((i) => tiers[i] === 2).sort((a, b) => key(a) - key(b))
    for (let n = 0; n < 4 && n < up.length && n < down.length; n++) {
      tiers[up[n]] = 2
      tiers[down[n]] = 1
    }
  }

  return { seasons: out, neutrals }
}

/**
 * One Player row as the projection needs it: the four canonical salary inputs
 * plus the attribute block development actually mutates. Shared so the two
 * diagnostics cannot disagree about what a player IS.
 */
export function toSimPlayer(row: {
  age: number
  potential: number
  primaryPosition: string
  overall: number
}): SimPlayer {
  return {
    age: row.age,
    potential: row.potential,
    primaryPosition: row.primaryPosition,
    overall: row.overall,
    attributes: extractPlayerAttributes(row as unknown as Record<string, unknown>),
  }
}

/** How many home fixtures fall in payroll week `week` of a season. */
export function fixturesInWeek(total: number, week: number): number {
  return Math.floor((total * week) / WEEKS_PER_SEASON) - Math.floor((total * (week - 1)) / WEEKS_PER_SEASON)
}
