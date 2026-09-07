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
 * no INSERT, UPDATE or DELETE. Every statement it runs is a SELECT. The
 * "0 new rows" claim is established by EVALUATING THE FIRST-BASELINE GATE
 * against the current state and requiring it to REFUSE with HISTORY_NOT_EMPTY -
 * the same code path that would do the writing, asked whether it could, rather
 * than run and observed to decline.
 *
 * WHAT IT PROVES:
 *   clubs                       exactly 60
 *   TeamEconomicState rows      exactly 60
 *   distinct covered clubs      exactly 60
 *   every club covered          exactly once, against the real roster
 *   every row                   version 1, reason baseline, effectiveAt before
 *                               PHASE_3R_ACTIVATION_START
 *   the acknowledged orphan     fixture cmtedbpib0001ya9jpzjzevb5, 3 rows,
 *                               net +213629 - read as evidence, never touched
 *   a second first baseline     WOULD REFUSE, so it would write 0 rows
 *
 * ANY UNREADABLE VALUE IS A REFUSAL. A verification that could not read is a
 * verification that failed, never one that passed quietly.
 *
 * IT NEEDS ONE CREDENTIAL: the Production database URL. No Render key, no Neon
 * key, no GitHub token - it asserts nothing about deployment, because what
 * Production is running was already proved by the first baseline's own gate at
 * the moment that mattered.
 */
import { Prisma, PrismaClient } from "../../src/generated/prisma"
import { assertProductionDatabaseUrl, parseDatabaseTarget } from "../../src/lib/production/env-guard"
import { PHASE_3R_ACTIVATION_START } from "../../src/lib/economy/config"
import {
  FIRST_BASELINE,
  evaluateFirstBaselineGate,
  evaluateSecondBaselineState,
  orphanReferencePrefix,
  readOrphanFromRows,
  type FirstBaselineReading,
  type InsertedRow,
  type OrphanReading,
  type SecondBaselineReading,
} from "../../src/lib/economy/first-baseline"

const C = FIRST_BASELINE

type Db = PrismaClient

async function countScalar(db: Db, sql: Prisma.Sql): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>(sql)
  return Number(rows[0]?.n ?? 0)
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
  console.info(`Phase 3R activation: ${PHASE_3R_ACTIVATION_START.toISOString()}`)
  console.info("")

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    const teamCount = await prisma.team.count().catch(() => null)
    const historyRows = await countScalar(prisma, Prisma.sql`SELECT COUNT(*)::bigint AS n FROM "TeamEconomicState"`).catch(() => null)
    const historyDistinct = await countScalar(
      prisma,
      Prisma.sql`SELECT COUNT(DISTINCT "teamId")::bigint AS n FROM "TeamEconomicState"`
    ).catch(() => null)

    const rows: InsertedRow[] | null = await prisma
      .$queryRaw<{ teamId: string; version: number; reason: string; effectiveAt: Date }[]>`
        SELECT "teamId", "version", "reason", "effectiveAt" FROM "TeamEconomicState" ORDER BY "teamId"
      `
      .then((result) => result.map((row) => ({ ...row, version: Number(row.version) })))
      .catch(() => null)

    const teamIds: string[] | null = await prisma
      .$queryRaw<{ id: string }[]>`SELECT "id" FROM "Team" ORDER BY "id"`
      .then((result) => result.map((row) => row.id))
      .catch(() => null)

    const orphan = await readOrphan(prisma).catch(() => null)

    // THE FIRST-BASELINE GATE, EVALUATED AGAINST TODAY. Only the fields that
    // decide "could a first baseline still run" are measured here; the
    // deployment-shaped fields are deliberately left null, which the gate
    // refuses on - and that is correct, because this command asserts nothing
    // about Render. What it needs from the gate is HISTORY_NOT_EMPTY.
    const gateReading: FirstBaselineReading = {
      canonicalHead: null,
      web: null,
      cron: null,
      migrationsApplied: null,
      migrationsTotal: null,
      migration23Applied: null,
      catalog: null,
      teamCount,
      historyRows,
      historyDistinctTeams: historyDistinct,
      now: new Date(),
    }
    const firstBaselineGate = evaluateFirstBaselineGate(gateReading)

    const reading: SecondBaselineReading = {
      teamCount,
      historyRows,
      historyDistinctTeams: historyDistinct,
      rows,
      teamIds,
      orphan,
      firstBaselineGate,
      now: new Date(),
    }

    console.info("--- MEASURED STATE ---")
    console.info(`  clubs:                 ${reading.teamCount ?? "UNREADABLE"}`)
    console.info(`  TeamEconomicState rows: ${reading.historyRows ?? "UNREADABLE"}`)
    console.info(`  distinct coverage:     ${reading.historyDistinctTeams ?? "UNREADABLE"}`)
    console.info(`  rows read back:        ${reading.rows?.length ?? "UNREADABLE"}`)
    if (reading.rows) {
      const versions = new Set(reading.rows.map((row) => row.version))
      const reasons = new Set(reading.rows.map((row) => row.reason))
      const latest = reading.rows.reduce<Date | null>((max, row) => (max === null || row.effectiveAt > max ? row.effectiveAt : max), null)
      console.info(`  versions present:      {${[...versions].sort().join(", ")}}`)
      console.info(`  reasons present:       {${[...reasons].sort().join(", ")}}`)
      console.info(`  latest effectiveAt:    ${latest?.toISOString() ?? "n/a"}`)
    }
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
