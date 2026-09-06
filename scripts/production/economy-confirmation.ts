/**
 * PHASE 3R - FIXED-CANDIDATE CONFIRMATION. DIAGNOSTIC ONLY. NOTHING IS SOLVED.
 *
 * SELECTs only. No runtime behaviour, no schema, no migration, no deploy, no
 * Production write.
 *
 * WHY THIS EXISTS SEPARATELY FROM prod:economy:calibrate. That script SEARCHED,
 * and it searched under plain model B. Its three-seed run was performed at the
 * two-lever candidate, while the recommendation it printed was a four-lever one
 * measured on a single seed under a different attendance formula. That gap is
 * the whole reason this file exists, so this one SOLVES NOTHING: every constant
 * below is fixed by decision, and the only question asked is whether the
 * candidate survives three seeds, a fine sensitivity, a roster-exploit probe
 * and an idempotency proof.
 *
 * THE ATTENDANCE FORMULA IS THE FINAL PROPOSED ONE, NOT MODEL B:
 *     quality = SUM(overall of owned ACTIVE players) + (22 - squadSize) x 40
 *     neutral = the league's MEDIAN quality that season, same formula
 * An empty roster slot counts as a replacement-level player - 40 is
 * FALLBACK_OVERALL_MIN, the floor the replenishment generator already uses, not
 * a number invented here. At a full squad this is IDENTICAL to today's live
 * model, so it changes nothing about the league as it stands.
 *
 * Run with: npm run prod:economy:confirm
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { SeededRandom } from "../../src/lib/match/engine/rng"
import {
  SEAT_TYPES,
  TICKET_PRICES,
  MAINTENANCE_COST_PER_SEAT,
  DEFAULT_STARTING_SEATS,
  type SeatCounts,
} from "../../src/lib/stadium/config"
import { calculateStadiumCapacity } from "../../src/lib/stadium/metrics"
import { calculatePlayerSalary } from "../../src/lib/economy/salary"
import { extractPlayerAttributes, type PlayerAttributes } from "../../src/lib/players/attributes"
import { developPlayer, rollRetirement } from "../../src/lib/seasons/player-development"
import { generateFallbackPlayer, FALLBACK_OVERALL_MIN } from "../../src/lib/players/fallback-generator"
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

// ================= THE FIXED CANDIDATE. NOTHING HERE IS SEARCHED. ============
const SALARY_SCALE = 0.72
const SALARY_COMPRESSION = 0.5
const SPONSOR_K = 0.06
const TIER1_MULT = 1.25
const TIER2_MULT = 1.0
const SALARY_PIVOT = 20_000
/** Replacement level for an empty roster slot: the fallback generator's own floor. */
const REPLACEMENT_OVERALL = FALLBACK_OVERALL_MIN // 40
const SEEDS = ["phase3r-calibration", "phase3r-seed-b", "phase3r-seed-c"]
const HORIZONS = [5, 10, 20]
/** The audit's identified understatement of fan fines, applied as a pure sink. */
const FINE_SENSITIVITY_LEAGUE_PER_SEASON = 900_000

// --- Calendar and match-day constants, as measured in the Phase 3R audit -----
const HOME_PER_SEASON = 19
const AWAY_PER_SEASON = 19
const WEEKS_PER_SEASON = 13
const AWAY_TRAVEL = 10_000
const BASE_MATCH_COST = 10_000
const COST_PER_CAPACITY = 0.5
const COST_PER_SPECTATOR = 3
const QUALITY_INFLUENCE = 0.0015
const BASE_OCCUPANCY = 0.62
const RANDOM_VARIANCE = 0.12
const MAINTENANCE_EXEMPT = DEFAULT_STARTING_SEATS
const RESERVE_WEEKS = 4

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}
function pct(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}
function median(values: number[]): number {
  return pct([...values].sort((a, b) => a - b), 0.5)
}
function gini(values: number[]): number {
  const floor = Math.min(0, ...values)
  const s = values.map((v) => v - floor).sort((a, b) => a - b)
  const n = s.length
  const total = s.reduce((sum, v) => sum + v, 0)
  if (n === 0 || total === 0) return 0
  let weighted = 0
  for (let i = 0; i < n; i++) weighted += (i + 1) * s[i]
  return (2 * weighted) / (n * total) - (n + 1) / n
}

// ================= THE FINAL ATTENDANCE FORMULA =============================

interface QualityPlayer {
  overall: number
}

