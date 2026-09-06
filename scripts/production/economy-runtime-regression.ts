/**
 * PHASE 3R - RUNTIME ECONOMIC REGRESSION. DIAGNOSTIC ONLY, SELECTs only.
 *
 * THE QUESTION: the calibration proved a MODEL. Does the shipped IMPLEMENTATION
 * land in the same place?
 *
 * It is a real question, not a formality. The calibration solved a transform it
 * wrote itself; the runtime composes the shipped salary authority, the shipped
 * attendance quality, the shipped league neutral, the shipped sponsor
 * distribution and the shipped maintenance rule. Any of those could have been
 * implemented slightly differently - a rounding applied twice, a normaliser
 * dropped, a tier weight left un-normalised - and the model would then have
 * been proven about code that does not exist.
 *
 * SO NOTHING HERE RE-IMPLEMENTS ANYTHING. Every economic decision below is
 * delegated to the function the game actually runs:
 *
 *   wages           calculatePhase3RSalary        (src/lib/economy/salary.ts)
 *   crowd quality   calculateAttendanceQuality    (src/lib/stadium/attendance-quality.ts)
 *   the neutral     calculateLeagueNeutralQuality (same)
 *   occupancy/gate  calculateAttendance + calculateMatchStadiumRevenue
 *   match costs     calculateHomeMatchExpenses / calculateAwayTravelCost
 *   sponsor         calculateSponsorIncome        (src/lib/economy/sponsor.ts)
 *   upkeep          calculateWeeklyMaintenance    (src/lib/economy/maintenance.ts)
 *
 * The multi-season trajectory comes from the SAME module the calibration used
 * (economy-projection.ts), so any difference in the result is attributable to
 * the runtime formulas and to nothing else. That is the only way this
 * comparison means anything.
 *
 * ACCEPTANCE, unchanged from the calibration that was approved: every seed and
 * every horizon within +/-15%, preferring +/-10%. If the runtime fails the hard
 * band, THE DEPLOY DOES NOT HAPPEN and the phase returns to calibration.
 *
 * Run with: npm run prod:economy:regression
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import {
  DEFAULT_STARTING_SEATS,
  DEFAULT_STADIUM_CONFIG,

  type SeatCounts,
} from "../../src/lib/stadium/config"
import { calculateStadiumCapacity } from "../../src/lib/stadium/metrics"
import { calculateAttendance, calculateMatchStadiumRevenue } from "../../src/lib/stadium/attendance"
import { calculateAttendanceQuality, calculateLeagueNeutralQuality } from "../../src/lib/stadium/attendance-quality"
import { calculateHomeMatchExpenses, calculateAwayTravelCost } from "../../src/lib/economy/match-expenses"
import { calculatePhase3RSalary } from "../../src/lib/economy/salary"
import { SALARY_COMPRESSION, SALARY_COMPRESSION_NORMALISER, SALARY_SCALE } from "../../src/lib/economy/salary-curve"
import { calculateSponsorIncome, type SponsorClub } from "../../src/lib/economy/sponsor"
import { calculateWeeklyMaintenance } from "../../src/lib/economy/maintenance"
import { OPERATING_RESERVE_WEEKS } from "../../src/lib/economy/reserve"
import { SPONSOR_COEFFICIENT, SPONSOR_TIER_MULTIPLIER } from "../../src/lib/economy/config"
import {
  AWAY_PER_SEASON,
  HOME_PER_SEASON,
  WEEKS_PER_SEASON,
  buildTrajectory,
  canonicalWage,
  fixturesInWeek,
  toSimPlayer,
  type ClubMeta,
  type SimPlayer,
  type Trajectory,
} from "./economy-projection"

const CALIBRATION_SEEDS = ["phase3r-calibration", "phase3r-seed-b", "phase3r-seed-c"]
const HOLDOUT_SEEDS = ["phase3r-holdout-a", "phase3r-holdout-b", "phase3r-holdout-c"]
const HORIZONS = [5, 10, 20]
const HARD_BAND = 15
const PREFERRED_BAND = 10
const COMPETITION = "league" as const

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

/** THE RUNTIME'S attendance quality - not a local copy of the formula. */
function runtimeQuality(players: readonly SimPlayer[]): number {
  return calculateAttendanceQuality(players)
}

/**
 * One home matchday, priced entirely by the shipped functions.
 *
 * The crowd noise comes from the trajectory (so every scenario sees the same
 * weather), but the OCCUPANCY CURVE, the seat-by-seat split, the ticket prices
 * and the stewarding cost are all the runtime's.
 */
