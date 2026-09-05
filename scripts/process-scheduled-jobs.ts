/**
 * Central scheduled-job entrypoint: runs every periodic background task the
 * app needs today - due-fixture simulation, transfer-listing expiration, and
 * season-lifecycle orchestration - back-to-back in one process. This is the
 * one job a scheduler (Render Cron or otherwise) should call going forward;
 * the three single-purpose scripts it wraps (process-due-fixtures.ts,
 * expire-transfer-listings.ts, process-season-lifecycle.ts) are left
 * completely unchanged and still work on their own for local debugging.
 * No task's own logic lives here - this file only calls the existing
 * services (processDueFixtures, expireDueTransferListings,
 * runSeasonEndOrchestratorForAllSeasons), which stay the single source of
 * truth for what each task actually does.
 *
 * ORDER MATTERS in exactly one place: season lifecycle runs AFTER fixture
 * processing, because fixture processing is what plays the last match of a
 * season - running the orchestrator first would always see that match as
 * still unplayed and defer the whole offseason by a full cron tick. Transfer
 * expiration sits between them only because it is the cheapest and touches
 * neither: it reads and writes TransferListing rows alone, so it is
 * genuinely order-independent with respect to the other two.
 *
 * The tasks are isolated from each other: a failure in one is logged clearly
 * and does not stop the others from getting their own chance to run, so a
 * problem with transfer expiration never silently prevents fixtures from
 * being played, and a failing season transition never rolls back matches
 * that were already simulated. There is deliberately no wrapping
 * transaction - each domain commits its own work as it goes, and a later
 * failure leaves earlier committed work standing. The process still exits
 * non-zero if any task failed, so a real scheduler sees the run as failed.
 *
 * Run with: npx tsx scripts/process-scheduled-jobs.ts
 */
import { processDueFixtures } from "../src/lib/match/simulate"
import { activateDueMatchConsequences } from "../src/lib/match/consequence-service"
import { expireDueTransferListings } from "../src/lib/transfers/expiration"
import { runSeasonEndOrchestratorForAllSeasons } from "../src/lib/seasons/orchestrator"
import { prisma } from "../src/lib/prisma"

async function main() {
  const startedAt = Date.now()
  const failedSubsystems: string[] = []

  let fixturesObserved: number | null = null
  let fixturesBlocked = 0
  let consequencesApplied: number | null = null
  let listingsExpired: number | null = null
  let seasonsChecked: number | null = null
  let seasonTransitions: number | null = null
  let seasonErrors = 0

  // --- A. Fixture processing ----------------------------------------------
  try {
    // processDueFixtures's own returned processedCount is how many fixtures
    // were found due at the moment this call started - not how many this
    // particular call actually simulated. Under two overlapping Runner
    // instances, the loser of ensureFixtureSimulated's own row lock still
    // sees the fixture as "due" here and reports it, even though it safely
    // no-ops once it re-checks playedAt inside that lock. The database
    // stays correct either way (a fixture is only ever really played
    // once) - only the wording below is adjusted, to never claim this
    // Runner itself simulated a fixture it may not actually have.
    const { processedCount, blocked } = await processDueFixtures()
    fixturesObserved = processedCount
    fixturesBlocked = blocked.length
    console.info(`Fixtures due observed: ${processedCount}`)
    // A blocked fixture is a club that cannot field a legal XI. It is NOT a
    // crash and it does not stop the matchday - but it must be loud, because
    // the alternative this replaces was simulating eight against eleven.
    for (const entry of blocked) {
      console.error(`Fixture ${entry.fixtureId} BLOCKED (${entry.code}): ${entry.detail}`)
    }
    if (blocked.length > 0) failedSubsystems.push("lineups")
  } catch (error) {
    failedSubsystems.push("fixtures")
    console.error("Fixture processing failed:", error)
  }

  // --- A2. Match consequence activation -----------------------------------
  // Runs AFTER fixture processing and BEFORE everything else, because a match
  // played earlier in this same tick may already be publicly finished (the
  // cron can be late), and a ban served here must be served before the
  // season orchestrator looks at anything.
  //
  // Fixture-driven and idempotent: it selects only fixtures that are played,
  // publicly finished and not yet applied, and each one is applied under its
  // own row lock behind Fixture.consequencesAppliedAt. Running this twice in
  // a row deducts no fitness twice and serves no ban twice.
  try {
    const consequences = await activateDueMatchConsequences()
    consequencesApplied = consequences.fixturesApplied
    console.info(
      `Match consequences activated: ${consequences.fixturesApplied}/${consequences.fixturesFound} fixture(s), ` +
        `${consequences.playersUpdated} player(s), ${consequences.injuriesStarted} injury(ies), ` +
        `${consequences.suspensionsAdded} suspension(s)`
    )
    for (const failure of consequences.failures) {
      console.error(`Consequence activation failed for fixture ${failure.fixtureId}:`, failure.error)
    }
    if (consequences.failures.length > 0) failedSubsystems.push("consequences")
  } catch (error) {
    failedSubsystems.push("consequences")
    console.error("Match consequence activation failed:", error)
  }

  // --- B. Transfer scheduled jobs -----------------------------------------
  try {
    const { expiredCount } = await expireDueTransferListings()
    listingsExpired = expiredCount
    console.info(`Transfer listings expired: ${expiredCount}`)
  } catch (error) {
    failedSubsystems.push("transfers")
    console.error("Transfer listing expiration failed:", error)
  }

  // --- C. Season lifecycle orchestration ----------------------------------
  try {
    const report = await runSeasonEndOrchestratorForAllSeasons()
    seasonsChecked = report.seasonsChecked
    seasonTransitions = report.transitionsPerformed
    seasonErrors = report.failures.length

    for (const summary of report.summaries) {
      const moves = summary.steps.filter((step) => step.advanced)
      if (moves.length === 0) continue
      const path = [
        `${moves[0].fromStatus}/${moves[0].fromStage}`,
        ...moves.map((step) => `${step.toStatus}/${step.toStage}`),
      ].join(" -> ")
      console.info(`Season ${summary.seasonId}: ${path}`)
    }
    // One season failing never stops the others (the orchestrator already
    // isolated them) - but it still fails the run.
    for (const failure of report.failures) {
      console.error(`Season lifecycle failed for season ${failure.seasonId}:`, failure.error)
    }
    if (report.failures.length > 0) {
      failedSubsystems.push("seasons")
    }
  } catch (error) {
    failedSubsystems.push("seasons")
    console.error("Season lifecycle orchestration failed:", error)
  }

  // --- Summary -------------------------------------------------------------
  const na = (value: number | null) => (value === null ? "failed" : String(value))
  console.info(
    [
      "Scheduled run summary:",
      `  Fixtures processed:        ${na(fixturesObserved)}`,
      `  Fixtures blocked (XI):     ${fixturesBlocked}`,
      `  Consequences activated:    ${na(consequencesApplied)}`,
      `  Transfer listings expired: ${na(listingsExpired)}`,
      `  Active seasons checked:    ${na(seasonsChecked)}`,
      `  Season transitions:        ${na(seasonTransitions)}`,
      `  Season errors:             ${seasonErrors}`,
      `  Duration:                  ${Date.now() - startedAt}ms`,
    ].join("\n")
  )

  if (failedSubsystems.length > 0) {
    console.error(`Scheduled run FAILED in: ${failedSubsystems.join(", ")}`)
    process.exitCode = 1
  }
}

main().finally(() => prisma.$disconnect())
