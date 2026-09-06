/**
 * PHASE 3R - JOINT ECONOMIC CALIBRATION PROOF. DIAGNOSTIC ONLY.
 *
 * SELECTs only, and not one line of application runtime behaviour is touched.
 * Everything below reads Production once and then does arithmetic in memory.
 *
 * WHY THIS EXISTS SEPARATELY FROM prod:economy:model. That script measured the
 * economy and solved three corrections INDEPENDENTLY - which is exactly the
 * proof gap the review named. A salary re-anchor changes the wage bill that a
 * sponsor is sized against, and a sponsor changes how much wage the economy can
 * carry. Solving either alone and then adding the other is not a proof, it is
 * two half-proofs stapled together. This script solves them JOINTLY over a
 * grid, under the corrected attendance behaviour, against a two-part objective
 * (stock stability AND club solvency) that neither can satisfy alone.
 *
 * FOUR MODELLING CORRECTIONS THE REVIEW REQUIRED, ALL ACTIVE HERE:
 *
 *   F2  ONE attendance roll per fixture. The live code rolls twice - once in
 *       the snapshot (which drives the crowd, is stored on Fixture.attendance
 *       and is charged as expenses) and again in simulate.ts (which is what is
 *       actually sold). Here there is exactly one roll and it feeds crowd,
 *       stored attendance, expenses and revenue alike, drawn from a seeded
 *       stream rather than Math.random.
 *
 *   F4  Three attendance-quality models are measured side by side at four
 *       squad sizes, because today's SUM-of-Overall makes shedding wage bill
 *       destroy revenue faster than it saves cost.
 *
 *   R7  Discretionary spends must leave four weeks of current payroll.
 *
 *   R8  A release may take the balance below zero when it is otherwise legal;
 *       the roster floor and positional minimums stay authoritative.
 *
 * SPONSOR SHAPE, FIXED BY DECISION R3/§14:
 *       base   = k x (LEAGUE MEDIAN weekly payroll, one snapshot per season)
 *       club   = base x tierMult(club) / mean(tierMult over all clubs)
 *   The normaliser is what makes k control the LEVEL and the tier multiplier
 *   control only the SPREAD, so the two can be reasoned about separately. A
 *   club's own payroll never appears: buying expensive players cannot buy
 *   sponsor income.
 *
 * WHY IT IS FAST ENOUGH TO GRID-SEARCH. The season roll - development, aging,
 * retirement, youth, replenishment - depends on the seed and on nothing else in
 * the parameter set. So the whole roster trajectory, the per-fixture attendance
 * noise, and therefore every matchday cash flow, are computed ONCE per (seed,
 * attendance model) and reused for every point on the grid. Each grid point is
 * then pure arithmetic over precomputed arrays.
 *
 * Run with: npm run prod:economy:calibrate
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { SeededRandom } from "../../src/lib/match/engine/rng"
import {
  SEAT_TYPES,
  TICKET_PRICES,
  CONSTRUCTION_COST_PER_SEAT,
  MAINTENANCE_COST_PER_SEAT,
  DEFAULT_STARTING_SEATS,
  type SeatCounts,
} from "../../src/lib/stadium/config"
import { calculateStadiumCapacity } from "../../src/lib/stadium/metrics"
import { calculatePlayerSalary } from "../../src/lib/economy/salary"
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

// --- Calendar, as measured in the Phase 3R audit ------------------------------
const HOME_PER_SEASON = 19
const AWAY_PER_SEASON = 19
const WEEKS_PER_SEASON = 13
const AWAY_TRAVEL = 10_000
const BASE_MATCH_COST = 10_000
const COST_PER_CAPACITY = 0.5
const COST_PER_SPECTATOR = 3
const NEUTRAL_QUALITY = 1_320
const QUALITY_INFLUENCE = 0.0015
const BASE_OCCUPANCY = 0.62
const RANDOM_VARIANCE = 0.12
/** R4: the starting stadium is exempt from upkeep. Only seats beyond it are charged. */
const MAINTENANCE_EXEMPT_CAPACITY = calculateStadiumCapacity(DEFAULT_STARTING_SEATS) // 10,600
const RESERVE_WEEKS = 4

export type AttendanceModel = "A" | "B" | "C"
/** Model C's "fixed number of relevant players" - the size of a starting XI. */
const MODEL_C_SUBSET = 11

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

// --- Squad quality, the three candidate models --------------------------------

interface QualityPlayer {
  overall: number
}

/**
 * A: today's model - the SUM of every squad player's Overall. Rewards headcount.
 * B: the squad's AVERAGE Overall re-expressed as a 22-player equivalent. A
 *    no-op at 22 players (which is every club in Production today), and it
 *    removes the size term entirely.
 * C: the average of the best MODEL_C_SUBSET players, as a 22-player equivalent.
 *    Rewards a strong first XI rather than depth, and needs no data the game
 *    does not already have.
 */
function teamQuality(players: readonly QualityPlayer[], model: AttendanceModel): number {
  if (players.length === 0) return 0
  const sum = players.reduce((s, p) => s + p.overall, 0)
  if (model === "A") return sum
  if (model === "B") return (sum / players.length) * MAX_ACTIVE_ROSTER_SIZE
  const top = [...players].sort((a, b) => b.overall - a.overall).slice(0, Math.min(MODEL_C_SUBSET, players.length))
  return (top.reduce((s, p) => s + p.overall, 0) / top.length) * MAX_ACTIVE_ROSTER_SIZE
}

