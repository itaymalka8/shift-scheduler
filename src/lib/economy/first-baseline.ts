/**
 * THE STRICT FIRST BASELINE - the one irreversible transaction that creates
 * TeamEconomicState history for a league that has none.
 *
 * WHY THIS IS NOT prod:economy:baseline. That command is IDEMPOTENT by design:
 * it computes which clubs already have history, skips them, and reports PASS
 * once coverage is complete however it got there. That is the right shape for a
 * re-run, a repair, or a verification pass - and the wrong shape for the FIRST
 * write, because "complete coverage" and "this run established the league's
 * history" are different claims. A first baseline that silently skipped a club
 * whose history appeared from somewhere else would report the same PASS.
 *
 * So the first run is a SEPARATE, STRUCTURALLY DIFFERENT command. It does not
 * skip. It does not tolerate a pre-existing row. It asserts an exact shape
 * before it writes, an exact shape before it commits, and refuses on anything
 * else. Its contract is:
 *
 *     starting rows 0 -> exactly 60 clubs -> exactly 60 rows inserted ->
 *     final rows 60 -> coverage 60/60 -> every row version 1, reason baseline
 *
 * ONE TRANSACTION, ALL OR NOTHING. The idempotent command uses one short
 * transaction per club, which is correct for a resumable repair and wrong here:
 * a first baseline that commits 37 of 60 rows leaves the league in a state no
 * contract describes, and the 23 missing clubs would then be "baselined" later
 * at a different instant with a different roster. There is no partial first
 * baseline. Either all sixty rows commit together or none does.
 *
 * THE LOCK ORDER, AND WHY IT IS THE PROJECT'S EXISTING ONE. This module
 * introduces no new locking system. It takes the two barriers the codebase
 * already defines, in the order activation-lock.ts documents as global:
 *
 *     goalx:phase3r:activation (EXCLUSIVE)
 *       -> goalx:economy:history (EXCLUSIVE)
 *         -> per-club lockTeamRoster, ascending club id
 *
 * The activation barrier comes first because activation-lock.ts states it is
 * "the FIRST lock any transaction takes - before goalx:economy:history, before
 * Team rows, before Player rows". A baseline that took the history lock first
 * would be the single path in the codebase violating that, and it also makes
 * the "activation is still in the future" assertion race-free against the
 * crossing rather than merely probable.
 *
 * WHAT THE EXCLUSIVE HISTORY BARRIER BUYS. Every appender in the codebase takes
 * that lock SHARED as its first economy statement, and shared excludes
 * exclusive. So while this transaction holds it, no registration, promotion,
 * purchase, release, replenishment or lifecycle append can commit a row. That
 * closes the window the per-club design leaves open: read coverage, a club
 * appends, the loop reaches that club, sees a row, skips it - and finishes with
 * complete coverage but fewer than sixty baseline rows.
 *
 * THE WRITE-CRITICAL CHECKS ARE RE-READ INSIDE THE BARRIER. Nothing measured
 * before the locks were held is trusted for a decision to write. Club count,
 * row count and distinct coverage are all read again after the barrier is
 * acquired, because only then are they stable for the rest of the transaction.
 *
 * NO NEW INSERT PATH. Rows are written through appendTeamEconomicState, the
 * same primitive every runtime appender uses, with no caller-supplied
 * effectiveAt - so the database clock, taken after the locks, remains the
 * ordering authority exactly as state-history.ts describes.
 */
import { PHASE_3R_ACTIVATION_START } from "./config"
import type { FinancialTransactionType } from "./service"

