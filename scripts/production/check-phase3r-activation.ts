/**
 * READ ONLY pre-deploy gate for Phase 3R: is the calibrated economy's
 * activation boundary still in the future, and is Production in the state the
 * activation expects to find?
 *
 * FAILS CLOSED, and exits non-zero, so a deploy pipeline stops rather than
 * proceeds. The deploy that turns the calibrated economy on MUST land before
 * PHASE_3R_ACTIVATION_START. If it slips past, the very first scheduled tick
 * would settle a sponsor week and a maintenance week that closed before
 * anybody could observe the new behaviour - sixty clubs credited and charged
 * retroactively, by accident, which is exactly what start-line activation
 * exists to prevent.
 *
 * The fix is never to force it. Move the literal in
 * src/lib/economy/config.ts to the next future Thursday 13:00 UTC, revalidate,
 * and run this again.
 *
 * IT STOPS COMPLAINING ONCE PHASE 3R IS LIVE, for the same reason the payroll
 * check does: post-boundary sponsor rows are what distinguish "the activation
 * deploy is late" from "the boundary is history, as it should be". No flag, no
 * extra state and no migration is needed to tell those two apart.
 *
 * Run with: npm run prod:economy:activation
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import {
  PAYROLL_AUTOMATION_START,
  PAYROLL_HOUR_UTC,
  PAYROLL_WEEKDAY,
  PHASE_3R_ACTIVATION_START,
} from "../../src/lib/economy/config"
import { isPayrollInstant, payrollWeekKey } from "../../src/lib/economy/payroll-clock"
import { sponsorReferenceId } from "../../src/lib/economy/sponsor"
import { maintenanceReferenceId, calculateWeeklyMaintenance } from "../../src/lib/economy/maintenance"
import { evaluateActivationReadiness } from "../../src/lib/production/payroll-activation"
import { SALARY_SCALE, SALARY_COMPRESSION, SALARY_COMPRESSION_NORMALISER } from "../../src/lib/economy/salary-curve"
import { SPONSOR_COEFFICIENT, SPONSOR_TIER_MULTIPLIER } from "../../src/lib/economy/config"
import { toSeatCounts } from "../../src/lib/stadium/config"
import { teamsWithoutEconomicHistory, teamsWithHistoryStartingAtOrAfter } from "../../src/lib/economy/state-history"

async function main() {
  console.info("=== prod:economy:activation ===")
  console.info("Mode:     READ ONLY - counts only, no writes\n")

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
  printProductionBanner("prod:economy:activation", target)

  try {
    const now = new Date()
    console.info(`Now:                    ${now.toISOString()}`)
    console.info(`Phase 3R boundary:      ${PHASE_3R_ACTIVATION_START.toISOString()}`)
    console.info(`Payroll boundary:       ${PAYROLL_AUTOMATION_START.toISOString()}`)
    console.info(`Weekly grid:            weekday ${PAYROLL_WEEKDAY} (Thursday), ${PAYROLL_HOUR_UTC}:00 UTC\n`)

    console.info("=== THE CANONICAL CONSTANTS THIS DEPLOY WOULD ACTIVATE ===")
    console.info(`  salary scale         ${SALARY_SCALE}`)
    console.info(`  salary compression   ${SALARY_COMPRESSION}`)
    console.info(`  wage-bill normaliser ${SALARY_COMPRESSION_NORMALISER}`)
    console.info(`  sponsor coefficient  ${SPONSOR_COEFFICIENT}`)
    console.info(`  tier multipliers     ${SPONSOR_TIER_MULTIPLIER[1]} / ${SPONSOR_TIER_MULTIPLIER[2]}\n`)

    const checks: { ok: boolean; label: string }[] = []
    const record = (ok: boolean, label: string) => {
      checks.push({ ok, label })
      console.info(`  ${ok ? "PASS" : "FAIL"}  ${label}`)
    }

    console.info("=== BOUNDARY SHAPE ===")
    // A boundary off the weekly grid would reprice on a day nothing settles,
    // and the first calibrated week would then settle against a league nothing
    // had repriced. Wrong in a way that is very hard to see in a log.
    record(isPayrollInstant(PHASE_3R_ACTIVATION_START), "the boundary sits on the weekly settlement grid")
    record(
      PHASE_3R_ACTIVATION_START.getTime() >= PAYROLL_AUTOMATION_START.getTime(),
      "the boundary is at or after autonomous payroll's own boundary"
    )

    console.info("\n=== ACTIVATION READINESS ===")
    const boundaryWeek = payrollWeekKey(PHASE_3R_ACTIVATION_START)
    const [postBoundarySponsorRows, anySponsorRows, anyMaintenanceRows] = await Promise.all([
      prisma.financialTransaction.count({
        where: { type: "sponsorIncome", referenceId: { gte: sponsorReferenceId(boundaryWeek) } },
      }),
      prisma.financialTransaction.count({ where: { type: "sponsorIncome" } }),
      prisma.financialTransaction.count({ where: { type: "stadiumMaintenance" } }),
    ])
    console.info(`  post-boundary sponsor rows in this database: ${postBoundarySponsorRows}`)

    const readiness = evaluateActivationReadiness({
      now,
      activationStart: PHASE_3R_ACTIVATION_START,
      postBoundaryPayrollRows: postBoundarySponsorRows,
    })
    record(readiness.ok, `${readiness.verdict}: ${readiness.detail}`)

    console.info("\n=== PRE-ACTIVATION STATE ===")
    // Sponsor and maintenance are brand new. Any row of either type before
    // activation would mean something other than the weekly settlement wrote
    // one, which is a defect worth stopping for.
    record(
      postBoundarySponsorRows > 0 || anySponsorRows === 0,
      `no pre-boundary sponsor rows exist (found ${anySponsorRows} sponsor row(s) in total)`
    )
    record(
      postBoundarySponsorRows > 0 || anyMaintenanceRows === 0,
      `no pre-activation maintenance rows exist (found ${anyMaintenanceRows})`
    )
    // The maintenance reference key is checked for shape rather than presence -
    // it must be distinct from the other two settlements of the same week, or
    // the (teamId, referenceId) unique constraint would make one settlement
    // silently no-op the next.
    record(
      maintenanceReferenceId(boundaryWeek) !== sponsorReferenceId(boundaryWeek),
      "the three settlements of one week use three distinct reference keys"
    )

    console.info("\n=== WHAT THE FIRST CALIBRATED WEEK WOULD DO ===")
    const stadiums = await prisma.stadium.findMany({
      select: { teamId: true, regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true },
    })
    const chargeable = stadiums
      .map((stadium) => ({ teamId: stadium.teamId, ...calculateWeeklyMaintenance(toSeatCounts(stadium)) }))
      .filter((row) => row.total > 0)
    const maintenanceLiability = chargeable.reduce((sum, row) => sum + row.total, 0)
    console.info(`  clubs above the starting ground: ${chargeable.length}/${stadiums.length}`)
    console.info(`  first-week maintenance liability: ${maintenanceLiability.toLocaleString("en-US")}`)
    for (const row of chargeable.slice(0, 10)) {
      console.info(`    ${row.teamId}  ${row.total.toLocaleString("en-US")}/week`)
    }

    const [teams, activePlayers] = await Promise.all([
      prisma.team.count(),
      prisma.player.count({ where: { teamId: { not: null }, careerStatus: "ACTIVE" } }),
    ])
    console.info(`  clubs: ${teams}   active owned players to be repriced on the first tick: ${activePlayers}`)

    // === STATE-HISTORY COVERAGE - FAILS CLOSED =============================
    //
    // From Phase 3R onward the sponsor settlement and every fixture's crowd are
    // priced from TeamEconomicState as of the instant being settled, and that
    // read fails closed: a club with no eligible row throws rather than being
    // priced from current state. So a club without history is not a degraded
    // settlement, it is a settlement that cannot happen - and discovering that
    // during the first calibrated week would leave the whole league unsettled.
    //
    // Two things have to be true, and "some rows exist" is neither of them:
    // every club must have history at all, and every club's history must BEGIN
    // strictly before the boundary. A club baselined after activation would
    // leave the activation instant itself unreconstructible.
    console.info("\n=== STATE-HISTORY COVERAGE ===")
    const [clubCount, withoutHistory, startingLate] = await Promise.all([
      prisma.team.count(),
      teamsWithoutEconomicHistory(prisma),
      teamsWithHistoryStartingAtOrAfter(prisma, PHASE_3R_ACTIVATION_START),
    ])
    console.info(`  clubs: ${clubCount}   clubs with no economic history: ${withoutHistory.length}`)
    for (const id of withoutHistory.slice(0, 10)) console.info(`    NO HISTORY ${id}`)
    for (const id of startingLate.slice(0, 10)) console.info(`    HISTORY STARTS AT/AFTER THE BOUNDARY ${id}`)
    record(
      withoutHistory.length === 0,
      `every club has economic history (${clubCount - withoutHistory.length}/${clubCount})`
    )
    record(
      startingLate.length === 0,
      `every club's history begins strictly before ${PHASE_3R_ACTIVATION_START.toISOString()}`
    )
    if (withoutHistory.length > 0 || startingLate.length > 0) {
      console.info("  Run prod:economy:baseline before activation - see scripts/production/economy-baseline.ts")
    }

    const failed = checks.filter((check) => !check.ok)
    console.info(`\nPHASE 3R ACTIVATION CHECK: ${failed.length === 0 ? "PASS" : "FAIL"}`)
    if (failed.length > 0) {
      for (const check of failed) console.error(`  FAILED: ${check.label}`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error("prod:economy:activation failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
