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

    console.info("\nECONOMY AUDIT: REPORTED")
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
