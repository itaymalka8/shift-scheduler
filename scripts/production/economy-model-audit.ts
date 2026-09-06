/**
 * PHASE 3R - READ ONLY ECONOMY MEASUREMENT AND MULTI-SEASON PROJECTION.
 *
 * SELECTs only. It never settles anything, never writes a ledger row, never
 * touches a balance, never advances a season. Everything below either reads
 * Production or does arithmetic in memory over what it read.
 *
 * WHY IT EXISTS ALONGSIDE prod:economy:audit. That script answers "is it safe
 * to switch autonomous payroll on" - one week, one balance column, one gate.
 * Phase 3R asks a different question: does this economy SURVIVE, season after
 * season, without a human moving money by hand. That needs the distribution
 * tails (p10/p90), the tier split promotion/relegation just made meaningful,
 * a per-club profit and loss, a stadium payback calculation, and above all a
 * MULTI-SEASON PROJECTION run through the game's own formulas rather than a
 * spreadsheet's idea of them.
 *
 * THE PROJECTION IMPORTS THE REAL FUNCTIONS - calculateAttendance,
 * calculateMatchStadiumRevenue, calculateHomeMatchExpenses,
 * calculateAwayTravelCost, calculatePlayerSalary, developPlayer,
 * rollRetirement, generateFallbackPlayer - so a rebalance of any config
 * constant changes this projection automatically, and a projection that
 * disagrees with the game is a bug in one of them rather than in a
 * hand-copied number here.
 *
 * DETERMINISM. calculateAttendance draws from Math.random (see section 5 of
 * the report - that is itself a finding). The projection therefore installs a
 * seeded Math.random for its own duration and restores the original
 * afterwards, so the same Production state always yields the same projection.
 *
 * Run with: npm run prod:economy:model
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
  DEFAULT_STARTING_BALANCE,
  DEFAULT_STARTING_SEATS,
  type SeatCounts,
  type SeatType,
} from "../../src/lib/stadium/config"
import { calculateAttendance, calculateMatchStadiumRevenue } from "../../src/lib/stadium/attendance"
import { calculateStadiumCapacity } from "../../src/lib/stadium/metrics"
import { calculateHomeMatchExpenses, calculateAwayTravelCost } from "../../src/lib/economy/match-expenses"
import { calculatePlayerSalary } from "../../src/lib/economy/salary"
import { calculateTeamTotalQuality } from "../../src/lib/players/quality"
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
import { calculatePlayerOverall } from "../../src/lib/players/overall"
import { DEFAULT_GAME_BALANCE_CONFIG } from "../../src/lib/match/engine/config"

// --- The real calendar, stated once ------------------------------------------
//
// 20 clubs, double round robin = 380 fixtures per division = 38 matchdays, 19
// of them at home. Matchdays run Mon/Wed/Sat, so matchday 38 lands 86 days
// after matchday 1 (see computeMatchdayDate), and the next season starts on
// the Monday at least 24h after the transition. 13 Thursday payroll
// boundaries per season cycle is the honest round number that falls out of
// that; SEASON_PAYROLL_WEEKS_LOW/HIGH bracket the uncertainty.
const HOME_FIXTURES_PER_SEASON = 19
const AWAY_FIXTURES_PER_SEASON = 19
const SEASON_PAYROLL_WEEKS = 13
const SEASON_PAYROLL_WEEKS_LOW = 12
const SEASON_PAYROLL_WEEKS_HIGH = 14

/** Every attribute column, as a Prisma select - extractPlayerAttributes needs them all. */
const ATTRIBUTE_SELECT = Object.fromEntries(
  Object.keys(extractPlayerAttributes({})).map((key) => [key, true])
) as Record<string, true>

