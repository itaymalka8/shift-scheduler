/**
 * Central scheduled-job entrypoint: runs every periodic background task the
 * app needs today - due-fixture simulation and transfer-listing expiration -
 * back-to-back in one process. This is the one job a scheduler (Render Cron
 * or otherwise) should call going forward; the two single-purpose scripts it
 * wraps (process-due-fixtures.ts, expire-transfer-listings.ts) are left
 * completely unchanged and still work on their own for local debugging.
 * Neither task's own logic lives here - this file only calls the existing
 * services (processDueFixtures, expireDueTransferListings), which stay the
 * single source of truth for what each task actually does.
 *
 * The two tasks are isolated from each other: a failure in one is logged
 * clearly and does not stop the other from getting its own chance to run,
 * so a problem with transfer expiration never silently prevents fixtures
 * from being played, and vice versa. The process still exits non-zero if
 * either task failed, so a real scheduler sees the run as failed.
 *
 * Run with: npx tsx scripts/process-scheduled-jobs.ts
 */
import { processDueFixtures } from "../src/lib/match/simulate"
import { expireDueTransferListings } from "../src/lib/transfers/expiration"
import { prisma } from "../src/lib/prisma"

async function main() {
  let failed = false

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
    const { processedCount } = await processDueFixtures()
    console.info(`Fixtures due observed: ${processedCount}`)
  } catch (error) {
    failed = true
    console.error("Fixture processing failed:", error)
  }

  try {
    const { expiredCount } = await expireDueTransferListings()
    console.info(`Transfer listings expired: ${expiredCount}`)
  } catch (error) {
    failed = true
    console.error("Transfer listing expiration failed:", error)
  }

  if (failed) {
    process.exitCode = 1
  }
}

main().finally(() => prisma.$disconnect())
