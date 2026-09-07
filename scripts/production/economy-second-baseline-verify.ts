/**
 * prod:economy:second-baseline-verify - THE SECOND BASELINE, ASKED READ-ONLY.
 *
 * WHAT "THE SECOND BASELINE" ACTUALLY MEANS. The required second result is
 * "0 new rows, 60/60 coverage". The obvious way to get it - run the baseline
 * again and check it wrote nothing - is the wrong way: it puts a write path
 * one gate away from the league's now-established history, for no gain. If the
 * gate ever failed to refuse, the "verification" would be the thing that broke
 * the invariant it was checking.
 *
 * SO THIS COMMAND CANNOT WRITE. It opens no transaction, takes no lock, has no
 * PRODUCTION_WRITE_CONFIRM to satisfy, imports no append primitive and issues
 * no INSERT, UPDATE or DELETE. Every database statement it runs is a SELECT and
 * every Render call it makes is a read.
 *
 * READ-ONLY IS NOT THE SAME AS UNGATED. This verifies Production, so it proves
 * the SAME environment contract the first baseline proved, through the SAME
 * authority - evaluateProductionEnvironmentGate:
 *
 *   the canonical GitHub branch head equals the approved target
 *   both Render services on the canonical repo, on the approved branch
 *   Auto Deploy OFF on both, both deployed commits exactly the target, web=cron
 *   Cron ACTIVE on the approved schedule
 *   migrations 23/23 with Migration 23 applied
 *   the TeamEconomicState catalog 7/7, triggers present AND enabled
 *   Phase 3R activation still in the future
 *   exactly 60 clubs
 *
 * A verification that measured history against a Production it had not
 * identified would be measuring something, but not the thing that matters.
 *
 * THEN, WHAT ONLY THIS COMMAND CHECKS:
 *   60 rows, 60/60 coverage, through evaluateSecondBaselineVerification -
 *     the canonical statement of the "0 new rows" contract
 *   every real club covered exactly once, against the actual roster
 *   every row version 1, reason baseline, effectiveAt before activation
 *   every row's weeklyPayroll a non-negative integer, and its
 *     attendanceQuality at or above ATTENDANCE_QUALITY_FLOOR
 *   sponsor and stadium-maintenance settlement counters readable
 *   ZERO repricing rows in history, because activation has not happened
 *   the acknowledged orphan still 3 rows netting +213629
 *   and the strict first-baseline gate now REFUSING on HISTORY_NOT_EMPTY,
 *     which is how "a second run writes 0 rows" is proved WITHOUT writing
 *
 * ANY UNREADABLE VALUE IS A REFUSAL. A verification that could not read is a
 * verification that failed, never one that passed quietly.
 *
 * CREDENTIALS: the Production database URL, a Render API key and a read-only
 * GitHub token - all three for READS. Deliberately NOT given
 * PRODUCTION_WRITE_CONFIRM (so no mutating command in this repository could run
 * even if invoked) and NOT given a Neon key (so no branch can be created or
 * deleted).
 */
import { Prisma, PrismaClient } from "../../src/generated/prisma"
import { assertProductionDatabaseUrl, parseDatabaseTarget } from "../../src/lib/production/env-guard"
import { getWebServiceConfig, getCronServiceConfig, getCronStatus, getLatestDeploy } from "../../src/lib/production/render-ops"
import { fetchGithubRef, readCanonicalHead } from "../../src/lib/production/canonical-head"
import { PHASE_3R_ACTIVATION_START } from "../../src/lib/economy/config"
import { ATTENDANCE_QUALITY_FLOOR } from "../../src/lib/stadium/attendance-quality"
import {
  FIRST_BASELINE,
  MAINTENANCE_TRANSACTION_TYPE,
  SPONSOR_TRANSACTION_TYPE,
  evaluateFirstBaselineGate,
  evaluateProductionEnvironmentGate,
  evaluateSecondBaselineState,
  orphanReferencePrefix,
  readOrphanFromRows,
  type CatalogReading,
  type EconomyActivityReading,
  type FirstBaselineReading,
  type HistoryRow,
  type OrphanReading,
  type SecondBaselineReading,
} from "../../src/lib/economy/first-baseline"

const C = FIRST_BASELINE

type Db = PrismaClient

