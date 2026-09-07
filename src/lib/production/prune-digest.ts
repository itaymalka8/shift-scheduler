/**
 * THE PRUNE PLAN DIGEST - proof that the destructive run is deleting the plan
 * a human actually read.
 *
 * WHAT IT ADDS THAT THE OTHER GATES DO NOT. The existing gates (explicit
 * allowlist, no wildcard, production branch refused, non-backups refused,
 * newest-N protected, retention floor, PRODUCTION_WRITE_CONFIRM) all answer
 * "is this deletion permissible?". None of them answers "is this the deletion
 * that was reviewed?". An operator handed three ids can execute them without
 * ever having seen the inventory those ids came from, and an allowlist copied
 * from a plan made yesterday looks identical to one made a second ago.
 *
 * The digest binds the ids to the WORLD THEY WERE CHOSEN IN: the project, the
 * production branch, the floor, the COMPLETE branch inventory, each requested
 * branch's own metadata, the protected and retained sets, and the resulting
 * counts. Execution recomputes it from a fresh live inventory and refuses on
 * any difference. So a plan goes stale the moment anything relevant moves - a
 * backup created, a branch deleted by someone else, the floor changed in a
 * deploy - and a stale plan cannot be executed at all.
 *
 * WHY THE WHOLE INVENTORY AND NOT JUST THE COUNTS (schema v2). v1 bound the
 * requested branches, the protected ids, and the before/after COUNTS. That
 * left a same-count substitution uncovered: a retained, non-protected backup
 * disappears and a different one appears, the total is unchanged, the newest-N
 * are unchanged, and the three requested ids and their metadata are unchanged -
 * so the digest matched while the inventory the human reviewed no longer
 * existed. COUNTS ARE NOT IDENTITY. Every branch the API returned is now bound
 * individually, with the role it plays in this plan, so any substitution,
 * disappearance, appearance or metadata edit anywhere in the account moves the
 * digest.
 *
 * WHY IT HASHES A CANONICAL STRUCTURE, NOT THE CONSOLE OUTPUT. Human-formatted
 * output carries incidental detail - column padding, a "3 day(s) ago", the
 * order a Map happened to iterate - and any of it changing would invalidate a
 * plan for no reason, which trains an operator to re-generate digests without
 * reading. The canonical form below has fixed field order, explicitly sorted
 * arrays, and nothing derived from the clock.
 */
import { createHash } from "crypto"
import type { BackupBranch, PrunePlan } from "./backup-prune"
import type { NeonBranchSummary } from "./neon-client"

/**
 * Bumped whenever the canonical shape changes. Part of the hashed payload, so
 * a plan produced by an older build cannot silently validate against a newer
 * one that means something different by the same fields.
 *
 * v1 -> v2: the complete branch inventory is bound, not just the counts.
 */
export const PRUNE_PLAN_SCHEMA_VERSION = 2

/** One requested branch, as the digest sees it. */
export interface CanonicalPruneBranch {
  branchId: string
  name: string
  createdAt: string
  parentId: string | null
}

/**
 * What a branch IS in this plan.
 *
 * "production" and "backup" are decided by the PLAN, never by the name alone -
 * planBackupPrune resolves production through neon-discovery and requires a
 * backup-shaped name AND a child-of-production parent. "other" is everything
 * else on the project, bound because a branch appearing or vanishing changes
 * the account the operator reviewed even when it was never a candidate.
 */
export type CanonicalBranchRole = "production" | "backup" | "other"

export interface CanonicalInventoryBranch {
  branchId: string
  name: string
  createdAt: string
  parentId: string | null
  role: CanonicalBranchRole
  /** Named in the operator's allowlist. */
  requested: boolean
  /** One of the newest MINIMUM_RETAINED_BACKUPS backups - never deletable. */
  isProtected: boolean
  /** Still present after this plan executes. */
  retained: boolean
}

/**
 * The exact structure that gets hashed. Field order here IS the serialization
 * order - see canonicalisePrunePlan, which builds the object key by key rather
 * than spreading, so the output is byte-stable across runs and machines.
 */
