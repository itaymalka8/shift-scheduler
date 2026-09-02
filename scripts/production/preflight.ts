/**
 * Read-only Production preflight - everything Step 7's manual, by-hand audit
 * checked, now runnable on demand. Never writes anything: every query below
 * is a count, a findMany/findFirst, or a plain SELECT against
 * "_prisma_migrations". No migrate deploy, no mutation, no fixture
 * processing.
 *
 * Run with: npm run prod:preflight
 */
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { findDuplicateActiveSeasons } from "../../src/lib/production/duplicate-active-seasons"
import { QA_MATCHDAY } from "../../src/lib/production/qa-residue"
import {
  expectedFixtureCount,
  V1_EXPECTED_DIVISIONS,
  V1_EXPECTED_DIVISION_TEAM_MEMBERSHIPS,
  V1_EXPECTED_TOTAL_FIXTURES,
} from "../../src/lib/production/league-structure"

interface MigrationRow {
  migration_name: string
  finished_at: Date | null
  rolled_back_at: Date | null
}

async function loadMigrationStatus(prisma: ReturnType<typeof createProductionClient>["prisma"]) {
  const localNames = readdirSync(join(process.cwd(), "prisma/migrations"))
    .filter((name) => name !== "migration_lock.toml")
    .sort()

  let applied: MigrationRow[] = []
  let migrationsTableExists = true
  try {
    applied = await prisma.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/does not exist/i.test(message)) {
      migrationsTableExists = false
    } else {
      throw error
    }
  }

  const appliedNames = new Set(applied.filter((m) => m.finished_at !== null && m.rolled_back_at === null).map((m) => m.migration_name))
  const pendingLocal = localNames.filter((name) => !appliedNames.has(name))
  const lastApplied = applied.length > 0 ? applied[applied.length - 1].migration_name : null

  return { migrationsTableExists, localCount: localNames.length, appliedCount: appliedNames.size, pendingLocal, lastApplied }
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
  printProductionBanner("prod:preflight", target)

  const errors: string[] = []
  const warnings: string[] = []
  const lines: string[] = []

  try {
    // --- Migration status ---------------------------------------------
    const migration = await loadMigrationStatus(prisma)
    if (!migration.migrationsTableExists) {
      errors.push('"_prisma_migrations" table not found - no migration has ever been applied to this database.')
    } else {
      lines.push(`Migrations: ${migration.appliedCount}/${migration.localCount} of this branch's local migrations applied`)
      lines.push(`  last applied: ${migration.lastApplied ?? "(none)"}`)
      if (migration.pendingLocal.length > 0) {
        warnings.push(`${migration.pendingLocal.length} migration(s) not yet applied to Production: ${migration.pendingLocal.join(", ")}`)
      }
    }

    // --- Seasons + duplicate-active check --------------------------------
    const seasons = await prisma.season.findMany({
      select: { countryCode: true, number: true, status: true, offseasonStage: true, isActive: true },
      orderBy: [{ countryCode: "asc" }, { number: "asc" }],
    })
    lines.push(`Seasons: ${seasons.length} total, ${seasons.filter((s) => s.isActive).length} active`)
    for (const s of seasons) {
      lines.push(`  ${s.countryCode} n${s.number}: ${s.status}/${s.offseasonStage} active=${s.isActive}`)
    }
    const duplicates = findDuplicateActiveSeasons(seasons)
    if (duplicates.length > 0) {
      errors.push(`Duplicate active Season per country: ${duplicates.join(", ")} - a future migration adding the partial unique index would fail on this.`)
    }

    // --- Core counts ------------------------------------------------------
    const [
      divisionCount,
      divisionTeamCount,
      teamCount,
      playerCount,
      fixtureCount,
      playedFixtureCount,
      matchEventCount,
      playerMatchStatsCount,
      financialTransactionCount,
      youthIntakeCount,
      youthProspectCount,
      playerSeasonLifecycleCount,
    ] = await Promise.all([
      prisma.division.count(),
      prisma.divisionTeam.count(),
      prisma.team.count(),
      prisma.player.count(),
      prisma.fixture.count(),
      prisma.fixture.count({ where: { playedAt: { not: null } } }),
      prisma.matchEvent.count(),
      prisma.playerMatchStats.count(),
      prisma.financialTransaction.count(),
      prisma.youthIntake.count(),
      prisma.youthProspect.count(),
      prisma.playerSeasonLifecycle.count(),
    ])
    lines.push(
      `Divisions=${divisionCount} DivisionTeams=${divisionTeamCount} Teams=${teamCount} Players=${playerCount}`,
      `Fixtures=${fixtureCount} playedFixtures=${playedFixtureCount} MatchEvents=${matchEventCount} PlayerMatchStats=${playerMatchStatsCount}`,
      `FinancialTransactions=${financialTransactionCount} YouthIntakes=${youthIntakeCount} YouthProspects=${youthProspectCount} PlayerSeasonLifecycle=${playerSeasonLifecycleCount}`
    )

    // --- V1 fixed-shape hard checks -----------------------------------
    // Not warnings: these are the exact numbers V1's one-country,
    // three-division world is defined to have. A mismatch means something
    // is structurally broken, not just "worth a look".
    if (divisionCount !== V1_EXPECTED_DIVISIONS) {
      errors.push(`Expected ${V1_EXPECTED_DIVISIONS} Divisions for V1, found ${divisionCount}.`)
    }
    if (divisionTeamCount !== V1_EXPECTED_DIVISION_TEAM_MEMBERSHIPS) {
      errors.push(`Expected ${V1_EXPECTED_DIVISION_TEAM_MEMBERSHIPS} DivisionTeam memberships for V1, found ${divisionTeamCount}.`)
    }
    if (fixtureCount !== V1_EXPECTED_TOTAL_FIXTURES) {
      errors.push(`Expected ${V1_EXPECTED_TOTAL_FIXTURES} total Fixtures for V1, found ${fixtureCount}.`)
    }

    // --- League structure ---------------------------------------------
    const divisions = await prisma.division.findMany({
      select: {
        tier: true,
        group: true,
        _count: { select: { teams: true, fixtures: true } },
        fixtures: { select: { matchday: true }, orderBy: { matchday: "desc" }, take: 1 },
      },
      orderBy: [{ tier: "asc" }, { group: "asc" }],
    })
    for (const d of divisions) {
      const expected = expectedFixtureCount(d._count.teams)
      const rounds = d.fixtures[0]?.matchday ?? 0
      const label = `tier ${d.tier}${d.group ? d.group : ""}`
      lines.push(`  Division ${label}: teams=${d._count.teams} fixtures=${d._count.fixtures} (expected ${expected}) rounds=${rounds}`)
      if (d._count.teams > 0 && d._count.fixtures !== expected) {
        warnings.push(`Division ${label} has ${d._count.fixtures} fixtures, expected ${expected} for ${d._count.teams} teams.`)
      }
    }

    // --- Fixture schedule -------------------------------------------------
    const now = new Date()
    const [earliest, latest, dueNow, nextUnplayed] = await Promise.all([
      prisma.fixture.findFirst({ orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
      prisma.fixture.findFirst({ orderBy: { scheduledAt: "desc" }, select: { scheduledAt: true } }),
      prisma.fixture.count({ where: { playedAt: null, scheduledAt: { lte: now } } }),
      prisma.fixture.findMany({
        where: { playedAt: null },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        select: { id: true, matchday: true, scheduledAt: true },
      }),
    ])
    lines.push(
      `Schedule: earliest=${earliest?.scheduledAt?.toISOString() ?? "n/a"} latest=${latest?.scheduledAt?.toISOString() ?? "n/a"} dueNow=${dueNow}`
    )
    if (nextUnplayed.length === 0) {
      lines.push("  next unplayed: (none)")
    }
    for (const f of nextUnplayed) {
      lines.push(`  next unplayed: matchday ${f.matchday} @ ${f.scheduledAt?.toISOString() ?? "unscheduled"}`)
    }

    // --- QA residue ---------------------------------------------------
    const qaFixtures = await prisma.fixture.count({ where: { matchday: QA_MATCHDAY } })
    if (qaFixtures > 0) {
      errors.push(`${qaFixtures} fixture(s) with matchday=${QA_MATCHDAY} (QA residue) found in Production.`)
    } else {
      lines.push(`QA residue: none (matchday=${QA_MATCHDAY} count = 0)`)
    }
  } catch (error) {
    errors.push(`Unexpected error while querying Production: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await prisma.$disconnect()
  }

  console.info(lines.join("\n"))
  if (warnings.length > 0) {
    console.info("\nWarnings:")
    for (const w of warnings) console.info(`  - ${w}`)
  }
  if (errors.length > 0) {
    console.error("\nErrors:")
    for (const e of errors) console.error(`  - ${e}`)
  }

  console.info(`\nPRODUCTION PREFLIGHT: ${errors.length === 0 ? "PASS" : "FAIL"}`)
  process.exitCode = errors.length === 0 ? 0 : 1
}

main()
