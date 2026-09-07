/**
 * READ ONLY verification that the historical retention contract is actually in
 * force in the database. Reads pg_constraint, pg_trigger and pg_proc. Runs no
 * DELETE, no UPDATE, no INSERT - the destructive proofs belong on a throwaway
 * PostgreSQL, never against Production.
 *
 * WHY THE CATALOGUE AND NOT schema.prisma. schema.prisma states an intention.
 * The catalogue states what is true. A migration applied partially, or a
 * constraint dropped by hand in a console, would leave those disagreeing - and
 * this phase's whole claim is that the database is the final authority. So the
 * verifier asks the database.
 *
 * It reports the state it finds either way, so it is useful BEFORE the
 * migration too: run it on 17 migrations and it correctly says the six FKs are
 * still CASCADE and the trigger is missing.
 *
 * Run with: npm run prod:retention:verify
 */
import { createProductionClient } from "../../src/lib/production/client"
import {
  evaluateRetention,
  retentionPasses,
  type ForeignKeyReading,
  type TriggerReading,
} from "../../src/lib/production/historical-retention"

async function main() {
  console.info("=== prod:retention:verify ===")
  console.info("Mode:     READ ONLY - pg_constraint / pg_trigger / pg_proc only, no writes\n")

  try {
    const { prisma, target } = createProductionClient()
    console.info(`Database: host=${target.host} name=${target.database}\n`)

    // Every foreign key on the tables the contract covers, straight from the
    // catalogue. confdeltype is the ON DELETE action as one character.
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
      WHERE c.contype = 'f'
    `)

    const triggers = await prisma.$queryRawUnsafe<TriggerReading[]>(`
      SELECT t.tgname                                                     AS "name",
             t.tgrelid::regclass::text                                    AS "table",
             p.proname                                                    AS "function",
             CASE WHEN (t.tgtype & 2) > 0 THEN 'BEFORE' ELSE 'AFTER' END  AS "timing",
             CASE WHEN (t.tgtype & 8) > 0 THEN 'DELETE' ELSE 'OTHER' END  AS "event",
             CASE WHEN (t.tgtype & 1) > 0 THEN 'ROW' ELSE 'STATEMENT' END AS "level",
             t.tgenabled::text                                            AS "enabled",
             pg_get_function_result(p.oid)                                AS "returns"
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND t.tgname = 'Fixture_played_no_delete'
    `)

    // regclass renders a quoted identifier for a mixed-case table name.
    const unquote = (s: string) => s.replace(/^"(.*)"$/, "$1")
    const checks = evaluateRetention({
      foreignKeys: foreignKeys.map((fk) => ({ ...fk, table: unquote(fk.table), target: unquote(fk.target) })),
      trigger: triggers.length > 0 ? { ...triggers[0], table: unquote(triggers[0].table) } : null,
    })

    for (const check of checks) {
      console.info(`  ${check.ok ? "PASS" : "FAIL"}  ${check.label}: ${check.detail}`)
    }

    const pass = retentionPasses(checks)
    console.info(`\nHISTORICAL RETENTION VERIFICATION: ${pass ? "PASS" : "FAIL"}`)
    if (!pass) process.exitCode = 1
  } catch (error) {
    console.error("prod:retention:verify failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