async function countScalar(db: Db, sql: Prisma.Sql): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>(sql)
  return Number(rows[0]?.n ?? 0)
}

/** The canonical branch head, through the shared authenticated reader. Read only. */
async function readGithubHead(): Promise<string | null> {
  const result = await readCanonicalHead(
    { repoUrl: C.repo, branch: C.branch },
    {
      fetchRef: fetchGithubRef,
      gitLsRemote: () => {
        throw new Error("git fallback is not used by the second baseline verification - the authenticated API read is required")
      },
      env: process.env,
    }
  )
  return result.ok ? result.sha : null
}

/** The seven-point TeamEconomicState catalog, read from PostgreSQL's own catalog. */
async function readCatalog(db: Db): Promise<CatalogReading> {
  const [table] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'TeamEconomicState' AND c.relkind = 'r' AND n.nspname = current_schema()
  `
  const [fk] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_constraint
     WHERE conrelid = '"TeamEconomicState"'::regclass AND contype = 'f' AND confdeltype = 'r'
  `
  const [unique] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_indexes
     WHERE tablename = 'TeamEconomicState' AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%teamId%' AND indexdef ILIKE '%version%'
  `
  const [asOf] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_indexes
     WHERE tablename = 'TeamEconomicState'
       AND indexdef ILIKE '%teamId%'
       AND indexdef ILIKE '%effectiveAt% DESC%'
       AND indexdef ILIKE '%version% DESC%'
  `
  const triggers = await db.$queryRaw<{ tgname: string; enabled: boolean }[]>`
    SELECT t.tgname AS tgname, (t.tgenabled <> 'D') AS enabled
      FROM pg_trigger t
     WHERE t.tgrelid = '"TeamEconomicState"'::regclass AND NOT t.tgisinternal
  `
  const has = (needle: string) => {
    const match = triggers.find((row) => row.tgname.toLowerCase().includes(needle))
    return match ? match.enabled : false
  }
  return {
    tableExists: Number(table?.n ?? 0) === 1,
    teamIdFkOnDeleteRestrict: Number(fk?.n ?? 0) >= 1,
    uniqueTeamIdVersion: Number(unique?.n ?? 0) >= 1,
    asOfIndex: Number(asOf?.n ?? 0) >= 1,
    updateTriggerEnabled: has("update"),
    deleteTriggerEnabled: has("delete"),
    truncateTriggerEnabled: has("truncate"),
  }
}

/** The acknowledged historical orphan, through the canonical MATCH_<fixtureId>_ namespace. Read only, never repaired. */
async function readOrphan(db: Db): Promise<OrphanReading> {
  const prefix = orphanReferencePrefix(C.orphanFixtureId)
  const rows = await db.$queryRaw<{ referenceId: string; amount: bigint }[]>`
    SELECT "referenceId", "amount"::bigint AS amount
      FROM "FinancialTransaction"
     WHERE starts_with("referenceId", ${prefix})
     ORDER BY "referenceId"
  `
  return readOrphanFromRows(
    C.orphanFixtureId,
    rows.map((row) => ({ referenceId: row.referenceId, amount: Number(row.amount) }))
  )
}

