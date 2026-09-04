import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import {
  ACCOUNT_PROTECTION_FOREIGN_KEYS,
  DELIBERATE_CASCADES,
  FIXTURE_RETENTION_TRIGGER,
  RETENTION_FOREIGN_KEYS,
  evaluateRetention,
  retentionPasses,
  type ForeignKeyReading,
  type TriggerReading,
} from "./historical-retention"

const ROOT = join(__dirname, "..", "..", "..")

// ---------------------------------------------------------------------------
// SOURCE GUARDS - no new Production-capable deletion path for a historical model
// ---------------------------------------------------------------------------

/**
 * THE ONE ALLOWED DELETION of a historical model, named exactly.
 *
 * A file/model allowlist rather than a regex over the whole tree: a broad
 * pattern would either miss `tx.` versus `prisma.`, or fire on the word
 * "delete" in prose. This walks the real files, finds every Prisma delete call
 * on a model that carries history, and compares the SET to this list.
 */
const ALLOWED_HISTORICAL_DELETES = [{ file: "src/lib/seasons/next-season.ts", model: "fixture" }] as const

/** Models whose rows are, or carry, sporting history. */
const HISTORICAL_MODELS = [
  "fixture",
  "team",
  "season",
  "division",
  "player",
  "matchEvent",
  "playerMatchStats",
  "teamEra",
  "seasonChampion",
  "championshipPlayoff",
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === "generated" || entry === "node_modules") continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Every `<client>.<model>.delete|deleteMany(` in shipped (non-test) source. */
function findHistoricalDeletes(): { file: string; model: string; line: number }[] {
  const found: { file: string; model: string; line: number }[] = []
  for (const file of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]) {
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, i) => {
      // Comments describe these rules constantly; only real calls count.
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "")
      const match = /\b(?:prisma|tx|client|db)\.([A-Za-z]+)\.(?:delete|deleteMany)\s*\(/.exec(code)
      if (match && HISTORICAL_MODELS.includes(match[1])) {
        found.push({ file: relative(ROOT, file), model: match[1], line: i + 1 })
      }
    })
  }
  return found
}

describe("no new deletion path for a historical model", () => {
  it("the ONLY historical delete in shipped source is the guarded schedule rebuild", () => {
    const found = findHistoricalDeletes().map(({ file, model }) => ({ file, model }))
    expect(found).toEqual([...ALLOWED_HISTORICAL_DELETES])
  })

  it.each(["team", "season", "division", "player", "matchEvent", "playerMatchStats", "teamEra", "seasonChampion", "championshipPlayoff"])(
    "nothing deletes %s anywhere in shipped source",
    (model) => {
      expect(findHistoricalDeletes().filter((d) => d.model === model)).toEqual([])
    }
  )

  it("no raw DELETE or TRUNCATE is executed from application code", () => {
    for (const file of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]) {
      const source = readFileSync(file, "utf8")
      // $executeRaw`DELETE ...` / $executeRawUnsafe("TRUNCATE ...")
      expect(source).not.toMatch(/\$executeRaw(Unsafe)?[^;]{0,200}\b(DELETE\s+FROM|TRUNCATE)\b/i)
    }
  })
})

describe("the schedule-rebuild guard is still in place", () => {
  const source = readFileSync(join(ROOT, "src/lib/seasons/next-season.ts"), "utf8")

  it("counts played fixtures before deleting anything", () => {
    const deleteAt = source.indexOf("tx.fixture.deleteMany")
    expect(deleteAt).toBeGreaterThan(-1)
    const before = source.slice(0, deleteAt)
    // The count and its refusal must both precede the delete, in that order.
    const countAt = before.lastIndexOf('playedAt: { not: null }')
    const throwAt = before.lastIndexOf("throw new SeasonLifecycleError")
    expect(countAt).toBeGreaterThan(-1)
    expect(throwAt).toBeGreaterThan(countAt)
  })

  it("refuses on played > 0 rather than merely warning", () => {
    expect(source).toContain("if (played > 0)")
    expect(source).toMatch(/refusing to rebuild its schedule/)
  })

  it("the guard is unfiltered by stage, so a decider counts too", () => {
    const guard = source.slice(source.indexOf("const played = await tx.fixture.count"))
    const call = guard.slice(0, guard.indexOf("\n}") + 2)
    expect(call).toContain("divisionId")
    expect(call).toContain("playedAt: { not: null }")
    expect(call).not.toContain("stage:")
  })
})

// ---------------------------------------------------------------------------
// THE CONTRACT ITSELF
// ---------------------------------------------------------------------------

