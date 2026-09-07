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
 * The declared FIELD NAMES of one Prisma model, read out of schema.prisma.
 * Relation fields are included: they are declared names, and excluding them
 * would be a judgement this test has no reason to make.
 */
function modelFields(model: string): Set<string> {
  const start = schema.indexOf(`model ${model} {`)
  if (start < 0) throw new Error(`model ${model} not found in schema.prisma`)
  const body = schema.slice(start, schema.indexOf("\n}", start))
  const names = body
    .split("\n")
    .slice(1)
    .map((line) => /^\s{2}(\w+)\s/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name))
  return new Set(names)
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
    expect(modelFields(model).size).toBeGreaterThan(0)
  })

  it("no application query names a column its model does not declare", () => {
    const offenders: string[] = []
    for (const statement of rawStatements()) {
      const relation = statement.relation
      if (!relation || !([...APPLICATION_MODELS] as string[]).includes(relation)) continue
      const fields = modelFields(relation)
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

describe("the exact identifiers that failed before", () => {
  it("NEVER references FinancialTransaction.fixtureId", () => {
    expect(modelFields("FinancialTransaction").has("fixtureId")).toBe(false)
    expect(runner).not.toMatch(/"fixtureId"/)
  })

  it("NEVER references Fixture.homeGoals or Fixture.awayGoals", () => {
    const fixture = modelFields("Fixture")
    expect(fixture.has("homeGoals")).toBe(false)
    expect(fixture.has("awayGoals")).toBe(false)
    expect(runner).not.toMatch(/"homeGoals"/)
    expect(runner).not.toMatch(/"awayGoals"/)
  })

  it("the fixture digest reads exactly id, playedAt, homeScore, awayScore", () => {
    const fixture = modelFields("Fixture")
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

  it("the predicates match what the SPONSOR WRITER actually emits", () => {
    // src/lib/economy/weekly-settlement.ts, settleSponsorWeek
    const settlement = readFileSync(join(ROOT, "src/lib/economy/weekly-settlement.ts"), "utf8")
    expect(settlement).toContain("export async function settleSponsorWeek")
    expect(settlement).toContain(`type: "${SPONSOR_TRANSACTION_TYPE}"`)
  })

  it("the predicates match what the MAINTENANCE WRITER actually emits", () => {
    const settlement = readFileSync(join(ROOT, "src/lib/economy/weekly-settlement.ts"), "utf8")
    expect(settlement).toContain(`type: "${MAINTENANCE_TRANSACTION_TYPE}"`)
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