/** Exactly forty lowercase hex characters. Anything else is not a commit id. */
const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * THE TWO SETTLEMENT TYPES THE SIDE-EFFECT DIGEST COUNTS.
 *
 * TYPED AGAINST THE CANONICAL CATALOG, NOT RESTATED. FinancialTransactionType
 * is the union of FINANCIAL_TRANSACTION_TYPES in economy/service.ts - the one
 * place this project names transaction types - so a literal that is not a real
 * type does not compile. That is the whole point: an earlier draft filtered on
 * 'SPONSOR' and 'STADIUM_MAINTENANCE', which are not values this codebase has
 * ever written. Those predicates could not throw; they simply matched nothing,
 * before AND after, so the digest would have compared 0 to 0 and called it
 * proof. A wrong column crashes and is found; a wrong enum value passes and is
 * not, which makes this the more dangerous half of the same defect.
 *
 * The authority is the WRITER: weekly-settlement.ts emits `sponsorIncome` when
 * it credits a sponsor week and `stadiumMaintenance` when it charges upkeep.
 * first-baseline.test.ts asserts these two constants against both the catalog
 * and those writers, so a rename in either place fails the test rather than
 * silently emptying the measurement.
 */
export const SPONSOR_TRANSACTION_TYPE: FinancialTransactionType = "sponsorIncome"
export const MAINTENANCE_TRANSACTION_TYPE: FinancialTransactionType = "stadiumMaintenance"

/**
 * THE APPROVED FIRST-BASELINE CONTRACT. Frozen, and every value is compared
 * with exact equality - never a prefix, never a "starts with", never a
 * normalised or trimmed variant beyond lowercasing a hex SHA.
 */
export const FIRST_BASELINE = Object.freeze({
  targetCommit: "063342e70fe5285aa3de050b7e344c83d51ec459",
  repo: "https://github.com/itaymalka8/goalx-manager",
  branch: "claude/goalx-manager-game-y3ht29",
  cronSchedule: "*/2 * * * *",
  expectedMigrations: 23,
  migration23: "20260906120000_team_economic_state_append_only",
  expectedClubs: 60,
  /** The acknowledged historical orphan. Evidence only - never repaired. */
  orphanFixtureId: "cmtedbpib0001ya9jpzjzevb5",
  orphanTransactionCount: 3,
  orphanNet: 213629,
} as const)

/** One refusal. `code` is stable and greppable; `detail` is what was measured. */
export interface Refusal {
  code: string
  detail: string
}

/** What a Render service reading has to contain for the gate to judge it. Null anywhere means unreadable, which is a refusal. */
export interface ServiceReading {
  repo: string | null
  branch: string | null
  autoDeploy: "on" | "off" | "unknown"
  deployedCommit: string | null
}

/** The seven TeamEconomicState catalog facts. Each is a tri-state: true, false, or null for unreadable. */
export interface CatalogReading {
  tableExists: boolean | null
  teamIdFkOnDeleteRestrict: boolean | null
  uniqueTeamIdVersion: boolean | null
  asOfIndex: boolean | null
  updateTriggerEnabled: boolean | null
  deleteTriggerEnabled: boolean | null
  truncateTriggerEnabled: boolean | null
}

/** Everything measured BEFORE the transaction opens. Every field may be null, and null is always a refusal. */
export interface FirstBaselineReading {
  canonicalHead: string | null
  web: ServiceReading | null
  cron: (ServiceReading & { suspended: boolean | null; schedule: string | null }) | null
  migrationsApplied: number | null
  migrationsTotal: number | null
  migration23Applied: boolean | null
  catalog: CatalogReading | null
  teamCount: number | null
  historyRows: number | null
  historyDistinctTeams: number | null
  now: Date
}

function pushIf(refusals: Refusal[], condition: boolean, code: string, detail: string): void {
  if (condition) refusals.push({ code, detail })
}

/** Exact, case-normalised SHA equality. A null, a short value or a non-hex value is never equal to anything. */
function sameCommit(actual: string | null, expected: string): boolean {
  if (typeof actual !== "string") return false
  const normalised = actual.trim().toLowerCase()
  return FULL_SHA.test(normalised) && normalised === expected
}

/**
 * THE PRE-WRITE GATE. Fails closed on every axis: an unreadable value is
 * refused identically to a wrong one, because "we could not tell" and "it is
 * wrong" are the same thing to a decision that cannot be taken back.
 */