describe("the retention contract", () => {
  it("names exactly the six foreign keys this phase changes", () => {
    expect(RETENTION_FOREIGN_KEYS.map((fk) => `${fk.table}.${fk.column}`)).toEqual([
      "Fixture.divisionId",
      "Fixture.homeTeamId",
      "Fixture.awayTeamId",
      "MatchEvent.teamId",
      "PlayerMatchStats.playerId",
      "FinancialTransaction.teamId",
    ])
    expect(RETENTION_FOREIGN_KEYS.every((fk) => fk.onDelete === "RESTRICT")).toBe(true)
  })

  it("keeps the two fixture cascades deliberate rather than accidental", () => {
    expect(DELIBERATE_CASCADES.map((fk) => `${fk.table}.${fk.column}`)).toEqual([
      "MatchEvent.fixtureId",
      "PlayerMatchStats.fixtureId",
    ])
    expect(DELIBERATE_CASCADES.every((fk) => fk.onDelete === "CASCADE")).toBe(true)
  })

  it("re-asserts the account protections it must not weaken", () => {
    expect(ACCOUNT_PROTECTION_FOREIGN_KEYS.map((fk) => `${fk.table}.${fk.column}`)).toEqual([
      "TeamEra.userId",
      "TeamEra.teamId",
    ])
    expect(ACCOUNT_PROTECTION_FOREIGN_KEYS.every((fk) => fk.onDelete === "RESTRICT")).toBe(true)
  })

  it("describes a BEFORE DELETE row trigger on Fixture", () => {
    expect(FIXTURE_RETENTION_TRIGGER).toMatchObject({
      table: "Fixture",
      timing: "BEFORE",
      event: "DELETE",
      level: "ROW",
      returns: "trigger",
    })
  })
})

// ---------------------------------------------------------------------------
// THE EVALUATOR - it must FAIL on every way the database could be wrong
// ---------------------------------------------------------------------------

const GOOD_FKS: ForeignKeyReading[] = [...RETENTION_FOREIGN_KEYS, ...DELIBERATE_CASCADES, ...ACCOUNT_PROTECTION_FOREIGN_KEYS]
const GOOD_TRIGGER: TriggerReading = { ...FIXTURE_RETENTION_TRIGGER, enabled: "O" }