function occupancyFor(quality: number, noise: number): number {
  const raw = BASE_OCCUPANCY + (quality - NEUTRAL_QUALITY) * QUALITY_INFLUENCE + noise
  return Math.max(0.05, Math.min(1.5, raw))
}

/** THE SINGLE ROLL. One occupancy -> one attendance -> both the gate and the cost. */
function matchdayFlows(seats: SeatCounts, quality: number, noise: number): { revenue: number; expense: number; attendance: number; occupancy: number } {
  const occupancy = occupancyFor(quality, noise)
  const ratio = Math.min(1, occupancy)
  let attendance = 0
  let revenue = 0
  for (const t of SEAT_TYPES) {
    const seated = Math.round(seats[t] * ratio)
    attendance += seated
    revenue += seated * TICKET_PRICES[t]
  }
  const capacity = calculateStadiumCapacity(seats)
  const expense = Math.round(BASE_MATCH_COST + COST_PER_CAPACITY * capacity + COST_PER_SPECTATOR * attendance)
  return { revenue, expense, attendance, occupancy }
}

function weeklyMaintenance(seats: SeatCounts): number {
  const capacity = calculateStadiumCapacity(seats)
  if (capacity <= MAINTENANCE_EXEMPT_CAPACITY) return 0
  // Charge the classes that were actually ADDED, cheapest-exempt-first: the
  // exemption is spent on the starting stadium's own composition, so an
  // expansion is charged at its own class rates rather than at an average.
  const exempt: SeatCounts = { ...DEFAULT_STARTING_SEATS }
  let cost = 0
  for (const t of SEAT_TYPES) {
    const chargeable = Math.max(0, seats[t] - exempt[t])
    cost += chargeable * MAINTENANCE_COST_PER_SEAT[t]
  }
  return cost
}

/** 19 fixtures spread over 13 weeks, integer-exact and front-loaded identically every season. */
function fixturesInWeek(total: number, week: number): number {
  return Math.floor((total * week) / WEEKS_PER_SEASON) - Math.floor((total * (week - 1)) / WEEKS_PER_SEASON)
}

// --- The roster trajectory, precomputed once per seed -------------------------

interface SimPlayer {
  age: number
  potential: number
  primaryPosition: string
  overall: number
  attributes: PlayerAttributes
  /** Wage as STORED in Production; only meaningful for season 1. */
  storedWage: number | null
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
  /** Canonical per-player weekly wage at scale 1.0, from calculatePlayerSalary. */
  canonicalWages: number[]
  /** Season 1 only: the wage rows Production actually holds today. */
  storedWages: number[] | null
  quality: number
  squadSize: number
  tier: number
  /** Occupancy noise for each of this club's 19 home fixtures. */
  noise: number[]
  /** Fan-incident fines rolled for this season (ultras clubs only). */
  fines: number
}

interface Trajectory {
  clubs: ClubMeta[]
  seasons: SeasonClubState[][] // [season][clubIndex]
  model: AttendanceModel
  seed: string
}

function clonePlayers(players: readonly SimPlayer[]): SimPlayer[] {
  return players.map((p) => ({ ...p, attributes: { ...p.attributes } }))
}

/**
 * The season roll in the orchestrator's own order:
 *   PLAYER_LIFECYCLE -> YOUTH_GENERATION -> BOT_PROMOTION -> SQUAD_REPLENISHMENT
 * Development is applied as a DELTA over the stored Overall, so a club whose
 * stored Overall and attributes ever disagreed could not be silently re-graded.
 */
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
      storedWage: null,
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
      storedWage: null,
    })
    promoted++
  }

  const counts = countRoster(survivors)
  if (!isResolvableWithinCap(counts)) return survivors
  const plan = planAdditions(counts)
  for (let slot = 0; slot < plan.length; slot++) {
    const generated = generateFallbackPlayer({ seasonId: `sim-${seasonNumber}`, teamId: clubId, slotIndex: slot, group: plan[slot] })
    survivors.push({
      age: generated.age,
      potential: generated.potential,
      primaryPosition: generated.primaryPosition,
      overall: generated.overall,
      attributes: extractPlayerAttributes(generated as unknown as Record<string, unknown>),
      storedWage: null,
    })
  }
  return survivors
}

function canonicalWage(p: SimPlayer): number {
  return calculatePlayerSalary({ overall: p.overall, age: p.age, potential: p.potential, primaryPosition: p.primaryPosition })
}

function buildTrajectory(
  clubs: ClubMeta[],
  squads: SimPlayer[][],
  seasons: number,
  model: AttendanceModel,
  seed: string
): Trajectory {
  const rng = new SeededRandom(seed)
  const live = squads.map(clonePlayers)
  const tiers = clubs.map((c) => c.startTier)
  const out: SeasonClubState[][] = []

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
        canonicalWages: players.map(canonicalWage),
        storedWages: season === 1 ? players.map((p) => p.storedWage ?? canonicalWage(p)) : null,
        quality: teamQuality(players, model),
        squadSize: players.length,
        tier: tiers[i],
        noise,
        fines,
      })
    }
    out.push(row)

    for (let i = 0; i < clubs.length; i++) live[i] = rollSquad(live[i], clubs[i].id, season, rng)

    // Promotion and relegation: four clubs swap labels, drawn from the season's
    // own RNG and NEVER from balance - a balance-sorted swap would manufacture
    // the tier-wealth correlation the tier analysis exists to test for.
    const key = (i: number) => new SeededRandom(`${seed}-${season}-${clubs[i].id}`).next()
    const up = clubs.map((_, i) => i).filter((i) => tiers[i] === 1).sort((a, b) => key(a) - key(b))
    const down = clubs.map((_, i) => i).filter((i) => tiers[i] === 2).sort((a, b) => key(a) - key(b))
    for (let n = 0; n < 4 && n < up.length && n < down.length; n++) {
      tiers[up[n]] = 2
      tiers[down[n]] = 1
    }
  }
  return { clubs, seasons: out, model, seed }
}

