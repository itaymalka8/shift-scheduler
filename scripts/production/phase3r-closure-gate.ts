/**
 * prod:phase3r:closure-gate - THE FINAL FROZEN PRODUCTION GATE, READ ONLY.
 *
 * WHAT IT IS. The last piece of evidence in the Phase 3R closure audit: a
 * fresh, complete reading of Production, judged by the same authorities the
 * first and second baselines were judged by, plus the closure-only questions.
 * It prints evidence and exits non-zero on any refusal. It NEVER prints that
 * Phase 3R is closed - that decision is taken outside the runner, after
 * independent review.
 *
 * NOTHING IS REMEMBERED; EVERYTHING IS RE-READ. Workflow D's historical
 * conclusion is not an input. A second baseline that passed earlier says
 * nothing about a row written since, so the "0 new rows, 60 rows, 60/60
 * coverage" contract is evaluated again, now, against Production as it is at
 * closure time.
 *
 * IT CANNOT WRITE. No transaction, no lock, no append primitive, no INSERT,
 * UPDATE, DELETE, TRUNCATE or MERGE, no $executeRaw, no Prisma create/update/
 * delete/upsert, no Render mutation helper, no Neon surface at all. Every
 * database statement is a SELECT and every Render call is a GET. It is never
 * given PRODUCTION_WRITE_CONFIRM, so every mutating command in this repository
 * would refuse before its first write even if one were somehow invoked.
 *
 * WHY IT REPEATS THE SECOND-BASELINE READS RATHER THAN IMPORTING THEM. The
 * second-baseline runner's exact bytes were executed against Production and
 * are pinned by 75 static tests; refactoring it to share code with this file
 * would change tooling that is already accepted, for no gain in evidence. The
 * duplication is deliberate and it is CONTAINED: both runners' raw SQL is
 * validated against the same Prisma DMMF physical-column authority
 * (src/lib/production/dmmf-columns.ts), which is what makes a wrong column
 * name impossible to ship rather than merely unlikely - the defect class that
 * failed Workflow C run 34113346563 with PostgreSQL 42703.
 *
 * CREDENTIALS: PRODUCTION_DATABASE_URL, RENDER_API_KEY and a read-only
 * GITHUB_TOKEN - all three for READS. Deliberately NOT given
 * PRODUCTION_WRITE_CONFIRM and NOT given NEON_API_KEY.
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
  orphanReferencePrefix,
  readOrphanFromRows,
  type CatalogReading,
  type EconomyActivityReading,
  type FirstBaselineReading,
  type HistoryRow,
  type OrphanReading,
  type SecondBaselineReading,
} from "../../src/lib/economy/first-baseline"
import { evaluateFrozenClosureGate, PHASE_3R_CLOSURE, type ClosureReading } from "../../src/lib/production/phase3r-closure"

const C = FIRST_BASELINE
const CLOSURE = PHASE_3R_CLOSURE

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
        throw new Error("git fallback is not used by the closure gate - the authenticated API read is required")
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

  console.info("=== prod:phase3r:closure-gate ===")
  console.info("Mode:     READ ONLY - this command has no write path")
  console.info(`Database: host=${target.host} name=${target.database}`)
  console.info(`Target commit:       ${C.targetCommit}`)
  console.info(`Production branch:   ${CLOSURE.productionBranchName}`)
  console.info(`Approved activation: ${CLOSURE.activationInstantIso}`)
  console.info(`Runtime activation:  ${PHASE_3R_ACTIVATION_START.toISOString()}`)
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
    const historyDistinctTeams = await countScalar(
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
      historyDistinctTeams,
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

    const secondBaseline: SecondBaselineReading = {
      environment,
      teamCount,
      historyRows,
      historyDistinctTeams,
      rows,
      teamIds,
      orphan,
      activity,
      firstBaselineGate,
      now: new Date(),
    }

    const reading: ClosureReading = {
      secondBaseline,
      activationStart: PHASE_3R_ACTIVATION_START,
      canonicalBranchName: C.branch,
    }

    // --- REPORT WHAT WAS MEASURED ----------------------------------------
    const environmentGate = evaluateProductionEnvironmentGate(environment)
    console.info("--- GITHUB / RENDER / DATABASE ---")
    console.info(`  canonical head:      ${environment.canonicalHead ?? "UNREADABLE"}`)
    console.info(`  Production branch:   ${reading.canonicalBranchName ?? "UNREADABLE"}`)
    console.info(`  web:                 repo=${environment.web?.repo ?? "?"} branch=${environment.web?.branch ?? "?"} autoDeploy=${environment.web?.autoDeploy ?? "?"} commit=${environment.web?.deployedCommit ?? "?"}`)
    console.info(`  cron:                repo=${environment.cron?.repo ?? "?"} branch=${environment.cron?.branch ?? "?"} autoDeploy=${environment.cron?.autoDeploy ?? "?"} commit=${environment.cron?.deployedCommit ?? "?"}`)
    console.info(`  cron state:          suspended=${environment.cron?.suspended ?? "?"} schedule=${environment.cron?.schedule ?? "?"}`)
    console.info(`  web == cron == target: ${environment.web?.deployedCommit === environment.cron?.deployedCommit && environment.web?.deployedCommit === C.targetCommit}`)
    console.info(`  migrations:          ${environment.migrationsApplied ?? "?"}/${environment.migrationsTotal ?? "?"}  migration23=${environment.migration23Applied ?? "?"}`)
    console.info(`  catalog:             ${catalog ? Object.values(catalog).filter((value) => value === true).length : 0}/7`)
    console.info(`  clubs:               ${environment.teamCount ?? "?"}`)
    console.info(`  ENVIRONMENT GATE:    ${environmentGate.ok ? "PASS" : "REFUSE"}`)
    for (const refusal of environmentGate.refusals) console.info(`    [${refusal.code}] ${refusal.detail}`)
    console.info("")

    console.info("--- TEAM ECONOMIC STATE ---")
    console.info(`  rows:                  ${historyRows ?? "UNREADABLE"}`)
    console.info(`  distinct coverage:     ${historyDistinctTeams ?? "UNREADABLE"}`)
    console.info(`  rows read back:        ${rows?.length ?? "UNREADABLE"}`)
    if (rows && rows.length > 0) {
      const payrolls = rows.map((row) => row.weeklyPayroll)
      const qualities = rows.map((row) => row.attendanceQuality)
      const latest = rows.reduce<Date | null>((max, row) => (max === null || row.effectiveAt > max ? row.effectiveAt : max), null)
      console.info(`  versions present:      {${[...new Set(rows.map((row) => row.version))].sort().join(", ")}}`)
      console.info(`  reasons present:       {${[...new Set(rows.map((row) => row.reason))].sort().join(", ")}}`)
      console.info(`  latest effectiveAt:    ${latest?.toISOString() ?? "n/a"}`)
      console.info(`  weeklyPayroll:         min=${Math.min(...payrolls)} max=${Math.max(...payrolls)}`)
      console.info(`  attendanceQuality:     min=${Math.min(...qualities)} max=${Math.max(...qualities)} floor=${ATTENDANCE_QUALITY_FLOOR}`)
    }
    console.info(`  sponsor settlements:   ${activity.sponsorSettlementCount ?? "UNREADABLE"}   (must be 0 before activation)`)
    console.info(`  maintenance settlements: ${activity.maintenanceSettlementCount ?? "UNREADABLE"} (must be 0 before activation)`)
    console.info(`  repricing rows:        ${activity.repricingRowCount ?? "UNREADABLE"}   (must be 0 before activation)`)
    console.info(`  historical orphan:     ${orphan ? `${orphan.transactionCount} rows, net ${orphan.net}` : "UNREADABLE"}  (acknowledged only, never repaired)`)
    console.info("")

    console.info("--- FIRST BASELINE: COULD IT RUN AGAIN? ---")
    console.info(`  first-baseline gate:   ${firstBaselineGate.ok ? "PASSES (it could run)" : "REFUSES"}`)
    for (const refusal of firstBaselineGate.refusals) console.info(`    [${refusal.code}] ${refusal.detail}`)
    console.info("")

    // --- THE FROZEN CLOSURE GATE -----------------------------------------
    const verdict = evaluateFrozenClosureGate(reading)

    console.info("CANONICAL SECOND BASELINE (re-read now, not remembered):")
    console.info("  ROWS WRITTEN: 0")
    console.info(`  ROWS: ${historyRows ?? "UNREADABLE"}`)
    console.info(`  COVERAGE: ${historyDistinctTeams ?? "UNREADABLE"}/${teamCount ?? "UNREADABLE"}`)
    for (const refusal of verdict.canonicalSecondBaseline.refusals) console.error(`  FAIL [${refusal.code}] ${refusal.detail}`)
    console.info(`  ${verdict.canonicalSecondBaseline.ok ? "PASS" : "FAIL"}`)
    console.info("")

    console.info(`ACTIVATION: ${PHASE_3R_ACTIVATION_START.toISOString()} (approved ${CLOSURE.activationInstantIso}, still future)`)
    console.info(`RECOVERY REQUIRED: ${verdict.recoveryRequired ? "YES" : "NO"}`)
    console.info("")

    if (!verdict.ok) {
      for (const refusal of verdict.refusals) console.error(`  FAIL [${refusal.code}] ${refusal.detail}`)
      console.error("")
      console.error("FINAL FROZEN PRODUCTION GATE: FAIL")
      process.exitCode = 1
      return
    }

    console.info("FINAL FROZEN PRODUCTION GATE: PASS")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("prod:phase3r:closure-gate crashed:", error instanceof Error ? error.message : error)
  console.error("This command is READ ONLY - a crash cannot have changed Production.")
  process.exitCode = 1
})
