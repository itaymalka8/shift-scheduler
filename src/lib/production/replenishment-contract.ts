/**
 * THE SQUAD REPLENISHMENT CONTRACT, as one declarative list.
 *
 * Pure: no Prisma, no I/O. It states what the database must look like after
 * the Phase 3N migration, and evaluates a catalogue reading against that
 * statement. The reading is done by the caller
 * (scripts/production/verify-squad-replenishment.ts against Production, a
 * real PostgreSQL in the rehearsal), so the same expectations are checked in
 * every place and cannot drift apart.
 *
 * WHY THE CATALOGUE AND NOT schema.prisma. schema.prisma is what we asked
 * for; pg_constraint is what we got. Two of the four guarantees here - the
 * CHECK constraints on the ledger arithmetic - do not exist in schema.prisma
 * at all, because Prisma's DSL has no @check at this version. They live only
 * in the migration, which means the catalogue is the ONLY place they can be
 * verified. Reading the schema file instead would silently skip them.
 *
 * It reports the state it finds either way, so it is useful BEFORE the
 * migration too: run it on 19 migrations and it correctly says the enum
 * value, the table, the index, the foreign keys and the checks are all
 * missing.
 */

/** The offseason stage the season roll advances through to reach CREATE_NEXT. */
export const REPLENISHMENT_ENUM = {
  type: "SeasonOffseasonStage",
  value: "SQUAD_REPLENISHMENT",
} as const

export const LEDGER_TABLE = "SquadReplenishment"

/** Every column the ledger must have, with the type the migration creates. */
export const LEDGER_COLUMNS = [
  { column: "id", type: "text", nullable: false },
  { column: "seasonId", type: "text", nullable: false },
  { column: "teamId", type: "text", nullable: false },
  { column: "ownedBefore", type: "integer", nullable: false },
  { column: "generated", type: "integer", nullable: false },
  { column: "ownedAfter", type: "integer", nullable: false },
  { column: "floorAtRun", type: "integer", nullable: false },
  { column: "completedAt", type: "timestamp without time zone", nullable: false },
] as const

/**
 * The index that makes "one replenishment per club per season" a database
 * fact rather than a convention. The service also serializes on the team
 * roster lock, which is what actually resolves a live race - but an unlocked
 * future caller would have nothing but this index between it and a club
 * replenished twice.
 */
export const LEDGER_UNIQUE_INDEX = {
  name: "SquadReplenishment_seasonId_teamId_key",
  table: LEDGER_TABLE,
  columns: ["seasonId", "teamId"],
} as const

/**
 * Both ledger foreign keys are RESTRICT, matching the historical retention
 * contract: a season or a club that has been replenished cannot be deleted
 * out from under its own audit row.
 */
export const LEDGER_FOREIGN_KEYS = [
  { constraint: "SquadReplenishment_seasonId_fkey", table: LEDGER_TABLE, column: "seasonId", target: "Season", onDelete: "RESTRICT" },
  { constraint: "SquadReplenishment_teamId_fkey", table: LEDGER_TABLE, column: "teamId", target: "Team", onDelete: "RESTRICT" },
] as const

/**
 * The arithmetic the database itself refuses to break. A row claiming a club
 * went from 14 to 18 having been given 3 players is not a rounding error - it
 * is a partially applied replenishment that somehow still wrote its ledger.
 */
export const LEDGER_CHECKS = [
  {
    constraint: "SquadReplenishment_counts_nonnegative",
    table: LEDGER_TABLE,
    contains: ["ownedBefore >= 0", "generated >= 0", "ownedAfter >= 0", "floorAtRun >= 0"],
  },
  {
    constraint: "SquadReplenishment_counts_balance",
    table: LEDGER_TABLE,
    contains: ["ownedBefore + generated", "ownedAfter"],
  },
] as const

/**
 * PostgreSQL rewrites a CHECK when it stores it: whitespace is normalised and
 * an identifier that needs no quoting loses its quotes, so the migration's
 * `"generated" >= 0` comes back as `generated >= 0`. Comparing the raw text
 * would therefore fail on a perfectly correct constraint - the fragments above
 * are written unquoted and both sides are put through this first.
 */
