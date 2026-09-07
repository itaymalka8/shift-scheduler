/**
 * Turns Render's Auto Deploy OFF on both production services, so a push to
 * main can no longer reach Production on its own and prod:deploy:safe
 * becomes the only path in.
 *
 * MUTATES Production configuration - requires PRODUCTION_WRITE_CONFIRM.
 * What it does NOT do: deploy, redeploy, restart, suspend or resume
 * anything, and it does not touch the repository, branch, build command,
 * start command, cron schedule, env vars, plan, region or service name.
 * Auto Deploy only governs what Render does on the NEXT push; the running
 * deploy is untouched by this change.
 *
 * Every write is followed by an INDEPENDENT re-read of the service (not a
 * reuse of the PATCH response) before this script reports success, because
 * the whole point of the setting is that something else must be able to
 * trust it afterwards.
 *
 * Run with:
 *   PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:render:autodeploy:off
 */
import { getWebServiceConfig, getCronServiceConfig, setWebAutoDeploy, setCronAutoDeploy } from "../../src/lib/production/render-ops"
import { describeAutoDeployState, type AutoDeployState } from "../../src/lib/production/auto-deploy-guard"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"

function reportService(label: string, name: string, id: string, autoDeploy: AutoDeployState, repo: string | null, branch: string | null) {
  console.info(`${label}: ${name} (${id})`)
  console.info(`  repository: ${repo ?? "unknown"}`)
  console.info(`  branch: ${branch ?? "unknown"}`)
  console.info(`  Auto Deploy: ${describeAutoDeployState(autoDeploy)}`)
}

async function main() {
  console.info("=== prod:render:autodeploy:off ===")
  console.info("Mode:     WRITE (Render service configuration only - no deploy, no database, no suspend)\n")

  try {
    // 1. Read both services first. Nothing is written until the two
    //    services this script is about to change have been identified and
    //    printed, so a wrong-service mistake is visible in the log above
    //    the write rather than discovered afterwards.
    console.info("--- BEFORE ---")
    const webBefore = await getWebServiceConfig()
    reportService("Web Service", webBefore.name, webBefore.id, webBefore.autoDeploy, webBefore.repo, webBefore.branch)
    const cronBefore = await getCronServiceConfig()
    reportService("Cron", cronBefore.name, cronBefore.id, cronBefore.autoDeploy, cronBefore.repo, cronBefore.branch)

    if (webBefore.autoDeploy === "off" && cronBefore.autoDeploy === "off") {
      console.info("\nBoth services already have Auto Deploy OFF - nothing to change.")
      console.info("\nWEB AUTO DEPLOY: OFF")
      console.info("CRON AUTO DEPLOY: OFF")
      console.info("AUTO DEPLOY DISABLE: PASS (no-op)")
      return
    }

    // 2. Write.
    console.info("\n--- WRITE ---")
    const webEcho = await setWebAutoDeploy(false)
    console.info(`Web Service PATCH autoDeploy=no -> echoed ${describeAutoDeployState(webEcho)}`)
    const cronEcho = await setCronAutoDeploy(false)
    console.info(`Cron PATCH autoDeploy=no -> echoed ${describeAutoDeployState(cronEcho)}`)

    // 3. Independent re-read. The PATCH echo above is informational only -
    //    this is the reading that decides PASS or FAIL.
    console.info("\n--- AFTER (independent re-read) ---")
    const webAfter = await getWebServiceConfig()
    reportService("Web Service", webAfter.name, webAfter.id, webAfter.autoDeploy, webAfter.repo, webAfter.branch)
    const cronAfter = await getCronServiceConfig()
    reportService("Cron", cronAfter.name, cronAfter.id, cronAfter.autoDeploy, cronAfter.repo, cronAfter.branch)

    // Nothing but this script's own field should have moved. Repo and
    // branch are re-asserted because they are the two fields whose silent
    // change would be most damaging and least obvious.
    const drift: string[] = []
    if (webAfter.repo !== webBefore.repo || webAfter.branch !== webBefore.branch) drift.push("web repo/branch")
    if (cronAfter.repo !== cronBefore.repo || cronAfter.branch !== cronBefore.branch) drift.push("cron repo/branch")
    if (webAfter.suspended !== webBefore.suspended) drift.push("web suspended")
    if (cronAfter.suspended !== cronBefore.suspended) drift.push("cron suspended")

    console.info("")
    console.info(`WEB AUTO DEPLOY: ${describeAutoDeployState(webAfter.autoDeploy)}`)
    console.info(`CRON AUTO DEPLOY: ${describeAutoDeployState(cronAfter.autoDeploy)}`)

    if (drift.length > 0) {
      console.error(`\nAUTO DEPLOY DISABLE: FAIL - unexpected change to ${drift.join(", ")}. Inspect the services on Render's dashboard.`)
      process.exitCode = 1
      return
    }

    // Fail closed: only a confirmed "off" on BOTH counts is a pass.
    // UNKNOWN is a failure here for the same reason it is a refusal in the
    // deploy guard - it means this script cannot prove what it just did.
    if (webAfter.autoDeploy !== "off" || cronAfter.autoDeploy !== "off") {
      console.error("\nAUTO DEPLOY DISABLE: FAIL - Auto Deploy is not confirmed OFF on both services after the write.")
      process.exitCode = 1
      return
    }

    console.info("AUTO DEPLOY DISABLE: PASS")
    console.info("Code can now reach Production ONLY through prod:deploy:safe.")
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError || error instanceof RenderCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:render:autodeploy:off failed:", error instanceof Error ? error.message : error)
    console.error("AUTO DEPLOY DISABLE: FAIL")
    process.exitCode = 1
  }
}

main()
