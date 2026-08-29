/**
 * Manual, one-off, READ-ONLY companion to create-cron-test-fixture.ts - not
 * wired into any route, never writes anything, never calls
 * processDueFixtures. Run from a Render Shell to see the current state of
 * the test fixture before and after a scheduled cron run:
 *
 *   npx tsx scripts/check-cron-test-fixture.ts
 *
 * Prints exactly the fields relevant to verifying the scheduler worked -
 * nothing else.
 */
import { prisma } from "../src/lib/prisma"

const TEST_MATCHDAY = 999999

async function main() {
  const fixture = await prisma.fixture.findFirst({
    where: { matchday: TEST_MATCHDAY },
    orderBy: { createdAt: "desc" },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
  })
  if (!fixture) {
    console.log("No cron test fixture found.")
    return
  }

  const [eventCount, statsCount, txCount] = await Promise.all([
    prisma.matchEvent.count({ where: { fixtureId: fixture.id } }),
    prisma.playerMatchStats.count({ where: { fixtureId: fixture.id } }),
    prisma.financialTransaction.count({ where: { referenceId: { contains: fixture.id } } }),
  ])

  console.log("fixtureId:", fixture.id)
  console.log("teams:", `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`)
  console.log("scheduledAt:", fixture.scheduledAt?.toISOString())
  console.log("status:", !fixture.playedAt ? "scheduled (not yet processed)" : "played")
  console.log("playedAt:", fixture.playedAt?.toISOString() ?? "null")
  console.log("homeScore/awayScore:", fixture.homeScore, "/", fixture.awayScore)
  console.log("matchEvent count:", eventCount)
  console.log("playerMatchStats count:", statsCount)
  console.log("financialTransaction count:", txCount)
}

main()
  .catch((error) => {
    console.error("check-cron-test-fixture failed:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