export function evaluateFirstBaselineGate(
  reading: FirstBaselineReading,
  contract: typeof FIRST_BASELINE = FIRST_BASELINE,
  activationStart: Date = PHASE_3R_ACTIVATION_START
): { ok: boolean; refusals: Refusal[] } {
  const refusals: Refusal[] = []

  // --- 1. THE CANONICAL BRANCH HEAD ---------------------------------------
  pushIf(
    refusals,
    !sameCommit(reading.canonicalHead, contract.targetCommit),
    "CANONICAL_HEAD",
    `canonical head=${reading.canonicalHead ?? "unreadable"} expected=${contract.targetCommit}`
  )

  // --- 2. THE TWO SERVICES ------------------------------------------------
  for (const [name, service] of [
    ["web", reading.web],
    ["cron", reading.cron],
  ] as const) {
    if (!service) {
      refusals.push({ code: `${name.toUpperCase()}_UNREADABLE`, detail: `${name} service could not be read` })
      continue
    }
    pushIf(refusals, service.repo !== contract.repo, `${name.toUpperCase()}_SOURCE`, `${name} repo=${service.repo ?? "unreadable"} expected=${contract.repo}`)
    pushIf(refusals, service.branch !== contract.branch, `${name.toUpperCase()}_BRANCH`, `${name} branch=${service.branch ?? "unreadable"} expected=${contract.branch}`)
    pushIf(refusals, service.autoDeploy !== "off", `${name.toUpperCase()}_AUTO_DEPLOY`, `${name} autoDeploy=${service.autoDeploy} expected=off`)
    pushIf(
      refusals,
      !sameCommit(service.deployedCommit, contract.targetCommit),
      `${name.toUpperCase()}_COMMIT`,
      `${name} deployed=${service.deployedCommit ?? "unreadable"} expected=${contract.targetCommit}`
    )
  }

  // WEB EQUALS CRON, asserted separately rather than inferred from the two
  // checks above: if the contract commit were ever wrong, this still says
  // whether the league is at least running one coherent build.
  if (reading.web && reading.cron) {
    const web = reading.web.deployedCommit
    const cron = reading.cron.deployedCommit
    pushIf(refusals, web === null || cron === null || web !== cron, "WEB_CRON_DIVERGED", `web=${web ?? "unreadable"} cron=${cron ?? "unreadable"}`)
  }

  // --- 3. CRON IS ACTIVE, ON ITS APPROVED SCHEDULE ------------------------
  if (reading.cron) {
    pushIf(refusals, reading.cron.suspended !== false, "CRON_NOT_ACTIVE", `cron suspended=${reading.cron.suspended ?? "unreadable"} expected=false`)
    pushIf(
      refusals,
      reading.cron.schedule !== contract.cronSchedule,
      "CRON_SCHEDULE",
      `cron schedule=${reading.cron.schedule ?? "unreadable"} expected=${contract.cronSchedule}`
    )
  }

  // --- 4. MIGRATIONS ------------------------------------------------------
  pushIf(
    refusals,
    reading.migrationsApplied !== contract.expectedMigrations || reading.migrationsTotal !== contract.expectedMigrations,
    "MIGRATIONS",
    `applied=${reading.migrationsApplied ?? "unreadable"}/${reading.migrationsTotal ?? "unreadable"} expected=${contract.expectedMigrations}/${contract.expectedMigrations}`
  )
  pushIf(refusals, reading.migration23Applied !== true, "MIGRATION_23", `${contract.migration23} applied=${reading.migration23Applied ?? "unreadable"}`)

  // --- 5. THE SEVEN-POINT CATALOG ----------------------------------------
  if (!reading.catalog) {
    refusals.push({ code: "CATALOG_UNREADABLE", detail: "TeamEconomicState catalog could not be read" })
  } else {
    const parts: [keyof CatalogReading, string][] = [
      ["tableExists", "CATALOG_TABLE"],
      ["teamIdFkOnDeleteRestrict", "CATALOG_FK_RESTRICT"],
      ["uniqueTeamIdVersion", "CATALOG_UNIQUE_TEAM_VERSION"],
      ["asOfIndex", "CATALOG_AS_OF_INDEX"],
      ["updateTriggerEnabled", "CATALOG_UPDATE_TRIGGER"],
      ["deleteTriggerEnabled", "CATALOG_DELETE_TRIGGER"],
      ["truncateTriggerEnabled", "CATALOG_TRUNCATE_TRIGGER"],
    ]
    for (const [field, code] of parts) {
      pushIf(refusals, reading.catalog[field] !== true, code, `${field}=${reading.catalog[field] ?? "unreadable"} expected=true`)
    }
  }

  // --- 6. ACTIVATION IS STILL AHEAD --------------------------------------
  pushIf(
    refusals,
    !(reading.now.getTime() < activationStart.getTime()),
    "ACTIVATION_NOT_FUTURE",
    `now=${reading.now.toISOString()} activation=${activationStart.toISOString()}`
  )

  // --- 7. THE FIRST-RUN SHAPE, and this is what makes it a FIRST baseline --
  pushIf(refusals, reading.teamCount !== contract.expectedClubs, "CLUB_COUNT", `clubs=${reading.teamCount ?? "unreadable"} expected=${contract.expectedClubs}`)
  pushIf(refusals, reading.historyRows !== 0, "HISTORY_NOT_EMPTY", `TeamEconomicState rows=${reading.historyRows ?? "unreadable"} expected=0`)
  pushIf(
    refusals,
    reading.historyDistinctTeams !== 0,
    "HISTORY_COVERAGE_NOT_ZERO",
    `distinct covered teams=${reading.historyDistinctTeams ?? "unreadable"} expected=0`
  )

  return { ok: refusals.length === 0, refusals }
}

