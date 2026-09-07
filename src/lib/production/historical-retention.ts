/**
 * THE HISTORICAL RETENTION CONTRACT, as one declarative list.
 *
 * Pure: no Prisma, no I/O. It states what the database must look like, and
 * evaluates a catalogue reading against that statement. The reading itself is
 * done by the caller (scripts/production/verify-historical-retention.ts against
 * Production, a real PostgreSQL in tests), so the same expectations are checked
 * in both places and cannot drift apart.
 *
 * WHY THIS IS NOT READ FROM schema.prisma. schema.prisma is what we asked for;
 * pg_constraint is what we got. A migration that was written wrong, applied
 * partially, or edited by hand in a console would leave the two disagreeing -
 * and the whole point of this phase is that the DATABASE is the authority.
 */

/** The six foreign keys whose ON DELETE must be RESTRICT for history to survive. */
export const RETENTION_FOREIGN_KEYS = [
  { constraint: "Fixture_divisionId_fkey", table: "Fixture", column: "divisionId", target: "Division", onDelete: "RESTRICT" },
  { constraint: "Fixture_homeTeamId_fkey", table: "Fixture", column: "homeTeamId", target: "Team", onDelete: "RESTRICT" },
  { constraint: "Fixture_awayTeamId_fkey", table: "Fixture", column: "awayTeamId", target: "Team", onDelete: "RESTRICT" },
  { constraint: "MatchEvent_teamId_fkey", table: "MatchEvent", column: "teamId", target: "Team", onDelete: "RESTRICT" },
  { constraint: "PlayerMatchStats_playerId_fkey", table: "PlayerMatchStats", column: "playerId", target: "Player", onDelete: "RESTRICT" },
  { constraint: "FinancialTransaction_teamId_fkey", table: "FinancialTransaction", column: "teamId", target: "Team", onDelete: "RESTRICT" },
] as const

/**
 * The two that must STAY CASCADE, asserted as deliberately as the six above.
 *
 * Once a played fixture cannot be deleted, the only fixture left to delete is
 * an unplayed one - which has no events and no stats. Cascading from it is
 * correct, and RESTRICT here would make honest schedule cleanup harder for no
 * gain. Someone "hardening" these later would be undoing a decision, so the
 * verifier says so out loud.
 */
export const DELIBERATE_CASCADES = [
  { constraint: "MatchEvent_fixtureId_fkey", table: "MatchEvent", column: "fixtureId", target: "Fixture", onDelete: "CASCADE" },
  { constraint: "PlayerMatchStats_fixtureId_fkey", table: "PlayerMatchStats", column: "fixtureId", target: "Fixture", onDelete: "CASCADE" },
] as const

/** Account deletion is out of scope, but its protection is re-asserted so a future change cannot quietly drop it. */
export const ACCOUNT_PROTECTION_FOREIGN_KEYS = [
  { constraint: "TeamEra_userId_fkey", table: "TeamEra", column: "userId", target: "User", onDelete: "RESTRICT" },
  { constraint: "TeamEra_teamId_fkey", table: "TeamEra", column: "teamId", target: "Team", onDelete: "RESTRICT" },
] as const

/**
 * Phase 3N's ledger, held to the same standard as everything else above: a
 * season or a club that has been replenished cannot be deleted out from under
 * its own audit row. Re-asserted here, in the retention contract, rather than
 * only in the replenishment contract - because "what may never be deleted" is
 * one question, and it should have one answer in one place.
 */
export const REPLENISHMENT_PROTECTION_FOREIGN_KEYS = [
  { constraint: "SquadReplenishment_seasonId_fkey", table: "SquadReplenishment", column: "seasonId", target: "Season", onDelete: "RESTRICT" },
  { constraint: "SquadReplenishment_teamId_fkey", table: "SquadReplenishment", column: "teamId", target: "Team", onDelete: "RESTRICT" },
] as const

export const FIXTURE_RETENTION_TRIGGER = {
  name: "Fixture_played_no_delete",
  table: "Fixture",
  function: "fixture_played_no_delete",
  timing: "BEFORE",
  event: "DELETE",
  level: "ROW",
  returns: "trigger",
} as const