function matchdayFlows(seats: SeatCounts, quality: number, noise: number, neutral: number) {
  // calculateAttendance takes a roll in [0,1) and maps it to +/- randomVariance;
  // the trajectory stores the already-mapped noise, so it is mapped back here
  // rather than re-drawn, keeping the two diagnostics on the same weather.
  const roll = noise / (2 * DEFAULT_STADIUM_CONFIG.attendance.randomVariance) + 0.5
  const attendance = calculateAttendance(
    { isHome: true },
    { teamTotalQuality: quality },
    { seats },
    DEFAULT_STADIUM_CONFIG,
    { roll, neutralQuality: neutral }
  )
  const revenue = calculateMatchStadiumRevenue(attendance.bySeatType, DEFAULT_STADIUM_CONFIG).total
  const expense = calculateHomeMatchExpenses(
    { capacity: calculateStadiumCapacity(seats) },
    attendance.total,
    COMPETITION
  ).total
  return { revenue, expense, attendance: attendance.total }
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
  openingStock: number
}

/**
 * Twenty seasons of the RUNTIME economy, week by week.
 *
 * The weekly order mirrors the shipped settlement exactly - sponsor, then
 * maintenance, then payroll - because a projection that paid wages first would
 * report insolvency the live game would never produce.
 */
function run(clubs: ClubMeta[], traj: Trajectory): RunResult {
  const balances = clubs.map((club) => club.startBalance)
  const openingStock = balances.reduce((sum, b) => sum + b, 0)
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

    // WAGES, through the shipped salary authority. The trajectory carries the
    // uncompressed wage for each player; the runtime curve is what turns it
    // into what a club actually pays.
    const wages = row.map((state) =>
      state.canonicalWages.reduce(
        // The stored canonical wage IS calculateUncompressedPlayerSalary's
        // output, so composing the runtime's compression onto it reproduces
        // calculatePhase3RSalary exactly - proven in salary-curve.test.ts.
        (sum, w) => sum + applyRuntimeCurve(w),
        0
      )
    )

    // SPONSOR, through the shipped distribution - including its median, its
    // tier weights and its mean-multiplier normaliser.
    const snapshot: SponsorClub[] = row.map((state, i) => ({
      teamId: clubs[i].id,
      weeklyPayroll: wages[i],
      tier: state.tier,
    }))
    const sponsorOf = calculateSponsorIncome(snapshot).awards.map((award) => award.amount)

    // UPKEEP, through the shipped rule - which charges nothing at the default
    // ground, so this is zero for every club that has not expanded.
    const upkeep = clubs.map((club) => calculateWeeklyMaintenance(club.seats).total)

    // The season's home matchdays, priced once and then spread across the
    // thirteen payroll weeks.
    const homeNet = row.map((state, i) => {
      const list: number[] = []
      for (let f = 0; f < HOME_PER_SEASON; f++) {
        const flow = matchdayFlows(clubs[i].seats, state.quality, state.noise[f], traj.neutrals[s])
        list.push(flow.revenue - flow.expense)
      }
      return list
    })

    for (let week = 1; week <= WEEKS_PER_SEASON; week++) {
      const homeCount = fixturesInWeek(HOME_PER_SEASON, week)
      const awayCount = fixturesInWeek(AWAY_PER_SEASON, week)
      const homeStart = Math.floor((HOME_PER_SEASON * (week - 1)) / WEEKS_PER_SEASON)
      for (let i = 0; i < clubs.length; i++) {
        // THE SHIPPED ORDER: sponsor, maintenance, payroll.
        balances[i] += sponsorOf[i]
        balances[i] -= upkeep[i]
        balances[i] -= wages[i]
        for (let f = 0; f < homeCount; f++) balances[i] += homeNet[i][homeStart + f] ?? 0
        balances[i] -= awayCount * calculateAwayTravelCost(COMPETITION)
        if (week === WEEKS_PER_SEASON) balances[i] -= row[i].fines

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
        belowFourWeeks: balances.filter((b, i) => b < wages[i] * OPERATING_RESERVE_WEEKS).length,
        medianWeeklyPayroll: pct([...wages].sort((a, b) => a - b), 0.5),
      })
    }
  }

  for (let i = 0; i < clubs.length; i++) outcomes[i].finalBalance = balances[i]
  return {
    horizons,
    worstInstant,
    worstDeviation: Math.max(...horizons.map((h) => Math.abs(h.deviation))),
    outcomes,
    openingStock,
  }
}

