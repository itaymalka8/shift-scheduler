/**
 * READ ONLY economy diagnostic - the numbers a human must see BEFORE
 * autonomous settlement is allowed to charge anybody.
 *
 * SELECTs only. It never settles payroll, never completes a construction job,
 * never touches a balance.
 *
 * WHY IT EXISTS. Phase 3O could answer almost nothing about Production's
 * money: the existing tooling reported one transaction COUNT and one balance
 * SUM, so "how much payroll history is there", "is any club close to zero"
 * and "how many builds are sitting overdue" were all arguments rather than
 * measurements. Turning on a clock that debits sixty clubs on those terms
 * would be guessing. This is the gate: run it, read it, then decide.
 *
 * Run with: npm run prod:economy:audit
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { PAYROLL_AUTOMATION_START, PAYROLL_MAX_CATCHUP_WEEKS } from "../../src/lib/economy/config"
import {
  getMostRecentPayrollTime,
  getNextPayrollDate,
  isPayrollDueForTeam,
  payrollReferenceId,
  payrollWeekKey,
  payrollWindow,
} from "../../src/lib/economy/payroll-clock"
import { evaluateActivationReadiness } from "../../src/lib/production/payroll-activation"
import {
  PHASE_3R_ACTIVATION_START,
  SPONSOR_COEFFICIENT,
  SPONSOR_TIER_MULTIPLIER,
} from "../../src/lib/economy/config"
import { SALARY_COMPRESSION, SALARY_SCALE } from "../../src/lib/economy/salary-curve"
import { calculatePhase3RSalary, calculateUncompressedPlayerSalary } from "../../src/lib/economy/salary"
import { calculateWeeklyMaintenance } from "../../src/lib/economy/maintenance"
import { readSeasonTiersAsOf } from "../../src/lib/economy/season-tier"
import { OPERATING_RESERVE_WEEKS as RESERVE_WEEKS } from "../../src/lib/economy/reserve"
import { DEFAULT_STARTING_SEATS, SEAT_TYPES, toSeatCounts } from "../../src/lib/stadium/config"

/**
 * THE ONE PIECE OF LEDGER RESIDUE THIS DATABASE IS KNOWN TO CARRY.
 *
 * Fixture cmtedbpib0001ya9jpzjzevb5 no longer exists; three FinancialTransaction
 * rows referencing it do, netting +213,629. FinancialTransaction has no foreign
 * key to Fixture - the link is the referenceId string alone - so the rows
 * survived the fixture.
 *
 * IT IS NOT DELETED, NOT REVERSED AND NOT REPAIRED. Economic balancing must
 * never rewrite historical money: those rows are part of how the current
 * balances came to be, and "correcting" them would silently move a club's
 * balance to match a story we prefer. It is acknowledged here so the audit can
 * tell the difference between the residue we know about and a NEW one, which
 * would mean a fixture is being deleted somewhere it should not be.
 */
const ACKNOWLEDGED_ORPHAN_FIXTURE_IDS = ["cmtedbpib0001ya9jpzjzevb5"]