/** One row of a catalogue reading, exactly as pg_constraint reports it. */
export interface ForeignKeyReading {
  constraint: string
  table: string
  column: string
  target: string
  onDelete: string
}

/** One row of a trigger reading, exactly as pg_trigger + pg_proc report it. */
export interface TriggerReading {
  name: string
  table: string
  function: string
  timing: string
  event: string
  level: string
  /** pg_trigger.tgenabled - "O" is the normal enabled state. */
  enabled: string
  returns: string
}

export interface RetentionCheck {
  label: string
  ok: boolean
  detail: string
}

function compareForeignKeys(
  expected: readonly ForeignKeyReading[],
  actual: ForeignKeyReading[],
  kind: string
): RetentionCheck[] {
  const byName = new Map(actual.map((fk) => [fk.constraint, fk]))
  return expected.map((want) => {
    const got = byName.get(want.constraint)
    if (!got) return { label: `${kind} ${want.constraint}`, ok: false, detail: "CONSTRAINT MISSING from pg_constraint" }
    const mismatches: string[] = []
    if (got.table !== want.table) mismatches.push(`table ${got.table} != ${want.table}`)
    if (got.column !== want.column) mismatches.push(`column ${got.column} != ${want.column}`)
    if (got.target !== want.target) mismatches.push(`target ${got.target} != ${want.target}`)
    if (got.onDelete !== want.onDelete) mismatches.push(`ON DELETE ${got.onDelete} != ${want.onDelete}`)
    return mismatches.length === 0
      ? { label: `${kind} ${want.constraint}`, ok: true, detail: `${got.table}.${got.column} -> ${got.target} ON DELETE ${got.onDelete}` }
      : { label: `${kind} ${want.constraint}`, ok: false, detail: mismatches.join("; ") }
  })
}

function checkTrigger(actual: TriggerReading | null): RetentionCheck[] {
  const want = FIXTURE_RETENTION_TRIGGER
  if (!actual) {
    return [{ label: `trigger ${want.name}`, ok: false, detail: "TRIGGER MISSING from pg_trigger - played fixtures are deletable" }]
  }
  return [
    { label: `trigger ${want.name} exists`, ok: true, detail: `on ${actual.table}` },
    { label: "trigger is on the Fixture table", ok: actual.table === want.table, detail: actual.table },
    { label: "trigger fires BEFORE", ok: actual.timing === want.timing, detail: actual.timing },
    { label: "trigger fires on DELETE", ok: actual.event === want.event, detail: actual.event },
    { label: "trigger is FOR EACH ROW", ok: actual.level === want.level, detail: actual.level },
    // "O" = enabled for origin/local. "D" is disabled; "R"/"A" are replica-only
    // modes, which would leave ordinary deletes unguarded.
    { label: "trigger is enabled (tgenabled=O)", ok: actual.enabled === "O", detail: `tgenabled=${actual.enabled}` },
    { label: "trigger runs the right function", ok: actual.function === want.function, detail: actual.function },
    { label: "trigger function returns trigger", ok: actual.returns === want.returns, detail: actual.returns },
  ]
}

export interface RetentionReadings {
  foreignKeys: ForeignKeyReading[]
  trigger: TriggerReading | null
}

/** Every check, in report order. `ok` on all of them is the whole contract. */
export function evaluateRetention(readings: RetentionReadings): RetentionCheck[] {
  return [
    ...compareForeignKeys(RETENTION_FOREIGN_KEYS, readings.foreignKeys, "FK"),
    ...compareForeignKeys(DELIBERATE_CASCADES, readings.foreignKeys, "deliberate CASCADE"),
    ...compareForeignKeys(ACCOUNT_PROTECTION_FOREIGN_KEYS, readings.foreignKeys, "account protection"),
    ...compareForeignKeys(REPLENISHMENT_PROTECTION_FOREIGN_KEYS, readings.foreignKeys, "replenishment protection"),
    ...checkTrigger(readings.trigger),
  ]
}

export function retentionPasses(checks: RetentionCheck[]): boolean {
  return checks.every((c) => c.ok)
}
