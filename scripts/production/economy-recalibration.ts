/**
 * PHASE 3R - NARROW RECALIBRATION. DIAGNOSTIC ONLY.
 *
 * SELECTs only. No runtime behaviour, no schema, no migration, no deploy, no
 * Production write.
 *
 * ONE DIMENSION IS SEARCHED AND EVERYTHING ELSE IS FROZEN BY DECISION:
 *   compression c = 0.50, sponsor k = 0.060, tier 1.25 / 1.00, the league-
 *   relative attendance neutral, the four-week reserve, maintenance above
 *   10,600 seats, the release rules and the re-pricing authority. Only the
 *   salary SCALE moves, and it is chosen to minimise the worst league-stock
 *   deviation across three horizons and three seeds.
 *
 * THE ATTENDANCE FORMULA IS NOW DECIDED, AND IT IS NOT THE PREVIOUS ONE:
 *
 *     quality = SUM(max(overall, 40)) + (22 - squadSize) x 40
 *             = 22 x 40 + SUM(max(overall - 40, 0))
 *
 * The second form is the one worth reading. Every squad starts from a fixed
 * floor of 880 and earns attendance ONLY for the quality a player carries ABOVE
 * replacement level. A player rated at or below 40 contributes exactly what an
 * empty slot contributes, so deleting him cannot move attendance at all - which
 * is the product rule the previous formula still violated, because there
 * SUM(overall) counted a 28-rated player as 28 while his empty slot counted 40.
 *
 * HELD-OUT VALIDATION IS NOT OPTIONAL HERE. The three original seeds are used
 * to CHOOSE the scale, so they stop being evidence the moment they are used
 * that way. Three seeds never seen by the search decide whether the answer
 * generalises, and nothing is tuned against them.
 *
 * Run with: npm run prod:economy:recalibrate
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import {
  SEAT_TYPES,
  TICKET_PRICES,
  MAINTENANCE_COST_PER_SEAT,
  DEFAULT_STARTING_SEATS,
  type SeatCounts,
} from "../../src/lib/stadium/config"
import { calculateStadiumCapacity } from "../../src/lib/stadium/metrics"
import { FALLBACK_OVERALL_MIN } from "../../src/lib/players/fallback-generator"
import { MAX_ACTIVE_ROSTER_SIZE } from "../../src/lib/players/roster"
import {
  AWAY_PER_SEASON,
  HOME_PER_SEASON,
  WEEKS_PER_SEASON,
  buildTrajectory,
  canonicalWage,
  fixturesInWeek,
  median,
  type ClubMeta,
  type SeasonClubState,
  toSimPlayer,
  type SimPlayer,
  type Trajectory,
} from "./economy-projection"

// ================= FROZEN BY DECISION =======================================
const SALARY_COMPRESSION = 0.5
const SPONSOR_K = 0.06
const TIER1_MULT = 1.25
const TIER2_MULT = 1.0
const SALARY_PIVOT = 20_000
const REPLACEMENT_OVERALL = FALLBACK_OVERALL_MIN // 40
const CALIBRATION_SEEDS = ["phase3r-calibration", "phase3r-seed-b", "phase3r-seed-c"]
const HOLDOUT_SEEDS = ["phase3r-holdout-a", "phase3r-holdout-b", "phase3r-holdout-c"]
const HORIZONS = [5, 10, 20]
const HARD_BAND = 15
const PREFERRED_BAND = 10
const FINE_SENSITIVITY_LEAGUE_PER_SEASON = 900_000

// --- Calendar and match-day constants, as measured in the Phase 3R audit -----
const AWAY_TRAVEL = 10_000
const BASE_MATCH_COST = 10_000
const COST_PER_CAPACITY = 0.5
const COST_PER_SPECTATOR = 3
const QUALITY_INFLUENCE = 0.0015
const BASE_OCCUPANCY = 0.62
const RESERVE_WEEKS = 4

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}
function pct(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
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

// ================= THE DECIDED ATTENDANCE FORMULA ===========================

/**
 * quality = SUM(max(overall, 40)) + (22 - squadSize) x 40
 *
 * Written below in the equivalent floor-plus-surplus form, because that is the
 * form that makes the property obvious: a squad's attendance is a fixed floor
 * plus whatever its players carry ABOVE replacement level, so a player at or
 * below 40 contributes nothing an empty slot would not also contribute, and
 * removing him cannot change attendance by even one seat.
 */