async function main(): Promise<void> {
  const url = assertProductionDatabaseUrl()
  const target = parseDatabaseTarget(url)

  console.info("=== prod:economy:second-baseline-verify ===")
  console.info("Mode:     READ ONLY - this command has no write path")
  console.info(`Database: host=${target.host} name=${target.database}`)
  console.info(`Target commit:       ${C.targetCommit}`)
  console.info(`Phase 3R activation: ${PHASE_3R_ACTIVATION_START.toISOString()}`)
  console.info("")

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    // --- THE FULL PRODUCTION ENVIRONMENT READING -------------------------
    const [head, web, cron, cronStatus] = await Promise.all([
      readGithubHead().catch(() => null),
      getWebServiceConfig().catch(() => null),
      getCronServiceConfig().catch(() => null),
      getCronStatus().catch(() => null),
    ])
    const [webDeploy, cronDeploy] = await Promise.all([
      web ? getLatestDeploy(web.id).catch(() => null) : Promise.resolve(null),
      cron ? getLatestDeploy(cron.id).catch(() => null) : Promise.resolve(null),
    ])

    const migrations = await prisma
      .$queryRaw<{ name: string; finished: Date | null }[]>`
        SELECT "migration_name" AS name, "finished_at" AS finished FROM "_prisma_migrations" ORDER BY "migration_name"
      `
      .catch(() => null)
    const applied = migrations ? migrations.filter((row) => row.finished !== null).length : null

    const catalog = await readCatalog(prisma).catch(() => null)
    const teamCount = await prisma.team.count().catch(() => null)
    const historyRows = await countScalar(prisma, Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "TeamEconomicState"`).catch(() => null)
    const historyDistinct = await countScalar(
      prisma,
      Prisma.sql`SELECT COUNT(DISTINCT "teamId")::bigint AS n FROM "TeamEconomicState"`
    ).catch(() => null)

    const environment: FirstBaselineReading = {
      canonicalHead: head,
      web: web ? { repo: web.repo, branch: web.branch, autoDeploy: web.autoDeploy, deployedCommit: webDeploy?.commitId ?? null } : null,
      cron: cron
        ? {
            repo: cron.repo,
            branch: cron.branch,
            autoDeploy: cron.autoDeploy,
            deployedCommit: cronDeploy?.commitId ?? null,
            suspended: cron.suspended === "unknown" ? null : cron.suspended,
            schedule: cronStatus?.schedule ?? null,
          }
        : null,
      migrationsApplied: applied,
      migrationsTotal: migrations ? migrations.length : null,
      migration23Applied: migrations ? migrations.some((row) => row.name === C.migration23 && row.finished !== null) : null,
      catalog,
      teamCount,
      historyRows,
      historyDistinctTeams: historyDistinct,
      now: new Date(),
    }

    // --- THE HISTORY ITSELF ----------------------------------------------
    const rows: HistoryRow[] | null = await prisma
      .$queryRaw<
        { teamId: string; version: number; reason: string; effectiveAt: Date; weeklyPayroll: number; attendanceQuality: number }[]
      >`
        SELECT "teamId", "version", "reason", "effectiveAt", "weeklyPayroll", "attendanceQuality"
          FROM "TeamEconomicState" ORDER BY "teamId"
      `
      .then((result) =>
        result.map((row) => ({
          ...row,
          version: Number(row.version),
          weeklyPayroll: Number(row.weeklyPayroll),
          attendanceQuality: Number(row.attendanceQuality),
        }))
      )
      .catch(() => null)

    const teamIds: string[] | null = await prisma
      .$queryRaw<{ id: string }[]>`SELECT "id" FROM "Team" ORDER BY "id"`
      .then((result) => result.map((row) => row.id))
      .catch(() => null)

    const orphan = await readOrphan(prisma).catch(() => null)

    const activity: EconomyActivityReading = {
      sponsorSettlementCount: await countScalar(
        prisma,
        Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "FinancialTransaction" WHERE "type" = ${SPONSOR_TRANSACTION_TYPE}`
      ).catch(() => null),
      maintenanceSettlementCount: await countScalar(
        prisma,
        Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "FinancialTransaction" WHERE "type" = ${MAINTENANCE_TRANSACTION_TYPE}`
      ).catch(() => null),
      repricingRowCount: await countScalar(
        prisma,
        Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "TeamEconomicState" WHERE "reason" = 'repricing'`
      ).catch(() => null),
    }

    const firstBaselineGate = evaluateFirstBaselineGate(environment)

    const reading: SecondBaselineReading = {
      environment,
      teamCount,
      historyRows,
      historyDistinctTeams: historyDistinct,
      rows,
      teamIds,
      orphan,
      activity,
      firstBaselineGate,
      now: new Date(),
    }

    // --- REPORT WHAT WAS MEASURED ----------------------------------------
    const environmentGate = evaluateProductionEnvironmentGate(environment)
    console.info("--- PRODUCTION ENVIRONMENT GATE ---")
    console.info(`  canonical head:      ${environment.canonicalHead ?? "UNREADABLE"}`)
    console.info(`  web:                 repo=${environment.web?.repo ?? "?"} branch=${environment.web?.branch ?? "?"} autoDeploy=${environment.web?.autoDeploy ?? "?"} commit=${environment.web?.deployedCommit ?? "?"}`)
    console.info(`  cron:                repo=${environment.cron?.repo ?? "?"} branch=${environment.cron?.branch ?? "?"} autoDeploy=${environment.cron?.autoDeploy ?? "?"} commit=${environment.cron?.deployedCommit ?? "?"}`)
    console.info(`  cron state:          suspended=${environment.cron?.suspended ?? "?"} schedule=${environment.cron?.schedule ?? "?"}`)
    console.info(`  migrations:          ${environment.migrationsApplied ?? "?"}/${environment.migrationsTotal ?? "?"}  migration23=${environment.migration23Applied ?? "?"}`)
    console.info(`  catalog:             ${catalog ? Object.values(catalog).filter((value) => value === true).length : 0}/7`)
    console.info(`  clubs:               ${environment.teamCount ?? "?"}`)
    console.info(`  ENVIRONMENT GATE:    ${environmentGate.ok ? "PASS" : "REFUSE"}`)
    for (const refusal of environmentGate.refusals) console.info(`    [${refusal.code}] ${refusal.detail}`)
    console.info("")

    console.info("--- ECONOMIC HISTORY ---")
    console.info(`  TeamEconomicState rows: ${reading.historyRows ?? "UNREADABLE"}`)
    console.info(`  distinct coverage:     ${reading.historyDistinctTeams ?? "UNREADABLE"}`)
    console.info(`  rows read back:        ${reading.rows?.length ?? "UNREADABLE"}`)
    if (reading.rows && reading.rows.length > 0) {
      const versions = new Set(reading.rows.map((row) => row.version))
      const reasons = new Set(reading.rows.map((row) => row.reason))
      const payrolls = reading.rows.map((row) => row.weeklyPayroll)
      const qualities = reading.rows.map((row) => row.attendanceQuality)
      const latest = reading.rows.reduce<Date | null>((max, row) => (max === null || row.effectiveAt > max ? row.effectiveAt : max), null)
      console.info(`  versions present:      {${[...versions].sort().join(", ")}}`)
      console.info(`  reasons present:       {${[...reasons].sort().join(", ")}}`)
      console.info(`  latest effectiveAt:    ${latest?.toISOString() ?? "n/a"}`)
      console.info(`  weeklyPayroll:         min=${Math.min(...payrolls)} max=${Math.max(...payrolls)}`)
      console.info(`  attendanceQuality:     min=${Math.min(...qualities)} max=${Math.max(...qualities)} floor=${ATTENDANCE_QUALITY_FLOOR}`)
    }
    console.info(`  sponsor settlements:   ${activity.sponsorSettlementCount ?? "UNREADABLE"}   (measured, not asserted)`)
    console.info(`  maintenance settlements: ${activity.maintenanceSettlementCount ?? "UNREADABLE"} (measured, not asserted)`)
    console.info(`  repricing rows:        ${activity.repricingRowCount ?? "UNREADABLE"}   (must be 0 before activation)`)
    console.info(`  historical orphan:     ${orphan ? `${orphan.transactionCount} rows, net ${orphan.net}` : "UNREADABLE"}`)
    console.info("")

    console.info("--- WOULD A SECOND FIRST-BASELINE WRITE ANYTHING? ---")
    console.info(`  first-baseline gate:   ${firstBaselineGate.ok ? "PASSES (it could run)" : "REFUSES"}`)
    for (const refusal of firstBaselineGate.refusals) console.info(`    [${refusal.code}] ${refusal.detail}`)
    console.info("")

    const verdict = evaluateSecondBaselineState(reading)
    if (!verdict.ok) {
      for (const refusal of verdict.refusals) console.error(`  FAIL [${refusal.code}] ${refusal.detail}`)
      console.error("")
      console.error("SECOND BASELINE VERIFICATION: FAIL")
      process.exitCode = 1
      return
    }

    console.info("ROWS WRITTEN THIS RUN: 0")
    console.info("NEW ROWS POSSIBLE:     0 (the strict first baseline now refuses on HISTORY_NOT_EMPTY)")
    console.info(`COVERAGE: ${reading.historyDistinctTeams}/${reading.teamCount}`)
    console.info(`HISTORICAL ORPHAN: ${orphan?.transactionCount} rows, net ${orphan?.net} (unchanged)`)
    console.info("")
    console.info("SECOND BASELINE VERIFICATION: PASS")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("prod:economy:second-baseline-verify crashed:", error instanceof Error ? error.message : error)
  console.error("This command is READ ONLY - a crash cannot have changed Production.")
  process.exitCode = 1
})
