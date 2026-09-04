/**
 * THE DRAW IS WRITE-ONCE, AND THE DATABASE IS THE AUTHORITY.
 *
 * Source-level, for the same reason the decider isolation tests are: the
 * property is about a guarantee that lives outside TypeScript. What can be
 * checked here is that the migration says what it must say, and that the
 * application has not grown a second write path that would depend on the
 * trigger to catch it.
 *
 * The trigger's BEHAVIOUR is proved where behaviour can only be proved -
 * against a real PostgreSQL 16, in the migration rehearsal - and its
 * PRESENCE in Production is proved by the champion verifier, which reads
 * pg_trigger and pg_proc on every run.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..")
const MIGRATIONS = join(ROOT, "prisma", "migrations")
const MIGRATION_DIR = "20260904090000_championship_playoff_draw_write_once"

const migration = readFileSync(join(MIGRATIONS, MIGRATION_DIR, "migration.sql"), "utf8")
const sql = migration.replace(/^\s*--.*$/gm, "")

function readCode(...parts: string[]): string {
  return readFileSync(join(ROOT, "src", ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("the write-once migration", () => {
  it("is a dedicated migration carrying nothing else", () => {
    // Mixing an unrelated schema change into this one would mean a future
    // revert of that change also silently reverts the immutability rule.
    expect(sql).not.toMatch(/ALTER TABLE|CREATE TABLE|CREATE TYPE|CREATE INDEX|DROP TABLE|DROP COLUMN/i)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION "championship_playoff_draw_write_once"/)
    expect(sql).toMatch(/CREATE TRIGGER "ChampionshipPlayoff_draw_write_once"/)
  })

  it("fires BEFORE UPDATE, for each row, on ChampionshipPlayoff", () => {
    expect(sql).toMatch(/BEFORE UPDATE ON "ChampionshipPlayoff"[\s\S]*?FOR EACH ROW/)
  })

  it("rejects ANY change to drawSeed", () => {
    // IS DISTINCT FROM, not <>: a change to or from NULL must be caught too,
    // and <> is null-propagating, so it would let both through.
    expect(sql).toMatch(/IF NEW\."drawSeed" IS DISTINCT FROM OLD\."drawSeed" THEN[\s\S]*?RAISE EXCEPTION/)
    expect(sql).toContain("drawSeed is immutable")
  })

  it("allows knockoutDraw exactly once - NULL to a bracket, and never again", () => {
    expect(sql).toMatch(
      /IF OLD\."knockoutDraw" IS NOT NULL\s*\n?\s*AND NEW\."knockoutDraw" IS DISTINCT FROM OLD\."knockoutDraw" THEN[\s\S]*?RAISE EXCEPTION/
    )
    expect(sql).toContain("knockoutDraw is write-once")
    // The guard is on OLD being non-null, which is what makes NULL -> bracket
    // legal and bracket -> anything (including NULL) illegal.
    expect(sql).toMatch(/OLD\."knockoutDraw" IS NOT NULL/)
  })

  it("names the violated invariant in the error, and the playoff it belongs to", () => {
    const raises = sql.match(/RAISE EXCEPTION[\s\S]*?USING ERRCODE/g) ?? []
    expect(raises).toHaveLength(2)
    for (const raise of raises) {
      expect(raise).toContain('OLD."id"')
      expect(raise).toContain("ChampionshipPlayoff.")
    }
  })

  it("inspects NOTHING but those two columns, so later fields stay updatable", () => {
    const body = sql.slice(sql.indexOf("BEGIN"), sql.indexOf("END;"))
    const columns = new Set([...body.matchAll(/(?:NEW|OLD)\."(\w+)"/g)].map((m) => m[1]))
    expect([...columns].sort()).toEqual(["drawSeed", "id", "knockoutDraw"])
  })

  it("is safe to apply more than once", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION")
    expect(sql).toContain('DROP TRIGGER IF EXISTS "ChampionshipPlayoff_draw_write_once"')
  })

  it("is the only migration that touches the trigger", () => {
    const others = readdirSync(MIGRATIONS)
      .filter((name) => name !== MIGRATION_DIR && !name.endsWith(".toml"))
      .filter((name) =>
        readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8").includes("draw_write_once")
      )
    expect(others).toEqual([])
  })
})

describe("the application has not grown a second write path", () => {
  const playoffs = readCode("lib", "seasons", "playoffs.ts")

  it("writes ChampionshipPlayoff in exactly two places: one create, one update", () => {
    expect(playoffs.match(/championshipPlayoff\.create\(/g)).toHaveLength(1)
    expect(playoffs.match(/championshipPlayoff\.update\(/g)).toHaveLength(1)
    for (const forbidden of ["upsert", "updateMany", "delete", "deleteMany", "createMany"]) {
      expect(playoffs).not.toContain(`championshipPlayoff.${forbidden}(`)
    }
  })

  it("the one update is still guarded by the draw not already existing", () => {
    // Application-level protection REMAINS - the database is the final
    // authority, not the only one. A caller should get a correct no-op, not
    // a database exception, when the draw is already made.
    expect(playoffs).toMatch(/const stored = parseKnockoutDraw\([\s\S]*?if \(!stored\) \{\s*await tx\.championshipPlayoff\.update\(/)
  })

  it("never writes drawSeed anywhere but the create", () => {
    const update = playoffs.slice(playoffs.indexOf("championshipPlayoff.update("))
    expect(update.slice(0, 300)).not.toContain("drawSeed")
  })
})
