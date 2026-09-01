/**
 * Manual/local entrypoint for the season-end orchestrator: takes every
 * currently-active (or already mid-offseason) season as far through the
 * end-of-season machine as it can get right now, then exits.
 *
 * Deliberately NOT wired into render.yaml's cron or into
 * process-scheduled-jobs.ts yet - production scheduling is a separate step,
 * and this script exists so the whole transition can be driven and inspected
 * locally first. Nothing here contains any orchestration logic of its own:
 * it only calls runSeasonEndOrchestratorForAllSeasons, which stays the
 * single source of truth for what a season transition does.
 *
 * Run with: npm run process-season-lifecycle
 */
import { runSeasonEndOrchestratorForAllSeasons } from "../src/lib/seasons/orchestrator"

async function main() {
  const startedAt = Date.now()
  const summaries = await runSeasonEndOrchestratorForAllSeasons()

  if (summaries.length === 0) {
    console.info("No active or in-offseason season found - nothing to do.")
    return
  }

  for (const summary of summaries) {
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
  console.info(`Season lifecycle run finished in ${Date.now() - startedAt}ms`)
}

main()
  .catch((error) => {
    console.error("Season lifecycle run failed:", error)
    process.exitCode = 1
  })