function distribution(label: string, values: number[]): void {
  if (values.length === 0) {
    console.info(`  ${label}: none`)
    return
  }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  const total = sorted.reduce((sum, value) => sum + value, 0)
  console.info(
    `  ${label}: n=${sorted.length} min=${sorted[0]} p25=${at(0.25)} median=${at(0.5)} p75=${at(0.75)} ` +
      `max=${sorted[sorted.length - 1]} total=${total}`
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
  printProductionBanner("prod:economy:audit", target)
  const now = new Date()
  console.info(`Now:      ${now.toISOString()}\n`)

  try {
    // ------------------------------------------------------------------
    // 1. Every ledger row, by type.
    // ------------------------------------------------------------------
    console.info("--- 1. FINANCIAL TRANSACTIONS BY TYPE ---")
    const byType = await prisma.financialTransaction.groupBy({
      by: ["type"],
      _count: { _all: true },
      _sum: { amount: true },
    })
    const totalRows = byType.reduce((sum, row) => sum + row._count._all, 0)
    for (const row of [...byType].sort((a, b) => b._count._all - a._count._all)) {
      console.info(
        `  ${row.type.padEnd(20)} rows=${String(row._count._all).padStart(6)}  sum=${String(row._sum.amount ?? 0).padStart(14)}`
      )
    }
    console.info(`  ${"TOTAL".padEnd(20)} rows=${String(totalRows).padStart(6)}`)

    // ------------------------------------------------------------------
    // 2. Payroll history - who has ever paid wages, and for which weeks.
    // ------------------------------------------------------------------
    console.info("\n--- 2. PAYROLL HISTORY ---")
    const teams = await prisma.team.findMany({
      select: { id: true, name: true, isBot: true, createdAt: true },
      orderBy: { id: "asc" },
    })
    const payroll = await prisma.financialTransaction.findMany({
      where: { type: "playerSalaries" },
      select: { teamId: true, referenceId: true, amount: true, createdAt: true },
      orderBy: { referenceId: "asc" },
    })
    const botById = new Map(teams.map((team) => [team.id, team.isBot]))
    const weeks = [...new Set(payroll.map((row) => row.referenceId))].sort()
    const paidTeams = new Set(payroll.map((row) => row.teamId))
    const humanRows = payroll.filter((row) => botById.get(row.teamId) === false).length
    const botRows = payroll.filter((row) => botById.get(row.teamId) === true).length

    console.info(`  playerSalaries rows:        ${payroll.length}`)
    console.info(`  distinct payroll weeks:     ${weeks.length}`)
    console.info(`  earliest week settled:      ${weeks[0]?.replace("PAYROLL_", "") ?? "none"}`)
    console.info(`  latest week settled:        ${weeks.at(-1)?.replace("PAYROLL_", "") ?? "none"}`)
    console.info(`  clubs with payroll history: ${paidTeams.size} of ${teams.length}`)
    console.info(`  clubs with NO payroll ever: ${teams.length - paidTeams.size}`)
    console.info(`  Human rows / BOT rows:      ${humanRows} / ${botRows}`)
    console.info(`  total wages charged, ever:  ${-payroll.reduce((sum, row) => sum + row.amount, 0)}`)
    for (const week of weeks.slice(0, 10)) {
      const rows = payroll.filter((row) => row.referenceId === week)
      console.info(
        `    ${week.replace("PAYROLL_", "")}: ${rows.length} club(s), ` +
          `${-rows.reduce((sum, row) => sum + row.amount, 0)} total`
      )
    }

    // ------------------------------------------------------------------
    // 3. What a payroll week costs today.
    // ------------------------------------------------------------------
    console.info("\n--- 3. CURRENT WEEKLY PAYROLL ---")
    const wageRows = await prisma.player.groupBy({
      by: ["teamId"],
      where: { teamId: { not: null }, careerStatus: "ACTIVE" },
      _sum: { weeklySalary: true },
      _count: { _all: true },
    })
    const weeklyByTeam = new Map(wageRows.map((row) => [row.teamId!, row._sum.weeklySalary ?? 0]))
    const weekly = teams.map((team) => weeklyByTeam.get(team.id) ?? 0)
    distribution("weekly payroll per club", weekly)
    console.info(`  league-wide weekly payroll: ${weekly.reduce((sum, value) => sum + value, 0)}`)
    const humanWeekly = teams.filter((t) => !t.isBot).map((t) => weeklyByTeam.get(t.id) ?? 0)
    const botWeekly = teams.filter((t) => t.isBot).map((t) => weeklyByTeam.get(t.id) ?? 0)
    distribution("...Human clubs", humanWeekly)
    distribution("...BOT clubs", botWeekly)

    // ------------------------------------------------------------------
    // 4. THE RISK ENVELOPE: can any club be surprised by one week's wages?
    // ------------------------------------------------------------------
    console.info("\n--- 4. BALANCE DISTRIBUTION ---")
    const balances = await prisma.team.findMany({ select: { id: true, name: true, isBot: true, balance: true } })
    distribution("balance per club", balances.map((row) => row.balance))
    distribution("...Human clubs", balances.filter((row) => !row.isBot).map((row) => row.balance))
    distribution("...BOT clubs", balances.filter((row) => row.isBot).map((row) => row.balance))
    const negative = balances.filter((row) => row.balance < 0)
    const belowOneWeek = balances.filter((row) => row.balance < (weeklyByTeam.get(row.id) ?? 0))
    console.info(`  clubs with a NEGATIVE balance:          ${negative.length}`)
    for (const row of negative.slice(0, 10)) console.info(`    ${row.name} (${row.id}) ${row.balance}`)
    console.info(`  clubs holding LESS than one week's pay: ${belowOneWeek.length}`)
    for (const row of belowOneWeek.slice(0, 10)) {
      console.info(`    ${row.name} (${row.id}) balance=${row.balance} weekly=${weeklyByTeam.get(row.id) ?? 0}`)
    }

    // ------------------------------------------------------------------
    // 5. What the next autonomous run would actually do.
    // ------------------------------------------------------------------
    console.info("\n--- 5. THE NEXT AUTONOMOUS PAYROLL RUN ---")
    const window = payrollWindow(now)
    console.info(`  activation boundary:        ${PAYROLL_AUTOMATION_START.toISOString()}`)
    console.info(`  look-back cap:              ${PAYROLL_MAX_CATCHUP_WEEKS} week(s)`)
    console.info(`  most recent payroll instant:${getMostRecentPayrollTime(now).toISOString()}`)
    console.info(`  next payroll instant:       ${getNextPayrollDate(now).toISOString()}`)
    console.info(`  candidate weeks right now:  ${window.instants.length}`)
    console.info(`  weeks outside the window:   ${window.weeksOutsideWindow}`)

    const settledKeys = new Set(payroll.map((row) => `${row.teamId}|${row.referenceId}`))
    let wouldCharge = 0
    let wouldChargeClubs = 0
    for (const instant of window.instants) {
      const referenceId = payrollReferenceId(payrollWeekKey(instant))
      for (const team of teams) {
        if (!isPayrollDueForTeam(instant, team)) continue
        if (settledKeys.has(`${team.id}|${referenceId}`)) continue
        wouldCharge += weeklyByTeam.get(team.id) ?? 0
        wouldChargeClubs++
      }
    }
    console.info(`  club-weeks it would settle: ${wouldChargeClubs}`)
    console.info(`  total it would debit:       ${wouldCharge}`)
    const wouldGoNegative = balances.filter((row) => {
      const owed = window.instants.filter(
        (instant) =>
          isPayrollDueForTeam(instant, teams.find((team) => team.id === row.id)!) &&
          !settledKeys.has(`${row.id}|${payrollReferenceId(payrollWeekKey(instant))}`)
      ).length
      return row.balance - owed * (weeklyByTeam.get(row.id) ?? 0) < 0
    })
    console.info(`  clubs that would go negative: ${wouldGoNegative.length}`)
    for (const row of wouldGoNegative.slice(0, 10)) console.info(`    ${row.name} (${row.id}) balance=${row.balance}`)

    // ------------------------------------------------------------------
    // 6. THE ACTIVATION GATE.
    // ------------------------------------------------------------------
    console.info("\n--- 6. ACTIVATION READINESS ---")
    const boundaryKey = payrollReferenceId(payrollWeekKey(PAYROLL_AUTOMATION_START))
    const postBoundaryPayrollRows = payroll.filter((row) => row.referenceId >= boundaryKey).length
    const activation = evaluateActivationReadiness({
      now,
      activationStart: PAYROLL_AUTOMATION_START,
      postBoundaryPayrollRows,
    })
    console.info(`  post-boundary wage rows:    ${postBoundaryPayrollRows}`)
    console.info(`  ${activation.ok ? "PASS" : "FAIL"}  ${activation.verdict}: ${activation.detail}`)

    // ------------------------------------------------------------------
    // 7. Stadium construction.
    // ------------------------------------------------------------------
    console.info("\n--- 7. STADIUM CONSTRUCTION ---")
    const jobs = await prisma.stadiumConstructionJob.findMany({
      select: { id: true, status: true, endsAt: true, completedAt: true, stadium: { select: { teamId: true } } },
      orderBy: { endsAt: "asc" },
    })
    const jobsByStatus = new Map<string, number>()
    for (const job of jobs) jobsByStatus.set(job.status, (jobsByStatus.get(job.status) ?? 0) + 1)
    console.info(`  construction jobs, ever:    ${jobs.length}`)
    for (const [status, count] of jobsByStatus) console.info(`    ${status.padEnd(12)} ${count}`)
    const overdue = jobs.filter((job) => job.status === "active" && job.endsAt <= now)
    console.info(`  OVERDUE (active, past its deadline): ${overdue.length}`)
    if (overdue.length > 0) {
      console.info(`  oldest overdue deadline:    ${overdue[0].endsAt.toISOString()}`)
      for (const job of overdue.slice(0, 10)) {
        const isBot = botById.get(job.stadium.teamId)
        console.info(`    ${job.id} team=${job.stadium.teamId} (${isBot ? "BOT" : "HUMAN"}) ends=${job.endsAt.toISOString()}`)
      }
    }
    const jobHumans = jobs.filter((job) => botById.get(job.stadium.teamId) === false).length
    console.info(`  jobs owned by Human / BOT clubs: ${jobHumans} / ${jobs.length - jobHumans}`)

    const stadiums = await prisma.stadium.findMany({
      select: { regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true },
    })
    distribution(
      "stadium capacity",
      stadiums.map((row) => row.regularSeats + row.coveredSeats + row.premiumSeats + row.vipSeats)
    )

    // =====================================================================
    // PHASE 3R - the calibrated economy's own state.
    //
    // Everything below is a MEASUREMENT with a stated expectation, so a run
    // can be read by somebody who was not here when it was written. Two of
    // them fail the run rather than merely reporting: a NEW orphan, and a
    // settlement written before its activation boundary. Both mean money moved
    // in a way nothing in this codebase is supposed to be able to produce.
    // =====================================================================
    console.info("\n=== 8. PHASE 3R: THE CALIBRATED ECONOMY ===")
    const phase3rFailures: string[] = []

    console.info(`  boundary:              ${PHASE_3R_ACTIVATION_START.toISOString()}`)
    const phase3rLive = now.getTime() >= PHASE_3R_ACTIVATION_START.getTime()
    console.info(`  state:                 ${phase3rLive ? "ACTIVE" : "not yet active"}`)
    console.info(
      `  constants:             scale ${SALARY_SCALE}, compression ${SALARY_COMPRESSION}, ` +
        `sponsor ${SPONSOR_COEFFICIENT}, tier ${SPONSOR_TIER_MULTIPLIER[1]}/${SPONSOR_TIER_MULTIPLIER[2]}`
    )

    // --- 8a. THE SALARY AUTHORITY, MEASURED RATHER THAN ASSUMED -----------
    // Which curve is each active player actually stored on? Before the
    // boundary every player should be on the legacy curve; after the first
    // settled week, every player should be on the calibrated one. A mixture
    // AFTER activation is the mixed-authority state the design forbids.
    const activeSquad = await prisma.player.findMany({
      where: { teamId: { not: null }, careerStatus: "ACTIVE" },
      select: { teamId: true, overall: true, age: true, potential: true, primaryPosition: true, weeklySalary: true },
    })
    let onLegacyCurve = 0
    let onCalibratedCurve = 0
    let onNeither = 0
    for (const player of activeSquad) {
      const legacy = calculateUncompressedPlayerSalary(player)
      const calibrated = calculatePhase3RSalary(player)
      if (player.weeklySalary === calibrated) onCalibratedCurve++
      else if (player.weeklySalary === legacy) onLegacyCurve++
      else onNeither++
    }
    console.info(
      `  salary authority:      ${onCalibratedCurve} on the calibrated curve, ${onLegacyCurve} on the legacy curve, ` +
        `${onNeither} on neither (of ${activeSquad.length})`
    )
    if (phase3rLive && onLegacyCurve > 0) {
      console.info("    NOTE: post-activation players still on the legacy curve - the next settlement reprices them")
    }

    // --- 8b. WEEKLY PAYROLL AND THE FOUR-WEEK RESERVE ---------------------
    const payrollByTeam = new Map<string, number>()
    for (const player of activeSquad) {
      if (!player.teamId) continue
      payrollByTeam.set(player.teamId, (payrollByTeam.get(player.teamId) ?? 0) + player.weeklySalary)
    }
    const clubs = await prisma.team.findMany({ select: { id: true, isBot: true, balance: true } })
    distribution("weekly payroll", clubs.map((club) => payrollByTeam.get(club.id) ?? 0))
    const negativeClubs = clubs.filter((club) => club.balance < 0)
    const clubsBelowOneWeek = clubs.filter((club) => club.balance < (payrollByTeam.get(club.id) ?? 0))
    const belowFourWeeks = clubs.filter((club) => club.balance < (payrollByTeam.get(club.id) ?? 0) * RESERVE_WEEKS)
    console.info(`  clubs with a negative balance:      ${negativeClubs.length}/${clubs.length}`)
    console.info(`  clubs below ONE week of payroll:    ${clubsBelowOneWeek.length}/${clubs.length}`)
    console.info(`  clubs below FOUR weeks (the reserve): ${belowFourWeeks.length}/${clubs.length}`)
    for (const club of negativeClubs.slice(0, 10)) {
      console.info(`    ${club.id} (${club.isBot ? "BOT" : "HUMAN"}) balance ${club.balance}`)
    }

    // --- 8c. HUMAN VS BOT PARITY ------------------------------------------
    // Not a fairness sentiment - a measurable claim. The two populations are
    // charged by identical formulas, so a systematic gap in what they PAY (as
    // opposed to what they have) would mean a formula read a club type
    // somewhere it should not have.
    const humanClubs = clubs.filter((club) => !club.isBot)
    const botClubs = clubs.filter((club) => club.isBot)
    const meanPayroll = (list: typeof clubs) =>
      list.length === 0 ? 0 : Math.round(list.reduce((sum, c) => sum + (payrollByTeam.get(c.id) ?? 0), 0) / list.length)
    const meanBalance = (list: typeof clubs) =>
      list.length === 0 ? 0 : Math.round(list.reduce((sum, c) => sum + c.balance, 0) / list.length)
    console.info(
      `  Human (${humanClubs.length}): mean payroll ${meanPayroll(humanClubs)}, mean balance ${meanBalance(humanClubs)}`
    )
    console.info(
      `  BOT   (${botClubs.length}): mean payroll ${meanPayroll(botClubs)}, mean balance ${meanBalance(botClubs)}`
    )

    // --- 8d. TIER ECONOMICS ------------------------------------------------
    const tiers = await readSeasonTiersAsOf(prisma, now)
    const byTier = new Map<number, { clubs: number; payroll: number; balance: number }>()
    for (const club of clubs) {
      const tier = tiers.tierByTeamId.get(club.id) ?? 0
      const bucket = byTier.get(tier) ?? { clubs: 0, payroll: 0, balance: 0 }
      bucket.clubs++
      bucket.payroll += payrollByTeam.get(club.id) ?? 0
      bucket.balance += club.balance
      byTier.set(tier, bucket)
    }
    console.info(`  tier authority: season ${tiers.seasonNumber ?? "none"} (${tiers.seasonId ?? "-"})`)
    for (const tier of [...byTier.keys()].sort()) {
      const bucket = byTier.get(tier)
      if (!bucket) continue
      const label = tier === 0 ? "no season membership" : `tier ${tier}`
      console.info(
        `    ${label.padEnd(22)} clubs ${String(bucket.clubs).padStart(3)}  ` +
          `mean payroll ${Math.round(bucket.payroll / bucket.clubs)}  mean balance ${Math.round(bucket.balance / bucket.clubs)}`
      )
    }

    // --- 8e. SETTLEMENT STATE, AND NO HISTORICAL CATCH-UP ------------------
    const boundaryWeekKey = payrollWeekKey(PHASE_3R_ACTIVATION_START)
    const [sponsorRows, maintenanceRows] = await Promise.all([
      prisma.financialTransaction.findMany({
        where: { type: "sponsorIncome" },
        select: { referenceId: true, amount: true },
      }),
      prisma.financialTransaction.findMany({
        where: { type: "stadiumMaintenance" },
        select: { referenceId: true, amount: true },
      }),
    ])
    const settlementReport = (label: string, rows: { referenceId: string; amount: number }[], prefix: string) => {
      const weeks = new Set(rows.map((row) => row.referenceId.replace(prefix, "")))
      const total = rows.reduce((sum, row) => sum + row.amount, 0)
      console.info(`  ${label}: ${rows.length} row(s) across ${weeks.size} week(s), net ${total}`)
      // START-LINE ACTIVATION: a settled week whose key sorts BEFORE the
      // boundary week means something wrote history. The week key is
      // zero-padded so lexicographic order is chronological order.
      const preBoundary = [...weeks].filter((week) => week < boundaryWeekKey)
      if (preBoundary.length > 0) {
        phase3rFailures.push(`${label} settled ${preBoundary.length} week(s) BEFORE the activation boundary: ${preBoundary.join(", ")}`)
      }
      return weeks
    }
    settlementReport("sponsor", sponsorRows, "SPONSOR_")
    settlementReport("maintenance", maintenanceRows, "MAINTENANCE_")

    // --- 8f. DUPLICATE ECONOMIC REFERENCE KEYS -----------------------------
    // The (teamId, referenceId) unique constraint makes a true duplicate
    // unstorable, so a non-zero count here would mean the constraint itself is
    // missing - which is worth knowing loudly rather than trusting.
    const duplicates = await prisma.$queryRaw<{ teamid: string; referenceid: string; n: bigint }[]>`
      SELECT "teamId" AS teamid, "referenceId" AS referenceid, COUNT(*) AS n
      FROM "FinancialTransaction"
      GROUP BY "teamId", "referenceId"
      HAVING COUNT(*) > 1
    `
    console.info(`  duplicate (teamId, referenceId) pairs: ${duplicates.length}`)
    if (duplicates.length > 0) {
      phase3rFailures.push(`${duplicates.length} duplicate economic reference key(s) - the unique constraint is not doing its job`)
      for (const row of duplicates.slice(0, 10)) {
        console.error(`    ${row.teamid} ${row.referenceid} x${Number(row.n)}`)
      }
    }

    // --- 8g. THE ACKNOWLEDGED ORPHAN, AND ONLY IT --------------------------
    // FinancialTransaction has no foreign key to Fixture; the link is the
    // referenceId string alone. One fixture is known to have gone and left
    // three rows behind. That residue is HISTORY: it is not deleted, not
    // reversed and not repaired. What must never appear is a SECOND one.
    const matchRows = await prisma.financialTransaction.findMany({
      where: { referenceId: { startsWith: "MATCH_" } },
      select: { referenceId: true, amount: true },
    })
    const fixtureIdOf = (referenceId: string) => referenceId.split("_")[1] ?? ""
    const referencedFixtureIds = [...new Set(matchRows.map((row) => fixtureIdOf(row.referenceId)))]
    const liveFixtures = new Set(
      (
        await prisma.fixture.findMany({ where: { id: { in: referencedFixtureIds } }, select: { id: true } })
      ).map((fixture) => fixture.id)
    )
    const orphanFixtureIds = referencedFixtureIds.filter((id) => !liveFixtures.has(id))
    const unexpectedOrphans = orphanFixtureIds.filter((id) => !ACKNOWLEDGED_ORPHAN_FIXTURE_IDS.includes(id))
    console.info(`  match ledger rows: ${matchRows.length} across ${referencedFixtureIds.length} fixture(s)`)
    console.info(
      `  orphaned fixtures: ${orphanFixtureIds.length} (acknowledged ${ACKNOWLEDGED_ORPHAN_FIXTURE_IDS.length}, unexpected ${unexpectedOrphans.length})`
    )
    for (const id of orphanFixtureIds) {
      const rows = matchRows.filter((row) => fixtureIdOf(row.referenceId) === id)
      const net = rows.reduce((sum, row) => sum + row.amount, 0)
      const known = ACKNOWLEDGED_ORPHAN_FIXTURE_IDS.includes(id)
      console.info(`    ${id}  ${rows.length} row(s), net ${net}  ${known ? "ACKNOWLEDGED - leave it alone" : "UNEXPECTED"}`)
    }
    if (unexpectedOrphans.length > 0) {
      phase3rFailures.push(`${unexpectedOrphans.length} NEW orphaned fixture(s) in the ledger: ${unexpectedOrphans.join(", ")}`)
    }

    // --- 8h. STADIUM ANOMALIES ---------------------------------------------
    const groundState = await prisma.stadium.findMany({
      select: { teamId: true, regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true },
    })
    const expanded = groundState
      .map((row) => ({ teamId: row.teamId, ...calculateWeeklyMaintenance(toSeatCounts(row)) }))
      .filter((row) => row.total > 0)
    const shrunk = groundState.filter((row) => {
      const seats = toSeatCounts(row)
      return SEAT_TYPES.some((type) => seats[type] < DEFAULT_STARTING_SEATS[type])
    })
    console.info(`  clubs above the starting ground: ${expanded.length}/${groundState.length}`)
    console.info(`  weekly maintenance liability:    ${expanded.reduce((sum, row) => sum + row.total, 0)}`)
    console.info(`  clubs with a seat class BELOW the default: ${shrunk.length}`)
    for (const row of shrunk.slice(0, 5)) console.info(`    ${row.teamId}`)
    console.info(`  clubs with no Stadium row at all: ${clubs.length - groundState.length}`)

    console.info("\nECONOMY AUDIT: REPORTED")
    if (phase3rFailures.length > 0) {
      for (const failure of phase3rFailures) console.error(`PHASE 3R AUDIT FAILURE: ${failure}`)
      process.exitCode = 1
    }
    if (!activation.ok) {
      console.error("ACTIVATION GATE: FAIL - see section 6")
      process.exitCode = 1
    }
  } catch (error) {
    console.error("prod:economy:audit failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
