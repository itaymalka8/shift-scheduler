/**
 * THE PHYSICAL DATABASE COLUMN AUTHORITY - Prisma's DMMF, not a text parse.
 *
 * WHY THIS EXISTS AS A MODULE. Three defects of one class reached Production
 * tooling: two raw queries named columns that do not exist
 * (FinancialTransaction."fixtureId", Fixture."homeGoals"/"awayGoals" - the
 * second failed Workflow C run 34113346563 with PostgreSQL 42703), and one
 * filtered on transaction-type literals this codebase never writes. The
 * contract test that closed that class was written for a single runner. A
 * SECOND read-only Production runner now issues raw SQL, and a copy of the
 * authority is how the two drift apart - so the authority lives here, once,
 * and every SQL-contract test imports it.
 *
 * WHY DMMF AND NOT schema.prisma TEXT. A Prisma RELATION field is not a
 * PostgreSQL column:
 *
 *     teamId  String              <- a physical column
 *     team    Team @relation(...) <- NOT a column; a client-side navigation
 *
 * An earlier version of the check allowed every declared field, so
 * `SELECT "team" FROM "FinancialTransaction"` satisfied it and would still
 * have failed in Production with undefined_column. Every DMMF field carries a
 * `kind`, and across this datamodel the kinds are exactly `scalar`, `enum` and
 * `object`. Stored columns are the scalar and enum fields; `object` is a
 * relation, in BOTH directions - a back-relation carries no FK and no
 * @relation attribute of its own, so "strip fields with @relation" would have
 * missed it while `kind === "object"` catches it.
 *
 * @map / @@map ARE RESPECTED as `dbName ?? name`. Nothing in this datamodel
 * currently sets one; the contract tests assert that, so the day one does the
 * assertion fails and this code is re-read rather than silently doing the
 * wrong thing.
 */
import { Prisma } from "@/generated/prisma"

type DmmfField = { name: string; kind: string; dbName?: string | null }
type DmmfModel = { name: string; dbName?: string | null; fields: DmmfField[] }

const datamodel = Prisma.dmmf.datamodel.models as unknown as DmmfModel[]

export function dmmfModel(model: string): DmmfModel {
  const found = datamodel.find((candidate) => candidate.name === model)
  if (!found) throw new Error(`model ${model} not found in Prisma DMMF`)
  return found
}

/** The PHYSICAL database columns of one model: scalar and enum fields only, named as the database names them. */
export function physicalColumns(model: string): Set<string> {
  return new Set(
    dmmfModel(model)
      .fields.filter((field) => field.kind === "scalar" || field.kind === "enum")
      .map((field) => field.dbName ?? field.name)
  )
}

/** The physical table name of one model. */
export function physicalTable(model: string): string {
  const found = dmmfModel(model)
  return found.dbName ?? found.name
}

/** The RELATION fields of one model - never valid in raw SQL. */
export function relationFields(model: string): Set<string> {
  return new Set(
    dmmfModel(model)
      .fields.filter((field) => field.kind === "object")
      .map((field) => field.name)
  )
}

/** Every distinct `kind` in the datamodel, so a new one is noticed rather than silently mis-classified. */
export function dmmfFieldKinds(): Set<string> {
  const kinds = new Set<string>()
  for (const model of datamodel) for (const field of model.fields) kinds.add(field.kind)
  return kinds
}

/** True when any model or field in the datamodel carries a @map / @@map. */
export function datamodelUsesDbNames(): boolean {
  return datamodel.some((model) => Boolean(model.dbName) || model.fields.some((field) => Boolean(field.dbName)))
}

/** One raw SQL statement lifted out of a runner, with the relation it reads. */
export interface RawStatement {
  sql: string
  relation: string | null
}

/**
 * Every `$queryRaw` / `Prisma.sql` template literal in a runner's source, with
 * the relation each one reads. EXTRACTED from the source rather than listed by
 * hand, so a NEW query added later is audited automatically instead of
 * escaping the inventory.
 */
export function rawStatements(source: string): RawStatement[] {
  const statements: RawStatement[] = []
  const pattern = /(?:\$queryRaw(?:<[^>]*>)?|Prisma\.sql)`([\s\S]*?)`/g
  for (const match of source.matchAll(pattern)) {
    const sql = match[1]
    const from = /FROM\s+(?:"([A-Za-z_][A-Za-z0-9_]*)"|([a-z_][a-z0-9_]*))/i.exec(sql)
    statements.push({ sql, relation: from ? (from[1] ?? from[2]) : null })
  }
  return statements
}

/** The quoted identifiers inside one statement, minus the relation name itself. */
export function quotedColumns(sql: string, relation: string): string[] {
  return [...sql.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]).filter((name) => name !== relation)
}

/**
 * Every `Relation."column"` in `source` that its Prisma model does not
 * declare as a physical column. An empty array is the passing state.
 */
export function undeclaredColumnUses(source: string, applicationModels: readonly string[]): string[] {
  const offenders: string[] = []
  for (const statement of rawStatements(source)) {
    const relation = statement.relation
    if (!relation || !applicationModels.includes(relation)) continue
    const columns = physicalColumns(relation)
    for (const column of quotedColumns(statement.sql, relation)) {
      if (!columns.has(column)) offenders.push(`${relation}."${column}"`)
    }
  }
  return offenders
}