describe("evaluateRetention fails closed", () => {
  it("passes on a fully correct database", () => {
    expect(retentionPasses(evaluateRetention({ foreignKeys: GOOD_FKS, trigger: GOOD_TRIGGER }))).toBe(true)
  })

  it.each(RETENTION_FOREIGN_KEYS.map((fk) => fk.constraint))("fails when %s is still CASCADE", (constraint) => {
    const fks = GOOD_FKS.map((fk) => (fk.constraint === constraint ? { ...fk, onDelete: "CASCADE" } : fk))
    const checks = evaluateRetention({ foreignKeys: fks, trigger: GOOD_TRIGGER })
    expect(retentionPasses(checks)).toBe(false)
    expect(checks.find((c) => c.label.includes(constraint))!.detail).toContain("CASCADE != RESTRICT")
  })

  it("fails when a constraint is missing entirely", () => {
    const fks = GOOD_FKS.filter((fk) => fk.constraint !== "Fixture_divisionId_fkey")
    expect(retentionPasses(evaluateRetention({ foreignKeys: fks, trigger: GOOD_TRIGGER }))).toBe(false)
  })

  it("fails when the trigger is missing", () => {
    const checks = evaluateRetention({ foreignKeys: GOOD_FKS, trigger: null })
    expect(retentionPasses(checks)).toBe(false)
    expect(checks.at(-1)!.detail).toContain("played fixtures are deletable")
  })

  it.each([
    ["disabled", { enabled: "D" }],
    ["replica-only", { enabled: "R" }],
    ["always-mode", { enabled: "A" }],
    ["AFTER instead of BEFORE", { timing: "AFTER" }],
    ["STATEMENT instead of ROW", { level: "STATEMENT" }],
    ["fired on the wrong event", { event: "OTHER" }],
    ["pointing at another function", { function: "something_else" }],
    ["a function that does not return trigger", { returns: "void" }],
    ["attached to the wrong table", { table: "MatchEvent" }],
  ])("fails when the trigger is %s", (_label, override) => {
    const trigger = { ...GOOD_TRIGGER, ...override } as TriggerReading
    expect(retentionPasses(evaluateRetention({ foreignKeys: GOOD_FKS, trigger }))).toBe(false)
  })

  it("fails when someone 'hardens' a deliberate CASCADE into RESTRICT", () => {
    const fks = GOOD_FKS.map((fk) => (fk.constraint === "MatchEvent_fixtureId_fkey" ? { ...fk, onDelete: "RESTRICT" } : fk))
    expect(retentionPasses(evaluateRetention({ foreignKeys: fks, trigger: GOOD_TRIGGER }))).toBe(false)
  })

  it("fails when account protection is weakened to CASCADE", () => {
    const fks = GOOD_FKS.map((fk) => (fk.constraint === "TeamEra_userId_fkey" ? { ...fk, onDelete: "CASCADE" } : fk))
    expect(retentionPasses(evaluateRetention({ foreignKeys: fks, trigger: GOOD_TRIGGER }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SCHEMA AND MIGRATION AGREE WITH THE CONTRACT
// ---------------------------------------------------------------------------

describe("schema.prisma and the migration match the contract", () => {
  const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")
  const migration = readFileSync(
    join(ROOT, "prisma/migrations/20260904170000_historical_retention_append_only/migration.sql"),
    "utf8"
  )

  it.each(RETENTION_FOREIGN_KEYS.map((fk) => [fk.constraint, fk.column] as const))(
    "%s is RESTRICT in the migration",
    (constraint, column) => {
      expect(migration).toContain(`ALTER TABLE`)
      expect(migration).toContain(`DROP CONSTRAINT "${constraint}"`)
      expect(migration).toMatch(new RegExp(`ADD CONSTRAINT "${constraint}"[\\s\\S]{0,200}ON DELETE RESTRICT`))
      expect(migration).toContain(`"${column}"`)
    }
  )

  it("the migration touches no other constraint", () => {
    const dropped = [...migration.matchAll(/DROP CONSTRAINT "([^"]+)"/g)].map((m) => m[1])
    expect(dropped.sort()).toEqual(RETENTION_FOREIGN_KEYS.map((fk) => fk.constraint).sort())
  })

  it("the migration creates the BEFORE DELETE row trigger and nothing else", () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "fixture_played_no_delete"()')
    expect(migration).toContain("RETURNS trigger")
    expect(migration).toContain('DROP TRIGGER IF EXISTS "Fixture_played_no_delete" ON "Fixture"')
    expect(migration).toMatch(/CREATE TRIGGER "Fixture_played_no_delete"\s+BEFORE DELETE ON "Fixture"\s+FOR EACH ROW/)
    expect([...migration.matchAll(/CREATE TRIGGER/g)]).toHaveLength(1)
  })

  it("the trigger keys off playedAt, not the anti-spoiler rule", () => {
    expect(migration).toContain('IF OLD."playedAt" IS NOT NULL THEN')
    // Assert on the EXECUTABLE sql: the comments deliberately NAME
    // isMatchFinished in order to explain why the rule is not used, so a
    // whole-file check would fail on its own documentation.
    const executable = migration.replace(/^\s*--.*$/gm, "")
    expect(executable).not.toContain("isMatchFinished")
    // No clock: a retention rule that asks what time it is is not deterministic.
    expect(executable).not.toMatch(/\bnow\(\)|CURRENT_TIMESTAMP|clock_timestamp/i)
  })

  it("the migration adds NO model, column, index or data change", () => {
    expect(migration).not.toMatch(/CREATE TABLE|ADD COLUMN|CREATE INDEX|CREATE UNIQUE INDEX/i)
    expect(migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im)
  })

  it("no broad UPDATE immutability was added to Fixture", () => {
    expect(migration).not.toMatch(/BEFORE UPDATE ON "Fixture"/)
  })

  it("schema.prisma agrees: the six relations are Restrict", () => {
    for (const line of [
      'division          Division             @relation(fields: [divisionId], references: [id], onDelete: Restrict)',
      'homeTeam          Team                 @relation("HomeFixtures", fields: [homeTeamId], references: [id], onDelete: Restrict)',
      'awayTeam          Team                 @relation("AwayFixtures", fields: [awayTeamId], references: [id], onDelete: Restrict)',
    ]) {
      expect(schema).toContain(line)
    }
    // The two fixture cascades survive in the schema too.
    expect(schema).toContain('fixture           Fixture  @relation(fields: [fixtureId], references: [id], onDelete: Cascade)')
  })

  it("MatchEvent still has NO foreign key on playerId, and no name snapshot", () => {
    const model = schema.slice(schema.indexOf("model MatchEvent"), schema.indexOf("model TransferWindow"))
    expect(model).toContain("playerId          String?")
    expect(model).toContain("secondaryPlayerId String?")
    expect(model).not.toMatch(/playerId[^\n]*@relation/)
    expect(model).not.toMatch(/playerName|playerNameAt/)
  })
})
