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
 * production branch, the floor, the full inventory counts, each requested
 * branch's own metadata, the protected set, and the resulting counts. Execution
 * recomputes it from a fresh live inventory and refuses on any difference. So a
 * plan goes stale the moment anything relevant moves - a backup created, a
 * branch deleted by someone else, the floor changed in a deploy - and a stale
 * plan cannot be executed at all.
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

/**
 * Bumped whenever the canonical shape changes. Part of the hashed payload, so
 * a plan produced by an older build cannot silently validate against a newer
 * one that means something different by the same fields.
 */
export const PRUNE_PLAN_SCHEMA_VERSION = 1

/** One requested branch, as the digest sees it. */
export interface CanonicalPruneBranch {
  branchId: string
  name: string
  createdAt: string
  parentId: string | null
}

/**
 * The exact structure that gets hashed. Field order here IS the serialization
 * order - see canonicalisePrunePlan, which builds the object key by key rather
 * than spreading, so the JSON is byte-stable across runs and machines.
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
  backupsAfter: number
  totalBranchesAfter: number
}

export interface CanonicalisePrunePlanInput {
  projectId: string
  plan: PrunePlan
  requestedIds: string[]
  minimumRetained: number
  totalBranchesBefore: number
  /** Full live inventory, for each requested branch's own metadata. */
  branchMetadata: Map<string, { name: string; createdAt: string; parentId: string | null }>
}

/**
 * Build the canonical plan.
 *
 * REQUESTED ORDER IS PRESERVED, deliberately. Two operators asking to delete
 * the same three branches in different orders produced their lists from
 * different readings, and the cheapest way to be sure a digest matches the plan
 * a person read is to make the plan's own sequence part of it.
 *
 * THE PROTECTED SET IS SORTED, equally deliberately. It is derived, not chosen:
 * it always means "the newest N", and its iteration order is an artefact of the
 * sort that produced it rather than anything an operator decided.
 */
export function canonicalisePrunePlan({
  projectId,
  plan,
  requestedIds,
  minimumRetained,
  totalBranchesBefore,
  branchMetadata,
}: CanonicalisePrunePlanInput): CanonicalPrunePlan {
  return {
    schemaVersion: PRUNE_PLAN_SCHEMA_VERSION,
    projectId,
    productionBranchId: plan.productionBranchId,
    minimumRetainedBackups: minimumRetained,
    totalBranchesBefore,
    backupsBefore: plan.backups.length,
    requestedBranchIds: [...requestedIds],
    requestedBranches: requestedIds.map((branchId) => {
      const meta = branchMetadata.get(branchId)
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
    protectedBackupIds: plan.protectedBackups.map((b: BackupBranch) => b.id).sort(),
    backupsAfter: plan.backupsAfter,
    totalBranchesAfter: plan.totalBranchesAfter,
  }
}

/**
 * The canonical serialization. Keys are emitted in the declared order above and
 * arrays exactly as canonicalisePrunePlan ordered them - no JSON.stringify key
 * sorting surprises, no Map iteration, no locale.
 */
export function serialiseCanonicalPrunePlan(canonical: CanonicalPrunePlan): string {
  const parts: string[] = [
    `schemaVersion=${canonical.schemaVersion}`,
    `projectId=${canonical.projectId}`,
    `productionBranchId=${canonical.productionBranchId}`,
    `minimumRetainedBackups=${canonical.minimumRetainedBackups}`,
    `totalBranchesBefore=${canonical.totalBranchesBefore}`,
    `backupsBefore=${canonical.backupsBefore}`,
    `requestedBranchIds=[${canonical.requestedBranchIds.join(",")}]`,
    `requestedBranches=[${canonical.requestedBranches
      .map((b) => `${b.branchId}|${b.name}|${b.createdAt}|${b.parentId ?? "null"}`)
      .join(";")}]`,
    `protectedBackupIds=[${canonical.protectedBackupIds.join(",")}]`,
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
        "The supplied plan digest does not match the plan computed from the CURRENT Neon inventory. Something relevant changed since the plan was reviewed - a backup created or removed, the branch set moved, the retention floor changed, or the id list was edited.",
    }
  }
  return { ok: true, code: null, message: null }
}