function teamQuality(players: readonly { overall: number }[]): number {
  let surplus = 0
  for (const p of players) surplus += Math.max(0, p.overall - REPLACEMENT_OVERALL)
  return MAX_ACTIVE_ROSTER_SIZE * REPLACEMENT_OVERALL + surplus
}

function occupancyFor(quality: number, noise: number, neutral: number): number {
  return Math.max(0.05, Math.min(1.5, BASE_OCCUPANCY + (quality - neutral) * QUALITY_INFLUENCE + noise))
}

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
  for (const t of SEAT_TYPES) cost += Math.max(0, seats[t] - DEFAULT_STARTING_SEATS[t]) * MAINTENANCE_COST_PER_SEAT[t]
  return cost
}


// ================= THE SALARY AUTHORITY =====================================
// Canonical inputs, and only these: overall, age, potential, primaryPosition -
// see economy-projection.ts, which owns canonicalWage.

let compressionNormaliser = 1

function transformWage(canonical: number, scale: number): number {
  return Math.round(
    scale *
      compressionNormaliser *
      Math.pow(SALARY_PIVOT, SALARY_COMPRESSION) *
      Math.pow(Math.max(1, canonical), 1 - SALARY_COMPRESSION)
  )
}

// ================= THE PROJECTION ===========================================
// Types, the season roll and the trajectory builder all live in
// economy-projection.ts, shared with the runtime regression so that both ask
// their question of the identical trajectory.

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
  longestEpisode: number
  deepest: number
  finalBalance: number
}
interface RunResult {
  horizons: Horizon[]
  worstInstant: number
  worstDeviation: number
  outcomes: ClubOutcome[]
  finalStates: SeasonClubState[]
  openingStock: number
}

