import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  LEDGER_CHECKS,
  LEDGER_COLUMNS,
  LEDGER_FOREIGN_KEYS,
  LEDGER_TABLE,
  LEDGER_UNIQUE_INDEX,
  REPLENISHMENT_ENUM,
  evaluateReplenishmentContract,
  replenishmentContractPasses,
  type ReplenishmentReadings,
} from "./replenishment-contract"

const ROOT = join(__dirname, "..", "..", "..")

/**
 * The evaluator has to FAIL on every way the database could be wrong, because
 * it is the only thing standing between "the migration says so" and "the
 * database actually does it". Every case below is one real way a migration
 * can be applied partially, or a constraint dropped by hand in a console.
 */

const GOOD: ReplenishmentReadings = {
  enumValues: [
    { type: "SeasonOffseasonStage", value: "NONE" },
    { type: "SeasonOffseasonStage", value: "PLAYER_LIFECYCLE" },
    { type: "SeasonOffseasonStage", value: "SQUAD_REPLENISHMENT" },
    { type: "SeasonOffseasonStage", value: "CREATE_NEXT" },
  ],
  columns: LEDGER_COLUMNS.map((column) => ({ table: LEDGER_TABLE, ...column })),
  indexes: [
    {
      name: LEDGER_UNIQUE_INDEX.name,
      table: LEDGER_TABLE,
      unique: true,
      definition: `CREATE UNIQUE INDEX "${LEDGER_UNIQUE_INDEX.name}" ON public."SquadReplenishment" USING btree ("seasonId", "teamId")`,
    },
  ],
  foreignKeys: [...LEDGER_FOREIGN_KEYS],
  checks: [
    {
      constraint: "SquadReplenishment_counts_nonnegative",
      table: LEDGER_TABLE,
      // Verbatim from pg_get_constraintdef in the migration rehearsal: note
      // that PostgreSQL has dropped the quotes around `generated`, which is
      // exactly what a naive text comparison would trip over.
      definition:
        'CHECK ((("ownedBefore" >= 0) AND (generated >= 0) AND ("ownedAfter" >= 0) AND ("floorAtRun" >= 0)))',
    },
    {
      constraint: "SquadReplenishment_counts_balance",
      table: LEDGER_TABLE,
      definition: 'CHECK ((("ownedBefore" + generated) = "ownedAfter"))',
    },
  ],
}

describe("the contract passes on a correctly migrated database", () => {
  it("passes", () => {
    const checks = evaluateReplenishmentContract(GOOD)
    const failures = checks.filter((check) => !check.ok)
    expect(failures.map((f) => `${f.label}: ${f.detail}`)).toEqual([])
    expect(replenishmentContractPasses(checks)).toBe(true)
  })
})

