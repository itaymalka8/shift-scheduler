/**
 * Gives every pre-existing club an ownership history (TeamEra), from
 * timestamps already in the database. See src/lib/teams/backfill-eras.ts for
 * the classification rules and why each is deterministic rather than a
 * guess.
 *
 * MUTATES Production (INSERTs into TeamEra only) - requires
 * PRODUCTION_WRITE_CONFIRM. It never updates or deletes any row, in any
 * table: no fixture, team, score, balance, squad, stadium or standing is
 * read for writing or touched. The only statement it issues besides reads is
 * an INSERT into TeamEra.
 *
 * IDEMPOTENT: a club that already has any era is skipped entirely. Running
 * it twice is a no-op the second time.
 *
 * DRY RUN BY DEFAULT. Without --apply it reports exactly what it would
 * write and exits without writing, so the plan can be reviewed against
 * Production before anything is inserted.
 *
 * Run with:
 *   npm run prod:eras:backfill              (dry run - safe, read only)
 *   PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:eras:backfill -- --apply
 */
import { createProductionClient } from "../../src/lib/production/client"
import { planTeamEraBackfill, planHasExactlyOneOpenEraPerTeam, type BackfillTeamInput } from "../../src/lib/teams/backfill-eras"
import { ProductionWriteNotConfirmedError, assertProductionWriteConfirmed } from "../../src/lib/production/write-guard"

const APPLY = process.argv.includes("--apply")

async function main() {
  console.info("=== prod:eras:backfill ===")
  console.info(`Mode:     ${APPLY ? "WRITE (INSERT into TeamEra only)" : "DRY RUN - read only, nothing will be written"}`)

  try {
    if (APPLY) assertProductionWriteConfirmed()

    const { prisma, target } = createProductionClient()
    console.info(`Database: host=${target.host} name=${target.database}\n`)

    const teams = await prisma.team.findMany({
      select: {
        id: true,
        name: true,
        isBot: true,
        createdAt: true,
        userId: true,
        user: { select: { createdAt: true } },
        _count: { select: { eras: true } },
      },
      orderBy: { createdAt: "asc" },
    })

    const input: BackfillTeamInput[] = teams.map((team) => ({
      id: team.id,
      isBot: team.isBot,
      createdAt: team.createdAt,
      userId: team.userId,
      userCreatedAt: team.user?.createdAt ?? null,
      existingEraCount: team._count.eras,
    }))

    const plan = planTeamEraBackfill(input)

    console.info(`Teams examined: ${teams.length}`)
    console.info(`Already have eras (skipped): ${plan.skippedAlreadyHasEras.length}`)
    console.info(`Eras to insert: ${plan.eras.length}`)
    const botOnly = plan.eras.filter((e) => e.type === "BOT" && e.endedAt === null).length
    const closedBot = plan.eras.filter((e) => e.type === "BOT" && e.endedAt !== null).length
    const human = plan.eras.filter((e) => e.type === "HUMAN").length
    console.info(`  open BOT eras (still-bot clubs): ${botOnly}`)
    console.info(`  closed BOT eras (taken-over clubs): ${closedBot}`)
    console.info(`  open HUMAN eras: ${human}`)

    if (!planHasExactlyOneOpenEraPerTeam(plan)) {
      console.error("\nBACKFILL: FAIL - the plan would leave a club with something other than exactly one open era.")
      process.exitCode = 1
      return
    }

    if (plan.unresolved.length > 0) {
      console.info(`\nUNRESOLVED - reported, never guessed (${plan.unresolved.length}):`)
      for (const item of plan.unresolved) {
        const team = teams.find((t) => t.id === item.teamId)
        console.info(`  ${item.teamId} (${team?.name ?? "unknown"}): ${item.reason}`)
      }
    } else {
      console.info("\nUnresolved clubs: none - every club was classified deterministically.")
    }

    if (!APPLY) {
      console.info("\nDRY RUN - nothing was written. Re-run with --apply (and PRODUCTION_WRITE_CONFIRM) to insert.")
      console.info("BACKFILL: READY")
      return
    }

    if (plan.eras.length === 0) {
      console.info("\nNothing to insert.")
      console.info("BACKFILL: PASS (no-op)")
      return
    }

    // One transaction: either every club gets its history or none does.
    // createMany only - no update, no delete, anywhere.
    const inserted = await prisma.$transaction(async (tx) => {
      const result = await tx.teamEra.createMany({
        data: plan.eras.map((era) => ({
          teamId: era.teamId,
          userId: era.userId,
          type: era.type,
          startedAt: era.startedAt,
          endedAt: era.endedAt,
        })),
      })
      return result.count
    })

    console.info(`\nInserted ${inserted} era(s).`)
    console.info("BACKFILL: PASS")
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:eras:backfill failed:", error instanceof Error ? error.message : error)
    console.error("BACKFILL: FAIL")
    process.exitCode = 1
  }
}

main()