function normaliseConstraint(definition: string): string {
  return definition.replace(/"/g, "").replace(/\s+/g, " ")
}

// ---------------------------------------------------------------------------
// Readings: one shape per catalogue query the caller runs.
// ---------------------------------------------------------------------------

export interface EnumValueReading {
  type: string
  value: string
}

export interface ColumnReading {
  table: string
  column: string
  type: string
  nullable: boolean
}

export interface IndexReading {
  name: string
  table: string
  unique: boolean
  definition: string
}

export interface ForeignKeyReading {
  constraint: string
  table: string
  column: string
  target: string
  onDelete: string
}

export interface CheckReading {
  constraint: string
  table: string
  definition: string
}

export interface ReplenishmentReadings {
  enumValues: EnumValueReading[]
  columns: ColumnReading[]
  indexes: IndexReading[]
  foreignKeys: ForeignKeyReading[]
  checks: CheckReading[]
}

export interface ContractCheck {
  label: string
  ok: boolean
  detail: string
}

function checkEnum(readings: ReplenishmentReadings): ContractCheck[] {
  const values = readings.enumValues.filter((row) => row.type === REPLENISHMENT_ENUM.type).map((row) => row.value)
  const present = values.includes(REPLENISHMENT_ENUM.value)
  return [
    {
      label: `enum ${REPLENISHMENT_ENUM.type} has ${REPLENISHMENT_ENUM.value}`,
      ok: present,
      detail: present ? values.join(", ") : `MISSING - present values: ${values.join(", ") || "(enum not found)"}`,
    },
  ]
}

function checkColumns(readings: ReplenishmentReadings): ContractCheck[] {
  const actual = new Map(
    readings.columns.filter((row) => row.table === LEDGER_TABLE).map((row) => [row.column, row])
  )
  if (actual.size === 0) {
    return [{ label: `table ${LEDGER_TABLE}`, ok: false, detail: "TABLE MISSING from information_schema" }]
  }
  const checks: ContractCheck[] = [
    { label: `table ${LEDGER_TABLE} exists`, ok: true, detail: `${actual.size} columns` },
  ]
  for (const want of LEDGER_COLUMNS) {
    const got = actual.get(want.column)
    if (!got) {
      checks.push({ label: `column ${LEDGER_TABLE}.${want.column}`, ok: false, detail: "COLUMN MISSING" })
      continue
    }
    const mismatches: string[] = []
    if (got.type !== want.type) mismatches.push(`type ${got.type} != ${want.type}`)
    if (got.nullable !== want.nullable) mismatches.push(`nullable ${got.nullable} != ${want.nullable}`)
    checks.push({
      label: `column ${LEDGER_TABLE}.${want.column}`,
      ok: mismatches.length === 0,
      detail: mismatches.length === 0 ? `${got.type}${got.nullable ? " NULL" : " NOT NULL"}` : mismatches.join("; "),
    })
  }
  // An unexpected column is not a failure - a later phase may add one - but it
  // is reported so a hand-edited table cannot pass unnoticed.
  const extra = [...actual.keys()].filter((column) => !LEDGER_COLUMNS.some((want) => want.column === column))
  if (extra.length > 0) {
    checks.push({ label: `columns beyond the contract`, ok: true, detail: `also present: ${extra.join(", ")}` })
  }
  return checks
}

function checkIndex(readings: ReplenishmentReadings): ContractCheck[] {
  const got = readings.indexes.find((row) => row.name === LEDGER_UNIQUE_INDEX.name)
  if (!got) {
    return [
      {
        label: `unique index ${LEDGER_UNIQUE_INDEX.name}`,
        ok: false,
        detail: "INDEX MISSING - a club could be replenished twice",
      },
    ]
  }
  // The column list only, never the whole definition - the index NAME itself
  // contains both column names, so matching on the definition would pass an
  // index that covers just one of them.
  const columnList = got.definition.match(/\(([^()]*)\)\s*$/)?.[1] ?? ""
  const mentionsBoth = LEDGER_UNIQUE_INDEX.columns.every((column) => columnList.includes(column))
  return [
    { label: `unique index ${LEDGER_UNIQUE_INDEX.name} exists`, ok: true, detail: `on ${got.table}` },
    { label: "the index is UNIQUE", ok: got.unique, detail: got.unique ? "UNIQUE" : "NOT UNIQUE" },
    {
      label: "the index covers (seasonId, teamId)",
      ok: mentionsBoth,
      detail: got.definition,
    },
  ]
}

function checkForeignKeys(readings: ReplenishmentReadings): ContractCheck[] {
  const byName = new Map(readings.foreignKeys.map((fk) => [fk.constraint, fk]))
  return LEDGER_FOREIGN_KEYS.map((want) => {
    const got = byName.get(want.constraint)
    if (!got) return { label: `FK ${want.constraint}`, ok: false, detail: "CONSTRAINT MISSING from pg_constraint" }
    const mismatches: string[] = []
    if (got.table !== want.table) mismatches.push(`table ${got.table} != ${want.table}`)
    if (got.column !== want.column) mismatches.push(`column ${got.column} != ${want.column}`)
    if (got.target !== want.target) mismatches.push(`target ${got.target} != ${want.target}`)
    if (got.onDelete !== want.onDelete) mismatches.push(`ON DELETE ${got.onDelete} != ${want.onDelete}`)
    return mismatches.length === 0
      ? {
          label: `FK ${want.constraint}`,
          ok: true,
          detail: `${got.table}.${got.column} -> ${got.target} ON DELETE ${got.onDelete}`,
        }
      : { label: `FK ${want.constraint}`, ok: false, detail: mismatches.join("; ") }
  })
}

function checkChecks(readings: ReplenishmentReadings): ContractCheck[] {
  const byName = new Map(readings.checks.map((row) => [row.constraint, row]))
  return LEDGER_CHECKS.map((want) => {
    const got = byName.get(want.constraint)
    if (!got) {
      return {
        label: `CHECK ${want.constraint}`,
        ok: false,
        detail: "CONSTRAINT MISSING - the ledger arithmetic is unenforced",
      }
    }
    const normalised = normaliseConstraint(got.definition)
    const missing = want.contains.filter((fragment) => !normalised.includes(fragment))
    return missing.length === 0
      ? { label: `CHECK ${want.constraint}`, ok: got.table === want.table, detail: normalised }
      : { label: `CHECK ${want.constraint}`, ok: false, detail: `does not constrain ${missing.join(", ")}: ${normalised}` }
  })
}

/** Every check, in report order. `ok` on all of them is the whole contract. */
export function evaluateReplenishmentContract(readings: ReplenishmentReadings): ContractCheck[] {
  return [
    ...checkEnum(readings),
    ...checkColumns(readings),
    ...checkIndex(readings),
    ...checkForeignKeys(readings),
    ...checkChecks(readings),
  ]
}

export function replenishmentContractPasses(checks: ContractCheck[]): boolean {
  return checks.every((check) => check.ok)
}