describe("the contract fails closed", () => {
  it("fails when the enum value was never added", () => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      enumValues: GOOD.enumValues.filter((row) => row.value !== REPLENISHMENT_ENUM.value),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks[0].detail).toContain("MISSING")
  })

  it("fails when the enum type itself is absent", () => {
    const checks = evaluateReplenishmentContract({ ...GOOD, enumValues: [] })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks[0].detail).toContain("enum not found")
  })

  it("fails - and says so once, not eight times - when the table does not exist", () => {
    const checks = evaluateReplenishmentContract({ ...GOOD, columns: [] })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.filter((check) => check.detail === "TABLE MISSING from information_schema")).toHaveLength(1)
  })

  it.each(LEDGER_COLUMNS.map((column) => column.column))("fails when the %s column is missing", (column) => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      columns: GOOD.columns.filter((row) => row.column !== column),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label.endsWith(`.${column}`))!.detail).toBe("COLUMN MISSING")
  })

  it("fails when a count column was created nullable", () => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      columns: GOOD.columns.map((row) => (row.column === "generated" ? { ...row, nullable: true } : row)),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
  })

  it("fails when a count column was created as text", () => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      columns: GOOD.columns.map((row) => (row.column === "ownedAfter" ? { ...row, type: "text" } : row)),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label.endsWith(".ownedAfter"))!.detail).toContain("text != integer")
  })

  it("reports a column beyond the contract without failing on it", () => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      columns: [...GOOD.columns, { table: LEDGER_TABLE, column: "notes", type: "text", nullable: true }],
    })
    expect(replenishmentContractPasses(checks)).toBe(true)
    expect(checks.find((check) => check.label === "columns beyond the contract")!.detail).toContain("notes")
  })

  it("fails when the unique index is missing", () => {
    const checks = evaluateReplenishmentContract({ ...GOOD, indexes: [] })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label.startsWith("unique index"))!.detail).toContain(
      "a club could be replenished twice"
    )
  })

  it("fails when the index exists but is not unique", () => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      indexes: GOOD.indexes.map((row) => ({ ...row, unique: false })),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label === "the index is UNIQUE")!.detail).toBe("NOT UNIQUE")
  })

  it("fails when the index covers only one of the two columns", () => {
    // The index NAME contains both column names, so this is exactly the case a
    // naive substring match on the whole definition would wave through.
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      indexes: [
        {
          ...GOOD.indexes[0],
          definition: 'CREATE UNIQUE INDEX "SquadReplenishment_seasonId_teamId_key" ON public."SquadReplenishment" USING btree ("seasonId")',
        },
      ],
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
  })

  it.each(LEDGER_FOREIGN_KEYS.map((fk) => fk.constraint))("fails when %s is CASCADE instead of RESTRICT", (constraint) => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      foreignKeys: GOOD.foreignKeys.map((fk) => (fk.constraint === constraint ? { ...fk, onDelete: "CASCADE" } : fk)),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label.includes(constraint))!.detail).toContain("CASCADE != RESTRICT")
  })

  it.each(LEDGER_FOREIGN_KEYS.map((fk) => fk.constraint))("fails when %s is missing entirely", (constraint) => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      foreignKeys: GOOD.foreignKeys.filter((fk) => fk.constraint !== constraint),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
  })

  it.each(LEDGER_CHECKS.map((check) => check.constraint))("fails when the %s CHECK is missing", (constraint) => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      checks: GOOD.checks.filter((row) => row.constraint !== constraint),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label.includes(constraint))!.detail).toContain("unenforced")
  })

  it("accepts the quoting PostgreSQL actually stores, in either direction", () => {
    // A migration written with quotes, stored without them - and the reverse,
    // in case a future PostgreSQL keeps them.
    const quoted = evaluateReplenishmentContract({
      ...GOOD,
      checks: GOOD.checks.map((row) => ({ ...row, definition: row.definition.replace(/generated/g, '"generated"') })),
    })
    expect(replenishmentContractPasses(quoted)).toBe(true)
    const unquoted = evaluateReplenishmentContract({
      ...GOOD,
      checks: GOOD.checks.map((row) => ({ ...row, definition: row.definition.replace(/"/g, "") })),
    })
    expect(replenishmentContractPasses(unquoted)).toBe(true)
  })

  it("fails when the balance CHECK exists but constrains the wrong thing", () => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      checks: GOOD.checks.map((row) =>
        row.constraint === "SquadReplenishment_counts_balance"
          ? { ...row, definition: 'CHECK (("ownedBefore" >= 0))' }
          : row
      ),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label.includes("counts_balance"))!.detail).toContain("does not constrain")
  })

  it("fails when the non-negativity CHECK forgot one of the four counters", () => {
    const checks = evaluateReplenishmentContract({
      ...GOOD,
      checks: GOOD.checks.map((row) =>
        row.constraint === "SquadReplenishment_counts_nonnegative"
          ? { ...row, definition: 'CHECK ((("ownedBefore" >= 0) AND (generated >= 0) AND ("ownedAfter" >= 0)))' }
          : row
      ),
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.find((check) => check.label.includes("counts_nonnegative"))!.detail).toContain("floorAtRun >= 0")
  })

  it("reports the pre-migration database honestly rather than crashing on it", () => {
    const checks = evaluateReplenishmentContract({
      enumValues: GOOD.enumValues.filter((row) => row.value !== REPLENISHMENT_ENUM.value),
      columns: [],
      indexes: [],
      foreignKeys: [],
      checks: [],
    })
    expect(replenishmentContractPasses(checks)).toBe(false)
    expect(checks.every((check) => typeof check.detail === "string")).toBe(true)
  })
})

describe("the contract matches what the migration actually writes", () => {
  const migration = readFileSync(
    join(ROOT, "prisma", "migrations", "20260905144224_squad_replenishment_floor", "migration.sql"),
    "utf8"
  )

  it("the enum value the contract expects is the one the migration adds", () => {
    expect(migration).toContain(`ADD VALUE '${REPLENISHMENT_ENUM.value}'`)
  })

  it("every column the contract expects is created by the migration", () => {
    for (const column of LEDGER_COLUMNS) expect(migration).toContain(`"${column.column}"`)
  })

  it("the unique index the contract expects is created by the migration", () => {
    expect(migration).toContain(`CREATE UNIQUE INDEX "${LEDGER_UNIQUE_INDEX.name}"`)
  })

  it("both foreign keys are RESTRICT in the migration, not just in the contract", () => {
    for (const fk of LEDGER_FOREIGN_KEYS) {
      expect(migration).toMatch(
        new RegExp(`ADD CONSTRAINT "${fk.constraint}"[\\s\\S]*?ON DELETE RESTRICT`)
      )
    }
  })

  it("both CHECK constraints are in the migration - they exist nowhere else", () => {
    for (const check of LEDGER_CHECKS) expect(migration).toContain(`ADD CONSTRAINT "${check.constraint}"`)
    // Prisma's DSL has no @check at this version, so schema.prisma cannot
    // carry them. If that ever changes, this test is the reminder to move them.
    const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8")
    for (const check of LEDGER_CHECKS) expect(schema).not.toContain(check.constraint)
  })
})
