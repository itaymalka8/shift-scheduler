/**
 * Computes exactly what `npm run process-scheduled-jobs` WOULD do against
 * Production right now, without running it. Every number below is a plain
 * read (count/findMany) mirroring that job's own queries - see the
 * comments at each step for the exact file/query being mirrored. Nothing
 * here calls processDueFixtures, expireDueTransferListings, or
 * runSeasonEndOrchestratorForAllSeasons - it never simulates a fixture,
 * never expires a listing, never advances a season.
 *
 * Run with: npm run prod:scheduled-check
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { isMatchFinished } from "../../src/lib/match/timing"

async function main() {
  let handle: ReturnType<typeof createProductionClient>
  try {
    handle = createProductionClient()
  } catch (error) {
    if (error instanceof ProductionSafetyError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }
  const { prisma, target } = handle
  printProductionBanner("prod:scheduled-check", target)

  try {
    const now = new Date()

    // Mirrors processDueFixtures()'s own WHERE clause - src/lib/match/simulate.ts.
    const dueFixtures = await prisma.fixture.count({ where: { playedAt: null, scheduledAt: { lte: now } } })

    // Mirrors expireDueTransferListings()'s own WHERE clause - src/lib/transfers/expiration.ts.
    const expiringListings = await prisma.transferListing.count({ where: { status: "OPEN", expiresAt: { lte: now } } })

    // Mirrors runSeasonEndOrchestratorForAllSeasons()'s own discovery query - src/lib/seasons/orchestrator.ts.
    const seasons = await prisma.season.findMany({
      where: { status: { not: "COMPLETED" }, OR: [{ isActive: true }, { status: "OFFSEASON" }] },
      select: { id: true, countryCode: true, number: true, status: true, offseasonStage: true },
      orderBy: { id: "asc" },
    })

    console.info(`Fixtures that would be processed now: ${dueFixtures}`)
    console.info(`Transfer listings that would expire now: ${expiringListings}`)
    console.info(`Seasons that would be checked: ${seasons.length}`)

    if (seasons.length === 0) {
      console.info("  (none)")
    }

    for (const season of seasons) {
      console.info(`\n  ${season.countryCode} season ${season.number}: ${season.status}/${season.offseasonStage}`)
      if (season.status === "ACTIVE") {
        // Re-implemented, not imported: isSeasonReadyForOffseason lives in
        // src/lib/seasons/orchestrator.ts, which imports the app's own
        // DATABASE_URL-bound Prisma singleton - nothing under
        // scripts/production may import that, directly or transitively
        // (see src/lib/production/client.ts) - so the same small check is
        // duplicated here against the safe production client instead.
        const fixtures = await prisma.fixture.findMany({
          where: { division: { seasonId: season.id } },
          select: { playedAt: true, scheduledAt: true },
        })
        const ready = fixtures.length > 0 && fixtures.every((f) => f.playedAt !== null && isMatchFinished(f.scheduledAt, now))
        console.info(`    Season transition possible right now: ${ready ? "YES - would move to OFFSEASON" : "no"}`)
      } else {
        console.info("    Season transition possible right now: n/a (already mid-offseason - stage-specific work would run, not evaluated by this dry check)")
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("prod:scheduled-check failed:", error)
  process.exitCode = 1
})