function pct(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

function distribution(label: string, values: number[], pad = 34): void {
  if (values.length === 0) {
    console.info(`  ${label.padEnd(pad)} none`)
    return
  }
  const s = [...values].sort((a, b) => a - b)
  const total = s.reduce((sum, v) => sum + v, 0)
  console.info(
    `  ${label.padEnd(pad)} n=${s.length} min=${fmt(s[0])} p10=${fmt(pct(s, 0.1))} p25=${fmt(pct(s, 0.25))} ` +
      `med=${fmt(pct(s, 0.5))} p75=${fmt(pct(s, 0.75))} p90=${fmt(pct(s, 0.9))} max=${fmt(s[s.length - 1])} ` +
      `total=${fmt(total)}`
  )
}

/** Gini over non-negative values; 0 = perfectly equal, 1 = one club holds everything. */
function gini(values: number[]): number {
  const shifted = values.map((v) => v - Math.min(0, ...values))
  const s = [...shifted].sort((a, b) => a - b)
  const n = s.length
  const total = s.reduce((sum, v) => sum + v, 0)
  if (n === 0 || total === 0) return 0
  let weighted = 0
  for (let i = 0; i < n; i++) weighted += (i + 1) * s[i]
  return (2 * weighted) / (n * total) - (n + 1) / n
}

// --- The projection's in-memory model ----------------------------------------

interface SimPlayer {
  age: number
  potential: number
  primaryPosition: string
  overall: number
  weeklySalary: number
  attributes: PlayerAttributes
}

interface SimClub {
  id: string
  isBot: boolean
  tier: number
  ultras: boolean
  balance: number
  seats: SeatCounts
  players: SimPlayer[]
}

interface SeasonLedger {
  gateRevenue: number
  homeExpense: number
  awayTravel: number
  fanFines: number
  wages: number
  maintenance: number
  construction: number
}

const EMPTY_LEDGER = (): SeasonLedger => ({
  gateRevenue: 0,
  homeExpense: 0,
  awayTravel: 0,
  fanFines: 0,
  wages: 0,
  maintenance: 0,
  construction: 0,
})

export interface ProjectionOptions {
  seasons: number
  /** Weekly stadium maintenance, charged SEASON_PAYROLL_WEEKS times. 0 = today's behaviour. */
  maintenanceEnabled: boolean
  /**
   * Reinvestment rule for clubs that have a manager. `null` = nobody builds,
   * which is what Production does today. A number is the fraction of balance
   * above a reserve that a Human club spends on regular seats each season.
   */
  humanReinvestFraction: number | null
  /** Reserve, in payroll weeks, a reinvesting club keeps back. */
  reserveWeeks: number
}

interface SeasonSnapshot {
  season: number
  totalMoney: number
  balances: number[]
  humanBalances: number[]
  botBalances: number[]
  tier1Balances: number[]
  tier2Balances: number[]
  negatives: number
  belowOneWeek: number
  belowFourWeeks: number
  weeklyPayrollTotal: number
  medianWeeklyPayroll: number
  giniIndex: number
  created: number
  destroyed: number
  ledger: SeasonLedger
  totalPlayers: number
  medianOverall: number
  capacityTotal: number
}

function seasonPayroll(club: SimClub): number {
  return club.players.reduce((sum, p) => sum + p.weeklySalary, 0)
}

/** One club's season of home and away football, at the real formulas. */
function playSeason(club: SimClub, rng: SeededRandom, ledger: SeasonLedger, opts: ProjectionOptions): void {
  const quality = calculateTeamTotalQuality(club.players)
  for (let m = 0; m < HOME_FIXTURES_PER_SEASON; m++) {
    const attendance = calculateAttendance({ isHome: true }, { teamTotalQuality: quality }, { seats: club.seats })
    const revenue = calculateMatchStadiumRevenue(attendance.bySeatType).total
    // THE PRODUCTION DEFECT, REPRODUCED ON PURPOSE: the live code computes
    // the expense from a SECOND, INDEPENDENT attendance roll (the snapshot's),
    // not from the roll the gate was sold at. Modelling one roll here would
    // understate the variance the real economy actually has.
    const expenseAttendance = calculateAttendance(
      { isHome: true },
      { teamTotalQuality: quality },
      { seats: club.seats }
    )
    const expense = calculateHomeMatchExpenses(
      { capacity: calculateStadiumCapacity(club.seats) },
      expenseAttendance.total,
      "league"
    ).total
    ledger.gateRevenue += revenue
    ledger.homeExpense += expense
    club.balance += revenue - expense

    if (club.ultras) {
      const { crowd } = DEFAULT_GAME_BALANCE_CONFIG
      // Base chance only: the projection has no match result, so the "lost"
      // and "cards" multipliers are deliberately not guessed at. This
      // UNDERSTATES fines, and says so rather than inventing a match.
      if (rng.next() < crowd.ultrasIncidentBaseChance) {
        const fine = Math.round((crowd.incidentFineMin + rng.next() * (crowd.incidentFineMax - crowd.incidentFineMin)) / 1000) * 1000
        ledger.fanFines += fine
        club.balance -= fine
      }
    }
  }
  const travel = calculateAwayTravelCost("league") * AWAY_FIXTURES_PER_SEASON
  ledger.awayTravel += travel
  club.balance -= travel

  const wages = seasonPayroll(club) * SEASON_PAYROLL_WEEKS
  ledger.wages += wages
  club.balance -= wages

  if (opts.maintenanceEnabled) {
    const weekly = SEAT_TYPES.reduce((sum, t) => sum + club.seats[t] * MAINTENANCE_COST_PER_SEAT[t], 0)
    const cost = weekly * SEASON_PAYROLL_WEEKS
    ledger.maintenance += cost
    club.balance -= cost
  }
}

/**
 * The season roll, in the orchestrator's own order:
 *   PLAYER_LIFECYCLE -> YOUTH_GENERATION -> BOT_PROMOTION -> SQUAD_REPLENISHMENT
 *
 * DEVELOPMENT IS APPLIED AS A DELTA, not as developPlayer's absolute answer.
 * developPlayer re-derives currentOverall from the attribute columns, and any
 * club whose stored Player.overall and stored attributes disagree (see the
 * integrity count in section 4) would otherwise be silently re-graded by the
 * projection. Taking (overall after - overall before) applies exactly the
 * growth the real roll would apply while leaving the stored Overall as the
 * authority it is everywhere else in the game.
 */
function rollSquad(club: SimClub, seasonNumber: number, rng: SeededRandom): void {
  const survivors: SimPlayer[] = []
  for (const player of club.players) {
    if (rollRetirement(player.age, rng)) continue
    const development = developPlayer(
      { age: player.age, potential: player.potential, primaryPosition: player.primaryPosition, attributes: player.attributes },
      rng
    )
    const grown = Math.min(player.potential, player.overall + Math.max(0, development.overall - development.currentOverall))
    const newAge = player.age + 1
    survivors.push({
      age: newAge,
      potential: player.potential,
      primaryPosition: player.primaryPosition,
      overall: grown,
      attributes: development.attributes,
      weeklySalary: calculatePlayerSalary({
        overall: grown,
        age: newAge,
        potential: player.potential,
        primaryPosition: player.primaryPosition,
      }),
    })
  }

  // YOUTH. Five prospects per club per season; the best three by (overall,
  // potential) are promoted, each subject to the same cap-and-floor headroom
  // rule promoteYouthProspect enforces. Modelled identically for Human and
  // BOT clubs - a Human manager who ignores the window promotes fewer, which
  // would make Human squads WEAKER than this projection shows, never richer.
  const prospects = generateYouthProspects(`sim-${seasonNumber}`, club.id, PROSPECTS_PER_INTAKE)
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
      weeklySalary: calculatePlayerSalary({
        overall: prospect.overall,
        age: prospect.age,
        potential: prospect.potential,
        primaryPosition: prospect.primaryPosition,
      }),
    })
    promoted++
  }

  const counts = countRoster(survivors)
  if (!isResolvableWithinCap(counts)) {
    // Production would throw RosterUnresolvableError here. The projection
    // reports it as a stopped club rather than pretending a squad appeared.
    club.players = survivors
    return
  }
  const plan = planAdditions(counts)
  for (let slot = 0; slot < plan.length; slot++) {
    const generated = generateFallbackPlayer({
      seasonId: `sim-${seasonNumber}`,
      teamId: club.id,
      slotIndex: slot,
      group: plan[slot],
    })
    survivors.push({
      age: generated.age,
      potential: generated.potential,
      primaryPosition: generated.primaryPosition,
      overall: generated.overall,
      attributes: extractPlayerAttributes(generated as unknown as Record<string, unknown>),
      weeklySalary: generated.weeklySalary,
    })
  }
  club.players = survivors
}

