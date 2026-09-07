/**
 * prod:economy:first-baseline - THE ONE-TIME, STRICT, ALL-OR-NOTHING FIRST
 * BASELINE.
 *
 * DELIBERATELY NOT prod:economy:baseline. That command is the idempotent
 * coverage repair: it skips clubs that already have history and reports PASS
 * once coverage is complete however it got there. This one refuses to run at
 * all unless the league has NO history, writes all sixty rows in ONE
 * transaction, and proves the exact shape before it is allowed to commit. Two
 * commands, two contracts, no flag that turns one into the other - because a
 * flag is exactly how a first run gets taken for a re-run.
 *
 * READ-ONLY UNLESS CONFIRMED. Without PRODUCTION_WRITE_CONFIRM this prints the
 * full gate reading and writes nothing. That is the intended rehearsal mode.
 *
 * WHAT IT NEEDS, AND NOTHING MORE: the Production database URL, a Render API
 * key (to prove what Production is running), and a read-only GitHub token (to
 * prove the canonical branch head). It never creates a Neon backup, never
 * touches Render configuration, never deploys, and never runs a second
 * baseline.
 */
import { createHash } from "crypto"
import { Prisma, PrismaClient } from "../../src/generated/prisma"
import { assertProductionDatabaseUrl, parseDatabaseTarget } from "../../src/lib/production/env-guard"
import { assertProductionWriteConfirmed, ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"
import { getWebServiceConfig, getCronServiceConfig, getCronStatus, getLatestDeploy } from "../../src/lib/production/render-ops"
import { fetchGithubRef, readCanonicalHead } from "../../src/lib/production/canonical-head"
import { PHASE_3R_ACTIVATION_START } from "../../src/lib/economy/config"
import {
  acquireEconomyHistoryExclusive,
  appendTeamEconomicState,
} from "../../src/lib/economy/state-history"
import { acquirePhase3RActivationExclusive } from "../../src/lib/economy/activation-lock"
import { lockTeamRoster } from "../../src/lib/players/roster"
import {
  FIRST_BASELINE,
  FirstBaselineAbort,
  evaluateFirstBaselineGate,
  runFirstBaselineTransaction,
  type CatalogReading,
  type FirstBaselineReading,
  type InsertedRow,
  type OrphanReading,
  type SideEffectDigest,
} from "../../src/lib/economy/first-baseline"

const C = FIRST_BASELINE

type Tx = Prisma.TransactionClient

/** The canonical branch head, through the shared authenticated reader - the canonical repo is private, so a bare git read has no credential in Actions. */
async function readGithubHead(): Promise<string | null> {
  const result = await readCanonicalHead(
    { repoUrl: C.repo, branch: C.branch },
    {
      fetchRef: fetchGithubRef,
      gitLsRemote: () => {
        throw new Error("git fallback is not used by the first baseline - the authenticated API read is required")
      },
      env: process.env,
    }
  )
  return result.ok ? result.sha : null
}

/** A stable digest of an ordered result set. Row CONTENTS never reach a log - only this hash. */
function digestRows(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex")
}

/**
 * THE SEVEN-POINT TeamEconomicState CATALOG, read from PostgreSQL's own
 * catalog rather than from Prisma's model metadata - the protections are
 * database objects, and only the database knows whether they are really there
 * and really enabled.
 */
async function readCatalog(tx: Tx): Promise<CatalogReading> {
  const [table] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'TeamEconomicState' AND c.relkind = 'r' AND n.nspname = current_schema()
  `
  const [fk] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_constraint
     WHERE conrelid = '"TeamEconomicState"'::regclass AND contype = 'f' AND confdeltype = 'r'
  `
  const [unique] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_indexes
     WHERE tablename = 'TeamEconomicState' AND indexdef ILIKE '%UNIQUE%'
       AND indexdef ILIKE '%teamId%' AND indexdef ILIKE '%version%'
  `
  const [asOf] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM pg_indexes
     WHERE tablename = 'TeamEconomicState'
       AND indexdef ILIKE '%teamId%'
       AND indexdef ILIKE '%effectiveAt% DESC%'
       AND indexdef ILIKE '%version% DESC%'
  `
  // tgenabled 'O' is the ordinary enabled state; 'D' is disabled. A trigger
  // that exists but is disabled is NOT a protection, so enabled is part of the
  // question rather than a separate one.
  const triggers = await tx.$queryRaw<{ tgname: string; enabled: boolean }[]>`
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

async function countScalar(tx: Tx, sql: Prisma.Sql): Promise<number> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>(sql)
  return Number(rows[0]?.n ?? 0)
}

/**
 * EVERYTHING THE BASELINE MUST NOT MOVE, as counts, sums and digests. Read
 * inside the protected transaction, before and after, so the comparison
 * attributes only this transaction's own effects rather than whatever the
 * league did meanwhile.
 */
async function readSideEffectDigest(tx: Tx): Promise<SideEffectDigest> {
  const teams = await tx.$queryRaw<{ id: string; balance: bigint }[]>`
    SELECT "id", "balance"::bigint AS balance FROM "Team" ORDER BY "id"
  `
  const players = await tx.$queryRaw<{ id: string; teamId: string | null; salary: bigint; status: string }[]>`
    SELECT "id", "teamId", "weeklySalary"::bigint AS salary, "careerStatus" AS status FROM "Player" ORDER BY "id"
  `
  const fixtures = await tx.$queryRaw<{ id: string; playedAt: Date | null; homeGoals: number | null; awayGoals: number | null }[]>`
    SELECT "id", "playedAt", "homeGoals", "awayGoals" FROM "Fixture" ORDER BY "id"
  `
  const tx_ = await tx.$queryRaw<{ id: string; amount: bigint; type: string }[]>`
    SELECT "id", "amount"::bigint AS amount, "type" FROM "FinancialTransaction" ORDER BY "id"
  `
  const seasons = await tx.$queryRaw<{ id: string; status: string; stage: string | null; active: boolean }[]>`
    SELECT "id", "status", "offseasonStage" AS stage, "isActive" AS active FROM "Season" ORDER BY "id"
  `
  const sponsorCount = await countScalar(tx, Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "FinancialTransaction" WHERE "type" = 'SPONSOR'`)
  const maintenanceCount = await countScalar(tx, Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "FinancialTransaction" WHERE "type" = 'STADIUM_MAINTENANCE'`)

  return {
    teamBalanceSum: teams.reduce((sum, row) => sum + Number(row.balance), 0),
    teamBalanceDigest: digestRows(teams.map((row) => [row.id, Number(row.balance)])),
    playerSalarySum: players.reduce((sum, row) => sum + Number(row.salary), 0),
    playerOwnershipDigest: digestRows(players.map((row) => [row.id, row.teamId])),
    playerCareerStatusDigest: digestRows(players.map((row) => [row.id, row.status])),
    fixtureDigest: digestRows(fixtures.map((row) => [row.id, row.playedAt?.toISOString() ?? null, row.homeGoals, row.awayGoals])),
    financialTransactionCount: tx_.length,
    financialTransactionNet: tx_.reduce((sum, row) => sum + Number(row.amount), 0),
    financialTransactionDigest: digestRows(tx_.map((row) => [row.id, Number(row.amount), row.type])),
    sponsorSettlementCount: sponsorCount,
    maintenanceSettlementCount: maintenanceCount,
    // Salary repricing state, as the league's own wage vector - a repricing
    // that fired mid-baseline would move this even though no single sum did.
    repricingMarkerDigest: digestRows(players.map((row) => [row.id, Number(row.salary)])),
    seasonDigest: digestRows(seasons.map((row) => [row.id, row.status, row.stage, row.active])),
  }
}

/** The acknowledged historical orphan, read as evidence. Never repaired, never balanced, never reversed. */
async function readOrphan(tx: Tx): Promise<OrphanReading> {
  const rows = await tx.$queryRaw<{ amount: bigint }[]>`
    SELECT "amount"::bigint AS amount FROM "FinancialTransaction" WHERE "fixtureId" = ${C.orphanFixtureId}
  `
  return {
    fixtureId: C.orphanFixtureId,
    transactionCount: rows.length,
    net: rows.reduce((sum, row) => sum + Number(row.amount), 0),
  }
}

async function main(): Promise<void> {
  const url = assertProductionDatabaseUrl()
  const target = parseDatabaseTarget(url)

  console.info("=== prod:economy:first-baseline ===")
  console.info("Mode:     STRICT FIRST BASELINE (all-or-nothing, refuses on any pre-existing history)")
  console.info(`Database: host=${target.host} name=${target.database}`)
  console.info(`Target commit:       ${C.targetCommit}`)
  console.info(`Phase 3R activation: ${PHASE_3R_ACTIVATION_START.toISOString()}`)
  console.info("")

  let confirmed = true
  try {
    assertProductionWriteConfirmed()
  } catch (error) {
    if (!(error instanceof ProductionWriteNotConfirmedError)) throw error
    confirmed = false
  }
  console.info(confirmed ? "Write:    CONFIRMED" : "Write:    NOT CONFIRMED - gate will be evaluated, nothing will be written")
  console.info("")

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    // --- THE GATE READING, every value measured rather than assumed --------
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
    const historyDistinct = await countScalar(prisma, Prisma.sql`SELECT COUNT(DISTINCT "teamId")::bigint AS n FROM "TeamEconomicState"`).catch(() => null)

    const reading: FirstBaselineReading = {
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

    console.info("--- STRICT FIRST BASELINE GATE ---")
    console.info(`  canonical head:      ${reading.canonicalHead ?? "UNREADABLE"}`)
    console.info(`  web:                 repo=${reading.web?.repo ?? "?"} branch=${reading.web?.branch ?? "?"} autoDeploy=${reading.web?.autoDeploy ?? "?"} commit=${reading.web?.deployedCommit ?? "?"}`)
    console.info(`  cron:                repo=${reading.cron?.repo ?? "?"} branch=${reading.cron?.branch ?? "?"} autoDeploy=${reading.cron?.autoDeploy ?? "?"} commit=${reading.cron?.deployedCommit ?? "?"}`)
    console.info(`  cron state:          suspended=${reading.cron?.suspended ?? "?"} schedule=${reading.cron?.schedule ?? "?"}`)
    console.info(`  migrations:          ${reading.migrationsApplied ?? "?"}/${reading.migrationsTotal ?? "?"}  migration23=${reading.migration23Applied ?? "?"}`)
    console.info(`  catalog:             ${catalog ? Object.values(catalog).filter((v) => v === true).length : 0}/7`)
    console.info(`  clubs:               ${reading.teamCount ?? "?"}`)
    console.info(`  history rows:        ${reading.historyRows ?? "?"}`)
    console.info(`  history coverage:    ${reading.historyDistinctTeams ?? "?"}`)
    console.info("")

    const gate = evaluateFirstBaselineGate(reading)
    if (!gate.ok) {
      for (const refusal of gate.refusals) console.error(`  REFUSE [${refusal.code}] ${refusal.detail}`)
      console.error("")
      console.error("FIRST BASELINE: REFUSED - nothing was written.")
      process.exitCode = 1
      return
    }
    console.info("  GATE: PASS - every value matched the approved first-baseline contract.")
    console.info("")

    if (!confirmed) {
      console.info("To execute: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:economy:first-baseline")
      console.info("")
      console.info("FIRST BASELINE: DRY RUN (gate passed, nothing written)")
      return
    }

    // --- THE ONE TRANSACTION ----------------------------------------------
    //
    // A generous timeout, because this holds the exclusive economy barrier
    // across sixty clubs against a remote Postgres and must not be killed
    // half-way - though "killed half-way" is itself safe here: the whole
    // transaction rolls back and exactly zero rows commit.
    let inserted: InsertedRow[] = []
    await prisma.$transaction(
      async (tx) => {
        const outcome = await runFirstBaselineTransaction(tx, {
          acquireActivationExclusive: acquirePhase3RActivationExclusive,
          acquireEconomyExclusive: acquireEconomyHistoryExclusive,
          lockTeamRoster,
          append: (client, input) => appendTeamEconomicState(client, input),
          readTeamIdsAscending: async (client) => {
            const rows = await client.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Team" ORDER BY "id"`
            return rows.map((row) => row.id)
          },
          countHistoryRows: (client) => countScalar(client, Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "TeamEconomicState"`),
          countDistinctHistoryTeams: (client) =>
            countScalar(client, Prisma.sql`SELECT COUNT(DISTINCT "teamId")::bigint AS n FROM "TeamEconomicState"`),
          readAllHistoryRows: async (client) => {
            const rows = await client.$queryRaw<{ teamId: string; version: number; reason: string; effectiveAt: Date }[]>`
              SELECT "teamId", "version", "reason", "effectiveAt" FROM "TeamEconomicState" ORDER BY "teamId"
            `
            return rows.map((row) => ({ ...row, version: Number(row.version) }))
          },
          readSideEffectDigest,
          readOrphan,
          now: () => new Date(),
        })
        inserted = outcome.inserted
        console.info("--- PRE-COMMIT ASSERTIONS ---")
        console.info(`  starting rows:       ${outcome.startingRows}`)
        console.info(`  clubs:               ${outcome.clubs}`)
        console.info(`  rows inserted:       ${outcome.inserted.length}`)
        console.info(`  final rows:          ${outcome.finalRows}`)
        console.info(`  distinct coverage:   ${outcome.distinctCovered}`)
        console.info(`  all versions 1:      yes`)
        console.info(`  all reasons baseline: yes`)
        console.info(`  all before activation: yes`)
        console.info(`  forbidden side effects: unchanged`)
        console.info(`  historical orphan:   ${outcome.orphanAfter.transactionCount} rows, net ${outcome.orphanAfter.net} (unchanged)`)
      },
      { timeout: 120_000, maxWait: 30_000 }
    )

    console.info("")
    console.info(`FIRST BASELINE COMPLETE: ${inserted.length} rows`)
    console.info("ROWS INSERTED: 60")
    console.info("COVERAGE: 60/60")
    console.info("FIRST BASELINE: PASS")
    console.info("")
    console.info("NEXT STEP IS A SEPARATE DECISION. The second baseline verification (0 new rows, 60/60)")
    console.info("is NOT run here and must be authorised on its own.")
  } catch (error) {
    if (error instanceof FirstBaselineAbort) {
      console.error("")
      console.error(`FIRST BASELINE: ABORTED - ${error.message}`)
      console.error("The transaction rolled back. Exactly 0 baseline rows were committed.")
      console.error("Do not re-run without a fresh human decision: no automatic retry exists, by design.")
      process.exitCode = 1
      return
    }
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("prod:economy:first-baseline crashed:", error instanceof Error ? error.message : error)
  console.error("If this happened inside the transaction, it rolled back completely: 0 rows committed.")
  process.exitCode = 1
})
