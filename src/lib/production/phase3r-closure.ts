/**
 * THE PHASE 3R CLOSURE AUTHORITIES - PURE PREDICATES OVER FRESH READINGS.
 *
 * WHAT THIS MODULE IS FOR. Closure is a claim about Production made at a
 * moment in time: the approved commit is deployed, the append-only machinery
 * exists and is enabled, sixty clubs each have exactly one baseline row, the
 * economy is still frozen ahead of activation, the acknowledged orphan is
 * untouched, and the Neon recovery points that would undo all of it still
 * exist. Every one of those is a MEASUREMENT, so this module holds no database
 * client, no Neon client, no Render client and no network call - it takes what
 * was read and returns a verdict with stable refusal codes.
 *
 * IT COMPOSES, IT DOES NOT RESTATE. The Production environment gate and the
 * per-row / pre-activation / orphan contract already exist in
 * economy/first-baseline.ts and are the same authorities the first and second
 * baselines were judged by. Re-deriving them here would create a second
 * source of truth that could drift from the one Production actually ran, so
 * the closure gate calls them and adds only what closure asks beyond them.
 *
 * THE SAME IS TRUE OF BACKUP RETENTION. identifyBackups and
 * MINIMUM_RETAINED_BACKUPS come from production/backup-prune.ts - the module
 * that decides what may be deleted. A retention audit that counted backups by
 * its own rule could pass while the prune authority disagreed about what a
 * backup even is; asking the same function makes the audit and the deleter
 * incapable of disagreeing.
 *
 * FAIL CLOSED, ALWAYS. Every reading field may be null, and null is a refusal
 * with its own code - never a value substituted for one that could not be
 * read, and never a quiet pass.
 *
 * THIS MODULE NEVER DECIDES CLOSURE. It produces evidence. Declaring Phase 3R
 * closed is a decision taken outside the runner, after independent review.
 */
import {
  evaluateSecondBaselineState,
  evaluateSecondBaselineVerification,
  FIRST_BASELINE,
  type Refusal,
  type SecondBaselineReading,
} from "@/lib/economy/first-baseline"
import { PHASE_3R_ACTIVATION_START } from "@/lib/economy/config"
import { identifyBackups, MINIMUM_RETAINED_BACKUPS, type BackupBranch } from "./backup-prune"
import type { NeonBranchSummary } from "./neon-client"

function pushIf(refusals: Refusal[], condition: boolean, code: string, detail: string): void {
  if (condition) refusals.push({ code, detail })
}

/**
 * THE APPROVED PHASE 3R CLOSURE CONTRACT. Frozen, and compared with exact
 * equality everywhere - never a prefix, never a "contains", never a
 * normalised variant.
 *
 * The activation instant is NOT restated here. It is PHASE_3R_ACTIVATION_START
 * from economy/config.ts, the value the runtime itself switches on; the gate
 * asserts that constant equals the approved instant, so a change to the
 * runtime constant fails closure rather than moving it.
 */
export const PHASE_3R_CLOSURE = Object.freeze({
  /** The approved activation instant, as an ISO string, for exact comparison. */
  activationInstantIso: "2026-09-24T13:00:00.000Z",
  /** The canonical Production branch NAME on GitHub. */
  productionBranchName: "claude/goalx-manager-game-y3ht29",
  /** The Neon branch that IS Production. Identified by id, never by name. */
  neonProductionBranchId: "br-proud-band-b16r2qjs",
  /** The project's branch-count allowance. */
  expectedBranchLimit: 10,
  /** Recovery points that must still exist, as child pre-deploy backups of Production. */
  requiredRecoveryPoints: [
    { id: "br-red-union-b1mmvmgr", name: "pre-deploy-goalx-2026-09-07-0824" },
    { id: "br-dry-river-b1ira70b", name: "pre-deploy-goalx-2026-09-07-0829" },
  ],
} as const)

// ===========================================================================
// 5. NEON BACKUP RETENTION
// ===========================================================================

/** Everything the backup-retention audit measures. Every field may be null, and null always refuses. */
export interface BackupRetentionReading {
  projectId: string | null
  projectName: string | null
  /** The project's branch-count allowance, from the Neon project object. */
  branchLimit: number | null
  /** The full branch inventory. Null means the list could not be read. */
  branches: NeonBranchSummary[] | null
  /** The branch Neon itself reports as Production, resolved through the canonical discovery path. */
  productionBranch: { id: string; name: string; primary: boolean } | null
}

export interface BackupRetentionVerdict {
  ok: boolean
  refusals: Refusal[]
  /** Genuine pre-deploy backups of Production, newest first, per the prune authority. */
  backups: BackupBranch[]
  branchCount: number | null
  branchLimit: number | null
  retentionFloor: number
}

