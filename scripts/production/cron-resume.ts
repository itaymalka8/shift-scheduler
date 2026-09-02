/**
 * MUTATES Production: resumes the goalx-manager-fixture-processor Cron
 * service. Requires PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION
 * or refuses immediately.
 *
 * Run with: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:cron:resume
 */
import { resumeCron, getCronStatus } from "../../src/lib/production/render-ops"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"

async function main() {
  console.info("=== prod:cron:resume ===")
  console.info("Mode:     WRITE (resume)\n")

  try {
    await resumeCron()
    const status = await getCronStatus()
    console.info(`Cron ${status.name} (${status.id}) suspended=${status.suspended}`)
    console.info(status.suspended === false ? "RESUME: CONFIRMED" : "RESUME: NOT CONFIRMED - check Render dashboard")
    if (status.suspended !== false) process.exitCode = 1
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError || error instanceof RenderCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:cron:resume failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