// ---------------------------------------------------------------------------
// THE TRANSACTION
// ---------------------------------------------------------------------------

/** One inserted row, as the append primitive reported it. */
export interface InsertedRow {
  teamId: string
  version: number
  reason: string
  effectiveAt: Date
}

/**
 * THE FORBIDDEN-SIDE-EFFECT DIGEST. The baseline establishes history and
 * nothing else, so every one of these must be byte-identical before and after.
 *
 * Counts, sums and deterministic digests only - never row contents. A proof
 * that nothing moved does not require reading what anything is.
 */
export interface SideEffectDigest {
  teamBalanceSum: number
  teamBalanceDigest: string
  playerSalarySum: number
  playerOwnershipDigest: string
  playerCareerStatusDigest: string
  fixtureDigest: string
  financialTransactionCount: number
  financialTransactionNet: number
  financialTransactionDigest: string
  sponsorSettlementCount: number
  maintenanceSettlementCount: number
  repricingMarkerDigest: string
  seasonDigest: string
}

/** The acknowledged historical orphan, as evidence. Never repaired, never balanced. */
export interface OrphanReading {
  fixtureId: string
  transactionCount: number
  net: number
}

/**
 * HOW A MATCH'S LEDGER ROWS ARE IDENTIFIED, and why it is not a foreign key.
 *
 * FinancialTransaction has NO fixtureId column. Its canonical columns are
 * id, teamId, type, amount, description, referenceId, createdAt - and a match's
 * rows are tied to their fixture through the referenceId NAMESPACE that
 * match/simulate.ts writes:
 *
 *     MATCH_<fixtureId>_HOME_REVENUE
 *     MATCH_<fixtureId>_HOME_EXPENSE
 *     MATCH_<fixtureId>_AWAY_TRAVEL
 *     MATCH_<fixtureId>_FAN_INCIDENT
 *
 * THE TRAILING UNDERSCORE IS LOAD-BEARING. Without it the prefix would also
 * match any fixture whose id merely STARTS WITH the orphan's id, which would
 * quietly fold another match's ledger into this one's evidence.
 *
 * A PREFIX, NEVER A SUBSTRING. `LIKE '%...%'` would match a referenceId that
 * merely mentions the fixture anywhere - including a namespace invented later -
 * so the check would silently widen. A prefix over a namespace that is built by
 * concatenation is exactly as precise as the namespace itself.
 *
 * IT COUNTS THE WHOLE NAMESPACE, not the three known rows. Enumerating the
 * three ids would make an unexpected FOURTH MATCH_ row invisible - and an
 * unexpected fourth row is precisely the kind of drift this gate exists to
 * catch.
 */
