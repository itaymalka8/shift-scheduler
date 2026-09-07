/**
 * THE RAW-SQL / PRISMA-SCHEMA CONTRACT for the first-baseline runner.
 *
 * TWO DEFECTS OF ONE CLASS REACHED PRODUCTION TOOLING before this test existed:
 *
 *   readOrphan            queried FinancialTransaction."fixtureId"  - no such column
 *   readSideEffectDigest  queried Fixture."homeGoals" / "awayGoals" - no such columns
 *
 * The second one is what failed Workflow C run 34113346563 with PostgreSQL
 * 42703. Both were written from memory instead of from the schema.
 *
 * A THIRD, QUIETER DEFECT of the same family did NOT crash: the sponsor and
 * maintenance counts filtered on 'SPONSOR' and 'STADIUM_MAINTENANCE', values
 * this codebase never writes. Those predicates matched nothing before AND
 * nothing after, so the digest compared 0 to 0 and would have reported a proof
 * it had not performed. A wrong column is found the first time it runs; a wrong
 * enum value is not, which is why both are covered here.
 *
 * SO THIS TEST DERIVES THE TRUTH RATHER THAN RESTATING IT: model field sets
 * come from prisma/schema.prisma, and transaction types come from
 * FINANCIAL_TRANSACTION_TYPES. Nothing here is a second source of truth.
 *
 * SCOPE, DELIBERATELY BOUNDED. Only statements against APPLICATION tables are
 * validated against Prisma models. PostgreSQL system catalogs (pg_class,
 * pg_constraint, pg_indexes, pg_trigger) and Prisma's own _prisma_migrations
 * bookkeeping table are different namespaces with different column names -
 * feeding them through a Prisma-model validator would be a category error - so
 * they are asserted separately, by name.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Prisma } from "@/generated/prisma"
import { FINANCIAL_TRANSACTION_TYPES } from "@/lib/economy/service"
import { MAINTENANCE_TRANSACTION_TYPE, SPONSOR_TRANSACTION_TYPE } from "@/lib/economy/first-baseline"

const ROOT = join(__dirname, "..", "..", "..")
const RUNNER_PATH = join(ROOT, "scripts/production/economy-first-baseline.ts")
const runner = readFileSync(RUNNER_PATH, "utf8")
/** The runner with comments removed - documentation must never satisfy a check about code. */
const runnerCode = runner.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8")

/** Every APPLICATION model the runner's raw SQL touches. */
const APPLICATION_MODELS = ["Team", "Player", "Fixture", "FinancialTransaction", "Season", "TeamEconomicState"] as const

/** Namespaces that are NOT Prisma models and must never be validated as one. */
const NON_MODEL_RELATIONS = ["pg_class", "pg_namespace", "pg_constraint", "pg_indexes", "pg_trigger", "_prisma_migrations"]

/**
 * THE PHYSICAL COLUMN AUTHORITY - Prisma's DMMF, not a text parse.
 *
 * WHY THE FIRST VERSION OF THIS WAS WRONG. It read every declared field name
 * out of schema.prisma and allowed all of them. But a Prisma RELATION field is
 * not a PostgreSQL column:
 *
 *     teamId  String              <- a physical column
 *     team    Team @relation(...) <- NOT a column; it is a client-side navigation
 *
 * so `SELECT "team" FROM "FinancialTransaction"` satisfied the old check and
 * would still have failed in Production with undefined_column - the very defect
 * class this file exists to make unreachable.
 *
 * DMMF IS THE RIGHT AUTHORITY, and it is available from the generated client
 * (Prisma.dmmf), so no hand-written scalar-type list is maintained here. Every
 * field carries a `kind`, and across this datamodel the kinds are exactly
 * `scalar`, `enum` and `object`. Stored columns are the scalar and enum fields;
 * `object` is a relation and is excluded. That is structural: a back-relation
 * carries no FK and no @relation attribute of its own, so "strip fields with
 * @relation" would have missed it, while `kind === "object"` catches every
 * relation in both directions.
 *
 * @map / @@map ARE RESPECTED. The physical name is `dbName ?? name` for a field
 * and `dbName ?? name` for a model. No field or model in this datamodel
 * currently sets one - asserted below, so the day one does, the assertion fails
 * and this code is re-read rather than silently doing the wrong thing.
 */
