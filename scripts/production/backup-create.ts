/**
 * MUTATES Production account (provisions a new Neon branch - an instant
 * point-in-time backup of Production, data + schema, never schema-only).
 * Requires PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION or
 * refuses immediately. Never deletes anything - there is no
 * prod:backup:delete command by design.
 *
 * Run with: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:backup:create
 */
import { createBackupBranch, verifyBackupBranch } from "../../src/lib/production/neon-ops"
import { NeonCredentialsMissingError } from "../../src/lib/production/neon-client"
import { ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"

async function main() {
  console.info("=== prod:backup:create ===")
  console.info("Mode:     WRITE (create backup branch)\n")

  try {
    const branch = await createBackupBranch()
    console.info(`Backup branch created: ${branch.name} (${branch.id})`)

    const verification = await verifyBackupBranch(branch.id)
    console.info(`Verification: exists=${verification.exists} isChildOfProduction=${verification.isChildOfProduction}`)
    console.info(verification.exists && verification.isChildOfProduction ? "BACKUP: VERIFIED" : "BACKUP: NOT VERIFIED")
    if (!verification.exists || !verification.isChildOfProduction) process.exitCode = 1
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError || error instanceof NeonCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:backup:create failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