// --- The parameter set and the evaluator --------------------------------------

export interface Params {
  salaryScale: number
  sponsorK: number
  tier1Mult: number
  tier2Mult: number
  maintenanceOn: boolean
}

interface Horizon {
  season: number
  total: number
  min: number
  median: number
  max: number
  gini: number
  negatives: number
  belowOneWeek: number
  belowFourWeeks: number
  medianWeeklyPayroll: number
  sponsorTier1Week: number
  sponsorTier2Week: number
  seasonGate: number
  seasonSponsor: number
  seasonWages: number
}

interface Evaluation {
  horizons: Map<number, Horizon>
  minBalanceEver: number
  worstDeviation: number
  openingStock: number
  occupancySamples: number[]
}

function wageOf(state: SeasonClubState, scale: number, seasonIndex: number): number {
  if (seasonIndex === 0 && state.storedWages) {
    // Season 1 runs on the wage rows Production actually holds. A retuned curve
    // does not rewrite existing Player.weeklySalary - the next season roll does.
    return state.storedWages.reduce((s, w) => s + w, 0)
  }
  let total = 0
  for (const w of state.canonicalWages) total += Math.round(w * scale)
  return total
}

function evaluate(
  traj: Trajectory,
  params: Params,
  horizons: number[],
  collectOccupancy = false
): Evaluation {
  const clubs = traj.clubs
  const balances = clubs.map((c) => c.startBalance)
  const openingStock = balances.reduce((s, b) => s + b, 0)
  const seats = clubs.map((c) => ({ ...c.seats }))
  const out = new Map<number, Horizon>()
  let minBalanceEver = Math.min(...balances)
  const occupancySamples: number[] = []

  for (let s = 0; s < traj.seasons.length; s++) {
    const row = traj.seasons[s]
    const wages = row.map((st) => wageOf(st, params.salaryScale, s))
    const medianWage = median(wages)
    const sponsorBase = params.sponsorK * medianWage
    const multOf = (tier: number) => (tier === 1 ? params.tier1Mult : params.tier2Mult)
    const norm = row.reduce((acc, st) => acc + multOf(st.tier), 0) / row.length
    const sponsorOf = row.map((st) => (norm === 0 ? 0 : (sponsorBase * multOf(st.tier)) / norm))

    // Per-club per-fixture matchday flows, from ONE attendance roll each.
    const homeNet: number[][] = row.map((st, i) => {
      const list: number[] = []
      for (let f = 0; f < HOME_PER_SEASON; f++) {
        const flow = matchdayFlows(seats[i], st.quality, st.noise[f])
        if (collectOccupancy) occupancySamples.push(flow.occupancy)
        list.push(flow.revenue - flow.expense)
      }
      return list
    })
    const gateTotals = row.map((_, i) => homeNet[i].reduce((a, b) => a + b, 0))

    let seasonGate = 0
    let seasonSponsor = 0
    let seasonWages = 0

    for (let week = 1; week <= WEEKS_PER_SEASON; week++) {
      const homeCount = fixturesInWeek(HOME_PER_SEASON, week)
      const awayCount = fixturesInWeek(AWAY_PER_SEASON, week)
      const homeStart = Math.floor((HOME_PER_SEASON * (week - 1)) / WEEKS_PER_SEASON)
      for (let i = 0; i < clubs.length; i++) {
        // ORDER WITHIN THE WEEK: sponsor, then payroll, then maintenance, then
        // this week's football. Charges before receipts is the CONSERVATIVE
        // ordering for a minimum-balance trace, and sponsor-before-payroll is
        // the decision R3 ordering.
        balances[i] += sponsorOf[i]
        seasonSponsor += sponsorOf[i]
        balances[i] -= wages[i]
        seasonWages += wages[i]
        if (params.maintenanceOn) balances[i] -= weeklyMaintenance(seats[i])
        for (let f = 0; f < homeCount; f++) {
          const net = homeNet[i][homeStart + f] ?? 0
          balances[i] += net
          seasonGate += net
        }
        balances[i] -= awayCount * AWAY_TRAVEL
        if (week === WEEKS_PER_SEASON) balances[i] -= row[i].fines
        if (balances[i] < minBalanceEver) minBalanceEver = balances[i]
      }
    }
    void gateTotals

    const season = s + 1
    if (horizons.includes(season)) {
      const sorted = [...balances].sort((a, b) => a - b)
      const t1 = row.find((st) => st.tier === 1)
      const t2 = row.find((st) => st.tier === 2)
      out.set(season, {
        season,
        total: balances.reduce((a, b) => a + b, 0),
        min: sorted[0],
        median: pct(sorted, 0.5),
        max: sorted[sorted.length - 1],
        gini: gini(balances),
        negatives: balances.filter((b) => b < 0).length,
        belowOneWeek: balances.filter((b, i) => b < wages[i]).length,
        belowFourWeeks: balances.filter((b, i) => b < wages[i] * 4).length,
        medianWeeklyPayroll: medianWage,
        sponsorTier1Week: t1 ? sponsorOf[row.indexOf(t1)] : 0,
        sponsorTier2Week: t2 ? sponsorOf[row.indexOf(t2)] : 0,
        seasonGate,
        seasonSponsor,
        seasonWages,
      })
    }
  }

  let worstDeviation = 0
  for (const h of horizons) {
    const row = out.get(h)
    if (!row) continue
    worstDeviation = Math.max(worstDeviation, Math.abs(row.total / openingStock - 1))
  }
  return { horizons: out, minBalanceEver, worstDeviation, openingStock, occupancySamples }
}