export function orphanReferencePrefix(fixtureId: string): string {
  return `MATCH_${fixtureId}_`
}

/**
 * The orphan reading, reduced from rows. The prefix filter is applied HERE as
 * well as in SQL, so the semantics live in one tested place and the query is
 * only the fetch - a query that ever widened would still be narrowed back to
 * the namespace by this function.
 */
export function readOrphanFromRows(fixtureId: string, rows: readonly { referenceId: string; amount: number }[]): OrphanReading {
  const prefix = orphanReferencePrefix(fixtureId)
  const matching = rows.filter((row) => row.referenceId.startsWith(prefix))
  return {
    fixtureId,
    transactionCount: matching.length,
    net: matching.reduce((sum, row) => sum + row.amount, 0),
  }
}

export interface FirstBaselineTxDeps<Tx> {
  /** goalx:phase3r:activation, EXCLUSIVE. The project's documented global first lock. */
  acquireActivationExclusive: (tx: Tx) => Promise<void>
  /** goalx:economy:history, EXCLUSIVE. The barrier that holds off every shared appender. */
  acquireEconomyExclusive: (tx: Tx) => Promise<void>
  /** The club's own roster lock - taken AFTER both barriers, never before. */
  lockTeamRoster: (tx: Tx, teamId: string) => Promise<boolean>
  /** The canonical append primitive. No effectiveAt is ever passed. */
  append: (tx: Tx, input: { teamId: string; reason: "baseline" }) => Promise<{ teamId: string; version: number; effectiveAt: Date }>
  readTeamIdsAscending: (tx: Tx) => Promise<string[]>
  countHistoryRows: (tx: Tx) => Promise<number>
  countDistinctHistoryTeams: (tx: Tx) => Promise<number>
  /** Every row now in the table, for the pre-commit shape assertions. */
  readAllHistoryRows: (tx: Tx) => Promise<InsertedRow[]>
  readSideEffectDigest: (tx: Tx) => Promise<SideEffectDigest>
  readOrphan: (tx: Tx) => Promise<OrphanReading>
  now: () => Date
}

export interface FirstBaselineOutcome {
  inserted: InsertedRow[]
  startingRows: number
  finalRows: number
  distinctCovered: number
  clubs: number
  before: SideEffectDigest
  after: SideEffectDigest
  orphanBefore: OrphanReading
  orphanAfter: OrphanReading
}

/** Thrown for every refusal inside the transaction, so the caller's rollback is the single failure path. */
export class FirstBaselineAbort extends Error {
  constructor(
    readonly code: string,
    detail: string
  ) {
    super(`[${code}] ${detail}`)
    this.name = "FirstBaselineAbort"
  }
}

function digestMismatches(before: SideEffectDigest, after: SideEffectDigest): string[] {
  const keys = Object.keys(before) as (keyof SideEffectDigest)[]
  return keys.filter((key) => before[key] !== after[key]).map((key) => `${key}: ${String(before[key])} -> ${String(after[key])}`)
}

/**
 * THE WHOLE FIRST BASELINE, inside ONE caller-provided transaction.
 *
 * Every failure throws. The caller wraps this in the database transaction, so a
 * throw is a complete rollback and the committed state is exactly zero baseline
 * rows. There is deliberately no retry, no partial commit, and no repair path:
 * a first baseline that failed is a first baseline that did not happen.
 */