export interface CanonicalPrunePlan {
  schemaVersion: number
  projectId: string
  productionBranchId: string
  minimumRetainedBackups: number
  totalBranchesBefore: number
  backupsBefore: number
  /** In the operator's requested order - reordering the request IS a different plan. */
  requestedBranchIds: string[]
  /** Same order as requestedBranchIds. */
  requestedBranches: CanonicalPruneBranch[]
  /** Sorted by id, so the protected set is order-independent. */
  protectedBackupIds: string[]
  /** Sorted by id. The backups that survive this plan. */
  retainedBackupIds: string[]
  /**
   * EVERY branch the API returned, sorted by id. This is the field that makes
   * the plan an IDENTITY rather than a shape.
   */
  inventory: CanonicalInventoryBranch[]
  backupsAfter: number
  totalBranchesAfter: number
}

export interface CanonicalisePrunePlanInput {
  projectId: string
  plan: PrunePlan
  requestedIds: string[]
  minimumRetained: number
  /** The FULL live branch list this plan was built from. */
  branches: NeonBranchSummary[]
}

/**
 * Build the canonical plan.
 *
 * REQUESTED ORDER IS PRESERVED, deliberately. Two operators asking to delete
 * the same three branches in different orders produced their lists from
 * different readings, and the cheapest way to be sure a digest matches the plan
 * a person read is to make the plan's own sequence part of it.
 *
 * EVERY DERIVED SET IS SORTED BY ID, equally deliberately. The protected set,
 * the retained set and the inventory are not chosen by anyone: they are
 * computed, and their order is an artefact of the sort that produced them or of
 * whatever order Neon's API happened to answer in. Sorting by id - not by
 * createdAt, not by name - keeps the order total and independent of every
 * mutable field, so re-listing the same branches can never move the digest
 * while any real change always does.
 *
 * THE TOTAL BRANCH COUNT IS DERIVED FROM THE INVENTORY, not passed alongside
 * it. A count that could disagree with the list it summarises is a second
 * source of truth, and the whole point of v2 is that there is one.
 */
export function canonicalisePrunePlan({
  projectId,
  plan,
  requestedIds,
  minimumRetained,
  branches,
}: CanonicalisePrunePlanInput): CanonicalPrunePlan {
  const requestedSet = new Set(requestedIds)
  const protectedSet = new Set(plan.protectedBackups.map((b: BackupBranch) => b.id))
  const deletedSet = new Set(plan.deletable.map((b: BackupBranch) => b.id))
  const backupSet = new Set(plan.backups.map((b: BackupBranch) => b.id))
  const byId = new Map(branches.map((b) => [b.id, b]))

  const inventory: CanonicalInventoryBranch[] = branches
    .map((b) => ({
      branchId: b.id,
      name: b.name,
      createdAt: b.createdAt,
      parentId: b.parentId,
      role: (b.id === plan.productionBranchId
        ? "production"
        : backupSet.has(b.id)
          ? "backup"
          : "other") as CanonicalBranchRole,
      requested: requestedSet.has(b.id),
      isProtected: protectedSet.has(b.id),
      retained: !deletedSet.has(b.id),
    }))
    .sort((a, b) => a.branchId.localeCompare(b.branchId))

  return {
    schemaVersion: PRUNE_PLAN_SCHEMA_VERSION,
    projectId,
    productionBranchId: plan.productionBranchId,
    minimumRetainedBackups: minimumRetained,
    totalBranchesBefore: branches.length,
    backupsBefore: plan.backups.length,
    requestedBranchIds: [...requestedIds],
    requestedBranches: requestedIds.map((branchId) => {
      const meta = byId.get(branchId)
      return {
        branchId,
        // An id the live inventory does not know is represented explicitly
        // rather than omitted: a plan naming a vanished branch must digest
        // differently from one naming a present branch, not identically to a
        // shorter plan.
        name: meta?.name ?? "",
        createdAt: meta?.createdAt ?? "",
        parentId: meta?.parentId ?? null,
      }
    }),
    protectedBackupIds: [...protectedSet].sort(),
    retainedBackupIds: plan.backups
      .map((b: BackupBranch) => b.id)
      .filter((id) => !deletedSet.has(id))
      .sort(),
    inventory,
    backupsAfter: plan.backupsAfter,
    totalBranchesAfter: plan.totalBranchesAfter,
  }
}

/**
 * Field escaping, so the serialization is INJECTIVE.
 *
 * Without it two different inventories could serialize to the same string by
 * moving a separator into a branch name - one branch called "a|b" against two
 * called "a" and "b". Nobody names a Neon branch that way on purpose, which is
 * exactly why nobody would notice. The backslash is escaped first so the escape
 * itself cannot be forged.
 */