function reinvest(club: SimClub, opts: ProjectionOptions): number {
  if (opts.humanReinvestFraction === null || club.isBot) return 0
  const reserve = seasonPayroll(club) * opts.reserveWeeks
  const spendable = Math.max(0, club.balance - reserve) * opts.humanReinvestFraction
  const seats = Math.floor(spendable / CONSTRUCTION_COST_PER_SEAT.regular)
  if (seats <= 0) return 0
  const cost = seats * CONSTRUCTION_COST_PER_SEAT.regular
  club.seats = { ...club.seats, regular: club.seats.regular + seats }
  club.balance -= cost
  return cost
}

function snapshot(season: number, clubs: SimClub[], ledger: SeasonLedger): SeasonSnapshot {
  const balances = clubs.map((c) => c.balance)
  const weekly = clubs.map((c) => seasonPayroll(c))
  const overalls = clubs.flatMap((c) => c.players.map((p) => p.overall)).sort((a, b) => a - b)
  const created = ledger.gateRevenue
  const destroyed = ledger.homeExpense + ledger.awayTravel + ledger.fanFines + ledger.wages + ledger.maintenance + ledger.construction
  return {
    season,
    totalMoney: balances.reduce((s, v) => s + v, 0),
    balances,
    humanBalances: clubs.filter((c) => !c.isBot).map((c) => c.balance),
    botBalances: clubs.filter((c) => c.isBot).map((c) => c.balance),
    tier1Balances: clubs.filter((c) => c.tier === 1).map((c) => c.balance),
    tier2Balances: clubs.filter((c) => c.tier === 2).map((c) => c.balance),
    negatives: clubs.filter((c) => c.balance < 0).length,
    belowOneWeek: clubs.filter((c) => c.balance < seasonPayroll(c)).length,
    belowFourWeeks: clubs.filter((c) => c.balance < seasonPayroll(c) * 4).length,
    weeklyPayrollTotal: weekly.reduce((s, v) => s + v, 0),
    medianWeeklyPayroll: pct([...weekly].sort((a, b) => a - b), 0.5),
    giniIndex: gini(balances),
    created,
    destroyed,
    ledger,
    totalPlayers: clubs.reduce((s, c) => s + c.players.length, 0),
    medianOverall: overalls.length ? pct(overalls, 0.5) : 0,
    capacityTotal: clubs.reduce((s, c) => s + calculateStadiumCapacity(c.seats), 0),
  }
}

function project(base: SimClub[], opts: ProjectionOptions, seed: string): SeasonSnapshot[] {
  const clubs: SimClub[] = base.map((c) => ({
    ...c,
    seats: { ...c.seats },
    players: c.players.map((p) => ({ ...p, attributes: { ...p.attributes } })),
  }))
  const rng = new SeededRandom(seed)
  const originalRandom = Math.random
  Math.random = () => rng.next()
  const out: SeasonSnapshot[] = []
  try {
    for (let season = 1; season <= opts.seasons; season++) {
      const ledger = EMPTY_LEDGER()
      for (const club of clubs) playSeason(club, rng, ledger, opts)
      for (const club of clubs) ledger.construction += reinvest(club, opts)
      for (const club of clubs) rollSquad(club, season, rng)
      // Promotion and relegation, modelled exactly as Phase 3Q leaves it: the
      // tier label moves, and NOTHING financial follows it. Four clubs swap
      // labels each season; with no tier-dependent money the choice of which
      // four cannot change any total, so the four lowest-balance tier 1 clubs
      // are used as a stable, explainable stand-in for a league table.
      const tier1 = clubs.filter((c) => c.tier === 1).sort((a, b) => a.balance - b.balance)
      const tier2 = clubs.filter((c) => c.tier === 2).sort((a, b) => b.balance - a.balance)
      for (let i = 0; i < 4 && i < tier1.length && i < tier2.length; i++) {
        tier1[i].tier = 2
        tier2[i].tier = 1
      }
      out.push(snapshot(season, clubs, ledger))
    }
  } finally {
    Math.random = originalRandom
  }
  return out
}

