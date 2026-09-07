/**
 * Scheduled job entrypoint: plays every fixture whose kickoff has passed
 * but hasn't been simulated yet, across every division. Meant to run on a
 * timer (a Render Cron Job job - see render.yaml), talking to Postgres
 * directly via the same DATABASE_URL as the web service. Never invoked
 * from a page load or API route a browser can reach.
 *
 * Run with: npx tsx scripts/process-due-fixtures.ts
 */
import { processDueFixtures } from "../src/lib/match/simulate"
import { prisma } from "../src/lib/prisma"

processDueFixtures()
  .then(({ processedCount, fixtureIds }) => {
    console.info(`processDueFixtures: played ${processedCount} fixture(s)`, fixtureIds)
  })
  .catch((error) => {
    console.error("processDueFixtures failed:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
