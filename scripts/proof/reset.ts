/**
 * PROOF-ONLY DATABASE RESET - drop the schema and re-migrate it.
 *
 * WHY THIS EXISTS INSTEAD OF TRUNCATE. The proof harness used to reset with
 * `TRUNCATE ... RESTART IDENTITY CASCADE`, which was fine while nothing
 * objected to being truncated. TeamEconomicState does: economic history is
 * append-only at the database level, and that guard has to cover TRUNCATE as
 * well as UPDATE and DELETE, because row-level BEFORE DELETE triggers do NOT
 * fire on TRUNCATE - only a statement-level BEFORE TRUNCATE trigger does.
 *
 * The tempting shortcut was to leave TRUNCATE unguarded so the harness kept
 * working. That is weakening a production integrity rule to make a test easier,
 * and the rule is the more valuable of the two. So the harness changed instead:
 * it drops the whole schema and replays the migrations, which is both a
 * stronger reset (it also proves the migrations apply from nothing on every
 * proof run) and one the append-only triggers have no opinion about, because
 * the table itself ceases to exist.
 *
 * NEVER PRODUCTION. It takes the URL it is given, and the caller
 * (economy-proof.ts) has already refused to run when that URL matches
 * PRODUCTION_DATABASE_URL. This module additionally refuses on its own, because
 * a guard that lives only in the caller stops being a guard the moment someone
 * writes a second caller.
 */
import { execFileSync } from "child_process"
import { PrismaClient } from "../../src/generated/prisma"

export async function resetProofDatabase(url: string): Promise<void> {
  const production = process.env.PRODUCTION_DATABASE_URL
  if (production && production === url) {
    throw new Error("REFUSED: resetProofDatabase was handed PRODUCTION_DATABASE_URL.")
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    // CASCADE takes the tables with the schema, so no trigger is consulted -
    // dropping a table is not deleting its rows.
    await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE`)
    await prisma.$executeRawUnsafe(`CREATE SCHEMA public`)
  } finally {
    await prisma.$disconnect()
  }

  // Replay every migration into the empty schema. Also means each proof run
  // re-proves that the migration history applies cleanly from nothing, which
  // the rehearsal does separately but is worth having as a side effect here.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: ["ignore", "pipe", "pipe"],
  })
}