function printProjection(title: string, snapshots: SeasonSnapshot[], marks: number[]): void {
  console.info(`\n  ${title}`)
  console.info(
    `    ${"season".padEnd(7)}${"total money".padStart(16)}${"median".padStart(14)}${"min".padStart(14)}` +
      `${"max".padStart(15)}${"gini".padStart(7)}${"neg".padStart(5)}${"<1w".padStart(5)}${"<4w".padStart(5)}` +
      `${"wk payroll".padStart(13)}${"med OVR".padStart(9)}`
  )
  for (const mark of marks) {
    const s = snapshots[mark - 1]
    if (!s) continue
    const sorted = [...s.balances].sort((a, b) => a - b)
    console.info(
      `    ${String(s.season).padEnd(7)}${fmt(s.totalMoney).padStart(16)}${fmt(pct(sorted, 0.5)).padStart(14)}` +
        `${fmt(sorted[0]).padStart(14)}${fmt(sorted[sorted.length - 1]).padStart(15)}` +
        `${s.giniIndex.toFixed(3).padStart(7)}${String(s.negatives).padStart(5)}` +
        `${String(s.belowOneWeek).padStart(5)}${String(s.belowFourWeeks).padStart(5)}` +
        `${fmt(s.weeklyPayrollTotal).padStart(13)}${String(s.medianOverall).padStart(9)}`
    )
  }
  const last = snapshots[snapshots.length - 1]
  const first = snapshots[0]
  // The stock BEFORE season 1 ran, recovered from season 1's own flows.
  const openingStock = first.totalMoney - (first.created - first.destroyed)
  console.info(
    `    opening stock=${fmt(openingStock)}  closing=${fmt(last.totalMoney)}  ` +
      `total drift=${fmt(last.totalMoney - openingStock)}  mean drift/season=${fmt((last.totalMoney - openingStock) / snapshots.length)}`
  )
  const firstNegative = snapshots.find((s) => s.negatives > 0)
  const firstAllNegative = snapshots.find((s) => s.negatives === s.balances.length)
  console.info(
    `    first club goes negative: season ${firstNegative ? firstNegative.season : "never"}   ` +
      `EVERY club negative: season ${firstAllNegative ? firstAllNegative.season : "never"}`
  )
  const human = [...last.humanBalances].sort((a, b) => a - b)
  const bot = [...last.botBalances].sort((a, b) => a - b)
  const t1 = [...last.tier1Balances].sort((a, b) => a - b)
  const t2 = [...last.tier2Balances].sort((a, b) => a - b)
  console.info(
    `    final cohorts: HUMAN med=${fmt(pct(human, 0.5))} (n=${human.length})  BOT med=${fmt(pct(bot, 0.5))} (n=${bot.length})  ` +
      `TIER1 med=${fmt(pct(t1, 0.5))}  TIER2 med=${fmt(pct(t2, 0.5))}`
  )
  console.info(
    `    final season flows: gate=+${fmt(last.ledger.gateRevenue)} matchCost=-${fmt(last.ledger.homeExpense)} ` +
      `travel=-${fmt(last.ledger.awayTravel)} wages=-${fmt(last.ledger.wages)} fines=-${fmt(last.ledger.fanFines)} ` +
      `maint=-${fmt(last.ledger.maintenance)} build=-${fmt(last.ledger.construction)}  ` +
      `NET=${fmt(last.created - last.destroyed)}`
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
  printProductionBanner("prod:economy:model", target)
  const now = new Date()
  console.info(`Now:      ${now.toISOString()}\n`)

  try {
    // ==================================================================
    // 1. THE LEDGER
    // ==================================================================
    console.info("=== 1. LEDGER BY TYPE ===")
    const byType = await prisma.financialTransaction.groupBy({
      by: ["type"],
      _count: { _all: true },
      _sum: { amount: true },
      _min: { amount: true },
      _max: { amount: true },
    })
    let created = 0
    let destroyed = 0
    let redistributed = 0
    for (const row of [...byType].sort((a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0))) {
      const sum = row._sum.amount ?? 0
      const kind =
        row.type === "transferPurchase" || row.type === "transferSale"
          ? "REDISTRIBUTION"
          : sum >= 0
            ? "CREATED BY SYSTEM"
            : "DESTROYED BY SYSTEM"
      if (kind === "REDISTRIBUTION") redistributed += sum
      else if (sum >= 0) created += sum
      else destroyed += sum
      console.info(
        `  ${row.type.padEnd(20)} rows=${String(row._count._all).padStart(6)} sum=${fmt(sum).padStart(14)} ` +
          `min=${fmt(row._min.amount ?? 0).padStart(10)} max=${fmt(row._max.amount ?? 0).padStart(10)}  ${kind}`
      )
    }
    const bounds = await prisma.financialTransaction.aggregate({ _min: { createdAt: true }, _max: { createdAt: true }, _count: { _all: true } })
    console.info(`  rows total: ${bounds._count._all}`)
    console.info(`  earliest:   ${bounds._min.createdAt?.toISOString() ?? "none"}`)
    console.info(`  latest:     ${bounds._max.createdAt?.toISOString() ?? "none"}`)

    // ==================================================================
    // 2. THE CLUBS
    // ==================================================================
    const teams = await prisma.team.findMany({
      select: { id: true, name: true, isBot: true, balance: true, crowdStyle: true, createdAt: true },
      orderBy: { id: "asc" },
    })
    const activeSeason = await prisma.season.findFirst({
      where: { isActive: true },
      select: { id: true, number: true, countryCode: true, status: true, offseasonStage: true },
      orderBy: { number: "desc" },
    })
    const memberships = activeSeason
      ? await prisma.divisionTeam.findMany({
          where: { division: { seasonId: activeSeason.id } },
          select: { teamId: true, division: { select: { tier: true, group: true } } },
        })
      : []
    const tierOf = new Map(memberships.map((m) => [m.teamId, m.division.tier]))
    const groupOf = new Map(memberships.map((m) => [m.teamId, m.division.group ?? ""]))

    console.info("\n=== 2. MONEY CONSERVATION ===")
    const totalBalance = teams.reduce((s, t) => s + t.balance, 0)
    const startingStock = teams.length * DEFAULT_STARTING_BALANCE
    console.info(`  clubs:                      ${teams.length} (${teams.filter((t) => !t.isBot).length} Human / ${teams.filter((t) => t.isBot).length} BOT)`)
    console.info(`  starting stock (n x ${fmt(DEFAULT_STARTING_BALANCE)}): ${fmt(startingStock)}`)
    console.info(`  system CREATED:             ${fmt(created)}`)
    console.info(`  system DESTROYED:           ${fmt(destroyed)}`)
    console.info(`  club-to-club REDISTRIBUTED: ${fmt(redistributed)} (must be 0)`)
    console.info(`  ledger-implied total:       ${fmt(startingStock + created + destroyed + redistributed)}`)
    console.info(`  actual Team.balance total:  ${fmt(totalBalance)}`)
    const gap = totalBalance - (startingStock + created + destroyed + redistributed)
    console.info(`  UNEXPLAINED GAP:            ${fmt(gap)}  ${gap === 0 ? "(Economy Service is the ONLY balance writer)" : "*** A WRITER OUTSIDE THE LEDGER EXISTS ***"}`)

    // ==================================================================
    // 3. BALANCES
    // ==================================================================
    console.info("\n=== 3. BALANCE DISTRIBUTION ===")
    const wageRows = await prisma.player.groupBy({
      by: ["teamId"],
      where: { teamId: { not: null }, careerStatus: "ACTIVE" },
      _sum: { weeklySalary: true },
      _count: { _all: true },
    })
    const weeklyByTeam = new Map(wageRows.map((r) => [r.teamId!, r._sum.weeklySalary ?? 0]))
    const squadSizeByTeam = new Map(wageRows.map((r) => [r.teamId!, r._count._all]))
    distribution("balance, all clubs", teams.map((t) => t.balance))
    distribution("...Human", teams.filter((t) => !t.isBot).map((t) => t.balance))
    distribution("...BOT", teams.filter((t) => t.isBot).map((t) => t.balance))
    distribution("...tier 1", teams.filter((t) => tierOf.get(t.id) === 1).map((t) => t.balance))
    distribution("...tier 2", teams.filter((t) => tierOf.get(t.id) === 2).map((t) => t.balance))
    console.info(`  Gini (balance):                    ${gini(teams.map((t) => t.balance)).toFixed(4)}`)
    console.info(`  NEGATIVE balances:                 ${teams.filter((t) => t.balance < 0).length}`)
    console.info(`  below ONE week's payroll:          ${teams.filter((t) => t.balance < (weeklyByTeam.get(t.id) ?? 0)).length}`)
    console.info(`  below FOUR weeks' payroll:         ${teams.filter((t) => t.balance < (weeklyByTeam.get(t.id) ?? 0) * 4).length}`)

    // ==================================================================
    // 4. PAYROLL
    // ==================================================================
    console.info("\n=== 4. PAYROLL PRESSURE ===")
    const players = await prisma.player.findMany({
      where: { teamId: { not: null }, careerStatus: "ACTIVE" },
      select: { teamId: true, age: true, overall: true, potential: true, primaryPosition: true, weeklySalary: true, marketValue: true },
    })
    distribution("weekly payroll per club", teams.map((t) => weeklyByTeam.get(t.id) ?? 0))
    distribution("...Human", teams.filter((t) => !t.isBot).map((t) => weeklyByTeam.get(t.id) ?? 0))
    distribution("...BOT", teams.filter((t) => t.isBot).map((t) => weeklyByTeam.get(t.id) ?? 0))
    distribution("...tier 1", teams.filter((t) => tierOf.get(t.id) === 1).map((t) => weeklyByTeam.get(t.id) ?? 0))
    distribution("...tier 2", teams.filter((t) => tierOf.get(t.id) === 2).map((t) => weeklyByTeam.get(t.id) ?? 0))
    distribution("squad size", teams.map((t) => squadSizeByTeam.get(t.id) ?? 0))
    distribution("weeklySalary per player", players.map((p) => p.weeklySalary))
    distribution("overall per player", players.map((p) => p.overall))
    distribution("age per player", players.map((p) => p.age))

    // INTEGRITY: does the stored Overall still grade out of the stored
    // attributes? The projection's development step depends on the answer -
    // see rollSquad's delta rule - and a drift here would also mean the youth
    // and replenishment integrity guards are the only things still checking.
    const attributeRows = await prisma.player.findMany({
      where: { teamId: { not: null }, careerStatus: "ACTIVE" },
      select: { id: true, overall: true, primaryPosition: true, ...ATTRIBUTE_SELECT },
    })
    let overallMismatch = 0
    let worstMismatch = 0
    for (const row of attributeRows) {
      const derived = calculatePlayerOverall({
        primaryPosition: row.primaryPosition,
        ...extractPlayerAttributes(row as unknown as Record<string, unknown>),
      })
      const delta = Math.abs(derived - row.overall)
      if (delta !== 0) overallMismatch++
      if (delta > worstMismatch) worstMismatch = delta
    }
    console.info(`  players whose stored Overall != attribute-derived Overall: ${overallMismatch}/${attributeRows.length} (worst delta ${worstMismatch})`)

    console.info("  salary by OVERALL band:")
    for (const [lo, hi] of [[0, 49], [50, 59], [60, 69], [70, 79], [80, 89], [90, 100]] as [number, number][]) {
      const band = players.filter((p) => p.overall >= lo && p.overall <= hi)
      if (band.length === 0) continue
      const s = band.map((p) => p.weeklySalary).sort((a, b) => a - b)
      console.info(`    OVR ${String(lo).padStart(3)}-${String(hi).padStart(3)}: n=${String(band.length).padStart(5)} med=${fmt(pct(s, 0.5)).padStart(8)} min=${fmt(s[0]).padStart(8)} max=${fmt(s[s.length - 1]).padStart(8)}`)
    }
    console.info("  salary by AGE band:")
    for (const [lo, hi] of [[16, 21], [22, 25], [26, 29], [30, 33], [34, 45]] as [number, number][]) {
      const band = players.filter((p) => p.age >= lo && p.age <= hi)
      if (band.length === 0) continue
      const s = band.map((p) => p.weeklySalary).sort((a, b) => a - b)
      console.info(`    age ${String(lo).padStart(2)}-${String(hi).padStart(2)}: n=${String(band.length).padStart(5)} med=${fmt(pct(s, 0.5)).padStart(8)} medOVR=${pct(band.map((p) => p.overall).sort((a, b) => a - b), 0.5)}`)
    }
    console.info("  salary by POSITION:")
    const positions = [...new Set(players.map((p) => p.primaryPosition))].sort()
    for (const position of positions) {
      const band = players.filter((p) => p.primaryPosition === position)
      const s = band.map((p) => p.weeklySalary).sort((a, b) => a - b)
      console.info(`    ${position.padEnd(4)}: n=${String(band.length).padStart(5)} med=${fmt(pct(s, 0.5)).padStart(8)} medOVR=${pct(band.map((p) => p.overall).sort((a, b) => a - b), 0.5)}`)
    }

    // ==================================================================
    // 5. MATCHDAY, AS ACTUALLY PLAYED
    // ==================================================================
    console.info("\n=== 5. MATCHDAY ECONOMY, MEASURED ===")
    const played = await prisma.fixture.findMany({
      where: { playedAt: { not: null } },
      select: { homeTeamId: true, awayTeamId: true, attendance: true, homeRevenue: true, homeMatchExpense: true, stage: true, playedAt: true },
    })
    console.info(`  fixtures played:            ${played.length}`)
    const stages = new Map<string, number>()
    for (const f of played) stages.set(f.stage, (stages.get(f.stage) ?? 0) + 1)
    for (const [stage, count] of stages) console.info(`    stage ${stage.padEnd(18)} ${count}`)
    const withMoney = played.filter((f) => f.homeRevenue !== null && f.homeMatchExpense !== null && f.attendance !== null)
    distribution("attendance (stored)", withMoney.map((f) => f.attendance!))
    distribution("home gate revenue", withMoney.map((f) => f.homeRevenue!))
    distribution("home match expense", withMoney.map((f) => f.homeMatchExpense!))
    distribution("home net (rev - exp)", withMoney.map((f) => f.homeRevenue! - f.homeMatchExpense!))

    const stadiums = await prisma.stadium.findMany({
      select: { teamId: true, regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true },
    })
    const seatsByTeam = new Map<string, SeatCounts>(
      stadiums.map((s) => [s.teamId, { regular: s.regularSeats, covered: s.coveredSeats, premium: s.premiumSeats, vip: s.vipSeats }])
    )
    // THE DETERMINISM CHECK: does the stored attendance reproduce the stored
    // gate at the stored prices? It cannot, if revenue and expense were rolled
    // separately. This measures the size of that disagreement.
    let reconstructible = 0
    const revenueGaps: number[] = []
    const impliedGateOccupancy: number[] = []
    const impliedCostOccupancy: number[] = []
    for (const f of withMoney) {
      const seats = seatsByTeam.get(f.homeTeamId)
      if (!seats) continue
      const capacity = calculateStadiumCapacity(seats)
      if (capacity === 0) continue
      const fullGate = SEAT_TYPES.reduce((sum, t) => sum + seats[t] * TICKET_PRICES[t], 0)
      impliedGateOccupancy.push(f.homeRevenue! / fullGate)
      impliedCostOccupancy.push(f.attendance! / capacity)
      const ratio = f.attendance! / capacity
      const predicted = SEAT_TYPES.reduce((sum, t) => sum + Math.round(seats[t] * ratio) * TICKET_PRICES[t], 0)
      if (predicted === f.homeRevenue) reconstructible++
      revenueGaps.push(f.homeRevenue! - predicted)
    }
    console.info(`  fixtures whose STORED attendance reproduces the STORED gate: ${reconstructible}/${revenueGaps.length}`)
    distribution("gate reconstruction error", revenueGaps)
    const occGate = [...impliedGateOccupancy].sort((a, b) => a - b)
    const occCost = [...impliedCostOccupancy].sort((a, b) => a - b)
    if (occGate.length > 0) {
      console.info(`  occupancy implied by REVENUE: min=${occGate[0].toFixed(4)} med=${pct(occGate, 0.5).toFixed(4)} max=${occGate[occGate.length - 1].toFixed(4)} mean=${(occGate.reduce((s, v) => s + v, 0) / occGate.length).toFixed(4)}`)
      console.info(`  occupancy implied by STORED attendance: min=${occCost[0].toFixed(4)} med=${pct(occCost, 0.5).toFixed(4)} max=${occCost[occCost.length - 1].toFixed(4)} mean=${(occCost.reduce((s, v) => s + v, 0) / occCost.length).toFixed(4)}`)
    }

    // Per-club matchday P&L so far.
    const revByTeam = new Map<string, number>()
    const expByTeam = new Map<string, number>()
    for (const f of withMoney) {
      revByTeam.set(f.homeTeamId, (revByTeam.get(f.homeTeamId) ?? 0) + f.homeRevenue!)
      expByTeam.set(f.homeTeamId, (expByTeam.get(f.homeTeamId) ?? 0) + f.homeMatchExpense!)
      expByTeam.set(f.awayTeamId, (expByTeam.get(f.awayTeamId) ?? 0) + calculateAwayTravelCost("league"))
    }
    distribution("match revenue per club, to date", teams.map((t) => revByTeam.get(t.id) ?? 0))
    distribution("match expense per club, to date", teams.map((t) => expByTeam.get(t.id) ?? 0))
    distribution("net matchday per club, to date", teams.map((t) => (revByTeam.get(t.id) ?? 0) - (expByTeam.get(t.id) ?? 0)))

    // ==================================================================
    // 6. STADIUM ECONOMICS
    // ==================================================================
    console.info("\n=== 6. STADIUM ECONOMICS ===")
    distribution("stadium capacity", stadiums.map((s) => calculateStadiumCapacity({ regular: s.regularSeats, covered: s.coveredSeats, premium: s.premiumSeats, vip: s.vipSeats })))
    const jobs = await prisma.stadiumConstructionJob.groupBy({ by: ["status"], _count: { _all: true }, _sum: { totalCost: true } })
    console.info(`  construction jobs: ${jobs.length === 0 ? "none, ever" : ""}`)
    for (const j of jobs) console.info(`    ${j.status.padEnd(12)} ${j._count._all}  spent=${fmt(j._sum.totalCost ?? 0)}`)
    const medianOccupancy = occGate.length > 0 ? pct(occGate, 0.5) : 0.62
    console.info(`  payback per seat, at the MEASURED median occupancy ${medianOccupancy.toFixed(4)}, ${HOME_FIXTURES_PER_SEASON} home matches/season:`)
    console.info(`    ${"class".padEnd(9)}${"cost".padStart(9)}${"gross/season".padStart(14)}${"net/season".padStart(12)}${"net w/maint".padStart(13)}${"payback".padStart(10)}${"+maint".padStart(9)}`)
    for (const t of SEAT_TYPES) {
      const gross = TICKET_PRICES[t] * medianOccupancy * HOME_FIXTURES_PER_SEASON
      // Every occupied seat costs costPerSpectator; every seat that exists at
      // all costs costPerCapacity, occupied or not.
      const net = gross - 3 * medianOccupancy * HOME_FIXTURES_PER_SEASON - 0.5 * HOME_FIXTURES_PER_SEASON
      const netMaint = net - MAINTENANCE_COST_PER_SEAT[t] * SEASON_PAYROLL_WEEKS
      console.info(
        `    ${t.padEnd(9)}${fmt(CONSTRUCTION_COST_PER_SEAT[t]).padStart(9)}${gross.toFixed(1).padStart(14)}${net.toFixed(1).padStart(12)}` +
          `${netMaint.toFixed(1).padStart(13)}${(net > 0 ? (CONSTRUCTION_COST_PER_SEAT[t] / net).toFixed(2) : "never").padStart(10)}` +
          `${(netMaint > 0 ? (CONSTRUCTION_COST_PER_SEAT[t] / netMaint).toFixed(2) : "never").padStart(9)}`
      )
    }
    const startingCapacity = calculateStadiumCapacity(DEFAULT_STARTING_SEATS)
    const startingMaint = SEAT_TYPES.reduce((s, t) => s + DEFAULT_STARTING_SEATS[t] * MAINTENANCE_COST_PER_SEAT[t], 0)
    console.info(`  starting stadium: capacity=${fmt(startingCapacity)} weeklyMaintenance(if activated)=${fmt(startingMaint)} seasonMaintenance=${fmt(startingMaint * SEASON_PAYROLL_WEEKS)}`)

    // ==================================================================
    // 7. TRANSFER ECONOMY
    // ==================================================================
    console.info("\n=== 7. TRANSFER ECONOMY ===")
    const listings = await prisma.transferListing.groupBy({ by: ["status"], _count: { _all: true }, _sum: { askingPrice: true }, _min: { askingPrice: true }, _max: { askingPrice: true } })
    if (listings.length === 0) console.info("  no transfer listing has ever been created")
    for (const l of listings) {
      console.info(`    ${l.status.padEnd(10)} n=${String(l._count._all).padStart(5)} sum=${fmt(l._sum.askingPrice ?? 0).padStart(12)} min=${fmt(l._min.askingPrice ?? 0).padStart(10)} max=${fmt(l._max.askingPrice ?? 0).padStart(10)}`)
    }
    distribution("player marketValue", players.map((p) => p.marketValue))
    const medianWeekly = pct(teams.map((t) => weeklyByTeam.get(t.id) ?? 0).sort((a, b) => a - b), 0.5)
    const medianValue = pct(players.map((p) => p.marketValue).sort((a, b) => a - b), 0.5)
    console.info(`  median player marketValue / median club WEEKLY payroll: ${(medianValue / Math.max(1, medianWeekly)).toFixed(3)}`)
    console.info(`  median player marketValue / median club SEASON payroll: ${(medianValue / Math.max(1, medianWeekly * SEASON_PAYROLL_WEEKS)).toFixed(4)}`)
    distribution("release cost (= weeklySalary)", players.map((p) => p.weeklySalary))

    // ==================================================================
    // 8. REPRESENTATIVE CLUB P&L, ONE SEASON, AT TODAY'S RULES
    // ==================================================================
    console.info("\n=== 8. ONE SEASON P&L BY PERCENTILE CLUB ===")
    const perClub = teams.map((t) => {
      const seats = seatsByTeam.get(t.id) ?? DEFAULT_STARTING_SEATS
      const fullGate = SEAT_TYPES.reduce((sum, s) => sum + seats[s] * TICKET_PRICES[s], 0)
      const capacity = calculateStadiumCapacity(seats)
      const gate = fullGate * medianOccupancy * HOME_FIXTURES_PER_SEASON
      const homeCost = (10_000 + 0.5 * capacity + 3 * capacity * medianOccupancy) * HOME_FIXTURES_PER_SEASON
      const travel = calculateAwayTravelCost("league") * AWAY_FIXTURES_PER_SEASON
      const wages = (weeklyByTeam.get(t.id) ?? 0) * SEASON_PAYROLL_WEEKS
      return { team: t, gate, homeCost, travel, wages, net: gate - homeCost - travel - wages }
    })
    const sortedByNet = [...perClub].sort((a, b) => a.net - b.net)
    for (const q of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      const row = sortedByNet[Math.min(sortedByNet.length - 1, Math.floor(sortedByNet.length * q))]
      console.info(
        `  p${String(Math.round(q * 100)).padStart(2)} ${row.team.isBot ? "BOT " : "HUM "}tier${tierOf.get(row.team.id) ?? "?"}${(groupOf.get(row.team.id) ?? "").padEnd(2)} ` +
          `gate=+${fmt(row.gate).padStart(11)} matchCost=-${fmt(row.homeCost).padStart(10)} travel=-${fmt(row.travel).padStart(8)} ` +
          `wages=-${fmt(row.wages).padStart(10)}  NET=${fmt(row.net).padStart(11)}`
      )
    }
    const leagueNet = perClub.reduce((s, r) => s + r.net, 0)
    console.info(`  LEAGUE-WIDE one-season net at today's rules: ${fmt(leagueNet)}  (${((leagueNet / Math.max(1, totalBalance)) * 100).toFixed(2)}% of current money stock)`)
    const withMaint = perClub.reduce((s, r) => {
      const seats = seatsByTeam.get(r.team.id) ?? DEFAULT_STARTING_SEATS
      const maint = SEAT_TYPES.reduce((sum, t) => sum + seats[t] * MAINTENANCE_COST_PER_SEAT[t], 0) * SEASON_PAYROLL_WEEKS
      return s + r.net - maint
    }, 0)
    console.info(`  ...the same, IF stadium maintenance were activated:      ${fmt(withMaint)}`)
    console.info(`  payroll-week sensitivity: ${SEASON_PAYROLL_WEEKS_LOW}wk=${fmt(perClub.reduce((s, r) => s + r.net + (r.wages / SEASON_PAYROLL_WEEKS) * (SEASON_PAYROLL_WEEKS - SEASON_PAYROLL_WEEKS_LOW), 0))}  ${SEASON_PAYROLL_WEEKS_HIGH}wk=${fmt(perClub.reduce((s, r) => s + r.net - (r.wages / SEASON_PAYROLL_WEEKS) * (SEASON_PAYROLL_WEEKS_HIGH - SEASON_PAYROLL_WEEKS), 0))}`)

    // ==================================================================
    // 9. MULTI-SEASON PROJECTION
    // ==================================================================
    console.info("\n=== 9. MULTI-SEASON PROJECTION (real formulas, seeded) ===")
    const fullPlayers = await prisma.player.findMany({
      where: { teamId: { not: null }, careerStatus: "ACTIVE" },
    })
    const byTeam = new Map<string, SimPlayer[]>()
    for (const row of fullPlayers) {
      const list = byTeam.get(row.teamId!) ?? []
      list.push({
        age: row.age,
        potential: row.potential,
        primaryPosition: row.primaryPosition,
        overall: row.overall,
        weeklySalary: row.weeklySalary,
        attributes: extractPlayerAttributes(row as unknown as Record<string, unknown>),
      })
      byTeam.set(row.teamId!, list)
    }
    const base: SimClub[] = teams.map((t) => ({
      id: t.id,
      isBot: t.isBot,
      tier: tierOf.get(t.id) ?? 2,
      ultras: t.crowdStyle === "ultras",
      balance: t.balance,
      seats: seatsByTeam.get(t.id) ?? { ...DEFAULT_STARTING_SEATS },
      players: byTeam.get(t.id) ?? [],
    }))
    console.info(`  projection base: ${base.length} clubs, ${base.reduce((s, c) => s + c.players.length, 0)} players, ${fmt(base.reduce((s, c) => s + c.balance, 0))} total money`)
    console.info(`  clubs with ultras crowds: ${base.filter((c) => c.ultras).length}`)

    const marks = [1, 2, 3, 5, 10, 15, 20]
    const scenarios: [string, ProjectionOptions][] = [
      ["A. TODAY'S ECONOMY (no sponsors, no prize money, no maintenance, nobody builds)", { seasons: 20, maintenanceEnabled: false, humanReinvestFraction: null, reserveWeeks: 0 }],
      ["B. TODAY + stadium maintenance activated", { seasons: 20, maintenanceEnabled: true, humanReinvestFraction: null, reserveWeeks: 0 }],
      ["C. TODAY + Human clubs reinvest 60% above a 6-week reserve into regular seats", { seasons: 20, maintenanceEnabled: false, humanReinvestFraction: 0.6, reserveWeeks: 6 }],
      ["D. C + maintenance (the brake, tested against the loop)", { seasons: 20, maintenanceEnabled: true, humanReinvestFraction: 0.6, reserveWeeks: 6 }],
    ]
    for (const [title, opts] of scenarios) {
      printProjection(title, project(base, opts, "phase3r-economy"), marks)
    }

    // ==================================================================
    // 10. DRIFT
    // ==================================================================
    console.info("\n=== 10. EQUILIBRIUM ===")
    const baseline = project(base, { seasons: 20, maintenanceEnabled: false, humanReinvestFraction: null, reserveWeeks: 0 }, "phase3r-economy")
    for (const mark of [1, 5, 10, 20]) {
      const s = baseline[mark - 1]
      if (!s) continue
      console.info(
        `  season ${String(s.season).padStart(2)}: created=+${fmt(s.created).padStart(13)} destroyed=-${fmt(s.destroyed).padStart(13)} ` +
          `NET=${fmt(s.created - s.destroyed).padStart(13)}  players=${s.totalPlayers}  medOVR=${s.medianOverall}`
      )
    }

    console.info("\nECONOMY MODEL AUDIT: REPORTED (read only, nothing mutated)")
  } catch (error) {
    console.error("prod:economy:model failed:", error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) console.error(error.stack)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
