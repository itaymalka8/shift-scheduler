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

const SNAPSHOT_DIR = "20260904120000_season_champion_club_name_snapshot"
const snapshotSql = readFileSync(join(MIGRATIONS, SNAPSHOT_DIR, "migration.sql"), "utf8").replace(/^\s*--.*$/gm, "")

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

describe("the club-name snapshot migration", () => {
  it("adds exactly one nullable column and nothing else", () => {
    // Nullable with no default is catalog-only in Postgres 11+: no row is
    // read or rewritten, whatever the table already holds.
    expect(snapshotSql).toMatch(/ALTER TABLE "SeasonChampion" ADD COLUMN IF NOT EXISTS "clubNameAtDecision" TEXT;/)
    expect(snapshotSql).not.toMatch(/NOT NULL|DEFAULT|DROP COLUMN|CREATE TABLE|CREATE TYPE|CREATE INDEX/i)
    expect(snapshotSql.match(/ALTER TABLE/g)).toHaveLength(1)
  })

  it("makes the snapshot write-once at the database", () => {
    expect(snapshotSql).toMatch(/CREATE OR REPLACE FUNCTION "season_champion_club_name_write_once"/)
    expect(snapshotSql).toMatch(/BEFORE UPDATE ON "SeasonChampion"[\s\S]*?FOR EACH ROW/)
    expect(snapshotSql).toMatch(
      /IF NEW\."clubNameAtDecision" IS DISTINCT FROM OLD\."clubNameAtDecision" THEN[\s\S]*?RAISE EXCEPTION/
    )
    expect(snapshotSql).toContain("clubNameAtDecision is write-once")
  })

  it("is ABSOLUTE - it does not carve out a null-to-value transition", () => {
    // Stricter than the playoff draw on purpose: the name is known at INSERT
    // and is never knowable afterwards, so a later write could only be
    // someone deciding today what a club "was called" years ago.
    expect(snapshotSql).not.toMatch(/OLD\."clubNameAtDecision" IS NOT NULL/)
    expect(snapshotSql).not.toMatch(/OLD\."clubNameAtDecision" IS NULL/)
  })

  it("inspects that column and the id, so later fields stay updatable", () => {
    const body = snapshotSql.slice(snapshotSql.indexOf("BEGIN"), snapshotSql.indexOf("END;"))
    const columns = new Set([...body.matchAll(/(?:NEW|OLD)\."(\w+)"/g)].map((m) => m[1]))
    expect([...columns].sort()).toEqual(["clubNameAtDecision", "id"])
  })

  it("is safe to apply more than once, in BOTH halves", () => {
    expect(snapshotSql).toContain("ADD COLUMN IF NOT EXISTS")
    expect(snapshotSql).toContain("CREATE OR REPLACE FUNCTION")
    expect(snapshotSql).toContain('DROP TRIGGER IF EXISTS "SeasonChampion_club_name_write_once"')
  })
})

describe("the snapshot is a display field, never an identity", () => {
  const champions = readCode("lib", "seasons", "champions.ts")

  it("is written at creation and never updated", () => {
    expect(champions).toMatch(/clubNameAtDecision: club\?\.name \?\? null/)
    expect(champions).not.toContain("seasonChampion.update(")
    expect(champions).not.toContain("seasonChampion.upsert(")
  })

  it("is never used to find, join or group a club anywhere in the tree", () => {
    const offenders = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
      .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes("generated") && !f.endsWith(".test.ts"))
      .filter((f) => {
        const code = readFileSync(join(ROOT, "src", f), "utf8")
        // A where/orderBy/groupBy that mentions it would make a display
        // snapshot into a lookup key, which is exactly what it must not be.
        return /(?:where|orderBy|groupBy|distinct)[\s\S]{0,200}clubNameAtDecision/.test(code)
      })
    expect(offenders).toEqual([])
  })
})
