/**
 * MUTATES Production: triggers a new deploy of the goalx-manager web
 * service's currently connected branch. Requires
 * PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION or refuses
 * immediately. Does NOT wait for the deploy to finish - see
 * prod:deploy:safe for a full guarded workflow that also waits and
 * verifies.
 *
 * Run with: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:deploy:trigger
 */
import { triggerDeploy } from "../../src/lib/production/render-ops"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"

async function main() {
  console.info("=== prod:deploy:trigger ===")
  console.info("Mode:     WRITE (trigger deploy)\n")

  try {
    const deploy = await triggerDeploy()
    console.info(`Deploy triggered: ${deploy.id} (status=${deploy.status})`)
    console.info(`Commit: ${deploy.commitId ?? "unknown"} - ${deploy.commitMessage ?? ""}`)
    console.info("\nThis command does not wait for completion - use prod:deploy:safe for a full guarded rollout.")
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError || error instanceof RenderCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:deploy:trigger failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
