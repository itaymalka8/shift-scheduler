/**
 * Read-only Render status: web service state + latest deploy, cron service
 * state + schedule/command + latest run, and - for both - the connected
 * repo/branch and Auto Deploy setting. Never suspends, resumes, or
 * triggers anything. No secrets printed - only RENDER_API_KEY's presence
 * matters, its value never does.
 *
 * Auto Deploy is printed as an explicit ON / OFF / UNKNOWN rather than a
 * raw field value, because UNKNOWN is a real, meaningful third answer here:
 * it is what prod:deploy:safe's guard refuses on, so it must be visible as
 * its own state and never collapsed into OFF (see auto-deploy-guard.ts).
 *
 * Run with: npm run prod:render:status
 */
import { getWebServiceConfig, getCronServiceConfig, getCronStatus, getLatestDeploy } from "../../src/lib/production/render-ops"
import { describeAutoDeployState } from "../../src/lib/production/auto-deploy-guard"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"

async function main() {
  console.info("=== prod:render:status ===")
  console.info("Mode:     READ ONLY\n")

  try {
    const web = await getWebServiceConfig()
    console.info(`Web Service: ${web.name} (${web.id})`)
    console.info(`  suspended: ${web.suspended}`)
    console.info(`  Web Auto Deploy: ${describeAutoDeployState(web.autoDeploy)}`)
    console.info(`  repository: ${web.repo ?? "unknown"}`)
    console.info(`  branch: ${web.branch ?? "unknown"}`)
    const latestWebDeploy = await getLatestDeploy(web.id)
    if (latestWebDeploy) {
      console.info(`  latest deploy: ${latestWebDeploy.status} @ ${latestWebDeploy.createdAt ?? "unknown time"}`)
      console.info(`  commit: ${latestWebDeploy.commitId ?? "unknown"} - ${latestWebDeploy.commitMessage ?? ""}`)
    } else {
      console.info("  latest deploy: (none found)")
    }

    console.info("")
    const cron = await getCronServiceConfig()
    console.info(`Cron: ${cron.name} (${cron.id})`)
    console.info(`  suspended: ${cron.suspended}`)
    console.info(`  Cron Auto Deploy: ${describeAutoDeployState(cron.autoDeploy)}`)
    console.info(`  repository: ${cron.repo ?? "unknown"}`)
    console.info(`  branch: ${cron.branch ?? "unknown"}`)
    const cronSchedule = await getCronStatus()
    console.info(`  schedule: ${cronSchedule.schedule ?? "unknown"}`)
    console.info(`  command: ${cronSchedule.command ?? "unknown"}`)
    const latestCronDeploy = await getLatestDeploy(cron.id)
    if (latestCronDeploy) {
      console.info(`  latest run/deploy: ${latestCronDeploy.status} @ ${latestCronDeploy.createdAt ?? "unknown time"}`)
    } else {
      console.info("  latest run/deploy: (none found)")
    }

    console.info("")
    console.info("--- Auto Deploy (what prod:deploy:safe's guard reads) ---")
    console.info(`Web Auto Deploy:  ${describeAutoDeployState(web.autoDeploy)}`)
    console.info(`Cron Auto Deploy: ${describeAutoDeployState(cron.autoDeploy)}`)
    if (web.autoDeploy === "off" && cron.autoDeploy === "off") {
      console.info("Controlled deployments only: code can reach Production ONLY through prod:deploy:safe.")
    } else {
      console.info("WARNING: a push can reach Production without prod:deploy:safe. prod:deploy:safe will REFUSE to run in this state.")
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