export async function runFirstBaselineTransaction<Tx>(
  tx: Tx,
  deps: FirstBaselineTxDeps<Tx>,
  contract: typeof FIRST_BASELINE = FIRST_BASELINE,
  activationStart: Date = PHASE_3R_ACTIVATION_START
): Promise<FirstBaselineOutcome> {
  // 1-2. THE BARRIERS, in the documented global order, BEFORE any roster lock
  // and before any write-critical read.
  await deps.acquireActivationExclusive(tx)
  await deps.acquireEconomyExclusive(tx)

  // 3. RE-READ EVERY WRITE-CRITICAL FACT UNDER THE BARRIER. The gate ran
  // outside this transaction; those readings proved it was worth opening one,
  // and prove nothing about the instant the rows are written.
  const startingRows = await deps.countHistoryRows(tx)
  if (startingRows !== 0) throw new FirstBaselineAbort("HISTORY_NOT_EMPTY_IN_TX", `TeamEconomicState rows=${startingRows} expected=0`)

  const startingCovered = await deps.countDistinctHistoryTeams(tx)
  if (startingCovered !== 0) throw new FirstBaselineAbort("HISTORY_COVERAGE_NOT_ZERO_IN_TX", `distinct covered teams=${startingCovered} expected=0`)

  const teamIds = await deps.readTeamIdsAscending(tx)
  if (teamIds.length !== contract.expectedClubs) {
    throw new FirstBaselineAbort("CLUB_COUNT_IN_TX", `clubs=${teamIds.length} expected=${contract.expectedClubs}`)
  }

  const now = deps.now()
  if (!(now.getTime() < activationStart.getTime())) {
    throw new FirstBaselineAbort("ACTIVATION_NOT_FUTURE_IN_TX", `now=${now.toISOString()} activation=${activationStart.toISOString()}`)
  }

  // 4. THE BEFORE PICTURE, taken inside the same protected transaction so the
  // comparison at the end attributes only this transaction's own effects.
  const before = await deps.readSideEffectDigest(tx)
  const orphanBefore = await deps.readOrphan(tx)

  // 5. THE WRITE. Deterministic ascending club id, one row each, no skips.
  const inserted: InsertedRow[] = []
  for (const teamId of teamIds) {
    if (!(await deps.lockTeamRoster(tx, teamId))) {
      throw new FirstBaselineAbort("TEAM_VANISHED", `club ${teamId} could not be locked`)
    }
    const state = await deps.append(tx, { teamId, reason: "baseline" })
    inserted.push({ teamId: state.teamId, version: state.version, reason: "baseline", effectiveAt: state.effectiveAt })
  }

  // 6. PRE-COMMIT ASSERTIONS - the shape, proved rather than assumed.
  if (inserted.length !== contract.expectedClubs) {
    throw new FirstBaselineAbort("INSERT_COUNT", `inserted=${inserted.length} expected=${contract.expectedClubs}`)
  }

  const finalRows = await deps.countHistoryRows(tx)
  if (finalRows !== contract.expectedClubs) throw new FirstBaselineAbort("FINAL_ROW_COUNT", `rows=${finalRows} expected=${contract.expectedClubs}`)

  const distinctCovered = await deps.countDistinctHistoryTeams(tx)
  if (distinctCovered !== contract.expectedClubs) {
    throw new FirstBaselineAbort("FINAL_COVERAGE", `distinct covered=${distinctCovered} expected=${contract.expectedClubs}`)
  }

  const allRows = await deps.readAllHistoryRows(tx)
  if (allRows.length !== contract.expectedClubs) throw new FirstBaselineAbort("FINAL_ROWS_READBACK", `read back ${allRows.length} rows expected=${contract.expectedClubs}`)

  const seen = new Map<string, number>()
  for (const row of allRows) {
    seen.set(row.teamId, (seen.get(row.teamId) ?? 0) + 1)
    if (row.version !== 1) throw new FirstBaselineAbort("VERSION_NOT_1", `club ${row.teamId} version=${row.version}`)
    if (row.reason !== "baseline") throw new FirstBaselineAbort("REASON_NOT_BASELINE", `club ${row.teamId} reason=${row.reason}`)
    if (!(row.effectiveAt.getTime() < activationStart.getTime())) {
      throw new FirstBaselineAbort("EFFECTIVE_AT_NOT_BEFORE_ACTIVATION", `club ${row.teamId} effectiveAt=${row.effectiveAt.toISOString()}`)
    }
  }
  if (seen.size !== contract.expectedClubs) throw new FirstBaselineAbort("COVERAGE_DISTINCT", `distinct clubs in rows=${seen.size} expected=${contract.expectedClubs}`)
  for (const [teamId, count] of seen) {
    if (count !== 1) throw new FirstBaselineAbort("DUPLICATE_TEAM_HISTORY", `club ${teamId} has ${count} rows`)
  }
  // Every club that exists is covered - not merely sixty distinct ids.
  const insertedIds = new Set(inserted.map((row) => row.teamId))
  for (const teamId of teamIds) {
    if (!insertedIds.has(teamId)) throw new FirstBaselineAbort("CLUB_SKIPPED", `club ${teamId} was not baselined`)
  }

  // 7. NOTHING ELSE MOVED.
  const after = await deps.readSideEffectDigest(tx)
  const drift = digestMismatches(before, after)
  if (drift.length > 0) throw new FirstBaselineAbort("SIDE_EFFECT_DRIFT", drift.join("; "))

  const orphanAfter = await deps.readOrphan(tx)
  if (
    orphanAfter.fixtureId !== orphanBefore.fixtureId ||
    orphanAfter.transactionCount !== orphanBefore.transactionCount ||
    orphanAfter.net !== orphanBefore.net
  ) {
    throw new FirstBaselineAbort(
      "ORPHAN_CHANGED",
      `before ${orphanBefore.transactionCount} rows net ${orphanBefore.net}; after ${orphanAfter.transactionCount} rows net ${orphanAfter.net}`
    )
  }
  // The orphan is historical truth, so it must also still BE what the record
  // says it is - a silent drift in the acknowledged figures is as much a
  // failure as the baseline having moved them.
  if (
    orphanAfter.fixtureId !== contract.orphanFixtureId ||
    orphanAfter.transactionCount !== contract.orphanTransactionCount ||
    orphanAfter.net !== contract.orphanNet
  ) {
    throw new FirstBaselineAbort(
      "ORPHAN_NOT_HISTORICAL_TRUTH",
      `fixture=${orphanAfter.fixtureId} rows=${orphanAfter.transactionCount} net=${orphanAfter.net}; expected ${contract.orphanFixtureId} / ${contract.orphanTransactionCount} / ${contract.orphanNet}`
    )
  }

  return { inserted, startingRows, finalRows, distinctCovered, clubs: teamIds.length, before, after, orphanBefore, orphanAfter }
}

