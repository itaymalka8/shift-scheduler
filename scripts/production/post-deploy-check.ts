/**
 * Read-only sanity check meant to run right after a Production deploy -
 * confirms the schema landed the way this branch expects and nothing about
 * the data looks broken. Never writes anything.
 *
 * Run with: npm run prod:post-deploy-check
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { findDuplicateActiveSeasons } from "../../src/lib/production/duplicate-active-seasons"
import { QA_MATCHDAY } from "../../src/lib/production/qa-residue"
import { V1_EXPECTED_TOTAL_FIXTURES } from "../../src/lib/production/league-structure"

// The one migration this generation of the schema needs applied for
// Season.status/offseasonStage and the three youth/lifecycle tables to
// exist at all - see
// prisma/migrations/20260901180307_add_season_lifecycle_youth_foundation/migration.sql.
const TARGET_MIGRATION = "20260901180307_add_season_lifecycle_youth_foundation"

interface MigrationRow {
  migration_name: string
  finished_at: Date | null
  rolled_back_at: Date | null
}

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
  printProductionBanner("prod:post-deploy-check", target)

  const errors: string[] = []
  const warnings: string[] = []

  try {
    // --- DB reachable + migrations table -----------------------------
    let migrations: MigrationRow[] = []
    try {
      migrations = await prisma.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC`
      console.info("DB reachable: yes")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/does not exist/i.test(message)) {
        console.info("DB reachable: yes")
        errors.push('"_prisma_migrations" table not found - no migration has ever been applied.')
      } else {
        throw error
      }
    }
    console.info(`Migrations applied: ${migrations.length}`)

    const targetMigrationRow = migrations.find((m) => m.migration_name === TARGET_MIGRATION)
    if (!targetMigrationRow) {
      errors.push(`Target migration not applied: ${TARGET_MIGRATION}`)
    } else if (targetMigrationRow.rolled_back_at !== null) {
      errors.push(`Target migration was rolled back: ${TARGET_MIGRATION}`)
    } else if (targetMigrationRow.finished_at === null) {
      errors.push(`Target migration is not finished (in progress or failed): ${TARGET_MIGRATION}`)
    } else {
      console.info(`Target migration applied: ${TARGET_MIGRATION} (${targetMigrationRow.finished_at.toISOString()})`)
    }

    // --- Season fields + Youth/lifecycle tables exist ----------------------
    try {
      await prisma.season.findFirst({ select: { status: true, offseasonStage: true } })
      console.info("Season.status / Season.offseasonStage: present")
    } catch (error) {
      errors.push(`Season.status/offseasonStage not queryable: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      await Promise.all([prisma.youthIntake.count(), prisma.youthProspect.count(), prisma.playerSeasonLifecycle.count()])
      console.info("YouthIntake / YouthProspect / PlayerSeasonLifecycle tables: present")
    } catch (error) {
      errors.push(`Youth/lifecycle tables not queryable: ${error instanceof Error ? error.message : String(error)}`)
    }

    // --- Active season invariant ------------------------------------------
    const seasons = await prisma.season.findMany({ select: { countryCode: true, isActive: true } })
    const duplicates = findDuplicateActiveSeasons(seasons)
    if (duplicates.length > 0) {
      errors.push(`Duplicate active Season per country: ${duplicates.join(", ")}`)
    } else {
      console.info(`Active season invariant: ok (${seasons.filter((s) => s.isActive).length} active season(s), no duplicates)`)
    }

    // --- Fixture count for V1 ----------------------------------------------
    const fixtureCount = await prisma.fixture.count()
    if (fixtureCount !== V1_EXPECTED_TOTAL_FIXTURES) {
      errors.push(`Total fixtures = ${fixtureCount}, expected ${V1_EXPECTED_TOTAL_FIXTURES} for V1's fixed league shape.`)
    } else {
      console.info(`Total fixtures: ${fixtureCount} (matches V1 expectation)`)
    }

    // --- QA residue ---------------------------------------------------
    const qaFixtures = await prisma.fixture.count({ where: { matchday: QA_MATCHDAY } })
    if (qaFixtures > 0) {
      errors.push(`${qaFixtures} fixture(s) with matchday=${QA_MATCHDAY} (QA residue) found.`)
    } else {
      console.info("QA residue: none")
    }
  } catch (error) {
    errors.push(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await prisma.$disconnect()
  }

  if (warnings.length > 0) {
    console.info("\nWarnings:")
    for (const w of warnings) console.info(`  - ${w}`)
  }
  if (errors.length > 0) {
    console.error("\nErrors:")
    for (const e of errors) console.error(`  - ${e}`)
  }

  console.info(`\nPRODUCTION POST-DEPLOY CHECK: ${errors.length === 0 ? "PASS" : "FAIL"}`)
  process.exitCode = errors.length === 0 ? 0 : 1
}

main()