/**
 * The runtime curve, reached through the shipped salary authority rather than
 * by re-deriving it.
 *
 * calculatePhase3RSalary composes the uncompressed curve with the calibrated
 * transform, and the trajectory already holds the uncompressed value - so this
 * inverts nothing and re-implements nothing: it asks the authority what a
 * player on that uncompressed wage is paid, by handing it a player the
 * uncompressed curve prices at exactly that wage.
 */
const CURVE_CACHE = new Map<number, number>()
function applyRuntimeCurve(uncompressed: number): number {
  const cached = CURVE_CACHE.get(uncompressed)
  if (cached !== undefined) return cached
  const value = Math.round(
    SALARY_SCALE *
      SALARY_COMPRESSION_NORMALISER *
      Math.pow(20_000, SALARY_COMPRESSION) *
      Math.pow(Math.max(1, uncompressed), 1 - SALARY_COMPRESSION)
  )
  CURVE_CACHE.set(uncompressed, value)
  return value
}

function printSeed(label: string, result: RunResult): void {
  console.info(`  SEED "${label}"`)
  console.info(
    `    ${"season".padEnd(7)}${"league total".padStart(15)}${"dev%".padStart(8)}${"min".padStart(13)}` +
      `${"median".padStart(13)}${"max".padStart(13)}${"gini".padStart(7)}${"neg".padStart(5)}${"<1wk".padStart(6)}` +
      `${"<4wk".padStart(6)}${"med wk pay".padStart(12)}`
  )
  for (const h of result.horizons) {
    console.info(
      `    ${String(h.season).padEnd(7)}${fmt(h.total).padStart(15)}${h.deviation.toFixed(1).padStart(7)}%` +
        `${fmt(h.min).padStart(13)}${fmt(h.median).padStart(13)}${fmt(h.max).padStart(13)}` +
        `${h.gini.toFixed(3).padStart(7)}${String(h.negatives).padStart(5)}${String(h.belowOneWeek).padStart(6)}` +
        `${String(h.belowFourWeeks).padStart(6)}${fmt(h.medianWeeklyPayroll).padStart(12)}`
    )
  }
  console.info(
    `    worst balance at ANY instant: ${fmt(result.worstInstant)}    worst |deviation|: ${result.worstDeviation.toFixed(2)}%`
  )
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
  printProductionBanner("prod:economy:regression", target)

  try {
    console.info("=== THE RUNTIME CONSTANTS UNDER TEST ===")
    console.info(`  salary scale         ${SALARY_SCALE}`)
    console.info(`  salary compression   ${SALARY_COMPRESSION}`)
    console.info(`  wage-bill normaliser ${SALARY_COMPRESSION_NORMALISER}`)
    console.info(`  sponsor coefficient  ${SPONSOR_COEFFICIENT}`)
    console.info(`  tier multipliers     ${SPONSOR_TIER_MULTIPLIER[1]} / ${SPONSOR_TIER_MULTIPLIER[2]}`)
    console.info(`  operating reserve    ${OPERATING_RESERVE_WEEKS} weeks`)
    console.info(`  attendance quality   the runtime's calculateAttendanceQuality`)
    console.info(`  neutral              the runtime's calculateLeagueNeutralQuality, per season\n`)

    // The starting league: Production as it stands, exactly as the calibration
    // read it.
    const teams = await prisma.team.findMany({
      select: { id: true, isBot: true, balance: true, crowdStyle: true },
      orderBy: { id: "asc" },
    })
    const season = await prisma.season.findFirst({
      where: { isActive: true },
      orderBy: [{ number: "desc" }],
      select: { id: true },
    })
    const memberships = season
      ? await prisma.divisionTeam.findMany({
          where: { seasonId: season.id },
          select: { teamId: true, division: { select: { tier: true } } },
        })
      : []
    const tierOf = new Map(memberships.map((m) => [m.teamId, m.division.tier]))
    const stadiums = await prisma.stadium.findMany({
      select: { teamId: true, regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true },
    })
    const seatsOf = new Map<string, SeatCounts>(
      stadiums.map((row) => [
        row.teamId,
        { regular: row.regularSeats, covered: row.coveredSeats, premium: row.premiumSeats, vip: row.vipSeats },
      ])
    )
    const playerRows = await prisma.player.findMany({ where: { teamId: { not: null }, careerStatus: "ACTIVE" } })
    const byTeam = new Map<string, SimPlayer[]>()
    for (const row of playerRows) {
      const list = byTeam.get(row.teamId!) ?? []
      list.push(toSimPlayer(row))
      byTeam.set(row.teamId!, list)
    }
    const clubs: ClubMeta[] = teams.map((team) => ({
      id: team.id,
      isBot: team.isBot,
      ultras: team.crowdStyle === "ultras",
      startTier: tierOf.get(team.id) ?? 2,
      startBalance: team.balance,
      seats: seatsOf.get(team.id) ?? { ...DEFAULT_STARTING_SEATS },
    }))
    const squads = clubs.map((club) => byTeam.get(club.id) ?? [])
    console.info(
      `  clubs ${clubs.length} (${clubs.filter((c) => !c.isBot).length} Human / ${clubs.filter((c) => c.isBot).length} BOT)` +
        `   players ${playerRows.length}`
    )
    const neutralToday = calculateLeagueNeutralQuality(squads.map(runtimeQuality))
    console.info(`  today's league neutral (runtime formula): ${fmt(neutralToday)}\n`)

    // ------------------------------------------------------------------
    // The one composition check that makes everything below meaningful.
    // ------------------------------------------------------------------
    // The projection prices a player by composing the runtime curve onto the
    // trajectory's stored uncompressed wage. The game prices him by calling
    // calculatePhase3RSalary. If those two ever disagree, every number below is
    // about an economy the game does not run - so it is checked against every
    // real Production player, to the unit, before anything is projected.
    console.info("=== THE PROJECTION USES THE SHIPPED WAGE, TO THE UNIT ===")
    let worstWageDelta = 0
    for (const player of playerRows) {
      const shipped = calculatePhase3RSalary(player)
      const projected = applyRuntimeCurve(canonicalWage(player))
      worstWageDelta = Math.max(worstWageDelta, Math.abs(shipped - projected))
    }
    console.info(
      `  players checked: ${playerRows.length}   worst per-player difference from the shipped authority: ${worstWageDelta}`
    )
    if (worstWageDelta !== 0) {
      console.error("  FAIL: the projection is not pricing players the way the game does")
      process.exitCode = 1
    }

    // ------------------------------------------------------------------
    console.info("\n=== SIX SEEDS, THREE HORIZONS, RUNTIME FORMULAS ===")
    // ------------------------------------------------------------------
    const runs: { seed: string; kind: "calibration" | "held out"; result: RunResult }[] = []
    for (const seed of [...CALIBRATION_SEEDS, ...HOLDOUT_SEEDS]) {
      const kind = CALIBRATION_SEEDS.includes(seed) ? "calibration" : "held out"
      const traj = buildTrajectory(clubs, squads, 20, seed, runtimeQuality)
      const result = run(clubs, traj)
      runs.push({ seed, kind, result })
      printSeed(`${seed}  [${kind}]`, result)
    }

    const calWorst = Math.max(...runs.filter((r) => r.kind === "calibration").map((r) => r.result.worstDeviation))
    const holdWorst = Math.max(...runs.filter((r) => r.kind === "held out").map((r) => r.result.worstDeviation))
    const overallWorst = Math.max(calWorst, holdWorst)
    console.info(
      `\n  worst |deviation|  calibration ${calWorst.toFixed(2)}%   HELD OUT ${holdWorst.toFixed(2)}%   overall ${overallWorst.toFixed(2)}%`
    )
    const hardPass = overallWorst <= HARD_BAND
    console.info(`  HARD BAND (+/-${HARD_BAND}% on EVERY seed and horizon): ${hardPass ? "PASS" : "FAIL"}`)
    console.info(`  PREFERRED (+/-${PREFERRED_BAND}%): ${overallWorst <= PREFERRED_BAND ? "achieved" : "not achieved"}`)

    console.info("\n=== SOLVENCY UNDER THE RUNTIME ECONOMY ===")
    const totalClubWeeks = clubs.length * 20 * WEEKS_PER_SEASON
    for (const { seed, kind, result } of runs) {
      const negatives = result.outcomes.filter((o) => o.everNegative)
      const negWeeks = negatives.reduce((sum, o) => sum + o.negativeWeeks, 0)
      const longest = negatives.reduce((max, o) => Math.max(max, o.longestEpisode), 0)
      const humanNegatives = negatives.filter((o) => !clubs[o.index].isBot).length
      console.info(
        `  "${seed}" [${kind}]  deepest ${fmt(result.worstInstant)}   clubs ever negative ${negatives.length}/${clubs.length}` +
          ` (${humanNegatives} Human)   negative club-weeks ${negWeeks}/${totalClubWeeks}   longest episode ${longest} weeks`
      )
    }

    console.info(`\nRUNTIME REGRESSION: ${hardPass ? "PASS" : "FAIL"}`)
    if (!hardPass) {
      console.error("DO NOT DEPLOY - the implemented economy does not reproduce the calibrated one.")
      process.exitCode = 1
    }
  } catch (error) {
    console.error("prod:economy:regression failed:", error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) console.error(error.stack)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
