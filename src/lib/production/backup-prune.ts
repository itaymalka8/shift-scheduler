/**
 * THE PURE RETENTION POLICY behind `npm run prod:backup:prune`. No network
 * call, no env var, no Neon client - it takes a branch list and a requested
 * allowlist and returns a plan. Every safety rule that decides whether a
 * branch may be deleted lives HERE, where it is testable without an account
 * that can lose data.
 *
 * THE SHAPE OF THE GUARANTEE. This module never returns "delete these three
 * of the five you asked for". A plan either passes every gate for every
 * requested branch and lists them all as deletable, or it fails and lists
 * NOTHING as deletable. A partially valid allowlist deletes nothing, because
 * the operator who wrote it was working from a different picture of the
 * account than the one the API just returned, and the safe response to that
 * disagreement is to stop and show them.
 *
 * WHAT IS PRODUCTION IS NOT DECIDED HERE BY NAME. The caller passes
 * productionBranchId, resolved through neon-discovery's canonical path
 * (primary flag first, an explicit override second, name only as a last
 * resort that refuses on any ambiguity). A branch merely called
 * "production", or a backup whose name someone edited to look like one, has
 * no bearing on this module's answer.
 *
 * WHY A CHILD-OF-PRODUCTION CHECK ON TOP OF THE NAME. A GoalX pre-deploy
 * backup is by construction a branch created from the production branch
 * (see neon-ops.createBackupBranch). A branch carrying a backup-shaped name
 * that hangs off something else is not one of ours - it may be a branch of a
 * branch, or a restore someone is mid-way through - and the two independent
 * signals have to agree before anything is deletable.
 */
import { parseBackupBranchName } from "./backup-naming"
import type { NeonBranchSummary } from "./neon-client"

/**
 * The retention floor. At least this many pre-deploy backups must survive
 * every prune. Three, not one: one backup is a single point of failure, and
 * a backup taken immediately before a bad deploy is exactly the one whose
 * contents you may not want to restore from.
 */
export const MINIMUM_RETAINED_BACKUPS = 3

export type PruneRefusalCode =
  | "UNKNOWN_BRANCH"
  | "IS_PRODUCTION"
  | "NOT_A_BACKUP"
  | "NOT_CHILD_OF_PRODUCTION"
  | "PROTECTED_NEWEST"
  | "DUPLICATE_REQUEST"

export interface PruneRefusal {
  branchId: string
  code: PruneRefusalCode
  detail: string
}

export interface BackupBranch {
  id: string
  name: string
  createdAt: string
  /** The instant encoded in the branch NAME - when the backup was taken. */
  takenAt: Date
}

export interface PrunePlan {
  ok: boolean
  productionBranchId: string
  /** Every branch on the project that is a genuine pre-deploy backup, newest first. */
  backups: BackupBranch[]
  /** The newest MINIMUM_RETAINED_BACKUPS backups. Never deletable. */
  protectedBackups: BackupBranch[]
  /** Non-empty ONLY when ok === true. */
  deletable: BackupBranch[]
  refusals: PruneRefusal[]
  /** Branches that would remain after executing this plan. */
  totalBranchesAfter: number
  backupsAfter: number
  /** Why the plan as a whole failed, when no individual branch was at fault. */
  reason: string | null
}

/**
 * Newest first, by the instant in the NAME rather than Neon's created_at.
 * The name is what the backup claims to be a snapshot of and is immutable;
 * created_at is metadata that a restore or a rename could in principle
 * reshuffle. Ties break on id so the order is total and deterministic.
 */
function newestFirst(a: BackupBranch, b: BackupBranch): number {
  const byTime = b.takenAt.getTime() - a.takenAt.getTime()
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
}

/** Every branch that is a real GoalX pre-deploy backup of THIS production branch, newest first. */
export function identifyBackups(branches: NeonBranchSummary[], productionBranchId: string): BackupBranch[] {
  const backups: BackupBranch[] = []
  for (const branch of branches) {
    if (branch.id === productionBranchId) continue
    if (branch.parentId !== productionBranchId) continue
    const parsed = parseBackupBranchName(branch.name)
    if (!parsed) continue
    backups.push({ id: branch.id, name: branch.name, createdAt: branch.createdAt, takenAt: parsed.takenAt })
  }
  return backups.sort(newestFirst)
}

export interface PlanBackupPruneInput {
  branches: NeonBranchSummary[]
  productionBranchId: string
  requestedIds: string[]
  minimumRetained?: number
}