/**
 * SUM of Overall, with every EMPTY roster slot counted at replacement level.
 *
 * At a full 22 this is exactly SUM(overall) - i.e. exactly what the live game
 * computes today - so the existing neutral of 1,320 and the measured 0.62
 * occupancy are untouched by adopting it. It differs only for a short squad,
 * which is the only case that was ever broken.
 */
function teamQuality(players: readonly QualityPlayer[]): number {
  const sum = players.reduce((s, p) => s + p.overall, 0)
  const empty = Math.max(0, MAX_ACTIVE_ROSTER_SIZE - players.length)
  return sum + empty * REPLACEMENT_OVERALL
}

function occupancyFor(quality: number, noise: number, neutral: number): number {
  return Math.max(0.05, Math.min(1.5, BASE_OCCUPANCY + (quality - neutral) * QUALITY_INFLUENCE + noise))
}

/** ONE roll per fixture, feeding crowd, stored attendance, expenses and gate alike. */
function matchdayFlows(seats: SeatCounts, quality: number, noise: number, neutral: number) {
  const occupancy = occupancyFor(quality, noise, neutral)
  const ratio = Math.min(1, occupancy)
  let attendance = 0
  let revenue = 0
  for (const t of SEAT_TYPES) {
    const seated = Math.round(seats[t] * ratio)
    attendance += seated
    revenue += seated * TICKET_PRICES[t]
  }
  const expense = Math.round(
    BASE_MATCH_COST + COST_PER_CAPACITY * calculateStadiumCapacity(seats) + COST_PER_SPECTATOR * attendance
  )
  return { revenue, expense, attendance, occupancy }
}

function weeklyMaintenance(seats: SeatCounts): number {
  let cost = 0
  for (const t of SEAT_TYPES) cost += Math.max(0, seats[t] - MAINTENANCE_EXEMPT[t]) * MAINTENANCE_COST_PER_SEAT[t]
  return cost
}

function fixturesInWeek(total: number, week: number): number {
  return Math.floor((total * week) / WEEKS_PER_SEASON) - Math.floor((total * (week - 1)) / WEEKS_PER_SEASON)
}

// ================= THE SALARY AUTHORITY =====================================
//
// THE CANONICAL INPUTS, NAMED ONCE: overall, age, potential, primaryPosition.
// Four Player columns. weeklySalary is NEVER an input to its own recalculation -
// which is the whole of the idempotency proof in section 6.

interface SalaryInputs {
  overall: number
  age: number
  potential: number
  primaryPosition: string
}

let compressionNormaliser = 1

/** w' = scale x N x PIVOT^c x w^(1-c). N holds the league bill flat at scale 1. */
function transformWage(canonical: number): number {
  if (SALARY_COMPRESSION <= 0) return Math.round(canonical * SALARY_SCALE)
  return Math.round(
    SALARY_SCALE *
      compressionNormaliser *
      Math.pow(SALARY_PIVOT, SALARY_COMPRESSION) *
      Math.pow(Math.max(1, canonical), 1 - SALARY_COMPRESSION)
  )
}

/** THE NEW SALARY AUTHORITY, as a pure function of canonical inputs only. */
function repriceFromCanonicalInputs(p: SalaryInputs): number {
  return transformWage(calculatePlayerSalary(p))
}

/** The WRONG implementation, kept only as the negative control in section 6. */
function repriceFromStoredWage(storedWeeklySalary: number): number {
  return transformWage(storedWeeklySalary)
}

// ================= THE PROJECTION ===========================================

interface SimPlayer extends SalaryInputs {
  attributes: PlayerAttributes
}

interface ClubMeta {
  id: string
  isBot: boolean
  ultras: boolean
  startTier: number
  startBalance: number
  seats: SeatCounts
}

interface SeasonClubState {
  wages: number[]
  quality: number
  squadSize: number
  averageOverall: number
  tier: number
  noise: number[]
  fines: number
}

interface Trajectory {
  seasons: SeasonClubState[][]
  neutrals: number[]
}