function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\p").replace(/;/g, "\\s").replace(/\n/g, "\\n")
}

/**
 * The canonical serialization. Keys are emitted in the declared order above and
 * arrays exactly as canonicalisePrunePlan ordered them - no JSON.stringify key
 * sorting surprises, no Map iteration, no locale.
 */
export function serialiseCanonicalPrunePlan(canonical: CanonicalPrunePlan): string {
  const parts: string[] = [
    `schemaVersion=${canonical.schemaVersion}`,
    `projectId=${esc(canonical.projectId)}`,
    `productionBranchId=${esc(canonical.productionBranchId)}`,
    `minimumRetainedBackups=${canonical.minimumRetainedBackups}`,
    `totalBranchesBefore=${canonical.totalBranchesBefore}`,
    `backupsBefore=${canonical.backupsBefore}`,
    `requestedBranchIds=[${canonical.requestedBranchIds.map(esc).join(",")}]`,
    `requestedBranches=[${canonical.requestedBranches
      .map((b) =>
        [esc(b.branchId), esc(b.name), esc(b.createdAt), b.parentId === null ? "null" : esc(b.parentId)].join("|")
      )
      .join(";")}]`,
    `protectedBackupIds=[${canonical.protectedBackupIds.map(esc).join(",")}]`,
    `retainedBackupIds=[${canonical.retainedBackupIds.map(esc).join(",")}]`,
    `inventory=[${canonical.inventory
      .map((b) =>
        [
          esc(b.branchId),
          esc(b.name),
          esc(b.createdAt),
          b.parentId === null ? "null" : esc(b.parentId),
          b.role,
          b.requested ? "requested" : "-",
          b.isProtected ? "protected" : "-",
          b.retained ? "retained" : "deleted",
        ].join("|")
      )
      .join(";")}]`,
    `backupsAfter=${canonical.backupsAfter}`,
    `totalBranchesAfter=${canonical.totalBranchesAfter}`,
  ]
  return parts.join("\n")
}

/**
 * SHA-256 over the canonical serialization, hex, lowercase.
 *
 * Printed and compared in full rather than truncated: a shortened digest is
 * easier to read back over a chat window and correspondingly easier to collide
 * by accident when someone pastes the wrong one.
 */
export function computePrunePlanDigest(canonical: CanonicalPrunePlan): string {
  return createHash("sha256").update(serialiseCanonicalPrunePlan(canonical), "utf8").digest("hex")
}

/** Convenience: canonicalise and hash in one step. */
export function prunePlanDigest(input: CanonicalisePrunePlanInput): {
  canonical: CanonicalPrunePlan
  digest: string
} {
  const canonical = canonicalisePrunePlan(input)
  return { canonical, digest: computePrunePlanDigest(canonical) }
}

export type PruneDigestGateDecision =
  | { ok: true; code: null; message: null }
  | { ok: false; code: "DIGEST_MISSING" | "DIGEST_MISMATCH"; message: string }

/**
 * The execute-time gate, as a pure function so it can be proven without a Neon
 * key and without a process that is capable of deleting anything.
 *
 * A MISSING DIGEST IS A REFUSAL, NOT A SKIP. If an absent digest meant "no
 * check to run", the control would be optional in practice: every operator who
 * forgot it would still delete backups, and the one who did supply it would be
 * the only one constrained.
 *
 * The comparison normalises case and surrounding whitespace only. Hex case
 * carries no meaning, and a digest copied out of a terminal picks up spaces;
 * neither difference is a different plan. Everything else - a truncated digest,
 * a digest for another plan, a digest from ten minutes ago - fails.
 */
export function evaluatePruneDigestGate(supplied: string | null, recomputed: string): PruneDigestGateDecision {
  const normalised = supplied?.trim().toLowerCase() ?? ""
  if (normalised.length === 0) {
    return {
      ok: false,
      code: "DIGEST_MISSING",
      message:
        "--plan-digest is required for --execute. Re-run without --execute to obtain the digest, read the plan it describes, then pass that digest back.",
    }
  }
  if (normalised !== recomputed.trim().toLowerCase()) {
    return {
      ok: false,
      code: "DIGEST_MISMATCH",
      message:
        "The supplied plan digest does not match the plan computed from the CURRENT Neon inventory. Something relevant changed since the plan was reviewed - a backup created, removed or substituted, a branch's metadata edited, the retention floor changed, or the id list edited.",
    }
  }
  return { ok: true, code: null, message: null }
}