export function planBackupPrune({
  branches,
  productionBranchId,
  requestedIds,
  minimumRetained = MINIMUM_RETAINED_BACKUPS,
}: PlanBackupPruneInput): PrunePlan {
  const backups = identifyBackups(branches, productionBranchId)
  const protectedBackups = backups.slice(0, minimumRetained)
  const protectedIds = new Set(protectedBackups.map((b) => b.id))
  const byId = new Map(branches.map((b) => [b.id, b]))
  const backupById = new Map(backups.map((b) => [b.id, b]))

  const fail = (reason: string | null, refusals: PruneRefusal[]): PrunePlan => ({
    ok: false,
    productionBranchId,
    backups,
    protectedBackups,
    deletable: [],
    refusals,
    totalBranchesAfter: branches.length,
    backupsAfter: backups.length,
    reason,
  })

  // A prune with no allowlist is not a prune - there is deliberately no
  // "delete everything eligible" mode.
  if (requestedIds.length === 0) {
    return fail("No branch ids were requested. Pruning requires an explicit allowlist - there is no wildcard prune.", [])
  }

  const refusals: PruneRefusal[] = []
  const accepted: BackupBranch[] = []
  const seen = new Set<string>()

  for (const rawId of requestedIds) {
    const branchId = rawId.trim()

    if (seen.has(branchId)) {
      refusals.push({ branchId, code: "DUPLICATE_REQUEST", detail: "listed more than once in the allowlist" })
      continue
    }
    seen.add(branchId)

    const branch = byId.get(branchId)
    if (!branch) {
      refusals.push({ branchId, code: "UNKNOWN_BRANCH", detail: "no branch with this id exists on the project" })
      continue
    }
    if (branch.id === productionBranchId) {
      refusals.push({ branchId, code: "IS_PRODUCTION", detail: `"${branch.name}" IS THE PRODUCTION BRANCH` })
      continue
    }
    if (!parseBackupBranchName(branch.name)) {
      refusals.push({ branchId, code: "NOT_A_BACKUP", detail: `"${branch.name}" does not match the pre-deploy backup naming convention` })
      continue
    }
    if (branch.parentId !== productionBranchId) {
      refusals.push({
        branchId,
        code: "NOT_CHILD_OF_PRODUCTION",
        detail: `"${branch.name}" is not a child of the production branch (parent=${branch.parentId ?? "none"})`,
      })
      continue
    }
    if (protectedIds.has(branchId)) {
      refusals.push({ branchId, code: "PROTECTED_NEWEST", detail: `"${branch.name}" is among the ${minimumRetained} newest backups, which are always retained` })
      continue
    }

    const backup = backupById.get(branchId)
    // Unreachable in practice - the checks above are exactly identifyBackups'
    // criteria - but a plan that cannot find the row it just validated is
    // a disagreement inside this module, and it fails closed rather than
    // deleting on the strength of a lookup that returned nothing.
    if (!backup) {
      refusals.push({ branchId, code: "NOT_A_BACKUP", detail: "passed the individual checks but is not in the identified backup set" })
      continue
    }
    accepted.push(backup)
  }

  if (refusals.length > 0) {
    return fail(null, refusals)
  }

  const backupsAfter = backups.length - accepted.length
  if (backupsAfter < minimumRetained) {
    return fail(
      `Deleting ${accepted.length} of ${backups.length} backups would leave ${backupsAfter}, below the retention floor of ${minimumRetained}.`,
      []
    )
  }

  return {
    ok: true,
    productionBranchId,
    backups,
    protectedBackups,
    deletable: accepted.sort(newestFirst),
    refusals: [],
    totalBranchesAfter: branches.length - accepted.length,
    backupsAfter,
    reason: null,
  }
}

/**
 * The smallest allowlist that frees `slotsToFree` branch slots: the OLDEST
 * eligible backups, because every one of them is superseded by every backup
 * taken after it. Returns null when the floor makes that impossible - the
 * caller then has to raise the account's branch limit rather than delete
 * its way out.
 *
 * This only ever RECOMMENDS. Nothing deletes on its output without an
 * operator putting those exact ids back in as an explicit allowlist.
 */
export function recommendPruneCandidates(
  branches: NeonBranchSummary[],
  productionBranchId: string,
  slotsToFree: number,
  minimumRetained: number = MINIMUM_RETAINED_BACKUPS
): BackupBranch[] | null {
  const backups = identifyBackups(branches, productionBranchId)
  const eligible = backups.slice(minimumRetained)
  if (slotsToFree <= 0 || slotsToFree > eligible.length) return null
  // Oldest first, take as many as needed.
  return eligible.slice(-slotsToFree).sort(newestFirst)
}

/** The backups taken AFTER this one - the recovery points that supersede it. */
export function supersededBy(backups: BackupBranch[], candidate: BackupBranch): BackupBranch[] {
  return backups.filter((b) => b.takenAt.getTime() > candidate.takenAt.getTime())
}

/** Distinct UTC days covered by a set of backups - the "different deployment points" check. */
export function distinctBackupDays(backups: BackupBranch[]): string[] {
  return [...new Set(backups.map((b) => b.name.slice("pre-deploy-goalx-".length, "pre-deploy-goalx-".length + 10)))].sort()
}

