/**
 * Manual/local entrypoint for the season-end orchestrator: takes every
 * currently-active (or already mid-offseason) season as far through the
 * end-of-season machine as it can get right now, then exits.
 *
 * The scheduled path is process-scheduled-jobs.ts, which calls the very same
 * runSeasonEndOrchestratorForAllSeasons after it has played the day's due
 * fixtures. This script stays for driving and inspecting a transition on its
 * own, with the per-stage detail a cron log has no room for. Nothing here
 * contains any orchestration logic of its own: it only calls
 * runSeasonEndOrchestratorForAllSeasons, which stays the single source of
 * truth for what a season transition does.
 *
 * Run with: npm run process-season-lifecycle
 */
import { runSeasonEndOrchestratorForAllSeasons } from "../src/lib/seasons/orchestrator"

async function main() {
  const startedAt = Date.now()
  const report = await runSeasonEndOrchestratorForAllSeasons()

  if (report.seasonsChecked === 0) {
    console.info("No active or in-offseason season found - nothing to do.")
    return
  }

  for (const summary of report.summaries) {
    console.info(`Season ${summary.seasonId}: ${summary.finalStatus}/${summary.finalStage}`)
    for (const step of summary.steps) {
      const move = step.advanced
        ? `${step.fromStatus}/${step.fromStage} -> ${step.toStatus}/${step.toStage}`
        : `${step.fromStatus}/${step.fromStage} (held)`
      console.info(`  ${move}: ${step.detail}`)
    }
    if (summary.nextSeasonId) {
      console.info(`  next season: ${summary.nextSeasonId}`)
    }
  }
  for (const failure of report.failures) {
    console.error(`Season ${failure.seasonId} failed:`, failure.error)
  }
  console.info(
    `Season lifecycle run finished in ${Date.now() - startedAt}ms - ` +
      `${report.seasonsChecked} checked, ${report.transitionsPerformed} transition(s), ${report.failures.length} error(s)`
  )
  if (report.failures.length > 0) {
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error("Season lifecycle run failed:", error)
    process.exitCode = 1
  })