function run(clubs: ClubMeta[], traj: Trajectory, scale: number, extraFineSink: boolean): RunResult {
  const balances = clubs.map((c) => c.startBalance)
  const openingStock = balances.reduce((s, b) => s + b, 0)
  const ultras = Math.max(1, clubs.filter((c) => c.ultras).length)
  const extraPerUltras = extraFineSink ? FINE_SENSITIVITY_LEAGUE_PER_SEASON / ultras : 0
  const outcomes: ClubOutcome[] = clubs.map((_, i) => ({
    index: i,
    everNegative: false,
    negativeWeeks: 0,
    longestEpisode: 0,
    deepest: balances[i],
    finalBalance: balances[i],
  }))
  const currentEpisode = clubs.map(() => 0)
  const horizons: Horizon[] = []
  let worstInstant = Math.min(...balances)

  for (let s = 0; s < traj.seasons.length; s++) {
    const row = traj.seasons[s]
    const wages = row.map((st) => st.canonicalWages.reduce((a, w) => a + transformWage(w, scale), 0))
    const sponsorBase = SPONSOR_K * median(wages)
    const multOf = (tier: number) => (tier === 1 ? TIER1_MULT : TIER2_MULT)
    const norm = row.reduce((acc, st) => acc + multOf(st.tier), 0) / row.length
    const sponsorOf = row.map((st) => (norm === 0 ? 0 : (sponsorBase * multOf(st.tier)) / norm))
    const homeNet = row.map((st, i) => {
      const list: number[] = []
      for (let f = 0; f < HOME_PER_SEASON; f++) {
        const flow = matchdayFlows(clubs[i].seats, st.quality, st.noise[f], traj.neutrals[s])
        list.push(flow.revenue - flow.expense)
      }
      return list
    })

    for (let week = 1; week <= WEEKS_PER_SEASON; week++) {
      const homeCount = fixturesInWeek(HOME_PER_SEASON, week)
      const awayCount = fixturesInWeek(AWAY_PER_SEASON, week)
      const homeStart = Math.floor((HOME_PER_SEASON * (week - 1)) / WEEKS_PER_SEASON)
      for (let i = 0; i < clubs.length; i++) {
        balances[i] += sponsorOf[i]
        balances[i] -= wages[i]
        balances[i] -= weeklyMaintenance(clubs[i].seats)
        for (let f = 0; f < homeCount; f++) balances[i] += homeNet[i][homeStart + f] ?? 0
        balances[i] -= awayCount * AWAY_TRAVEL
        if (week === WEEKS_PER_SEASON) {
          balances[i] -= row[i].fines
          if (clubs[i].ultras) balances[i] -= extraPerUltras
        }
        if (balances[i] < 0) {
          outcomes[i].everNegative = true
          outcomes[i].negativeWeeks++
          currentEpisode[i]++
          if (currentEpisode[i] > outcomes[i].longestEpisode) outcomes[i].longestEpisode = currentEpisode[i]
        } else {
          currentEpisode[i] = 0
        }
        if (balances[i] < outcomes[i].deepest) outcomes[i].deepest = balances[i]
        if (balances[i] < worstInstant) worstInstant = balances[i]
      }
    }

    const season = s + 1
    if (HORIZONS.includes(season)) {
      const sorted = [...balances].sort((a, b) => a - b)
      const total = balances.reduce((a, b) => a + b, 0)
      const t1 = row.findIndex((st) => st.tier === 1)
      const t2 = row.findIndex((st) => st.tier === 2)
      horizons.push({
        season,
        total,
        deviation: (total / openingStock - 1) * 100,
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
  return {
    horizons,
    worstInstant,
    worstDeviation: Math.max(...horizons.map((h) => Math.abs(h.deviation))),
    outcomes,
    finalStates: traj.seasons[traj.seasons.length - 1],
    openingStock,
  }
}

function printSeed(label: string, r: RunResult): void {
  console.info(`  SEED "${label}"`)
  console.info(
    `    ${"season".padEnd(7)}${"league total".padStart(15)}${"dev%".padStart(8)}${"min".padStart(13)}${"median".padStart(13)}` +
      `${"max".padStart(13)}${"gini".padStart(7)}${"neg".padStart(5)}${"<1wk".padStart(6)}${"<4wk".padStart(6)}${"med wk pay".padStart(12)}`
  )
  for (const h of r.horizons) {
    console.info(
      `    ${String(h.season).padEnd(7)}${fmt(h.total).padStart(15)}${h.deviation.toFixed(1).padStart(7)}%` +
        `${fmt(h.min).padStart(13)}${fmt(h.median).padStart(13)}${fmt(h.max).padStart(13)}${h.gini.toFixed(3).padStart(7)}` +
        `${String(h.negatives).padStart(5)}${String(h.belowOneWeek).padStart(6)}${String(h.belowFourWeeks).padStart(6)}` +
        `${fmt(h.medianWeeklyPayroll).padStart(12)}`
    )
  }
  console.info(`    worst balance at ANY instant: ${fmt(r.worstInstant)}    worst |deviation|: ${r.worstDeviation.toFixed(2)}%`)
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
  printProductionBanner("prod:economy:recalibrate", target)
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
    for (const row of playerRows) {
      const list = byTeam.get(row.teamId!) ?? []
      list.push(toSimPlayer(row))
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
    const allCanonical = squads.flat().map(canonicalWage)
    const rawSum = allCanonical.reduce((a, b) => a + b, 0)
    const shapedSum = allCanonical.reduce(
      (a, w) => a + Math.pow(SALARY_PIVOT, SALARY_COMPRESSION) * Math.pow(Math.max(1, w), 1 - SALARY_COMPRESSION),
      0
    )
    compressionNormaliser = shapedSum > 0 ? rawSum / shapedSum : 1

    console.info("=== FROZEN AUTHORITIES (only the salary scale is searched) ===")
    console.info(`  compression c = ${SALARY_COMPRESSION}   normaliser N = ${compressionNormaliser.toFixed(6)}`)
    console.info(`  sponsor k = ${SPONSOR_K}   tier ${TIER1_MULT} / ${TIER2_MULT}`)
    console.info(`  quality = SUM(max(overall, ${REPLACEMENT_OVERALL})) + (22 - n) x ${REPLACEMENT_OVERALL}`)
    console.info(`          = 22 x ${REPLACEMENT_OVERALL} + SUM(max(overall - ${REPLACEMENT_OVERALL}, 0))`)
    console.info(`  neutral = the league's own median quality that season, same formula`)
    console.info(`  clubs ${clubs.length} (${clubs.filter((c) => !c.isBot).length} Human / ${clubs.filter((c) => c.isBot).length} BOT)   players ${playerRows.length}`)
    const below40 = squads.flat().filter((p) => p.overall < REPLACEMENT_OVERALL).length
    console.info(`  players below the replacement level today: ${below40}/${playerRows.length} (${((below40 / playerRows.length) * 100).toFixed(1)}%)`)

    // ==================================================================
    // TASK 1. THE NEW ATTENDANCE FORMULA
    // ==================================================================
    console.info("\n=== 1. THE DECIDED ATTENDANCE FORMULA ===")
    const refIndex = Math.floor(squads.length / 2)
    const refSquad = squads[refIndex]
    const refSeats = clubs[refIndex].seats
    const fullGate = SEAT_TYPES.reduce((s, t) => s + refSeats[t] * TICKET_PRICES[t], 0)
    const refNeutral = teamQuality(refSquad)
    const mean = refSquad.reduce((s, p) => s + p.overall, 0) / refSquad.length
    const uniformOverall = Math.round(mean)
    const SCALE_FOR_PROOF = 0.73
    const seasonOf = (players: SimPlayer[]) => {
      const q = teamQuality(players)
      const o = Math.min(1, occupancyFor(q, 0, refNeutral))
      const attendance = SEAT_TYPES.reduce((s, t) => s + Math.round(refSeats[t] * o), 0)
      const gate =
        (SEAT_TYPES.reduce((s, t) => s + Math.round(refSeats[t] * o) * TICKET_PRICES[t], 0) -
          Math.round(BASE_MATCH_COST + COST_PER_CAPACITY * calculateStadiumCapacity(refSeats) + COST_PER_SPECTATOR * attendance)) *
          HOME_PER_SEASON -
        AWAY_TRAVEL * AWAY_PER_SEASON
      const payroll = players.reduce((s, p) => s + transformWage(canonicalWage(p), SCALE_FOR_PROOF), 0) * WEEKS_PER_SEASON
      return { q, o, gate, payroll, net: gate - payroll }
    }
    const uniform = (n: number): SimPlayer[] =>
      Array.from({ length: n }, () => ({ overall: uniformOverall, age: 26, potential: uniformOverall, primaryPosition: "CM", attributes: {} }))
    console.info(`  reference club: ${refSquad.length} players, mean Overall ${mean.toFixed(2)}, capacity ${fmt(calculateStadiumCapacity(refSeats))}`)
    console.info(`  equivalent-quality squads: every player synthesised at Overall ${uniformOverall}. Only headcount varies.`)
    console.info(
      `    ${"size".padEnd(6)}${"quality".padStart(9)}${"occupancy".padStart(11)}${"season gate".padStart(13)}` +
        `${"season payroll".padStart(16)}${"net operating".padStart(15)}${"vs 22".padStart(13)}`
    )
    let base22 = 0
    for (const size of [22, 21, 20, 19, 18, 17, 16]) {
      const r = seasonOf(uniform(size))
      if (size === 22) base22 = r.net
      console.info(
        `    ${String(size).padEnd(6)}${fmt(r.q).padStart(9)}${r.o.toFixed(4).padStart(11)}${fmt(r.gate).padStart(13)}` +
          `${fmt(-r.payroll).padStart(16)}${fmt(r.net).padStart(15)}${fmt(r.net - base22).padStart(13)}`
      )
    }

    console.info(`\n  RELEASING ONE SYNTHETIC PLAYER FROM A FULL SQUAD:`)
    console.info(
      `    ${"released OVR".padEnd(14)}${"d quality".padStart(11)}${"d occupancy".padStart(13)}${"d gate/season".padStart(15)}` +
        `${"wage saved".padStart(13)}${"d NET".padStart(13)}${"attendance rewarded?".padStart(22)}`
    )
    const weakest = [...refSquad].sort((a, b) => a.overall - b.overall)[0]
    let attendanceViolations = 0
    let monotoneViolations = 0
    let previousDelta = 0
    for (const v of [20, 28, 39, 40, 41, 50, 60, 80]) {
      const victim: SimPlayer = { overall: v, age: 26, potential: v, primaryPosition: "CM", attributes: {} }
      const withVictim = [...refSquad.filter((p) => p !== weakest), victim]
      const before = seasonOf(withVictim)
      const after = seasonOf(withVictim.filter((p) => p !== victim))
      const dQuality = after.q - before.q
      const wageSaved = transformWage(canonicalWage(victim), SCALE_FOR_PROOF) * WEEKS_PER_SEASON
      if (v <= REPLACEMENT_OVERALL && dQuality > 0) attendanceViolations++
      if (v > REPLACEMENT_OVERALL) {
        const expected = -(v - REPLACEMENT_OVERALL)
        if (dQuality !== expected) monotoneViolations++
        if (dQuality > previousDelta) monotoneViolations++
        previousDelta = dQuality
      }
      console.info(
        `    ${`OVR ${v}`.padEnd(14)}${fmt(dQuality).padStart(11)}${(after.o - before.o).toFixed(4).padStart(13)}` +
          `${fmt(after.gate - before.gate).padStart(15)}${fmt(wageSaved).padStart(13)}${fmt(after.net - before.net).padStart(13)}` +
          `${(dQuality > 0 ? "*** YES - VIOLATION" : "no").padStart(22)}`
      )
    }
    console.info(
      `  ASSERTION 1 - Overall <= ${REPLACEMENT_OVERALL} never increases attendance: ` +
        `${attendanceViolations === 0 ? "PASS" : `FAIL (${attendanceViolations})`}`
    )
    console.info(
      `  ASSERTION 2 - Overall > ${REPLACEMENT_OVERALL} decreases quality by exactly the surplus lost, monotonically: ` +
        `${monotoneViolations === 0 ? "PASS" : `FAIL (${monotoneViolations})`}`
    )
    console.info(`  Wage savings may still make a release rational; that is allowed. Attendance never rewards the deletion.`)

    // ==================================================================
    // TASK 2. NARROW SALARY-SCALE CALIBRATION
    // ==================================================================
    console.info("\n=== 2. NARROW CALIBRATION - salary scale only, three calibration seeds ===")
    const calTraj = CALIBRATION_SEEDS.map((seed) => ({ seed, traj: buildTrajectory(clubs, squads, 20, seed, teamQuality) }))
    const worstAcross = (scale: number, sink = false) =>
      Math.max(...calTraj.map(({ traj }) => run(clubs, traj, scale, sink).worstDeviation))
    // The suggested window is 0.720-0.740. It is searched at fine resolution AND
    // bracketed more widely, so that an answer sitting on a boundary is visible
    // as a boundary rather than reported as an optimum.
    const LO = 0.7
    const HI = 0.78
    const STEP = 0.0005
    let bestScale = LO
    let bestWorst = Infinity
    const profile: { scale: number; worst: number }[] = []
    for (let s = LO; s <= HI + 1e-9; s += STEP) {
      const scale = Number(s.toFixed(4))
      const w = worstAcross(scale)
      profile.push({ scale, worst: w })
      if (w < bestWorst) {
        bestWorst = w
        bestScale = scale
      }
    }
    console.info(`  searched ${profile.length} scales over [${LO}, ${HI}] at a step of ${STEP}`)
    console.info(`  profile across the suggested window:`)
    console.info(`    ${"scale".padStart(8)}${"worst |dev|".padStart(13)}`)
    for (const p of profile.filter((x) => Math.abs((x.scale * 1000) % 5) < 1e-6 && x.scale >= 0.715 && x.scale <= 0.745)) {
      console.info(`    ${p.scale.toFixed(4).padStart(8)}${p.worst.toFixed(2).padStart(12)}%${p.scale === bestScale ? "   <- best" : ""}`)
    }
    console.info(`  OPTIMUM: salary scale ${bestScale.toFixed(4)}, worst |deviation| across all calibration seeds and horizons ${bestWorst.toFixed(2)}%`)
    if (bestScale <= LO + STEP || bestScale >= HI - STEP) {
      console.info(`  WARNING: the optimum sits on the searched boundary - the window is too narrow.`)
    }

    // ==================================================================
    // TASK 3. FREEZE
    // ==================================================================
    const FROZEN_SCALE = bestScale
    console.info("\n=== 3. FROZEN CANDIDATE ===")
    console.info(`  salary scale        ${FROZEN_SCALE.toFixed(4)}   <-- FROZEN, nothing changes after this line`)
    console.info(`  salary compression  ${SALARY_COMPRESSION}`)
    console.info(`  sponsor coefficient ${SPONSOR_K}`)
    console.info(`  tier multipliers    ${TIER1_MULT} / ${TIER2_MULT}`)

    // ==================================================================
    // TASK 4. HELD-OUT VALIDATION
    // ==================================================================
    console.info("\n=== 4. CALIBRATION SEEDS, THEN HELD-OUT SEEDS (never seen by the search) ===")
    const allRuns: { seed: string; kind: "calibration" | "held out"; result: RunResult }[] = []
    for (const { seed, traj } of calTraj) {
      const r = run(clubs, traj, FROZEN_SCALE, false)
      allRuns.push({ seed, kind: "calibration", result: r })
      printSeed(`${seed}  [calibration]`, r)
    }
    for (const seed of HOLDOUT_SEEDS) {
      const r = run(clubs, buildTrajectory(clubs, squads, 20, seed, teamQuality), FROZEN_SCALE, false)
      allRuns.push({ seed, kind: "held out", result: r })
      printSeed(`${seed}  [HELD OUT]`, r)
    }
    const calWorst = Math.max(...allRuns.filter((r) => r.kind === "calibration").map((r) => r.result.worstDeviation))
    const holdWorst = Math.max(...allRuns.filter((r) => r.kind === "held out").map((r) => r.result.worstDeviation))
    const overallWorst = Math.max(calWorst, holdWorst)
    console.info(`\n  worst |deviation|  calibration ${calWorst.toFixed(2)}%   HELD OUT ${holdWorst.toFixed(2)}%   overall ${overallWorst.toFixed(2)}%`)
    console.info(`  HARD ACCEPTANCE (+/-${HARD_BAND}% on EVERY seed and horizon): ${overallWorst <= HARD_BAND ? "PASS" : "FAIL"}`)
    console.info(`  PREFERRED (+/-${PREFERRED_BAND}%): ${overallWorst <= PREFERRED_BAND ? "achieved" : "not achieved"}`)

    // ==================================================================
    // TASK 5. SOLVENCY
    // ==================================================================
    console.info("\n=== 5. SOLVENCY ACROSS ALL SIX SEEDS ===")
    const totalClubWeeks = clubs.length * 20 * WEEKS_PER_SEASON
    for (const { seed, kind, result } of allRuns) {
      const negatives = result.outcomes.filter((o) => o.everNegative)
      const negWeeks = negatives.reduce((s, o) => s + o.negativeWeeks, 0)
      const longest = negatives.reduce((m, o) => Math.max(m, o.longestEpisode), 0)
      console.info(
        `\n  "${seed}" [${kind}]  deepest ${fmt(result.worstInstant)}   distinct clubs ever negative ${negatives.length}/${clubs.length}` +
          `   negative club-weeks ${negWeeks}/${totalClubWeeks} (${((negWeeks / totalClubWeeks) * 100).toFixed(3)}%)   longest episode ${longest} weeks`
      )
      if (negatives.length === 0) {
        console.info("    no club was ever negative at any instant.")
        continue
      }
      console.info(
        `    ${"club".padEnd(10)}${"H/BOT".padStart(7)}${"tier".padStart(6)}${"capacity".padStart(10)}${"wk payroll".padStart(12)}` +
          `${"avgOVR".padStart(8)}${"deepest".padStart(14)}${"neg wks".padStart(9)}${"longest".padStart(9)}${"recovers".padStart(10)}`
      )
      for (const o of [...negatives].sort((a, b) => a.deepest - b.deepest).slice(0, 12)) {
        const st = result.finalStates[o.index]
        console.info(
          `    ${clubs[o.index].id.slice(-8).padEnd(10)}${(clubs[o.index].isBot ? "BOT" : "HUMAN").padStart(7)}${String(st.tier).padStart(6)}` +
            `${fmt(calculateStadiumCapacity(clubs[o.index].seats)).padStart(10)}` +
            `${fmt(st.canonicalWages.reduce((a, w) => a + transformWage(w, FROZEN_SCALE), 0)).padStart(12)}` +
            `${st.averageOverall.toFixed(1).padStart(8)}${fmt(o.deepest).padStart(14)}${String(o.negativeWeeks).padStart(9)}` +
            `${String(o.longestEpisode).padStart(9)}${(o.finalBalance >= 0 ? "YES" : "no").padStart(10)}`
        )
      }
    }

    // ==================================================================
    // TASK 6. FAN-FINE SENSITIVITY - only after the RAW candidate passed
    // ==================================================================
    console.info("\n=== 6. FAN-FINE SENSITIVITY (a check, never a crutch) ===")
    if (overallWorst > HARD_BAND) {
      console.info("  SKIPPED: the RAW candidate did not pass the hard band, so the sink may not be")
      console.info("  used to rescue it. Fix the raw economy first.")
    } else {
      console.info(
        `  ${fmt(FINE_SENSITIVITY_LEAGUE_PER_SEASON)} per season charged only to the ${clubs.filter((c) => c.ultras).length} ultras clubs.`
      )
      console.info(`    ${"seed".padEnd(26)}${"dev5".padStart(9)}${"dev10".padStart(9)}${"dev20".padStart(9)}${"worst instant".padStart(16)}${"neg@20".padStart(8)}`)
      let sinkOk = true
      for (const { seed, kind } of allRuns) {
        const traj = calTraj.find((c) => c.seed === seed)?.traj ?? buildTrajectory(clubs, squads, 20, seed, teamQuality)
        const r = run(clubs, traj, FROZEN_SCALE, true)
        for (const h of r.horizons) if (h.deviation < -HARD_BAND) sinkOk = false
        console.info(
          `    ${`${seed} [${kind === "held out" ? "H" : "C"}]`.padEnd(26)}${r.horizons[0].deviation.toFixed(1).padStart(8)}%` +
            `${r.horizons[1].deviation.toFixed(1).padStart(8)}%${r.horizons[2].deviation.toFixed(1).padStart(8)}%` +
            `${fmt(r.worstInstant).padStart(16)}${String(r.horizons[2].negatives).padStart(8)}`
        )
      }
      console.info(`  The sink must not push any seed below -${HARD_BAND}%: ${sinkOk ? "PASS" : "FAIL"}`)
    }

    console.info("\nRECALIBRATION: REPORTED (read only, nothing mutated)")
  } catch (error) {
    console.error("prod:economy:recalibrate failed:", error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) console.error(error.stack)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
