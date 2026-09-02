/**
 * Short, human-readable status of Production's season state - read-only.
 * Run with: npm run prod:season-status
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"

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
  printProductionBanner("prod:season-status", target)

  try {
    // Same discovery shape as runSeasonEndOrchestratorForAllSeasons's own
    // query (src/lib/seasons/orchestrator.ts), re-implemented here rather
    // than imported - see client.ts's header for why.
    const seasons = await prisma.season.findMany({
      where: { status: { not: "COMPLETED" }, OR: [{ isActive: true }, { status: "OFFSEASON" }] },
      select: { id: true, countryCode: true, number: true, status: true, offseasonStage: true, isActive: true },
      orderBy: [{ countryCode: "asc" }, { number: "asc" }],
    })

    if (seasons.length === 0) {
      console.info("No active or in-offseason season found.")
      return
    }

    const now = new Date()
    for (const season of seasons) {
      console.info(`\n${season.countryCode} season ${season.number}: ${season.status}/${season.offseasonStage} (active=${season.isActive})`)

      const [playedAgg, due, nextFixtures, openHuman, openBot, expiredWaiting] = await Promise.all([
        prisma.fixture.aggregate({
          where: { division: { seasonId: season.id }, playedAt: { not: null } },
          _count: { _all: true },
          _max: { matchday: true },
        }),
        prisma.fixture.count({ where: { division: { seasonId: season.id }, playedAt: null, scheduledAt: { lte: now } } }),
        prisma.fixture.findMany({
          where: { division: { seasonId: season.id }, playedAt: null },
          orderBy: { scheduledAt: "asc" },
          take: 5,
          select: { matchday: true, scheduledAt: true },
        }),
        prisma.youthIntake.count({ where: { seasonId: season.id, status: "OPEN", team: { isBot: false } } }),
        prisma.youthIntake.count({ where: { seasonId: season.id, status: "OPEN", team: { isBot: true } } }),
        // Same filter runOneStep's WAITING_HUMANS stage uses to find intakes
        // due for settlement (src/lib/seasons/orchestrator.ts).
        prisma.youthIntake.count({
          where: { seasonId: season.id, status: "OPEN", closesAt: { lte: now }, team: { isBot: false } },
        }),
      ])

      console.info(`  Current round: ${playedAgg._max.matchday ?? 0}`)
      console.info(`  Played fixtures: ${playedAgg._count._all}`)
      console.info(`  Due fixtures: ${due}`)
      console.info("  Next fixtures:")
      if (nextFixtures.length === 0) {
        console.info("    (none unplayed)")
      }
      for (const f of nextFixtures) {
        console.info(`    matchday ${f.matchday} @ ${f.scheduledAt?.toISOString() ?? "unscheduled"}`)
      }
      console.info(`  Open human youth intakes: ${openHuman}`)
      console.info(`  Open bot youth intakes: ${openBot}`)
      console.info(`  Expired intakes waiting settlement: ${expiredWaiting}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("prod:season-status failed:", error)
  process.exitCode = 1
})
