/**
 * Read-only Render status: web service state + latest deploy, cron service
 * state + schedule/command + latest run. Never suspends, resumes, or
 * triggers anything. No secrets printed - only RENDER_API_KEY's presence
 * matters, its value never does.
 *
 * Run with: npm run prod:render:status
 */
import { getWebServiceStatus, getCronStatus, getLatestDeploy } from "../../src/lib/production/render-ops"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"

async function main() {
  console.info("=== prod:render:status ===")
  console.info("Mode:     READ ONLY\n")

  try {
    const web = await getWebServiceStatus()
    console.info(`Web Service: ${web.name} (${web.id})`)
    console.info(`  suspended: ${web.suspended}`)
    const latestWebDeploy = await getLatestDeploy(web.id)
    if (latestWebDeploy) {
      console.info(`  latest deploy: ${latestWebDeploy.status} @ ${latestWebDeploy.createdAt ?? "unknown time"}`)
      console.info(`  commit: ${latestWebDeploy.commitId ?? "unknown"} - ${latestWebDeploy.commitMessage ?? ""}`)
    } else {
      console.info("  latest deploy: (none found)")
    }

    console.info("")
    const cron = await getCronStatus()
    console.info(`Cron: ${cron.name} (${cron.id})`)
    console.info(`  suspended: ${cron.suspended}`)
    console.info(`  schedule: ${cron.schedule ?? "unknown"}`)
    console.info(`  command: ${cron.command ?? "unknown"}`)
    const latestCronDeploy = await getLatestDeploy(cron.id)
    if (latestCronDeploy) {
      console.info(`  latest run/deploy: ${latestCronDeploy.status} @ ${latestCronDeploy.createdAt ?? "unknown time"}`)
    } else {
      console.info("  latest run/deploy: (none found)")
    }

    console.info(
      "\nNote: Render's API has no distinct endpoint for a Cron Job's individual scheduled-run history separate from its deploy history - " +
        "the line above is the closest available signal, not a per-run log."
    )
  } catch (error) {
    if (error instanceof RenderCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:render:status failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