export interface PostPruneVerification {
  ok: boolean
  checks: { name: string; ok: boolean; detail: string }[]
}

export interface VerifyPostPruneInput {
  branchesAfter: NeonBranchSummary[]
  productionBranchIdBefore: string
  productionBranchIdAfter: string
  deletedIds: string[]
  minimumRetained?: number
  /** Neon's branch limit for the project, when known - proves capacity was actually freed. */
  branchLimit?: number | null
  branchesBefore: number
}

/**
 * Runs AFTER real deletions, against a FRESH list from the API - never
 * against the plan's own expectations. A prune that deleted successfully but
 * cannot then prove Production is still there, still has the same id, and
 * still has its retained backups is reported as a FAILURE even though every
 * DELETE returned 200.
 */
export function verifyPostPrune({
  branchesAfter,
  productionBranchIdBefore,
  productionBranchIdAfter,
  deletedIds,
  minimumRetained = MINIMUM_RETAINED_BACKUPS,
  branchLimit = null,
  branchesBefore,
}: VerifyPostPruneInput): PostPruneVerification {
  const checks: { name: string; ok: boolean; detail: string }[] = []
  const production = branchesAfter.find((b) => b.id === productionBranchIdBefore)

  checks.push({
    name: "Production branch exists",
    ok: production !== undefined,
    detail: production ? `${production.name} (${production.id})` : `NO branch with id ${productionBranchIdBefore} in the post-prune list`,
  })

  checks.push({
    name: "Production branch id unchanged",
    ok: productionBranchIdAfter === productionBranchIdBefore,
    detail:
      productionBranchIdAfter === productionBranchIdBefore
        ? productionBranchIdBefore
        : `RESOLVED TO A DIFFERENT BRANCH: before=${productionBranchIdBefore} after=${productionBranchIdAfter}`,
  })

  const survivors = deletedIds.filter((id) => branchesAfter.some((b) => b.id === id))
  checks.push({
    name: "Every requested branch is gone",
    ok: survivors.length === 0,
    detail: survivors.length === 0 ? `${deletedIds.length} deleted` : `STILL PRESENT: ${survivors.join(", ")}`,
  })

  const remainingBackups = identifyBackups(branchesAfter, productionBranchIdBefore)
  checks.push({
    name: `At least ${minimumRetained} backups retained`,
    ok: remainingBackups.length >= minimumRetained,
    detail: `${remainingBackups.length} backup(s): ${remainingBackups.map((b) => b.name).join(", ") || "none"}`,
  })

  const freed = branchesBefore - branchesAfter.length
  checks.push({
    name: "Branch count fell by the number deleted",
    ok: freed === deletedIds.length,
    detail: `${branchesBefore} -> ${branchesAfter.length} (freed ${freed}, expected ${deletedIds.length})`,
  })

  if (branchLimit !== null) {
    checks.push({
      name: "Room for at least one new backup",
      ok: branchesAfter.length < branchLimit,
      detail: `${branchesAfter.length}/${branchLimit} branches used`,
    })
  }

  return { ok: checks.every((c) => c.ok), checks }
}

export interface PruneArgs {
  branchIds: string[]
  execute: boolean
  slotsToFree: number
}

/**
 * DRY RUN IS THE DEFAULT AND execute IS OPT-IN. Nothing about an absent
 * flag, an unparseable argument, or an unrecognised env value can turn
 * execute on - it flips true only for the literal `--execute` flag or the
 * literal env string "true".
 *
 * PRUNE_BRANCH_IDS / PRUNE_EXECUTE exist for the GitHub Actions path, where
 * threading argv through `npm run` is awkward. Flags win over env.
 */
export function parsePruneArgs(argv: string[], env: Record<string, string | undefined>): PruneArgs {
  const branchIds: string[] = []
  let execute = false
  let slotsToFree = Number(env.PRUNE_SLOTS_TO_FREE ?? 3)

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--execute") execute = true
    else if (arg === "--branch" || arg === "--branches") branchIds.push(...splitBranchIds(argv[++i] ?? ""))
    else if (arg.startsWith("--branches=")) branchIds.push(...splitBranchIds(arg.slice("--branches=".length)))
    else if (arg.startsWith("--branch=")) branchIds.push(...splitBranchIds(arg.slice("--branch=".length)))
    else if (arg.startsWith("--slots=")) slotsToFree = Number(arg.slice("--slots=".length))
  }

  if (branchIds.length === 0 && env.PRUNE_BRANCH_IDS) branchIds.push(...splitBranchIds(env.PRUNE_BRANCH_IDS))
  if (!execute && env.PRUNE_EXECUTE === "true") execute = true
  if (!Number.isFinite(slotsToFree) || slotsToFree < 1) slotsToFree = 3

  return { branchIds, execute, slotsToFree }
}

function splitBranchIds(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