/**
 * THE SECOND BASELINE IS A DIFFERENT QUESTION, ASKED READ-ONLY.
 *
 * After the first baseline commits, the required second result is "0 new rows,
 * 60/60 coverage". That is a VERIFICATION, not a write, so this is a pure
 * predicate over a reading - there is deliberately no second write path in this
 * module to run by accident.
 */
export function evaluateSecondBaselineVerification(
  reading: { historyRows: number | null; historyDistinctTeams: number | null; teamCount: number | null; rowsWritten: number },
  contract: typeof FIRST_BASELINE = FIRST_BASELINE
): { ok: boolean; refusals: Refusal[] } {
  const refusals: Refusal[] = []
  pushIf(refusals, reading.rowsWritten !== 0, "SECOND_BASELINE_WROTE_ROWS", `rows written=${reading.rowsWritten} expected=0`)
  pushIf(refusals, reading.teamCount !== contract.expectedClubs, "CLUB_COUNT", `clubs=${reading.teamCount ?? "unreadable"} expected=${contract.expectedClubs}`)
  pushIf(refusals, reading.historyRows !== contract.expectedClubs, "HISTORY_ROWS", `rows=${reading.historyRows ?? "unreadable"} expected=${contract.expectedClubs}`)
  pushIf(
    refusals,
    reading.historyDistinctTeams !== contract.expectedClubs,
    "HISTORY_COVERAGE",
    `distinct covered=${reading.historyDistinctTeams ?? "unreadable"} expected=${contract.expectedClubs}`
  )
  return { ok: refusals.length === 0, refusals }
}