function printHorizons(label: string, evaluation: Evaluation): void {
  console.info(`  ${label}`)
  console.info(
    `    ${"season".padEnd(7)}${"league total".padStart(15)}${"dev%".padStart(8)}${"min".padStart(14)}` +
      `${"median".padStart(14)}${"max".padStart(14)}${"gini".padStart(7)}${"neg".padStart(5)}` +
      `${"<4w".padStart(5)}${"med wk pay".padStart(12)}${"spon T1/wk".padStart(12)}${"spon T2/wk".padStart(12)}${"wage share".padStart(12)}`
  )
  for (const [, h] of [...evaluation.horizons.entries()].sort((a, b) => a[0] - b[0])) {
    const dev = (h.total / evaluation.openingStock - 1) * 100
    const wageShare = h.seasonWages / Math.max(1, h.seasonGate + h.seasonSponsor)
    console.info(
      `    ${String(h.season).padEnd(7)}${fmt(h.total).padStart(15)}${dev.toFixed(1).padStart(7)}%` +
        `${fmt(h.min).padStart(14)}${fmt(h.median).padStart(14)}${fmt(h.max).padStart(14)}` +
        `${h.gini.toFixed(3).padStart(7)}${String(h.negatives).padStart(5)}${String(h.belowFourWeeks).padStart(5)}` +
        `${fmt(h.medianWeeklyPayroll).padStart(12)}${fmt(h.sponsorTier1Week).padStart(12)}${fmt(h.sponsorTier2Week).padStart(12)}` +
        `${(wageShare * 100).toFixed(1).padStart(11)}%`
    )
  }
  console.info(`    minimum balance reached by ANY club at ANY point: ${fmt(evaluation.minBalanceEver)}`)
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
  printProductionBanner("prod:economy:calibrate", target)
  console.info(`Now:      ${new Date().toISOString()}\n`)

  try {
    // ------------------------------------------------------------------
    // LOAD PRODUCTION, READ ONLY
    // ------------------------------------------------------------------
    const teams = await prisma.team.findMany({
      select: { id: true, isBot: true, balance: true, crowdStyle: true },
      orderBy: { id: "asc" },
    })
    const activeSeason = await prisma.season.findFirst({
      where: { isActive: true },
      select: { id: true, number: true },
      orderBy: { number: "desc" },
    })
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
    for (const row of playerRows) {
      const list = byTeam.get(row.teamId!) ?? []
      list.push({
        age: row.age,
        potential: row.potential,
        primaryPosition: row.primaryPosition,
        overall: row.overall,
        attributes: extractPlayerAttributes(row as unknown as Record<string, unknown>),
        storedWage: row.weeklySalary,
      })
      byTeam.set(row.teamId!, list)
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
    const openingStock = clubs.reduce((s, c) => s + c.startBalance, 0)

    console.info("=== BASE STATE ===")
    console.info(`  clubs ${clubs.length} (${clubs.filter((c) => !c.isBot).length} Human / ${clubs.filter((c) => c.isBot).length} BOT)`)
    console.info(`  players ${playerRows.length}   opening stock ${fmt(openingStock)}`)
    console.info(`  stored weekly payroll, league total ${fmt(squads.reduce((s, sq) => s + sq.reduce((a, p) => a + (p.storedWage ?? 0), 0), 0))}`)
    console.info(
      `  canonical weekly payroll at scale 1.0, league total ${fmt(squads.reduce((s, sq) => s + sq.reduce((a, p) => a + canonicalWage(p), 0), 0))}`
    )
    console.info(`  maintenance exemption boundary ${fmt(MAINTENANCE_EXEMPT_CAPACITY)} seats`)

    // ------------------------------------------------------------------
    // 1. F4 - ATTENDANCE QUALITY MODEL COMPARISON
    // ------------------------------------------------------------------
    console.info("\n=== 1. F4: ATTENDANCE QUALITY MODELS AT FOUR SQUAD SIZES ===")
    console.info("  Same club, same AVERAGE Overall at every size: for size n the n players")
    console.info("  whose Overall is closest to the full-squad mean are kept, so quality is")
    console.info("  held constant and ONLY headcount changes.")
    const sample = squads.reduce((best, sq) => (sq.length > best.length ? sq : best), squads[0])
    const fullMean = sample.reduce((s, p) => s + p.overall, 0) / sample.length
    const seatsSample = clubs[0].seats
    const fullGate = SEAT_TYPES.reduce((s, t) => s + seatsSample[t] * TICKET_PRICES[t], 0)
    console.info(`  reference club: ${sample.length} players, mean Overall ${fullMean.toFixed(2)}, capacity ${fmt(calculateStadiumCapacity(seatsSample))}`)
    console.info(
      `    ${"size".padEnd(6)}${"meanOVR".padStart(9)}` +
        `${"A quality".padStart(11)}${"A occ".padStart(8)}${"A season gate".padStart(15)}` +
        `${"B quality".padStart(11)}${"B occ".padStart(8)}${"B season gate".padStart(15)}` +
        `${"C quality".padStart(11)}${"C occ".padStart(8)}${"C season gate".padStart(15)}`
    )
    const modelResults = new Map<AttendanceModel, Map<number, number>>([
      ["A", new Map()],
      ["B", new Map()],
      ["C", new Map()],
    ])
    for (const size of [22, 20, 18, 16].filter((n) => n <= sample.length)) {
      const kept = [...sample].sort((a, b) => Math.abs(a.overall - fullMean) - Math.abs(b.overall - fullMean)).slice(0, size)
      const mean = kept.reduce((s, p) => s + p.overall, 0) / kept.length
      const cells: string[] = []
      for (const model of ["A", "B", "C"] as AttendanceModel[]) {
        const q = teamQuality(kept, model)
        const occ = Math.min(1, occupancyFor(q, 0))
        const gate = fullGate * occ * HOME_PER_SEASON
        modelResults.get(model)!.set(size, gate)
        cells.push(`${fmt(q).padStart(11)}${occ.toFixed(4).padStart(8)}${fmt(gate).padStart(15)}`)
      }
      console.info(`    ${String(size).padEnd(6)}${mean.toFixed(2).padStart(9)}${cells.join("")}`)
    }
    const sizesTested = [...modelResults.get("A")!.keys()].sort((a, b) => b - a)
    const bigSize = sizesTested[0]
    const smallSize = sizesTested[sizesTested.length - 1]
    console.info(`  COLLAPSE FROM ${bigSize} TO ${smallSize} PLAYERS AT UNCHANGED AVERAGE QUALITY:`)
    for (const model of ["A", "B", "C"] as AttendanceModel[]) {
      const big = modelResults.get(model)!.get(bigSize)!
      const small = modelResults.get(model)!.get(smallSize)!
      console.info(
        `    model ${model}: season gate ${fmt(big)} -> ${fmt(small)}  ` +
          `(${(((small - big) / Math.max(1, big)) * 100).toFixed(1)}%)`
      )
    }

    // ------------------------------------------------------------------
    // 2. THE JOINT SOLVER
    // ------------------------------------------------------------------
    console.info("\n=== 2. JOINT SOLVER: salary scale x sponsor coefficient x tier multiplier ===")
    const SEED = "phase3r-calibration"
    const HORIZONS = [5, 10, 20]
    const chosenModel: AttendanceModel = "B"
    console.info(`  attendance model used for the solve: ${chosenModel} (see section 1)`)
    console.info(`  F2 corrected: ONE seeded attendance roll per fixture drives crowd, stored`)
    console.info(`  attendance, match expenses and ticket revenue alike.`)
    const trajB = buildTrajectory(clubs, squads, 20, chosenModel, SEED)

    interface GridPoint extends Params {
      worstDeviation: number
      minBalanceEver: number
      feasible: boolean
      dev5: number
      dev10: number
      dev20: number
    }
    const runPoint = (p: Params): GridPoint => {
      const ev = evaluate(trajB, p, HORIZONS)
      const dev = (h: number) => (ev.horizons.get(h)!.total / ev.openingStock - 1) * 100
      return {
        ...p,
        worstDeviation: ev.worstDeviation,
        minBalanceEver: ev.minBalanceEver,
        feasible: ev.worstDeviation <= 0.15 && ev.minBalanceEver >= 0,
        dev5: dev(5),
        dev10: dev(10),
        dev20: dev(20),
      }
    }

    // THE LANDSCAPE IS A RIDGE, NOT A BASIN, AND IT IS NARROW.
    // A 20-season stock deviation of +/-15% on a 317M opening stock is +/-2.4M
    // of drift per season, while one grid step of 0.025 in salary scale is
    // worth about 8M of drift per season. Sampling a coarse grid would
    // therefore miss the feasible set almost entirely and then report a corner
    // as "closest", which is how a calibration gets decided by its own step
    // size. So the grid is printed for SHAPE only, and the answer is found by
    // solving, for each salary scale, the sponsor coefficient that zeroes the
    // 20-season drift - which reduces a 2-D search to a 1-D ridge.
    console.info("  LANDSCAPE (worst stock deviation across the 5/10/20 horizons, tier 1.25):")
    const kAxis = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    console.info(`    ${"salary".padStart(7)}${kAxis.map((k) => `k=${k.toFixed(2)}`.padStart(10)).join("")}`)
    for (let sv = 0.75; sv <= 1.0001; sv += 0.05) {
      const cells = kAxis.map((k) => {
        const p = runPoint({ salaryScale: Number(sv.toFixed(4)), sponsorK: k, tier1Mult: 1.25, tier2Mult: 1, maintenanceOn: false })
        const v = p.worstDeviation * 100
        return (v > 9999 ? ">9999" : v.toFixed(0)).padStart(9) + "%"
      })
      console.info(`    ${sv.toFixed(3).padStart(7)}${cells.join("")}`)
    }

    /** For a fixed salary scale, the sponsor coefficient that zeroes 20-season drift. */
    const solveK = (salaryScale: number): GridPoint => {
      const at = (k: number) => runPoint({ salaryScale, sponsorK: k, tier1Mult: 1.25, tier2Mult: 1, maintenanceOn: false })
      const zero = at(0)
      // dev20 rises monotonically with k. If it is already positive at k=0 this
      // salary scale alone puts too much money in and no sponsor can fix it.
      if (zero.dev20 >= 0) return zero
      let low = 0
      let high = 0.25
      let guard = 0
      while (at(high).dev20 < 0 && guard++ < 8) high *= 2
      for (let i = 0; i < 26; i++) {
        const mid = (low + high) / 2
        if (at(mid).dev20 < 0) low = mid
        else high = mid
      }
      return at((low + high) / 2)
    }

    console.info("\n  THE RIDGE: for each salary scale, the sponsor coefficient that zeroes 20-season drift")
    console.info(
      `    ${"salary".padStart(7)}${"sponsorK*".padStart(11)}${"dev5".padStart(8)}${"dev10".padStart(8)}${"dev20".padStart(8)}` +
        `${"worst dev".padStart(11)}${"min balance ever".padStart(18)}${"feasible".padStart(10)}`
    )
    const ridge: GridPoint[] = []
    for (let sv = 0.75; sv <= 1.0001; sv += 0.01) {
      const p = solveK(Number(sv.toFixed(4)))
      ridge.push(p)
      console.info(
        `    ${p.salaryScale.toFixed(3).padStart(7)}${p.sponsorK.toFixed(4).padStart(11)}` +
          `${p.dev5.toFixed(1).padStart(8)}${p.dev10.toFixed(1).padStart(8)}${p.dev20.toFixed(1).padStart(8)}` +
          `${(p.worstDeviation * 100).toFixed(2).padStart(10)}%${fmt(p.minBalanceEver).padStart(18)}` +
          `${(p.feasible ? "YES" : "no").padStart(10)}`
      )
    }
    const feasibleRidge = ridge.filter((p) => p.feasible)
    const within10 = feasibleRidge.filter((p) => p.worstDeviation <= 0.10)
    console.info(`  ridge points feasible (all horizons within +/-15% AND no club ever negative): ${feasibleRidge.length}`)
    console.info(`  ...of which inside the preferred +/-10% band: ${within10.length}`)

    // AMONG FEASIBLE POINTS, PREFER THE ONE WITH THE MOST SOLVENCY HEADROOM.
    // Every point on the ridge is equally stable by construction; what separates
    // them is how close the weakest club ever comes to zero, which is exactly
    // the margin that decides whether ordinary management is survivable.
    const pool = within10.length > 0 ? within10 : feasibleRidge
    const best = pool.length > 0
      ? [...pool].sort((a, b) => b.minBalanceEver - a.minBalanceEver)[0]
      : [...ridge].sort((a, b) => a.worstDeviation - b.worstDeviation)[0]
    if (pool.length === 0) {
      console.info("  NO FEASIBLE RIDGE POINT. Reporting the most stable point found instead.")
    }
    console.info(
      `  SELECTED: salary ${best.salaryScale.toFixed(3)}, sponsorK ${best.sponsorK.toFixed(4)}, ` +
        `worst deviation ${(best.worstDeviation * 100).toFixed(2)}%, minimum balance ever ${fmt(best.minBalanceEver)}`
    )

    // ------------------------------------------------------------------
    // 3. TIER MULTIPLIER SWEEP AT THE CHOSEN LEVEL
    // ------------------------------------------------------------------
    console.info("\n=== 3. TIER MULTIPLIER SWEEP (level held at the solved s,k) ===")
    console.info(`  base: salary ${best.salaryScale.toFixed(3)}, sponsorK ${best.sponsorK.toFixed(3)}`)
    console.info(
      `    ${"tier1".padStart(7)}${"worst dev".padStart(11)}${"min bal ever".padStart(15)}${"gini@20".padStart(9)}` +
        `${"T1/wk".padStart(11)}${"T2/wk".padStart(11)}${"annual diff".padStart(13)}${"5s cum".padStart(13)}${"10s cum".padStart(13)}${"neg@20".padStart(8)}`
    )
    for (const t1 of [1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3]) {
      const p: Params = { salaryScale: best.salaryScale, sponsorK: best.sponsorK, tier1Mult: t1, tier2Mult: 1, maintenanceOn: false }
      const ev = evaluate(trajB, p, HORIZONS)
      const h20 = ev.horizons.get(20)!
      const h5 = ev.horizons.get(5)!
      const h10 = ev.horizons.get(10)!
      const diffWeek = h20.sponsorTier1Week - h20.sponsorTier2Week
      console.info(
        `    ${t1.toFixed(2).padStart(7)}${(ev.worstDeviation * 100).toFixed(2).padStart(10)}%${fmt(ev.minBalanceEver).padStart(15)}` +
          `${h20.gini.toFixed(3).padStart(9)}${fmt(h20.sponsorTier1Week).padStart(11)}${fmt(h20.sponsorTier2Week).padStart(11)}` +
          `${fmt(diffWeek * WEEKS_PER_SEASON).padStart(13)}` +
          `${fmt((h5.sponsorTier1Week - h5.sponsorTier2Week) * WEEKS_PER_SEASON * 5).padStart(13)}` +
          `${fmt((h10.sponsorTier1Week - h10.sponsorTier2Week) * WEEKS_PER_SEASON * 10).padStart(13)}` +
          `${String(h20.negatives).padStart(8)}`
      )
    }

    // ------------------------------------------------------------------
    // 4. THE FINAL CANDIDATE, THREE SEEDS, WITH AND WITHOUT MAINTENANCE
    // ------------------------------------------------------------------
    console.info("\n=== 4. FINAL CANDIDATE ACROSS THREE DETERMINISTIC SEEDS ===")
    const finalParams: Params = { salaryScale: best.salaryScale, sponsorK: best.sponsorK, tier1Mult: 1.25, tier2Mult: 1, maintenanceOn: false }
    console.info(`  salary scale ${finalParams.salaryScale.toFixed(3)}   sponsorK ${finalParams.sponsorK.toFixed(3)}   tier 1.25 / 1.00`)
    const SEEDS = ["phase3r-calibration", "phase3r-seed-b", "phase3r-seed-c"]
    const seedEvals: Evaluation[] = []
    for (const seed of SEEDS) {
      const traj = seed === SEED ? trajB : buildTrajectory(clubs, squads, 20, chosenModel, seed)
      const ev = evaluate(traj, finalParams, HORIZONS, seed === SEED)
      seedEvals.push(ev)
      printHorizons(`SEED "${seed}"`, ev)
    }
    for (const h of HORIZONS) {
      const devs = seedEvals.map((ev) => (ev.horizons.get(h)!.total / ev.openingStock - 1) * 100)
      const mins = seedEvals.map((ev) => ev.horizons.get(h)!.min)
      console.info(
        `  AGGREGATE season ${h}: stock deviation ${Math.min(...devs).toFixed(1)}% .. ${Math.max(...devs).toFixed(1)}%   ` +
          `min club balance ${fmt(Math.min(...mins))} .. ${fmt(Math.max(...mins))}`
      )
    }
    console.info(
      `  minimum balance reached by ANY club at ANY point, across all three seeds: ` +
        `${fmt(Math.min(...seedEvals.map((e) => e.minBalanceEver)))}`
    )

    // ------------------------------------------------------------------
    // 5. CONTRADICTION CHECK - the PREVIOUS audit's recommendation
    // ------------------------------------------------------------------
    console.info("\n=== 5. CONTRADICTION CHECK: s=0.81, k=0.50, tier 1.25 (the previous recommendation) ===")
    const previous: Params = { salaryScale: 0.81, sponsorK: 0.5, tier1Mult: 1.25, tier2Mult: 1, maintenanceOn: false }
    printHorizons("PREVIOUS RECOMMENDATION, COMBINED", evaluate(trajB, previous, HORIZONS))
    console.info("  the same pair with maintenance above 10,600 activated (no club has expanded, so it is a no-op today):")
    printHorizons("PREVIOUS + MAINTENANCE", evaluate(trajB, { ...previous, maintenanceOn: true }, HORIZONS))

    // ------------------------------------------------------------------
    // 6. STADIUM PAYBACK UNDER THE FINAL MODEL
    // ------------------------------------------------------------------
    console.info("\n=== 6. STADIUM PAYBACK, MAINTENANCE ABOVE 10,600 ONLY ===")
    const occ = [...seedEvals[0].occupancySamples].sort((a, b) => a - b)
    const quartiles: [string, number][] = [
      ["lower quartile", pct(occ, 0.25)],
      ["median", pct(occ, 0.5)],
      ["upper quartile", pct(occ, 0.75)],
    ]
    console.info(`  occupancy drawn from the final candidate's own ${occ.length} simulated home fixtures`)
    for (const [label, o] of quartiles) {
      console.info(`  at ${label} occupancy ${o.toFixed(4)}:`)
      console.info(`    ${"class".padEnd(9)}${"cost".padStart(9)}${"gross/season".padStart(14)}${"net/season".padStart(12)}${"maint/season".padStart(14)}${"net-maint".padStart(11)}${"payback".padStart(10)}`)
      for (const t of SEAT_TYPES) {
        const gross = TICKET_PRICES[t] * o * HOME_PER_SEASON
        const net = gross - COST_PER_SPECTATOR * o * HOME_PER_SEASON - COST_PER_CAPACITY * HOME_PER_SEASON
        const maint = MAINTENANCE_COST_PER_SEAT[t] * WEEKS_PER_SEASON
        const after = net - maint
        console.info(
          `    ${t.padEnd(9)}${fmt(CONSTRUCTION_COST_PER_SEAT[t]).padStart(9)}${gross.toFixed(1).padStart(14)}${net.toFixed(1).padStart(12)}` +
            `${maint.toFixed(1).padStart(14)}${after.toFixed(1).padStart(11)}` +
            `${(after > 0 ? (CONSTRUCTION_COST_PER_SEAT[t] / after).toFixed(2) : "NEVER").padStart(10)}`
        )
      }
    }

    // ------------------------------------------------------------------
    // 7. STRESS SCENARIOS AND DISCRETIONARY RULES
    // ------------------------------------------------------------------
    console.info("\n=== 7. STRESS SCENARIOS UNDER THE FINAL CONSTANTS ===")
    const allPlayers = squads.flat().sort((a, b) => b.overall - a.overall)
    const stressSquads: [string, SimPlayer[]][] = [
      ["baseline median club   ", squads[Math.floor(squads.length / 2)]],
      ["expensive squad (top22)", clonePlayers(allPlayers.slice(0, 22))],
      ["weak squad (bottom 22) ", clonePlayers(allPlayers.slice(-22))],
      ["16-player roster       ", clonePlayers(squads[Math.floor(squads.length / 2)].slice(0, 16))],
      ["22-player roster       ", clonePlayers(squads[Math.floor(squads.length / 2)])],
    ]
    console.info(
      `    ${"scenario".padEnd(24)}${"size".padStart(6)}${"meanOVR".padStart(9)}${"quality".padStart(9)}` +
        `${"season gate".padStart(13)}${"season wage".padStart(13)}${"sponsor".padStart(11)}${"maint".padStart(9)}${"NET/season".padStart(13)}`
    )
    const refH = seedEvals[0].horizons.get(5)!
    const sponsorT2Season = refH.sponsorTier2Week * WEEKS_PER_SEASON
    for (const [label, squad] of stressSquads) {
      const q = teamQuality(squad, chosenModel)
      const o = Math.min(1, occupancyFor(q, 0))
      const attendance = SEAT_TYPES.reduce((s, t) => s + Math.round(seatsSample[t] * o), 0)
      const gate =
        (SEAT_TYPES.reduce((s, t) => s + Math.round(seatsSample[t] * o) * TICKET_PRICES[t], 0) -
          Math.round(BASE_MATCH_COST + COST_PER_CAPACITY * calculateStadiumCapacity(seatsSample) + COST_PER_SPECTATOR * attendance)) *
          HOME_PER_SEASON -
        AWAY_TRAVEL * AWAY_PER_SEASON
      const wage = squad.reduce((s, p) => s + Math.round(canonicalWage(p) * finalParams.salaryScale), 0) * WEEKS_PER_SEASON
      const mean = squad.reduce((s, p) => s + p.overall, 0) / squad.length
      console.info(
        `    ${label.padEnd(24)}${String(squad.length).padStart(6)}${mean.toFixed(1).padStart(9)}${fmt(q).padStart(9)}` +
          `${fmt(gate).padStart(13)}${fmt(-wage).padStart(13)}${fmt(sponsorT2Season).padStart(11)}${"0".padStart(9)}` +
          `${fmt(gate - wage + sponsorT2Season).padStart(13)}`
      )
    }

    console.info("\n  DISCRETIONARY RULES, MODELLED AGAINST THE FINAL CANDIDATE")
    const medianClubWeekly = refH.medianWeeklyPayroll
    const reserve = medianClubWeekly * RESERVE_WEEKS
    const medianBalance5 = refH.median
    console.info(`  four-week reserve at season 5's median payroll: ${fmt(reserve)}`)
    console.info(`  median club balance at season 5:                ${fmt(medianBalance5)}`)
    console.info(`  headroom a median club may spend discretionarily: ${fmt(Math.max(0, medianBalance5 - reserve))}`)
    for (const [label, expansion] of [
      ["+2,000 regular seats", 2_000],
      ["+5,000 regular seats", 5_000],
      ["+10,000 regular seats", 10_000],
    ] as [string, number][]) {
      const cost = expansion * CONSTRUCTION_COST_PER_SEAT.regular
      const seatsAfter: SeatCounts = { ...seatsSample, regular: seatsSample.regular + expansion }
      const maint = weeklyMaintenance(seatsAfter) * WEEKS_PER_SEASON
      const o = pct(occ, 0.5)
      const extraGate = (TICKET_PRICES.regular - COST_PER_SPECTATOR) * o * expansion * HOME_PER_SEASON - COST_PER_CAPACITY * expansion * HOME_PER_SEASON
      console.info(
        `    ${label.padEnd(22)} cost ${fmt(cost).padStart(12)}  affordable within reserve: ${cost <= Math.max(0, medianBalance5 - reserve) ? "YES" : "NO "}` +
          `  extra gate/season ${fmt(extraGate).padStart(11)}  maintenance/season ${fmt(maint).padStart(11)}` +
          `  payback ${extraGate - maint > 0 ? ((cost / (extraGate - maint)).toFixed(2) + " seasons") : "NEVER"}`
      )
    }

    const cheapest = squads[Math.floor(squads.length / 2)].reduce((a, b) => (a.overall < b.overall ? a : b))
    console.info(
      `\n  RELEASE, allowed to take the balance below zero (R8): a median club's cheapest player` +
        ` costs ${fmt(Math.round(canonicalWage(cheapest) * finalParams.salaryScale))} once and removes` +
        ` ${fmt(Math.round(canonicalWage(cheapest) * finalParams.salaryScale) * WEEKS_PER_SEASON)} of wage per season.` +
        `  Payback in weeks: 1. The roster floor of 16 and the positional minimums remain the binding constraint.`
    )

    console.info("\nCALIBRATION PROOF: REPORTED (read only, nothing mutated)")
  } catch (error) {
    console.error("prod:economy:calibrate failed:", error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) console.error(error.stack)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