function rollSquad(players: SimPlayer[], clubId: string, seasonNumber: number, rng: SeededRandom): SimPlayer[] {
  const survivors: SimPlayer[] = []
  for (const player of players) {
    if (rollRetirement(player.age, rng)) continue
    const development = developPlayer(
      { age: player.age, potential: player.potential, primaryPosition: player.primaryPosition, attributes: player.attributes },
      rng
    )
    const grown = Math.min(player.potential, player.overall + Math.max(0, development.overall - development.currentOverall))
    survivors.push({
      age: player.age + 1,
      potential: player.potential,
      primaryPosition: player.primaryPosition,
      overall: grown,
      attributes: development.attributes,
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

function buildTrajectory(clubs: ClubMeta[], squads: SimPlayer[][], seasons: number, seed: string): Trajectory {
  const rng = new SeededRandom(seed)
  const live = squads.map((sq) => sq.map((p) => ({ ...p, attributes: { ...p.attributes } })))
  const tiers = clubs.map((c) => c.startTier)
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
            fines += Math.round((crowd.incidentFineMin + rng.next() * (crowd.incidentFineMax - crowd.incidentFineMin)) / 1000) * 1000
          }
        }
      }
      row.push({
        wages: players.map(repriceFromCanonicalInputs),
        quality: teamQuality(players),
        squadSize: players.length,
        averageOverall: players.length ? players.reduce((s, p) => s + p.overall, 0) / players.length : 0,
        tier: tiers[i],
        noise,
        fines,
      })
    }
    out.push(row)
    neutrals.push(median(row.map((st) => st.quality)))

    for (let i = 0; i < clubs.length; i++) live[i] = rollSquad(live[i], clubs[i].id, season, rng)

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

interface Horizon {
  season: number
  total: number
  deviation: number
  min: number
  median: number
  max: number
  gini: number
  negatives: number
  belowOneWeek: number
  belowFourWeeks: number
  medianWeeklyPayroll: number
  sponsorT1Week: number
  sponsorT2Week: number
}

interface ClubOutcome {
  index: number
  everNegative: boolean
  negativeWeeks: number
  deepest: number
  finalBalance: number
}

interface RunResult {
  horizons: Horizon[]
  worstInstant: number
  outcomes: ClubOutcome[]
  finalStates: SeasonClubState[]
  occupancySamples: number[]
  openingStock: number
}

function run(clubs: ClubMeta[], traj: Trajectory, extraFineSink: boolean, collectOccupancy = false): RunResult {
  const balances = clubs.map((c) => c.startBalance)
  const openingStock = balances.reduce((s, b) => s + b, 0)
  const ultrasCount = Math.max(1, clubs.filter((c) => c.ultras).length)
  const extraPerUltrasClub = extraFineSink ? FINE_SENSITIVITY_LEAGUE_PER_SEASON / ultrasCount : 0
  const outcomes: ClubOutcome[] = clubs.map((_, i) => ({
    index: i,
    everNegative: false,
    negativeWeeks: 0,
    deepest: balances[i],
    finalBalance: balances[i],
  }))
  const horizons: Horizon[] = []
  const occupancySamples: number[] = []
  let worstInstant = Math.min(...balances)

  for (let s = 0; s < traj.seasons.length; s++) {
    const row = traj.seasons[s]
    const wages = row.map((st) => st.wages.reduce((a, b) => a + b, 0))
    const sponsorBase = SPONSOR_K * median(wages)
    const multOf = (tier: number) => (tier === 1 ? TIER1_MULT : TIER2_MULT)
    const norm = row.reduce((acc, st) => acc + multOf(st.tier), 0) / row.length
    const sponsorOf = row.map((st) => (norm === 0 ? 0 : (sponsorBase * multOf(st.tier)) / norm))

    const homeNet = row.map((st, i) => {
      const list: number[] = []
      for (let f = 0; f < HOME_PER_SEASON; f++) {
        const flow = matchdayFlows(clubs[i].seats, st.quality, st.noise[f], traj.neutrals[s])
        if (collectOccupancy) occupancySamples.push(flow.occupancy)
        list.push(flow.revenue - flow.expense)
      }
      return list
    })

    for (let week = 1; week <= WEEKS_PER_SEASON; week++) {
      const homeCount = fixturesInWeek(HOME_PER_SEASON, week)
      const awayCount = fixturesInWeek(AWAY_PER_SEASON, week)
      const homeStart = Math.floor((HOME_PER_SEASON * (week - 1)) / WEEKS_PER_SEASON)
      for (let i = 0; i < clubs.length; i++) {
        // sponsor, then payroll, then upkeep, then this week's football.
        balances[i] += sponsorOf[i]
        balances[i] -= wages[i]
        balances[i] -= weeklyMaintenance(clubs[i].seats)
        for (let f = 0; f < homeCount; f++) balances[i] += homeNet[i][homeStart + f] ?? 0
        balances[i] -= awayCount * AWAY_TRAVEL
        if (week === WEEKS_PER_SEASON) {
          balances[i] -= row[i].fines
          if (clubs[i].ultras) balances[i] -= extraPerUltrasClub
        }
        if (balances[i] < 0) {
          outcomes[i].everNegative = true
          outcomes[i].negativeWeeks++
        }
        if (balances[i] < outcomes[i].deepest) outcomes[i].deepest = balances[i]
        if (balances[i] < worstInstant) worstInstant = balances[i]
      }
    }

    const season = s + 1
    if (HORIZONS.includes(season)) {
      const sorted = [...balances].sort((a, b) => a - b)
      const t1 = row.findIndex((st) => st.tier === 1)
      const t2 = row.findIndex((st) => st.tier === 2)
      horizons.push({
        season,
        total: balances.reduce((a, b) => a + b, 0),
        deviation: (balances.reduce((a, b) => a + b, 0) / openingStock - 1) * 100,
        min: sorted[0],
        median: pct(sorted, 0.5),
        max: sorted[sorted.length - 1],
        gini: gini(balances),
        negatives: balances.filter((b) => b < 0).length,
        belowOneWeek: balances.filter((b, i) => b < wages[i]).length,
        belowFourWeeks: balances.filter((b, i) => b < wages[i] * RESERVE_WEEKS).length,
        medianWeeklyPayroll: median(wages),
        sponsorT1Week: t1 >= 0 ? sponsorOf[t1] : 0,
        sponsorT2Week: t2 >= 0 ? sponsorOf[t2] : 0,
      })
    }
  }
  for (let i = 0; i < clubs.length; i++) outcomes[i].finalBalance = balances[i]
  return { horizons, worstInstant, outcomes, finalStates: traj.seasons[traj.seasons.length - 1], occupancySamples, openingStock }
}

async function main() {
  let handle: ReturnType<typeof createProductionClient>
  try {
    handle = createProductionClient()
  } catch (error) {
    if (error instanceof ProductionSafetyError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }
  const { prisma, target } = handle
  printProductionBanner("prod:economy:confirm", target)
  console.info(`Now:      ${new Date().toISOString()}\n`)

  try {
    const teams = await prisma.team.findMany({
      select: { id: true, isBot: true, balance: true, crowdStyle: true },
      orderBy: { id: "asc" },
    })
    const activeSeason = await prisma.season.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { number: "desc" } })
    const memberships = activeSeason
      ? await prisma.divisionTeam.findMany({
          where: { division: { seasonId: activeSeason.id } },
          select: { teamId: true, division: { select: { tier: true } } },
        })
      : []
    const tierOf = new Map(memberships.map((m) => [m.teamId, m.division.tier]))
    const stadiums = await prisma.stadium.findMany({
      select: { teamId: true, regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true },
    })
    const seatsOf = new Map<string, SeatCounts>(
      stadiums.map((s) => [s.teamId, { regular: s.regularSeats, covered: s.coveredSeats, premium: s.premiumSeats, vip: s.vipSeats }])
    )
    const playerRows = await prisma.player.findMany({ where: { teamId: { not: null }, careerStatus: "ACTIVE" } })

    const byTeam = new Map<string, SimPlayer[]>()
    const storedWageOf = new Map<string, number[]>()
    for (const row of playerRows) {
      const list = byTeam.get(row.teamId!) ?? []
      list.push({
        age: row.age,
        potential: row.potential,
        primaryPosition: row.primaryPosition,
        overall: row.overall,
        attributes: extractPlayerAttributes(row as unknown as Record<string, unknown>),
      })
      byTeam.set(row.teamId!, list)
      const wl = storedWageOf.get(row.teamId!) ?? []
      wl.push(row.weeklySalary)
      storedWageOf.set(row.teamId!, wl)
    }

    const clubs: ClubMeta[] = teams.map((t) => ({
      id: t.id,
      isBot: t.isBot,
      ultras: t.crowdStyle === "ultras",
      startTier: tierOf.get(t.id) ?? 2,
      startBalance: t.balance,
      seats: seatsOf.get(t.id) ?? { ...DEFAULT_STARTING_SEATS },
    }))
    const squads = clubs.map((c) => byTeam.get(c.id) ?? [])
    const allCanonical = squads.flat().map((p) => calculatePlayerSalary(p))
    const rawSum = allCanonical.reduce((a, b) => a + b, 0)
    const shapedSum = allCanonical.reduce(
      (a, w) => a + Math.pow(SALARY_PIVOT, SALARY_COMPRESSION) * Math.pow(Math.max(1, w), 1 - SALARY_COMPRESSION),
      0
    )
    compressionNormaliser = shapedSum > 0 ? rawSum / shapedSum : 1

    console.info("=== FIXED CANDIDATE - NOTHING BELOW IS SOLVED ===")
    console.info(`  salary scale            ${SALARY_SCALE}`)
    console.info(`  salary compression      ${SALARY_COMPRESSION}  (normaliser N = ${compressionNormaliser.toFixed(6)})`)
    console.info(`  sponsor coefficient     ${SPONSOR_K}`)
    console.info(`  tier multipliers        ${TIER1_MULT} / ${TIER2_MULT}`)
    console.info(`  attendance quality      SUM(overall) + (22 - squadSize) x ${REPLACEMENT_OVERALL}`)
    console.info(`  attendance neutral      the league's own median quality, per season`)
    console.info(`  clubs ${clubs.length}   players ${playerRows.length}   opening stock ${fmt(clubs.reduce((s, c) => s + c.startBalance, 0))}`)
    console.info(`  canonical weekly bill at scale 1: ${fmt(rawSum)}   at the candidate: ${fmt(squads.flat().reduce((s, p) => s + repriceFromCanonicalInputs(p), 0))}`)

    // ==================================================================
    // TASK 1 + 2. THREE SEEDS, THREE HORIZONS, FIXED PARAMETERS
    // ==================================================================
    console.info("\n=== 1. THE FIXED CANDIDATE ON THREE SEEDS ===")
    const trajectories = SEEDS.map((seed) => ({ seed, traj: buildTrajectory(clubs, squads, 20, seed) }))
    const results = trajectories.map(({ seed, traj }, i) => ({ seed, result: run(clubs, traj, false, i === 0) }))
    let acceptable = true
    for (const { seed, result } of results) {
      console.info(`\n  SEED "${seed}"`)
      console.info(
        `    ${"season".padEnd(7)}${"league total".padStart(15)}${"dev%".padStart(8)}${"min".padStart(13)}${"median".padStart(13)}` +
          `${"max".padStart(13)}${"gini".padStart(7)}${"neg".padStart(5)}${"<1wk".padStart(6)}${"<4wk".padStart(6)}` +
          `${"med wk pay".padStart(12)}${"T1 spon/wk".padStart(12)}${"T2 spon/wk".padStart(12)}`
      )
      for (const h of result.horizons) {
        if (Math.abs(h.deviation) > 15) acceptable = false
        console.info(
          `    ${String(h.season).padEnd(7)}${fmt(h.total).padStart(15)}${h.deviation.toFixed(1).padStart(7)}%` +
            `${fmt(h.min).padStart(13)}${fmt(h.median).padStart(13)}${fmt(h.max).padStart(13)}` +
            `${h.gini.toFixed(3).padStart(7)}${String(h.negatives).padStart(5)}${String(h.belowOneWeek).padStart(6)}` +
            `${String(h.belowFourWeeks).padStart(6)}${fmt(h.medianWeeklyPayroll).padStart(12)}` +
            `${fmt(h.sponsorT1Week).padStart(12)}${fmt(h.sponsorT2Week).padStart(12)}`
        )
      }
      const h20 = result.horizons[result.horizons.length - 1]
      console.info(
        `    sponsor economics at season 20: TIER 1 ${fmt(h20.sponsorT1Week)}/wk = ${fmt(h20.sponsorT1Week * WEEKS_PER_SEASON)}/season` +
          `   TIER 2 ${fmt(h20.sponsorT2Week)}/wk = ${fmt(h20.sponsorT2Week * WEEKS_PER_SEASON)}/season` +
          `   league ${fmt((h20.sponsorT1Week * 20 + h20.sponsorT2Week * 40) * WEEKS_PER_SEASON)}/season`
      )
      console.info(`    WORST balance reached at ANY instant: ${fmt(result.worstInstant)}`)
    }
    const worstDev = Math.max(...results.flatMap((r) => r.result.horizons.map((h) => Math.abs(h.deviation))))
    console.info(`\n  ACCEPTANCE (hard +/-15% at every seed and horizon): ${acceptable ? "PASS" : "FAIL"}`)
    console.info(`  worst absolute deviation anywhere: ${worstDev.toFixed(2)}%  (preferred band +/-10%: ${worstDev <= 10 ? "inside" : "OUTSIDE"})`)

    // ==================================================================
    // TASK 3. INSOLVENCY FORENSICS
    // ==================================================================
    console.info("\n=== 3. INSOLVENCY, MEASURED RATHER THAN CHARACTERISED ===")
    for (const { seed, result } of results) {
      const negatives = result.outcomes.filter((o) => o.everNegative)
      const totalClubWeeks = clubs.length * 20 * WEEKS_PER_SEASON
      const negativeWeeks = negatives.reduce((s, o) => s + o.negativeWeeks, 0)
      console.info(
        `\n  SEED "${seed}": deepest ${fmt(result.worstInstant)}   distinct clubs ever negative ${negatives.length}/${clubs.length}` +
          `   negative club-weeks ${negativeWeeks}/${totalClubWeeks} (${((negativeWeeks / totalClubWeeks) * 100).toFixed(3)}%)`
      )
      if (negatives.length === 0) {
        console.info("    no club was ever negative at any instant.")
        continue
      }
      console.info(
        `    ${"club".padEnd(10)}${"H/BOT".padStart(7)}${"tier".padStart(6)}${"wk payroll".padStart(12)}${"capacity".padStart(10)}` +
          `${"avgOVR".padStart(8)}${"deepest".padStart(14)}${"neg wks".padStart(9)}${"final".padStart(14)}${"recovers".padStart(10)}`
      )
      for (const o of [...negatives].sort((a, b) => a.deepest - b.deepest).slice(0, 15)) {
        const st = result.finalStates[o.index]
        console.info(
          `    ${clubs[o.index].id.slice(-8).padEnd(10)}${(clubs[o.index].isBot ? "BOT" : "HUMAN").padStart(7)}` +
            `${String(st.tier).padStart(6)}${fmt(st.wages.reduce((a, b) => a + b, 0)).padStart(12)}` +
            `${fmt(calculateStadiumCapacity(clubs[o.index].seats)).padStart(10)}${st.averageOverall.toFixed(1).padStart(8)}` +
            `${fmt(o.deepest).padStart(14)}${String(o.negativeWeeks).padStart(9)}${fmt(o.finalBalance).padStart(14)}` +
            `${(o.finalBalance >= 0 ? "YES" : "no").padStart(10)}`
        )
      }
      const humans = negatives.filter((o) => !clubs[o.index].isBot).length
      console.info(`    Human clubs among them: ${humans}   BOT clubs: ${negatives.length - humans}   (league is ${clubs.filter((c) => !c.isBot).length} Human / ${clubs.filter((c) => c.isBot).length} BOT)`)
    }

    // ==================================================================
    // TASK 4. THE ROSTER-SIZE EXPLOIT
    // ==================================================================
    console.info("\n=== 4. ROSTER SIZE AND RELEASE, UNDER THE FINAL FORMULA ===")
    const refIndex = Math.floor(squads.length / 2)
    const refSquad = squads[refIndex]
    const refSeats = clubs[refIndex].seats
    const fullGate = SEAT_TYPES.reduce((s, t) => s + refSeats[t] * TICKET_PRICES[t], 0)
    const refNeutral = teamQuality(refSquad)
    const sponsorSeason = results[0].result.horizons[0].sponsorT2Week * WEEKS_PER_SEASON
    const mean = refSquad.reduce((s, p) => s + p.overall, 0) / refSquad.length
    const seasonOf = (players: SimPlayer[]) => {
      const q = teamQuality(players)
      const o = Math.min(1, occupancyFor(q, 0, refNeutral))
      const attendance = SEAT_TYPES.reduce((s, t) => s + Math.round(refSeats[t] * o), 0)
      const gate =
        (SEAT_TYPES.reduce((s, t) => s + Math.round(refSeats[t] * o) * TICKET_PRICES[t], 0) -
          Math.round(BASE_MATCH_COST + COST_PER_CAPACITY * calculateStadiumCapacity(refSeats) + COST_PER_SPECTATOR * attendance)) *
          HOME_PER_SEASON -
        AWAY_TRAVEL * AWAY_PER_SEASON
      const payroll = players.reduce((s, p) => s + repriceFromCanonicalInputs(p), 0) * WEEKS_PER_SEASON
      return { q, o, gate, payroll, net: gate - payroll + sponsorSeason }
    }
    console.info(`  reference club: ${refSquad.length} players, mean Overall ${mean.toFixed(2)}, capacity ${fmt(calculateStadiumCapacity(refSeats))}`)

    // TRULY EQUIVALENT SQUADS. Selecting "the n real players closest to the
    // mean" does NOT hold quality constant - the real distribution's low tail
    // sits further from the mean than its high tail, so shrinking the squad
    // RAISES its average and the table then measures a quality change wearing a
    // size change's clothes. Every player here is instead synthesised at the
    // squad's own mean Overall, so the average is identical at every size by
    // construction and ONLY headcount varies.
    const uniformOverall = Math.round(mean)
    const uniform = (n: number): SimPlayer[] =>
      Array.from({ length: n }, () => ({
        overall: uniformOverall,
        age: 26,
        potential: uniformOverall,
        primaryPosition: "CM",
        attributes: {},
      }))
    console.info(`  equivalent-quality squads: every player synthesised at Overall ${uniformOverall}, age 26, CM.`)
    console.info(
      `    ${"size".padEnd(6)}${"meanOVR".padStart(9)}${"quality".padStart(9)}${"occupancy".padStart(11)}` +
        `${"season gate".padStart(13)}${"season payroll".padStart(16)}${"NET".padStart(13)}${"vs 22".padStart(13)}`
    )
    let netBaseline: number | null = null
    for (const size of [22, 21, 20, 19, 18, 17, 16]) {
      const r = seasonOf(uniform(size))
      if (netBaseline === null) netBaseline = r.net
      console.info(
        `    ${String(size).padEnd(6)}${uniformOverall.toFixed(2).padStart(9)}${fmt(r.q).padStart(9)}${r.o.toFixed(4).padStart(11)}` +
          `${fmt(r.gate).padStart(13)}${fmt(-r.payroll).padStart(16)}${fmt(r.net).padStart(13)}${fmt(r.net - (netBaseline ?? r.net)).padStart(13)}`
      )
    }

    console.info(`\n  RELEASING ONE PLAYER FROM A FULL SQUAD - the boundary case is Overall ${REPLACEMENT_OVERALL}.`)
    console.info(`  Arithmetically the quality change is exactly (${REPLACEMENT_OVERALL} - releasedOverall), so it is`)
    console.info(`  ZERO at the replacement level, positive below it and negative above it: an empty slot`)
    console.info(`  is never valued ABOVE the replacement player it stands in for. Measured:`)
    console.info(
      `    ${"released OVR".padEnd(14)}${"d quality".padStart(11)}${"d gate/season".padStart(15)}${"wage saved/season".padStart(19)}` +
        `${"d NET/season".padStart(14)}${"profitable?".padStart(13)}`
    )
    // The victim is SYNTHESISED at each probe Overall and swapped into the real
    // squad's weakest slot, because the reference club happens to carry nobody
    // near 40 - picking "the nearest real player" silently tested 28 twice.
    const weakest = [...refSquad].sort((a, b) => a.overall - b.overall)[0]
    for (const v of [28, 39, REPLACEMENT_OVERALL, 41, 53, 65, 86]) {
      const victim: SimPlayer = { overall: v, age: 26, potential: v, primaryPosition: "CM", attributes: {} }
      const withVictim = [...refSquad.filter((p) => p !== weakest), victim]
      const before = seasonOf(withVictim)
      const after = seasonOf(withVictim.filter((p) => p !== victim))
      const wageSaved = repriceFromCanonicalInputs(victim) * WEEKS_PER_SEASON
      console.info(
        `    ${`OVR ${v}`.padEnd(14)}${fmt(after.q - before.q).padStart(11)}${fmt(after.gate - before.gate).padStart(15)}` +
          `${fmt(wageSaved).padStart(19)}${fmt(after.net - before.net).padStart(14)}` +
          `${(after.net - before.net > 0 ? "YES" : "no").padStart(13)}`
      )
    }
    const gatePerQualityPoint =
      QUALITY_INFLUENCE * (fullGate - COST_PER_SPECTATOR * calculateStadiumCapacity(refSeats)) * HOME_PER_SEASON
    let breakEven = REPLACEMENT_OVERALL
    for (let v = REPLACEMENT_OVERALL; v <= 100; v++) {
      const wage = repriceFromCanonicalInputs({ overall: v, age: 26, potential: v, primaryPosition: "CM" }) * WEEKS_PER_SEASON
      if ((v - REPLACEMENT_OVERALL) * gatePerQualityPoint >= wage) {
        breakEven = v
        break
      }
    }
    console.info(
      `    gate value of one quality point: ${fmt(gatePerQualityPoint)}/season.  BREAK-EVEN Overall = ${breakEven}:` +
        ` releasing a player rated ${breakEven} or better costs the club money outright.`
    )

    // ==================================================================
    // TASK 5. FAN-FINE SENSITIVITY
    // ==================================================================
    console.info("\n=== 5. FAN-FINE SENSITIVITY (an extra sink only - no invented events) ===")
    console.info(
      `  ${fmt(FINE_SENSITIVITY_LEAGUE_PER_SEASON)} per season, charged only to the ${clubs.filter((c) => c.ultras).length} ultras clubs` +
        ` (${fmt(FINE_SENSITIVITY_LEAGUE_PER_SEASON / Math.max(1, clubs.filter((c) => c.ultras).length))} each), at each season's end.`
    )
    let sensitivityOk = true
    console.info(`    ${"seed".padEnd(24)}${"dev5".padStart(9)}${"dev10".padStart(9)}${"dev20".padStart(9)}${"worst instant".padStart(16)}${"neg@20".padStart(8)}`)
    for (const { seed, traj } of trajectories) {
      const r = run(clubs, traj, true)
      for (const h of r.horizons) if (Math.abs(h.deviation) > 15) sensitivityOk = false
      console.info(
        `    ${seed.padEnd(24)}${r.horizons[0].deviation.toFixed(1).padStart(8)}%${r.horizons[1].deviation.toFixed(1).padStart(8)}%` +
          `${r.horizons[2].deviation.toFixed(1).padStart(8)}%${fmt(r.worstInstant).padStart(16)}${String(r.horizons[2].negatives).padStart(8)}`
      )
    }
    console.info(`  ACCEPTANCE under the sensitivity sink (+/-15%): ${sensitivityOk ? "PASS" : "FAIL"}`)

    // ==================================================================
    // TASK 6. SALARY RE-PRICING IDEMPOTENCY
    // ==================================================================
    console.info("\n=== 6. SALARY RE-PRICING IDEMPOTENCY ===")
    console.info("  CANONICAL INPUTS: overall, age, potential, primaryPosition. Four Player columns.")
    console.info("  weeklySalary is NEVER an input to its own recalculation, which is what makes")
    console.info("  the operation a pure function of state that re-pricing does not change.")
    let mismatches = 0
    let driftExamples = 0
    let worstDrift = 0
    for (const p of squads.flat()) {
      const first = repriceFromCanonicalInputs(p)
      // "Retry after crash" and "retry after deploy" are the SAME call: the
      // inputs are columns the operation does not write.
      const second = repriceFromCanonicalInputs(p)
      const third = repriceFromCanonicalInputs(p)
      const fourth = repriceFromCanonicalInputs(p)
      if (!(first === second && second === third && third === fourth)) mismatches++
      // NEGATIVE CONTROL: the forbidden implementation, applied twice.
      const wrongOnce = repriceFromStoredWage(calculatePlayerSalary(p))
      const wrongTwice = repriceFromStoredWage(wrongOnce)
      if (wrongOnce !== wrongTwice) {
        driftExamples++
        worstDrift = Math.max(worstDrift, Math.abs(wrongTwice - wrongOnce))
      }
    }
    const total = squads.flat().length
    console.info(`  players tested: ${total}`)
    console.info(`  first = second = retry-after-crash = retry-after-deploy: ${total - mismatches}/${total} identical  ${mismatches === 0 ? "PASS" : "FAIL"}`)
    console.info(`  NEGATIVE CONTROL - transforming the STORED wage instead: ${driftExamples}/${total} drift on the second application,`)
    console.info(`  worst single-player drift ${fmt(worstDrift)}/week. That implementation is NOT idempotent and must be forbidden.`)
    console.info(`  Ledger: this operation writes Player.weeklySalary only. It creates no FinancialTransaction`)
    console.info(`  row and reads none, so no historical payroll can change - the ledger is append-only and`)
    console.info(`  past PAYROLL_* rows are keyed to weeks that have already settled.`)

    // ==================================================================
    // TASK 7. ACTIVATION DESIGN
    // ==================================================================
    console.info("\n=== 7. ACTIVATION (design only - no timestamp is chosen here) ===")
    const exemptCapacity = calculateStadiumCapacity(MAINTENANCE_EXEMPT)
    const liable = stadiums.filter((s) => weeklyMaintenance({ regular: s.regularSeats, covered: s.coveredSeats, premium: s.premiumSeats, vip: s.vipSeats }) > 0)
    console.info(`  maintenance exemption boundary: ${fmt(exemptCapacity)} seats, per seat CLASS`)
    console.info(`  Production clubs above the exemption today: ${liable.length}/${stadiums.length}`)
    console.info(`  immediate maintenance liability if activated right now: ${fmt(stadiums.reduce((s, x) => s + weeklyMaintenance({ regular: x.regularSeats, covered: x.coveredSeats, premium: x.premiumSeats, vip: x.vipSeats }), 0))} per week`)

    console.info("\nCONFIRMATION: REPORTED (read only, nothing mutated)")
  } catch (error) {
    console.error("prod:economy:confirm failed:", error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) console.error(error.stack)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