type DmmfField = { name: string; kind: string; dbName?: string | null }
type DmmfModel = { name: string; dbName?: string | null; fields: DmmfField[] }

const datamodel = Prisma.dmmf.datamodel.models as unknown as DmmfModel[]

function dmmfModel(model: string): DmmfModel {
  const found = datamodel.find((candidate) => candidate.name === model)
  if (!found) throw new Error(`model ${model} not found in Prisma DMMF`)
  return found
}

/** The PHYSICAL database columns of one model: scalar and enum fields only, named as the database names them. */
function physicalColumns(model: string): Set<string> {
  return new Set(
    dmmfModel(model)
      .fields.filter((field) => field.kind === "scalar" || field.kind === "enum")
      .map((field) => field.dbName ?? field.name)
  )
}

/** The physical table name of one model. */
function physicalTable(model: string): string {
  const found = dmmfModel(model)
  return found.dbName ?? found.name
}

/** The RELATION fields of one model - never valid in raw SQL. */
function relationFields(model: string): Set<string> {
  return new Set(
    dmmfModel(model)
      .fields.filter((field) => field.kind === "object")
      .map((field) => field.name)
  )
}

/** One raw SQL statement lifted out of the runner, with the relation it reads. */
interface RawStatement {
  sql: string
  relation: string | null
}

/**
 * Every `$queryRaw` / `Prisma.sql` template literal in the runner, with the
 * relation each one reads. Extracted from the source rather than listed here,
 * so a NEW query added later is audited automatically instead of escaping the
 * inventory.
 */
function rawStatements(): RawStatement[] {
  const statements: RawStatement[] = []
  const pattern = /(?:\$queryRaw(?:<[^>]*>)?|Prisma\.sql)`([\s\S]*?)`/g
  for (const match of runner.matchAll(pattern)) {
    const sql = match[1]
    const from = /FROM\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|([a-z_][a-z0-9_]*))/i.exec(sql)
    statements.push({ sql, relation: from ? (from[1] ?? from[2]) : null })
  }
  return statements
}

/** The quoted identifiers inside one statement, minus the relation name itself. */
function quotedColumns(sql: string, relation: string): string[] {
  return [...sql.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]).filter((name) => name !== relation)
}

describe("the runner's raw SQL is inventoried, not assumed", () => {
  it("finds every raw statement in the runner", () => {
    const statements = rawStatements()
    // The runner has a fixed, reviewable number of raw statements. If this
    // count changes, a query was added or removed and must be audited below.
    expect(statements.length).toBe(20)
    expect(statements.every((s) => s.sql.trim().length > 0)).toBe(true)
  })

  it("every statement reads a relation this test recognises - application model or system catalog", () => {
    for (const statement of rawStatements()) {
      if (statement.relation === null) continue
      const known = ([...APPLICATION_MODELS] as string[]).includes(statement.relation) || NON_MODEL_RELATIONS.includes(statement.relation)
      expect({ relation: statement.relation, known }).toEqual({ relation: statement.relation, known: true })
    }
  })

  it("covers every application model the runner touches", () => {
    const touched = new Set(
      rawStatements()
        .map((s) => s.relation)
        .filter((relation): relation is string => Boolean(relation) && ([...APPLICATION_MODELS] as string[]).includes(relation!))
    )
    // Team, Fixture, FinancialTransaction, Season, TeamEconomicState appear in
    // FROM clauses; Player does too, via the digest's ownership/salary read.
    for (const model of ["Team", "Player", "Fixture", "FinancialTransaction", "Season", "TeamEconomicState"]) {
      expect([...touched]).toContain(model)
    }
  })
})

