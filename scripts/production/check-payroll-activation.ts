/**
 * READ ONLY pre-deploy gate: is the payroll activation boundary still in the
 * future?
 *
 * The deploy that first turns autonomous payroll on MUST land before
 * PAYROLL_AUTOMATION_START. If it slips past, the very first scheduled tick
 * would settle a payroll week that closed before the new behaviour was
 * visible - sixty clubs charged retroactively, by accident, which is the one
 * outcome start-line activation exists to prevent.
 *
 * FAILS CLOSED, and exits non-zero, so a deploy pipeline stops rather than
 * proceeds. The fix is never to force it: move the literal in
 * src/lib/economy/config.ts to the next future Thursday 13:00 UTC, revalidate,
 * and run preflight again.
 *
 * It stops complaining once payroll is genuinely live: post-boundary wage rows
 * are what distinguish "the first activation deploy is late" from "the
 * boundary is history, as it should be". See
 * src/lib/production/payroll-activation.ts.
 *
 * Run with: npm run prod:payroll:activation-check
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { PAYROLL_AUTOMATION_START, PAYROLL_WEEKDAY, PAYROLL_HOUR_UTC } from "../../src/lib/economy/config"
import { isPayrollInstant, payrollReferenceId, payrollWeekKey } from "../../src/lib/economy/payroll-clock"
import { evaluateActivationReadiness } from "../../src/lib/production/payroll-activation"

async function main() {
  console.info("=== prod:payroll:activation-check ===")
  console.info("Mode:     READ ONLY - one SELECT, no writes\n")

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
  printProductionBanner("prod:payroll:activation-check", target)

  try {
    const now = new Date()
    console.info(`Now:                 ${now.toISOString()}`)
    console.info(`Activation boundary: ${PAYROLL_AUTOMATION_START.toISOString()}`)
    console.info(`Payroll grid:        weekday ${PAYROLL_WEEKDAY} (Thursday), ${PAYROLL_HOUR_UTC}:00 UTC\n`)

    // A boundary that is not itself a payroll instant would settle nothing on
    // the day it names and everything a week later - wrong in a way that is
    // very hard to see in a log.
    const onGrid = isPayrollInstant(PAYROLL_AUTOMATION_START)
    console.info(`  ${onGrid ? "PASS" : "FAIL"}  the boundary sits on the payroll grid`)

    const boundaryKey = payrollReferenceId(payrollWeekKey(PAYROLL_AUTOMATION_START))
    const postBoundaryPayrollRows = await prisma.financialTransaction.count({
      where: { type: "playerSalaries", referenceId: { gte: boundaryKey } },
    })

    const check = evaluateActivationReadiness({
      now,
      activationStart: PAYROLL_AUTOMATION_START,
      postBoundaryPayrollRows,
    })
    console.info(`  post-boundary wage rows in this database: ${postBoundaryPayrollRows}`)
    console.info(`  ${check.ok ? "PASS" : "FAIL"}  ${check.verdict}: ${check.detail}`)

    const pass = onGrid && check.ok
    console.info(`\nPAYROLL ACTIVATION CHECK: ${pass ? "PASS" : "FAIL"}`)
    if (!pass) process.exitCode = 1
  } catch (error) {
    console.error("prod:payroll:activation-check failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