/**
 * NEON BACKUP RETENTION - can Production still be recovered?
 *
 * WHAT "A BACKUP" MEANS IS NOT DECIDED HERE. identifyBackups already requires
 * two independent signals to agree: the pre-deploy naming convention AND being
 * a child of the Production branch. So a branch someone named to look like a
 * backup, or a branch of a branch, cannot be counted - which is exactly why an
 * unrelated branch cannot pad the retention count.
 *
 * THE FLOOR IS IMPORTED, NOT RESTATED. MINIMUM_RETAINED_BACKUPS is the same
 * constant the prune command refuses to go below. A local copy here could
 * drift, and the drift would be invisible: the audit would pass while a prune
 * deleted below what the audit believed was retained.
 */
export function evaluateBackupRetention(
  reading: BackupRetentionReading,
  contract: typeof PHASE_3R_CLOSURE = PHASE_3R_CLOSURE,
  retentionFloor: number = MINIMUM_RETAINED_BACKUPS
): BackupRetentionVerdict {
  const refusals: Refusal[] = []

  pushIf(refusals, reading.projectId === null, "PROJECT_UNREADABLE", "the Neon project could not be read")
  pushIf(refusals, reading.branchLimit === null, "BRANCH_LIMIT_UNREADABLE", "the project's branch limit could not be read")
  pushIf(refusals, reading.branches === null, "BRANCH_INVENTORY_UNREADABLE", "the branch inventory could not be read")
  pushIf(refusals, reading.productionBranch === null, "PRODUCTION_BRANCH_UNREADABLE", "the Production branch could not be resolved")

  // THE PRODUCTION BRANCH, BY ID. A branch merely NAMED production has no
  // bearing here - the id is the identity, and it must be the approved one.
  if (reading.productionBranch) {
    pushIf(
      refusals,
      reading.productionBranch.id !== contract.neonProductionBranchId,
      "PRODUCTION_BRANCH_ID",
      `Neon Production branch is ${reading.productionBranch.id} ("${reading.productionBranch.name}"), expected ${contract.neonProductionBranchId}`
    )
    // ...and it must still be the branch Neon itself serves as primary/default.
    pushIf(
      refusals,
      reading.productionBranch.primary !== true,
      "PRODUCTION_BRANCH_NOT_PRIMARY",
      `${reading.productionBranch.id} is no longer the project's primary/default branch`
    )
  }

  if (reading.branchLimit !== null) {
    pushIf(
      refusals,
      reading.branchLimit !== contract.expectedBranchLimit,
      "BRANCH_LIMIT",
      `project branch limit is ${reading.branchLimit}, expected ${contract.expectedBranchLimit}`
    )
  }

  const branches = reading.branches
  const branchCount = branches ? branches.length : null
  // The prune authority decides what a backup is. This audit only counts them.
  const backups = branches ? identifyBackups(branches, contract.neonProductionBranchId) : []

  if (branches) {
    pushIf(
      refusals,
      !branches.some((branch) => branch.id === contract.neonProductionBranchId),
      "PRODUCTION_BRANCH_ABSENT",
      `${contract.neonProductionBranchId} is not in the project's branch inventory`
    )
    if (reading.branchLimit !== null) {
      pushIf(
        refusals,
        branches.length > reading.branchLimit,
        "BRANCH_COUNT_OVER_LIMIT",
        `${branches.length} branches exceeds the project limit of ${reading.branchLimit}`
      )
    }
    pushIf(
      refusals,
      backups.length < retentionFloor,
      "RETENTION_FLOOR",
      `${backups.length} pre-deploy backup(s) of Production, below the retention floor of ${retentionFloor}`
    )

    // THE NAMED RECOVERY POINTS. Each is checked for existence, then for the
    // three independent facts that make it a usable recovery point: its name,
    // its parent, and its acceptance by the prune authority's own backup test.
    const byId = new Map(branches.map((branch) => [branch.id, branch]))
    const backupIds = new Set(backups.map((backup) => backup.id))
    for (const required of contract.requiredRecoveryPoints) {
      const branch = byId.get(required.id)
      if (!branch) {
        refusals.push({ code: "RECOVERY_POINT_MISSING", detail: `required recovery point ${required.id} ("${required.name}") no longer exists` })
        continue
      }
      pushIf(refusals, branch.name !== required.name, "RECOVERY_POINT_NAME", `${required.id} is named "${branch.name}", expected "${required.name}"`)
      pushIf(
        refusals,
        branch.parentId !== contract.neonProductionBranchId,
        "RECOVERY_POINT_NOT_CHILD_OF_PRODUCTION",
        `${required.id} has parent ${branch.parentId ?? "none"}, expected ${contract.neonProductionBranchId}`
      )
      pushIf(
        refusals,
        !backupIds.has(required.id),
        "RECOVERY_POINT_NOT_A_BACKUP",
        `${required.id} is not recognised as a pre-deploy backup of Production by the prune authority`
      )
    }
  }

  return { ok: refusals.length === 0, refusals, backups, branchCount, branchLimit: reading.branchLimit, retentionFloor }
}

// ===========================================================================
// 6. THE FINAL FROZEN CLOSURE GATE
// ===========================================================================

