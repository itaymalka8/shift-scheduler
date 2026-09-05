/**
 * READ ONLY verification that the Phase 3N squad replenishment contract is
 * actually in force in the database. Reads pg_enum, information_schema,
 * pg_indexes and pg_constraint, plus two harmless row counts. Runs no INSERT,
 * no UPDATE, no DELETE - and never replenishes anything.
 *
 * WHY THE CATALOGUE AND NOT schema.prisma: see
 * src/lib/production/replenishment-contract.ts. Two of the guarantees - the
 * CHECK constraints on the ledger arithmetic - exist ONLY in the migration,
 * because Prisma's DSL has no @check at this version, so the catalogue is the
 * only place they can be verified at all.
 *
 * It runs on both sides of the migration: on 19 migrations it correctly
 * reports the enum value, table, index, foreign keys and checks as missing.
 *
 * Run with: npm run prod:replenishment:verify
 */
import { createProductionClient } from "../../src/lib/production/client"
import {
  evaluateReplenishmentContract,
  replenishmentContractPasses,
  type CheckReading,
  type ColumnReading,
  type EnumValueReading,
  type ForeignKeyReading,
  type IndexReading,
} from "../../src/lib/production/replenishment-contract"

async function main() {
  console.info("=== prod:replenishment:verify ===")
  console.info("Mode:     READ ONLY - pg_enum / information_schema / pg_indexes / pg_constraint, no writes\n")

  try {
    const { prisma, target } = createProductionClient()
    console.info(`Database: host=${target.host} name=${target.database}\n`)

    const enumValues = await prisma.$queryRawUnsafe<EnumValueReading[]>(`
      SELECT t.typname AS "type", e.enumlabel AS "value"
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'SeasonOffseasonStage'
      ORDER BY e.enumsortorder
    `)

    const columns = await prisma.$queryRawUnsafe<ColumnReading[]>(`
      SELECT table_name AS "table", column_name AS "column", data_type AS "type",
             (is_nullable = 'YES') AS "nullable"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'SquadReplenishment'
      ORDER BY ordinal_position
    `)

    const indexes = await prisma.$queryRawUnsafe<IndexReading[]>(`
      SELECT i.relname                                  AS "name",
             t.relname                                  AS "table",
             ix.indisunique                             AS "unique",
             pg_get_indexdef(ix.indexrelid)             AS "definition"
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      WHERE t.relname = 'SquadReplenishment'
    `)

    // confdeltype is the ON DELETE action as one character.
    const foreignKeys = await prisma.$queryRawUnsafe<ForeignKeyReading[]>(`
      SELECT c.conname                    AS "constraint",
             c.conrelid::regclass::text   AS "table",
             a.attname                    AS "column",
             c.confrelid::regclass::text  AS "target",
             CASE c.confdeltype
               WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
               WHEN 'n' THEN 'SET NULL'  WHEN 'd' THEN 'SET DEFAULT' ELSE c.confdeltype::text
             END                          AS "onDelete"
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND c.conrelid::regclass::text IN ('"SquadReplenishment"', 'SquadReplenishment')
    `)

    const checks = await prisma.$queryRawUnsafe<CheckReading[]>(`
      SELECT c.conname                          AS "constraint",
             c.conrelid::regclass::text         AS "table",
             pg_get_constraintdef(c.oid)        AS "definition"
      FROM pg_constraint c
      WHERE c.contype = 'c' AND c.conrelid::regclass::text IN ('"SquadReplenishment"', 'SquadReplenishment')
    `)

    // regclass renders a quoted identifier for a mixed-case table name.
    const unquote = (value: string) => value.replace(/^"(.*)"$/, "$1")
    const contract = evaluateReplenishmentContract({
      enumValues,
      columns,
      indexes,
      foreignKeys: foreignKeys.map((fk) => ({ ...fk, table: unquote(fk.table), target: unquote(fk.target) })),
      checks: checks.map((row) => ({ ...row, table: unquote(row.table) })),
    })

    for (const check of contract) {
      console.info(`  ${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`)
    }

    // ------------------------------------------------------------------
    // What is actually in the ledger right now. Reported, never judged:
    // rows are expected only once a season has rolled, and their absence
    // before the first roll is the correct state, not a failure.
    // ------------------------------------------------------------------
    const tableExists = contract.some((check) => check.label.endsWith("exists") && check.label.includes("table"))
    console.info("\n--- LEDGER CONTENTS (reported, not judged) ---")
    if (!tableExists) {
      console.info("  the ledger table does not exist here yet - nothing to read")
    } else {
      const [{ rows }] = await prisma.$queryRawUnsafe<{ rows: bigint }[]>(
        `SELECT COUNT(*) AS rows FROM "SquadReplenishment"`
      )
      console.info(`  ledger rows: ${rows}`)
      const seasons = await prisma.$queryRawUnsafe<{ number: number; status: string; stage: string; rows: bigint }[]>(`
        SELECT s."number", s."status"::text AS "status", s."offseasonStage"::text AS "stage",
               COUNT(r."id") AS rows
        FROM "Season" s
        LEFT JOIN "SquadReplenishment" r ON r."seasonId" = s."id"
        GROUP BY s."id", s."number", s."status", s."offseasonStage"
        ORDER BY s."number"
      `)
      for (const season of seasons) {
        console.info(`  season ${season.number}: status=${season.status} stage=${season.stage} ledgerRows=${season.rows}`)
      }
    }

    const pass = replenishmentContractPasses(contract)
    console.info(`\nSQUAD REPLENISHMENT CONTRACT VERIFICATION: ${pass ? "PASS" : "FAIL"}`)
    if (!pass) process.exitCode = 1
  } catch (error) {
    console.error("prod:replenishment:verify failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