describe("EVERY column of EVERY application-table query exists on its Prisma model", () => {
  it.each([...APPLICATION_MODELS])("%s - the model itself is declared in schema.prisma", (model) => {
    expect(physicalColumns(model).size).toBeGreaterThan(0)
  })

  it("no application query names a column its model does not declare", () => {
    const offenders: string[] = []
    for (const statement of rawStatements()) {
      const relation = statement.relation
      if (!relation || !([...APPLICATION_MODELS] as string[]).includes(relation)) continue
      const fields = physicalColumns(relation)
      for (const column of quotedColumns(statement.sql, relation)) {
        if (!fields.has(column)) offenders.push(`${relation}."${column}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("system-catalog and _prisma_migrations queries are NOT validated as Prisma models", () => {
    const systemRelations = rawStatements()
      .map((s) => s.relation)
      .filter((relation): relation is string => Boolean(relation) && NON_MODEL_RELATIONS.includes(relation!))
    expect(systemRelations.length).toBeGreaterThan(0)
    // They are a different namespace: none of them is a Prisma model.
    for (const relation of systemRelations) {
      expect(schema.includes(`model ${relation} {`)).toBe(false)
    }
  })
})

describe("PHYSICAL COLUMNS ONLY - a Prisma relation field is not a database column", () => {
  /**
   * The exact hole the previous validator left open: `SELECT "team" FROM
   * "FinancialTransaction"` passed, because `team` is a declared field name -
   * but PostgreSQL has no such column and would raise undefined_column.
   */
  const ACCEPTED: [string, string][] = [
    ["FinancialTransaction", "teamId"],
    ["Player", "teamId"],
    ["Fixture", "homeTeamId"],
    ["Fixture", "awayTeamId"],
    ["Team", "balance"],
    ["TeamEconomicState", "teamId"],
  ]

  const REJECTED: [string, string][] = [
    ["FinancialTransaction", "team"],
    ["Player", "team"],
    ["Fixture", "homeTeam"],
    ["Fixture", "awayTeam"],
    ["Team", "players"],
    ["Team", "homeFixtures"],
    ["TeamEconomicState", "team"],
  ]

  it.each(ACCEPTED)("%s.%s IS accepted - it is a stored column", (model, column) => {
    expect(physicalColumns(model).has(column)).toBe(true)
  })

  it.each(REJECTED)("%s.%s IS REJECTED - it is a Prisma relation, not a column", (model, field) => {
    // It really is declared on the model...
    expect(relationFields(model).has(field)).toBe(true)
    // ...and it is NOT a physical column.
    expect(physicalColumns(model).has(field)).toBe(false)
  })

  it("no relation field of any audited model leaks into its physical column set", () => {
    for (const model of APPLICATION_MODELS) {
      for (const relation of relationFields(model)) {
        expect({ model, relation, isColumn: physicalColumns(model).has(relation) }).toEqual({ model, relation, isColumn: false })
      }
    }
  })

  it("scalar and enum fields are both kept - an enum column is still a column", () => {
    // Fixture.stage is an enum; excluding enums would wrongly reject it.
    expect(physicalColumns("Fixture").has("stage")).toBe(true)
    expect(physicalColumns("Season").has("status")).toBe(true)
  })

  it("THE VALIDATOR ITSELF fails a query that names a relation field", () => {
    // Drive the same predicate the audit uses over a deliberately broken query.
    const broken = 'SELECT "team" FROM "FinancialTransaction"'
    const relation = /FROM\s+"([A-Za-z_][A-Za-z0-9_]*)"/.exec(broken)![1]
    const offenders = quotedColumns(broken, relation).filter((column) => !physicalColumns(relation).has(column))
    expect(offenders).toEqual(['team'])
  })

  it("@map and @@map are respected structurally, and nothing uses them yet", () => {
    // physicalColumns/physicalTable resolve dbName ?? name. Assert the current
    // datamodel sets neither, so the day one does, this fails and the code is
    // re-read rather than quietly doing the wrong thing.
    for (const model of APPLICATION_MODELS) {
      expect(physicalTable(model)).toBe(model)
      for (const field of dmmfModel(model).fields) expect(field.dbName ?? null).toBeNull()
    }
  })

  it("uses Prisma DMMF rather than a hand-written scalar-type list", () => {
    const self = readFileSync(join(__dirname, "first-baseline-sql-contract.test.ts"), "utf8")
    expect(self).toContain("Prisma.dmmf.datamodel.models")
    expect(self).toContain('field.kind === "scalar" || field.kind === "enum"')
  })
})

describe("the exact identifiers that failed before", () => {
  it("NEVER references FinancialTransaction.fixtureId", () => {
    expect(physicalColumns("FinancialTransaction").has("fixtureId")).toBe(false)
    expect(runner).not.toMatch(/"fixtureId"/)
  })

  it("NEVER references Fixture.homeGoals or Fixture.awayGoals", () => {
    const fixture = physicalColumns("Fixture")
    expect(fixture.has("homeGoals")).toBe(false)
    expect(fixture.has("awayGoals")).toBe(false)
    expect(runner).not.toMatch(/"homeGoals"/)
    expect(runner).not.toMatch(/"awayGoals"/)
  })

  it("the fixture digest reads exactly id, playedAt, homeScore, awayScore", () => {
    const fixture = physicalColumns("Fixture")
    for (const column of ["id", "playedAt", "homeScore", "awayScore"]) expect(fixture.has(column)).toBe(true)
    expect(runner).toContain('SELECT "id", "playedAt", "homeScore", "awayScore" FROM "Fixture" ORDER BY "id"')
    expect(runner).toMatch(/fixtureDigest: digestRows\(fixtures\.map\(\(row\) => \[row\.id, row\.playedAt\?\.toISOString\(\) \?\? null, row\.homeScore, row\.awayScore\]\)\)/)
  })
})

describe("FinancialTransaction.type predicates carry the canonical authority", () => {
  it("both predicates are members of FINANCIAL_TRANSACTION_TYPES", () => {
    expect(FINANCIAL_TRANSACTION_TYPES).toContain(SPONSOR_TRANSACTION_TYPE)
    expect(FINANCIAL_TRANSACTION_TYPES).toContain(MAINTENANCE_TRANSACTION_TYPE)
  })

  it("the sponsor predicate is exactly sponsorIncome", () => {
    expect(SPONSOR_TRANSACTION_TYPE).toBe("sponsorIncome")
  })

  it("the maintenance predicate is exactly stadiumMaintenance", () => {
    expect(MAINTENANCE_TRANSACTION_TYPE).toBe("stadiumMaintenance")
  })

  it("FAILS if either predicate returns to the values that matched nothing", () => {
    for (const dead of ["SPONSOR", "STADIUM_MAINTENANCE"]) {
      expect(FINANCIAL_TRANSACTION_TYPES).not.toContain(dead)
      expect(SPONSOR_TRANSACTION_TYPE).not.toBe(dead)
      expect(MAINTENANCE_TRANSACTION_TYPE).not.toBe(dead)
      // and the dead literal must not appear in runner CODE. The header
      // comment names them deliberately, to record what went wrong.
      expect(runnerCode).not.toContain(`'${dead}'`)
    }
  })

  it("the runner parameterises both predicates instead of inlining a literal", () => {
    expect(runner).toContain('WHERE "type" = ${SPONSOR_TRANSACTION_TYPE}')
    expect(runner).toContain('WHERE "type" = ${MAINTENANCE_TRANSACTION_TYPE}')
  })

  /**
   * SCOPED TO THE WRITER'S OWN BODY, not to the file.
   *
   * A whole-file `toContain` proves only that the string exists SOMEWHERE in
   * weekly-settlement.ts. It would still pass if settleSponsorWeek changed its
   * type while settleMaintenanceWeek - or any other function in the same file -
   * still mentioned sponsorIncome. That is exactly the substitution these tests
   * have to catch, so each writer's body is extracted and inspected alone.
   *
   * Bounded deterministically: from `export async function <name>(` to the next
   * top-level `export ` declaration (or end of file). Both writers are top-level
   * exports in this file, asserted below, so the boundary is unambiguous.
   */
  const settlementSource = readFileSync(join(ROOT, "src/lib/economy/weekly-settlement.ts"), "utf8")

  function exportedFunctionBody(source: string, name: string): string {
    const signature = `export async function ${name}(`
    const start = source.indexOf(signature)
    expect(start).toBeGreaterThanOrEqual(0)
    const after = start + signature.length
    const next = source.indexOf("\nexport ", after)
    return source.slice(after, next < 0 ? source.length : next)
  }

  /** The type: "..." literal of the createFinancialTransaction call inside one body. */
  function emittedTransactionTypes(body: string): string[] {
    return [...body.matchAll(/createFinancialTransaction\(tx, \{[\s\S]{0,400}?type: "([A-Za-z]+)"/g)].map((match) => match[1])
  }

  it("both writers are top-level exports, so the body boundary is unambiguous", () => {
    expect(settlementSource).toContain("export async function settleSponsorWeek(")
    expect(settlementSource).toContain("export async function settleMaintenanceWeek(")
  })

  it("settleSponsorWeek's OWN createFinancialTransaction call emits sponsorIncome", () => {
    const body = exportedFunctionBody(settlementSource, "settleSponsorWeek")
    expect(emittedTransactionTypes(body)).toEqual([SPONSOR_TRANSACTION_TYPE])
    // And the maintenance type does NOT appear in the sponsor writer's body.
    expect(body).not.toContain(`type: "${MAINTENANCE_TRANSACTION_TYPE}"`)
  })

  it("settleMaintenanceWeek's OWN createFinancialTransaction call emits stadiumMaintenance", () => {
    const body = exportedFunctionBody(settlementSource, "settleMaintenanceWeek")
    expect(emittedTransactionTypes(body)).toEqual([MAINTENANCE_TRANSACTION_TYPE])
    expect(body).not.toContain(`type: "${SPONSOR_TRANSACTION_TYPE}"`)
  })

  it("a whole-file check would NOT have been enough - each type lives in exactly one writer", () => {
    // Both strings exist in the file, which is why file-scope proves nothing.
    expect(settlementSource).toContain(`type: "${SPONSOR_TRANSACTION_TYPE}"`)
    expect(settlementSource).toContain(`type: "${MAINTENANCE_TRANSACTION_TYPE}"`)
    // Scoped, each appears in its own writer and NOT in the other's.
    const sponsorBody = exportedFunctionBody(settlementSource, "settleSponsorWeek")
    const maintenanceBody = exportedFunctionBody(settlementSource, "settleMaintenanceWeek")
    expect(sponsorBody).not.toBe(maintenanceBody)
    expect(emittedTransactionTypes(sponsorBody)).not.toEqual(emittedTransactionTypes(maintenanceBody))
  })

  it("introduces NO second source of truth for transaction types", () => {
    // The catalog is declared once, in economy/service.ts.
    const service = readFileSync(join(ROOT, "src/lib/economy/service.ts"), "utf8")
    expect(service).toContain("export const FINANCIAL_TRANSACTION_TYPES")
    const core = readFileSync(join(ROOT, "src/lib/economy/first-baseline.ts"), "utf8")
    expect(core).toContain('import type { FinancialTransactionType } from "./service"')
    expect(core).not.toContain("FINANCIAL_TRANSACTION_TYPES = [")
    expect(runner).not.toContain("FINANCIAL_TRANSACTION_TYPES = [")
  })
})

describe("the raw SQL inventory is FAIL CLOSED across every Prisma raw API", () => {
  /**
   * The inventory recognises $queryRaw and Prisma.sql. Prisma has other raw
   * entry points, and a query introduced through one of those would execute in
   * Production while silently escaping this audit - so each is asserted absent
   * BY NAME. If one is ever added deliberately, this test fails first and the
   * inventory must be extended to recognise it.
   */
  const UNREVIEWED_RAW_APIS = ["$queryRawUnsafe", "$executeRawUnsafe", "$executeRaw"] as const

  it.each(UNREVIEWED_RAW_APIS)("the runner contains ZERO uses of %s", (api) => {
    expect((runnerCode.match(new RegExp(`\\${api}\\b`, "g")) ?? []).length).toBe(0)
  })

  it("every raw form present is accounted for - as a template, or as the one executor of templates", () => {
    // TEMPLATE FORMS are what the inventory parses: $queryRaw`...` and
    // Prisma.sql`...`.
    const queryRawTemplates = (runnerCode.match(/\$queryRaw(?:<[^>]*>)?`/g) ?? []).length
    const prismaSqlTemplates = (runnerCode.match(/Prisma\.sql`/g) ?? []).length
    expect(queryRawTemplates + prismaSqlTemplates).toBe(rawStatements().length)

    // ONE NON-TEMPLATE $queryRaw EXISTS and is not an escape hatch: countScalar
    // is a helper whose argument is a Prisma.Sql its CALLERS build with
    // Prisma.sql`...` - and every one of those templates is already in the
    // inventory above. It composes inventoried SQL; it cannot introduce new SQL.
    const allQueryRaw = (runnerCode.match(/\$queryRaw\b/g) ?? []).length
    expect(allQueryRaw - queryRawTemplates).toBe(1)
    expect(runnerCode).toMatch(/async function countScalar\(tx: Tx, sql: Prisma\.Sql\): Promise<number> \{\s*const rows = await tx\.\$queryRaw<\{ n: bigint \}\[\]>\(sql\)/)
  })

  it("the claim 'every raw statement is inventoried' is therefore honest", () => {
    // Every Prisma raw entry point appearing in the runner is $queryRaw. No
    // execute form, no Unsafe form, so there is no raw SQL outside the twenty.
    const anyRaw = (runnerCode.match(/\$(?:query|execute)Raw(?:Unsafe)?\b/g) ?? []).length
    const queryRawOnly = (runnerCode.match(/\$queryRaw\b/g) ?? []).length
    expect(anyRaw).toBe(queryRawOnly)
  })
})

describe("no measurement is quietly downgraded", () => {
  it("the transaction body catches nothing - an unreadable measurement aborts the baseline", () => {
    // Bounded to the $transaction call itself. main().catch(...) at the end of
    // the file is the process-level handler, not a swallowed measurement.
    const start = runnerCode.indexOf("await prisma.$transaction(")
    const end = runnerCode.indexOf("{ timeout:", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(runnerCode.slice(start, end)).not.toMatch(/\.catch\(/)
  })

  it("the gate's reads turn an error into null, and the gate refuses on null", () => {
    // .catch(() => null) before the transaction is not "ignore" - null is a
    // refusal in evaluateFirstBaselineGate, tested in first-baseline.test.ts.
    const gateSection = runner.slice(0, runner.indexOf("await prisma.$transaction("))
    expect(gateSection).toMatch(/\.catch\(\(\) => null\)/)
  })

  it("every side-effect measurement the contract names is still computed", () => {
    for (const field of [
      "teamBalanceSum",
      "teamBalanceDigest",
      "playerSalarySum",
      "playerOwnershipDigest",
      "playerCareerStatusDigest",
      "fixtureDigest",
      "financialTransactionCount",
      "financialTransactionNet",
      "financialTransactionDigest",
      "sponsorSettlementCount",
      "maintenanceSettlementCount",
      "repricingMarkerDigest",
      "seasonDigest",
    ]) {
      expect(runner).toContain(`${field}:`)
    }
  })
})