/** Everything the final frozen gate measures, all of it read fresh from Production. */
export interface ClosureReading {
  /**
   * The FULL second-baseline reading: environment gate inputs, the sixty rows
   * themselves, the club roster, the pre-activation counters, the acknowledged
   * orphan, and the strict first-baseline gate evaluated against current state.
   */
  secondBaseline: SecondBaselineReading
  /** The activation instant the RUNTIME is compiled with, so a changed constant fails closure. */
  activationStart: Date
  /** The Production branch name the canonical head was read from. */
  canonicalBranchName: string | null
}

export interface ClosureVerdict {
  ok: boolean
  refusals: Refusal[]
  /**
   * DERIVED, never read from anywhere. "Recovery required" is not a flag any
   * system publishes; it is the judgement that something unexpected was
   * observed. It is exactly the negation of a clean gate, so it is computed
   * from the refusals rather than accepted as an input that could be asserted
   * without evidence.
   */
  recoveryRequired: boolean
  /** The canonical second-baseline verdict, evaluated directly and reported separately. */
  canonicalSecondBaseline: { ok: boolean; refusals: Refusal[] }
}

/**
 * THE FINAL FROZEN PRODUCTION GATE.
 *
 * Composes, in order:
 *
 *   evaluateSecondBaselineState        the environment gate (canonical head,
 *                                      both Render services, migrations,
 *                                      catalog, activation future, 60 clubs),
 *                                      the per-row invariants, the frozen
 *                                      pre-activation zero contract, the
 *                                      acknowledged orphan, and the proof that
 *                                      a second first-baseline could not write
 *   evaluateSecondBaselineVerification the canonical "0 new rows, 60 rows,
 *                                      60/60 coverage" contract, invoked
 *                                      directly on the same fresh reading
 *
 * and adds what only closure asks:
 *
 *   the activation instant is EXACTLY the approved one, read from the runtime
 *     constant rather than from a literal in this file
 *   the canonical head was read from the approved Production BRANCH NAME
 *   recovery is not required
 *
 * THE SECOND BASELINE IS RE-PROVEN, NOT REMEMBERED. Workflow D's historical
 * conclusion is not an input here. The gate reads Production now and requires
 * the same result now; a run that passed yesterday says nothing about a row
 * written since.
 */
export function evaluateFrozenClosureGate(
  reading: ClosureReading,
  contract: typeof PHASE_3R_CLOSURE = PHASE_3R_CLOSURE,
  baselineContract: typeof FIRST_BASELINE = FIRST_BASELINE
): ClosureVerdict {
  // --- THE ACTIVATION INSTANT, BEFORE ANYTHING IS JUDGED AGAINST IT --------
  //
  // Every "before activation" assertion below is only meaningful if activation
  // is where it was approved to be, so the instant is checked first and by
  // exact ISO equality against the RUNTIME constant.
  const refusals: Refusal[] = []
  pushIf(
    refusals,
    reading.activationStart.toISOString() !== contract.activationInstantIso,
    "ACTIVATION_INSTANT_CHANGED",
    `activation is ${reading.activationStart.toISOString()}, approved ${contract.activationInstantIso}`
  )

  pushIf(
    refusals,
    reading.canonicalBranchName !== contract.productionBranchName,
    "PRODUCTION_BRANCH_NAME",
    `canonical head was read from ${reading.canonicalBranchName ?? "an unreadable branch"}, expected ${contract.productionBranchName}`
  )

  // --- THE FULL PRODUCTION STATE, THROUGH THE EXISTING AUTHORITY -----------
  const fullState = evaluateSecondBaselineState(reading.secondBaseline, baselineContract, reading.activationStart)
  refusals.push(...fullState.refusals)

  // --- THE CANONICAL SECOND-BASELINE CONTRACT, INVOKED DIRECTLY ------------
  //
  // rowsWritten is 0 by construction: this gate has no write path at all.
  const canonicalSecondBaseline = evaluateSecondBaselineVerification(
    {
      historyRows: reading.secondBaseline.historyRows,
      historyDistinctTeams: reading.secondBaseline.historyDistinctTeams,
      teamCount: reading.secondBaseline.teamCount,
      rowsWritten: 0,
    },
    baselineContract
  )
  for (const refusal of canonicalSecondBaseline.refusals) {
    if (!refusals.some((existing) => existing.code === refusal.code)) refusals.push(refusal)
  }

  return { ok: refusals.length === 0, refusals, recoveryRequired: refusals.length > 0, canonicalSecondBaseline }
}

/** The approved activation instant as a Date, for callers that want to compare without re-parsing. */
export const APPROVED_ACTIVATION_INSTANT = new Date(PHASE_3R_CLOSURE.activationInstantIso)

/** True when the runtime's activation constant is still the approved instant. */
export function runtimeActivationMatchesContract(): boolean {
  return PHASE_3R_ACTIVATION_START.toISOString() === PHASE_3R_CLOSURE.activationInstantIso
}
