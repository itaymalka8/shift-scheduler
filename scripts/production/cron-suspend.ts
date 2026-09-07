/**
 * MUTATES Production: suspends the goalx-manager-fixture-processor Cron
 * service. Requires PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION
 * or refuses immediately.
 *
 * Run with: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:cron:suspend
 */
import { suspendCron, getCronStatus } from "../../src/lib/production/render-ops"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"

async function main() {
  console.info("=== prod:cron:suspend ===")
  console.info("Mode:     WRITE (suspend)\n")

  try {
    await suspendCron()
    const status = await getCronStatus()
    console.info(`Cron ${status.name} (${status.id}) suspended=${status.suspended}`)
    console.info(status.suspended === true ? "SUSPEND: CONFIRMED" : "SUSPEND: NOT CONFIRMED - check Render dashboard")
    if (status.suspended !== true) process.exitCode = 1
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError || error instanceof RenderCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:cron:suspend failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
