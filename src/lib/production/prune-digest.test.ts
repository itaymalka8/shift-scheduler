import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  PRUNE_PLAN_SCHEMA_VERSION,
  canonicalisePrunePlan,
  computePrunePlanDigest,
  evaluatePruneDigestGate,
  prunePlanDigest,
  serialiseCanonicalPrunePlan,
  type CanonicalisePrunePlanInput,
} from "./prune-digest"
import { MINIMUM_RETAINED_BACKUPS, planBackupPrune, parsePruneArgs } from "./backup-prune"
import type { NeonBranchSummary } from "./neon-client"

const ROOT = join(__dirname, "..", "..", "..")
const PROJECT = "sparkling-project-12345678"
const PROD = "br-production-id"

function branch(over: Partial<NeonBranchSummary> & { id: string; name: string }): NeonBranchSummary {
  return { createdAt: "2026-09-03T00:00:00Z", parentId: PROD, primary: false, ...over }
}

const production = branch({ id: PROD, name: "production", parentId: null, primary: true })
const b1 = branch({ id: "br-old-1", name: "pre-deploy-goalx-2026-09-03-1121", createdAt: "2026-09-03T11:21:00Z" })
const b2 = branch({ id: "br-old-2", name: "pre-deploy-goalx-2026-09-03-1544", createdAt: "2026-09-03T15:44:00Z" })
const b3 = branch({ id: "br-old-3", name: "pre-deploy-goalx-2026-09-03-1838", createdAt: "2026-09-03T18:38:00Z" })
const b4 = branch({ id: "br-keep-1", name: "pre-deploy-goalx-2026-09-04-0421", createdAt: "2026-09-04T04:21:00Z" })
const b5 = branch({ id: "br-keep-2", name: "pre-deploy-goalx-2026-09-04-0721", createdAt: "2026-09-04T07:21:00Z" })
const b6 = branch({ id: "br-keep-3", name: "pre-deploy-goalx-2026-09-04-1057", createdAt: "2026-09-04T10:57:00Z" })
// Newer than every requested branch, older than every protected one: retained,
// but NOT protected. The one position where a substitution is invisible to
// counts, the protected set, and the request alike.
const b7 = branch({ id: "br-middle", name: "pre-deploy-goalx-2026-09-03-2000", createdAt: "2026-09-03T20:00:00Z" })

const ALL = [production, b2, b6, b1, b5, b7, b3, b4]
const REQUESTED = [b1.id, b2.id, b3.id]

/** A retained, NON-protected backup - the substitution case's subject. */
const retainedNonProtected = b7

/**
 * Mirrors exactly what scripts/production/backup-prune.ts does: plan from the
 * live inventory, then digest the plan together with that inventory. Every case
 * below perturbs ONE input to this and asserts the digest moved.
 */
function digestOf(
  branches: NeonBranchSummary[] = ALL,
  requestedIds: string[] = REQUESTED,
  over: Partial<CanonicalisePrunePlanInput> = {}
): string {
  const plan = planBackupPrune({ branches, productionBranchId: PROD, requestedIds })
  return prunePlanDigest({
    projectId: PROJECT,
    plan,
    requestedIds,
    minimumRetained: MINIMUM_RETAINED_BACKUPS,
    branches,
    ...over,
  }).digest
}

describe("the plan digest is stable for an unchanged world", () => {
  it("identical inventory and identical request produce an identical digest", () => {
    expect(digestOf()).toBe(digestOf())
  })

  it("is stable when the SAME branches arrive from Neon in a different order", () => {
    // Neon does not promise a list order. A reshuffled response is the same
    // world, so re-listing must not invalidate a plan a human is holding.
    const shuffled = [b4, production, b6, b3, b7, b1, b5, b2]
    expect(digestOf(shuffled)).toBe(digestOf())
  })

  it("is a full 64-character lowercase sha256, printed and compared untruncated", () => {
    expect(digestOf()).toMatch(/^[0-9a-f]{64}$/)
  })

  it("binds nothing derived from the clock", () => {
    // Same inputs, computed at two different instants.
    const first = digestOf()
    jest.useFakeTimers().setSystemTime(new Date("2027-01-01T00:00:00Z"))
    try {
      expect(digestOf()).toBe(first)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe("the plan digest moves when anything it binds moves", () => {
  const baseline = digestOf()

  it("changing one requested branch changes the digest", () => {
    expect(digestOf(ALL, [b1.id, b2.id, b4.id])).not.toBe(baseline)
  })

  it("changing the ORDER of the requested branches changes the digest", () => {
    // Requested order is part of the plan a human read, deliberately.
    expect(digestOf(ALL, [b3.id, b2.id, b1.id])).not.toBe(baseline)
  })

  it("dropping a requested branch changes the digest", () => {
    expect(digestOf(ALL, [b1.id, b2.id])).not.toBe(baseline)
  })

  it("changing a requested branch's own metadata changes the digest", () => {
    const renamed = ALL.map((b) => (b.id === b1.id ? { ...b, createdAt: "2026-09-03T11:22:00Z" } : b))
    expect(digestOf(renamed)).not.toBe(baseline)

    const reparented = ALL.map((b) => (b.id === b2.id ? { ...b, parentId: "br-somewhere-else" } : b))
    expect(digestOf(reparented)).not.toBe(baseline)
  })

  it("a requested id the live inventory no longer knows digests differently from a shorter plan", () => {
    const withUnknown = prunePlanDigest({
      projectId: PROJECT,
      plan: planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED }),
      requestedIds: [...REQUESTED, "br-vanished"],
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    }).digest
    expect(withUnknown).not.toBe(baseline)
  })

  it("changing the protected set changes the digest", () => {
    const plan = planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED })
    const swapped = {
      ...plan,
      protectedBackups: [plan.protectedBackups[0], plan.protectedBackups[1], { ...plan.protectedBackups[2], id: "br-other" }],
    }
    const moved = prunePlanDigest({
      projectId: PROJECT,
      plan: swapped,
      requestedIds: REQUESTED,
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    }).digest
    expect(moved).not.toBe(baseline)
  })

  it("the protected set is order-independent, because it is derived and not chosen", () => {
    const plan = planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED })
    const reversed = { ...plan, protectedBackups: [...plan.protectedBackups].reverse() }
    const same = prunePlanDigest({
      projectId: PROJECT,
      plan: reversed,
      requestedIds: REQUESTED,
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    }).digest
    expect(same).toBe(baseline)
  })

  it("changing the retention floor changes the digest", () => {
    expect(digestOf(ALL, REQUESTED, { minimumRetained: MINIMUM_RETAINED_BACKUPS + 1 })).not.toBe(baseline)
  })

  it("changing the current inventory changes the digest even when the request is untouched", () => {
    // A backup created since the plan was read: same three ids, different world.
    const newer = branch({ id: "br-new", name: "pre-deploy-goalx-2026-09-05-0900", createdAt: "2026-09-05T09:00:00Z" })
    expect(digestOf([...ALL, newer])).not.toBe(baseline)

    // A branch someone else deleted since the plan was read.
    expect(digestOf(ALL.filter((b) => b.id !== b5.id))).not.toBe(baseline)
  })

  it("changing the Neon project or the production branch changes the digest", () => {
    expect(digestOf(ALL, REQUESTED, { projectId: "some-other-project" })).not.toBe(baseline)

    const otherProd = "br-other-production"
    const moved = planBackupPrune({
      branches: ALL.map((b) => (b.id === PROD ? { ...b, id: otherProd } : { ...b, parentId: otherProd })),
      productionBranchId: otherProd,
      requestedIds: REQUESTED,
    })
    expect(moved.productionBranchId).not.toBe(PROD)
  })

  it("changing the schema version changes the digest", () => {
    const canonical = canonicalisePrunePlan({
      projectId: PROJECT,
      plan: planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED }),
      requestedIds: REQUESTED,
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    })
    expect(canonical.schemaVersion).toBe(PRUNE_PLAN_SCHEMA_VERSION)
    expect(computePrunePlanDigest({ ...canonical, schemaVersion: canonical.schemaVersion + 1 })).not.toBe(baseline)
  })
})

/**
 * THE SAME-COUNT SUBSTITUTION CASE, which schema v1 did not cover.
 *
 * Bind only the requested ids, the protected ids and the COUNTS, and this
 * whole block passes with an unchanged digest: the request is untouched, the
 * newest three are untouched, the totals are untouched - and the account being
 * deleted from is nonetheless not the account anyone reviewed.
 */
describe("the complete inventory is bound, not just its size", () => {
  const baseline = digestOf()

  it("swapping a retained NON-PROTECTED backup for a different one changes the digest", () => {
    const substitute = branch({
      id: "br-substitute",
      name: "pre-deploy-goalx-2026-09-03-2001",
      createdAt: "2026-09-03T20:01:00Z",
    })
    const swapped = [...ALL.filter((b) => b.id !== retainedNonProtected.id), substitute]

    const before = planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED })
    const after = planBackupPrune({ branches: swapped, productionBranchId: PROD, requestedIds: REQUESTED })

    // Everything v1 bound is IDENTICAL across the swap...
    expect(swapped.length).toBe(ALL.length)
    expect(after.backups.length).toBe(before.backups.length)
    expect(after.backupsAfter).toBe(before.backupsAfter)
    expect(after.totalBranchesAfter).toBe(before.totalBranchesAfter)
    expect(after.protectedBackups.map((b) => b.id).sort()).toEqual(before.protectedBackups.map((b) => b.id).sort())
    expect(after.deletable.map((b) => b.id).sort()).toEqual(before.deletable.map((b) => b.id).sort())

    // ...and the digest still moves, because the inventory itself is bound.
    expect(digestOf(swapped)).not.toBe(baseline)
  })

  it("a retained non-protected backup merely DISAPPEARING changes the digest", () => {
    expect(digestOf(ALL.filter((b) => b.id !== retainedNonProtected.id))).not.toBe(baseline)
  })

  it("changing metadata on a retained, non-requested backup changes the digest", () => {
    for (const field of ["name", "createdAt", "parentId"] as const) {
      const edited = ALL.map((b) =>
        b.id === retainedNonProtected.id
          ? {
              ...b,
              [field]:
                field === "name"
                  ? "pre-deploy-goalx-2026-09-03-2001"
                  : field === "createdAt"
                    ? "2026-09-03T20:01:00Z"
                    : "br-some-other-parent",
            }
          : b
      )
      expect(digestOf(edited)).not.toBe(baseline)
    }
  })

  it("changing metadata on a PROTECTED backup changes the digest", () => {
    const edited = ALL.map((b) => (b.id === b6.id ? { ...b, createdAt: "2026-09-04T10:58:00Z" } : b))
    expect(digestOf(edited)).not.toBe(baseline)
  })

  it("changing only the RETAINED SET changes the digest", () => {
    // Same total branch count, same protected three, same inventory members -
    // only which of them survive differs.
    const shorter = digestOf(ALL, [b1.id, b2.id])
    const longer = digestOf(ALL, REQUESTED)
    expect(shorter).not.toBe(longer)

    const plan = planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED })
    const { canonical } = prunePlanDigest({
      projectId: PROJECT,
      plan,
      requestedIds: REQUESTED,
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    })
    expect(canonical.retainedBackupIds).toEqual([b4.id, b5.id, b6.id, b7.id].sort())
    expect(computePrunePlanDigest({ ...canonical, retainedBackupIds: [b4.id, b5.id, b6.id] })).not.toBe(baseline)
  })

  it("a non-backup branch appearing, vanishing or being substituted changes the digest", () => {
    const other = branch({ id: "br-scratch", name: "someones-scratch-branch", parentId: null })
    expect(digestOf([...ALL, other])).not.toBe(baseline)

    const withOther = [...ALL, other]
    const substituted = [...ALL, branch({ id: "br-scratch-2", name: "someones-scratch-branch", parentId: null })]
    expect(digestOf(substituted)).not.toBe(digestOf(withOther))
  })

  it("REORDERING the Neon response without changing its contents does NOT change the digest", () => {
    // Every permutation of the same list is the same world.
    const permutations = [
      [b4, production, b6, b3, b7, b1, b5, b2],
      [b6, b5, b4, b7, b3, b2, b1, production],
      [production, b1, b2, b3, b7, b4, b5, b6],
    ]
    for (const p of permutations) {
      expect(p.length).toBe(ALL.length)
      expect(digestOf(p)).toBe(baseline)
    }
  })

  it("binds every branch with its role and its requested/protected/retained flags", () => {
    const { canonical } = prunePlanDigest({
      projectId: PROJECT,
      plan: planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED }),
      requestedIds: REQUESTED,
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    })

    expect(canonical.inventory.map((b) => b.branchId)).toEqual(ALL.map((b) => b.id).sort())
    expect(canonical.inventory.find((b) => b.branchId === PROD)!.role).toBe("production")
    expect(canonical.inventory.filter((b) => b.role === "backup")).toHaveLength(7)

    const requested = canonical.inventory.find((b) => b.branchId === b1.id)!
    expect(requested).toMatchObject({ requested: true, isProtected: false, retained: false, role: "backup" })

    const protectedRow = canonical.inventory.find((b) => b.branchId === b6.id)!
    expect(protectedRow).toMatchObject({ requested: false, isProtected: true, retained: true })

    // Nothing outside the allowlist is ever marked for deletion.
    expect(canonical.inventory.filter((b) => !b.retained).map((b) => b.branchId).sort()).toEqual([...REQUESTED].sort())
  })

  it("the serialization is injective - a separator inside a name cannot forge a row", () => {
    const sneaky = ALL.map((b) =>
      b.id === retainedNonProtected.id ? { ...b, name: `x|y;br-fake|fake|2026-01-01T00:00:00Z|null|backup` } : b
    )
    const plain = ALL.map((b) => (b.id === retainedNonProtected.id ? { ...b, name: "x" } : b))
    expect(digestOf(sneaky)).not.toBe(digestOf(plain))
    expect(digestOf(sneaky)).not.toBe(baseline)
  })

  it("stays deterministic and clock-free with the inventory bound", () => {
    jest.useFakeTimers().setSystemTime(new Date("2028-06-01T12:34:56Z"))
    try {
      expect(digestOf()).toBe(baseline)
      expect(digestOf([...ALL].reverse())).toBe(baseline)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe("the canonical form is a structure, not console output", () => {
  it("hashes a deterministic serialization with a fixed field order", () => {
    const canonical = canonicalisePrunePlan({
      projectId: PROJECT,
      plan: planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED }),
      requestedIds: REQUESTED,
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    })
    const lines = serialiseCanonicalPrunePlan(canonical).split("\n").map((l) => l.split("=")[0])
    expect(lines).toEqual([
      "schemaVersion",
      "projectId",
      "productionBranchId",
      "minimumRetainedBackups",
      "totalBranchesBefore",
      "backupsBefore",
      "requestedBranchIds",
      "requestedBranches",
      "protectedBackupIds",
      "retainedBackupIds",
      "inventory",
      "backupsAfter",
      "totalBranchesAfter",
    ])
  })

  it("binds every field the contract requires", () => {
    const { canonical } = prunePlanDigest({
      projectId: PROJECT,
      plan: planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED }),
      requestedIds: REQUESTED,
      minimumRetained: MINIMUM_RETAINED_BACKUPS,
      branches: ALL,
    })
    expect(canonical.projectId).toBe(PROJECT)
    expect(canonical.productionBranchId).toBe(PROD)
    expect(canonical.minimumRetainedBackups).toBe(MINIMUM_RETAINED_BACKUPS)
    expect(canonical.totalBranchesBefore).toBe(ALL.length)
    expect(canonical.backupsBefore).toBe(7)
    expect(canonical.requestedBranchIds).toEqual(REQUESTED)
    expect(canonical.requestedBranches.map((b) => b.branchId)).toEqual(REQUESTED)
    expect(canonical.requestedBranches.map((b) => b.name)).toEqual([b1.name, b2.name, b3.name])
    expect(canonical.requestedBranches.map((b) => b.createdAt)).toEqual([b1.createdAt, b2.createdAt, b3.createdAt])
    expect(canonical.requestedBranches.every((b) => b.parentId === PROD)).toBe(true)
    expect(canonical.protectedBackupIds).toEqual([b4.id, b5.id, b6.id].sort())
    expect(canonical.backupsAfter).toBe(4)
    expect(canonical.totalBranchesAfter).toBe(ALL.length - REQUESTED.length)
  })

  it("does not hash human-formatted console output", () => {
    const source = readFileSync(join(ROOT, "src/lib/production/prune-digest.ts"), "utf8")
    // The only thing fed to the hash is the canonical serialization.
    expect(source).toMatch(/createHash\("sha256"\)\.update\(serialiseCanonicalPrunePlan\(canonical\), "utf8"\)/)
    // Nothing time-derived, nothing locale-derived, nothing padded for a terminal.
    for (const forbidden of ["Date.now", "new Date(", "toLocale", "padStart", "padEnd", "console."]) {
      expect(source.includes(forbidden)).toBe(false)
    }
  })
})

describe("the execute-time digest gate", () => {
  const recomputed = digestOf()

  it("accepts the exact digest of the freshly recomputed plan", () => {
    expect(evaluatePruneDigestGate(recomputed, recomputed)).toEqual({ ok: true, code: null, message: null })
  })

  it("refuses a MISSING digest in execute mode rather than skipping the check", () => {
    for (const missing of [null, "", "   "]) {
      const decision = evaluatePruneDigestGate(missing, recomputed)
      expect(decision.ok).toBe(false)
      expect(decision.code).toBe("DIGEST_MISSING")
    }
  })

  it("refuses a WRONG digest", () => {
    const decision = evaluatePruneDigestGate("0".repeat(64), recomputed)
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe("DIGEST_MISMATCH")
  })

  it("refuses a TRUNCATED or prefix-only digest", () => {
    expect(evaluatePruneDigestGate(recomputed.slice(0, 16), recomputed).ok).toBe(false)
    expect(evaluatePruneDigestGate(recomputed.slice(0, 63), recomputed).ok).toBe(false)
  })

  it("refuses a STALE digest - one computed before a backup was created", () => {
    const newer = branch({ id: "br-new", name: "pre-deploy-goalx-2026-09-05-0900", createdAt: "2026-09-05T09:00:00Z" })
    const stale = digestOf() // read the plan against the old world...
    const live = digestOf([...ALL, newer]) // ...but Neon has moved on.
    const decision = evaluatePruneDigestGate(stale, live)
    expect(decision.ok).toBe(false)
    expect(decision.code).toBe("DIGEST_MISMATCH")
  })

  it("refuses a STALE digest - one computed before someone else deleted a branch", () => {
    const stale = digestOf()
    const live = digestOf(ALL.filter((b) => b.id !== b5.id))
    expect(evaluatePruneDigestGate(stale, live).code).toBe("DIGEST_MISMATCH")
  })

  it("refuses a digest for a DIFFERENT id list, even a subset of the same one", () => {
    expect(evaluatePruneDigestGate(digestOf(ALL, [b1.id, b2.id]), recomputed).code).toBe("DIGEST_MISMATCH")
  })

  it("tolerates only case and surrounding whitespace, which are not a different plan", () => {
    expect(evaluatePruneDigestGate(recomputed.toUpperCase(), recomputed).ok).toBe(true)
    expect(evaluatePruneDigestGate(`  ${recomputed}\n`, recomputed).ok).toBe(true)
  })
})

describe("parsePruneArgs carries the digest without loosening anything", () => {
  it("defaults to no digest, so an --execute that forgets it is refused", () => {
    expect(parsePruneArgs([], {})).toEqual({ branchIds: [], execute: false, slotsToFree: 3, planDigest: null })
    expect(parsePruneArgs(["--branches", "br-a", "--execute"], {}).planDigest).toBeNull()
  })

  it("accepts the flag in both forms and the env fallback, flag winning", () => {
    const d = "a".repeat(64)
    expect(parsePruneArgs(["--plan-digest", d], {}).planDigest).toBe(d)
    expect(parsePruneArgs([`--plan-digest=${d}`], {}).planDigest).toBe(d)
    expect(parsePruneArgs([], { PRUNE_PLAN_DIGEST: d }).planDigest).toBe(d)
    expect(parsePruneArgs(["--plan-digest", d], { PRUNE_PLAN_DIGEST: "b".repeat(64) }).planDigest).toBe(d)
  })

  it("a dangling or empty --plan-digest yields null, which the gate then refuses", () => {
    expect(parsePruneArgs(["--plan-digest"], {}).planDigest).toBeNull()
    expect(parsePruneArgs(["--plan-digest="], {}).planDigest).toBeNull()
    expect(parsePruneArgs([], { PRUNE_PLAN_DIGEST: "  " }).planDigest).toBeNull()
  })

  it("supplying a digest never turns execution on by itself", () => {
    expect(parsePruneArgs(["--plan-digest", "a".repeat(64)], {}).execute).toBe(false)
  })
})

describe("the prune command's own shape", () => {
  const script = readFileSync(join(ROOT, "scripts/production/backup-prune.ts"), "utf8")

  it("gates on the digest BEFORE the first deletion", () => {
    const gate = script.indexOf("evaluatePruneDigestGate(")
    const firstDelete = script.indexOf("deleteBackupBranch(")
    expect(gate).toBeGreaterThan(-1)
    expect(firstDelete).toBeGreaterThan(gate)
  })

  it("recomputes the digest from the live inventory it just fetched, not from anything supplied", () => {
    // The plan digested is built from listBranches() output in this same run.
    expect(script).toMatch(/const \[project, production, branchesBefore\] = await Promise\.all\(/)
    // The WHOLE live list is handed to the digest, not a reduction of it.
    expect(script).toMatch(/prunePlanDigest\(\{[\s\S]*?branches: branchesBefore,/)
  })

  it("returns without deleting on a refused gate", () => {
    const gate = script.indexOf("if (!digestGate.ok) {")
    const block = script.slice(gate, script.indexOf("PLAN DIGEST MATCHES"))
    expect(block).toContain("NOTHING WAS DELETED")
    expect(block).toContain("process.exitCode = 1")
    expect(block).toContain("return")
    expect(block).not.toContain("deleteBackupBranch")
  })

  it("keeps every pre-existing gate mandatory alongside the new one", () => {
    expect(script).toContain("assertProductionWriteConfirmed(process.env)")
    expect(script).toContain("planBackupPrune(")
    expect(script).toContain("verifyPostPrune(")
    // The write confirmation is still checked before any API call at all.
    expect(script.indexOf("assertProductionWriteConfirmed")).toBeLessThan(script.indexOf("await Promise.all"))
  })

  it("a dry run needs no destructive credential and deletes nothing", () => {
    // assertProductionWriteConfirmed is reached only under args.execute...
    expect(script).toMatch(/if \(args\.execute\) assertProductionWriteConfirmed\(process\.env\)/)
    // ...and the dry run returns before the digest gate and the delete loop.
    const dryRun = script.indexOf("if (!args.execute) {")
    expect(dryRun).toBeGreaterThan(-1)
    const dryRunBlock = script.slice(dryRun, script.indexOf("const digestGate"))
    expect(dryRunBlock).toContain("DRY RUN - NOTHING WAS DELETED")
    expect(dryRunBlock).toContain("return")
    expect(dryRunBlock).not.toContain("deleteBackupBranch")
    expect(dryRun).toBeLessThan(script.indexOf("deleteBackupBranch("))
  })

  it("prints the digest with the plan on the dry run, and tells the operator to pass it back", () => {
    expect(script).toContain("PLAN DIGEST: ${digest}")
    expect(script).toMatch(/--plan-digest \$\{digest\} --execute/)
  })

  it("offers no wildcard and no way to widen the deletion set", () => {
    // Comments stripped first: the header DOCUMENTS the absence of --all and
    // --older-than, and a check that failed on the documentation would push
    // someone to delete the explanation rather than keep the property.
    const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const wildcard of ["--all", "--older-than", "--everything", "--eligible"]) {
      expect(code.includes(wildcard)).toBe(false)
    }
    // Only ids the operator named are ever deleted: the loop iterates the
    // plan's deletable set, which planBackupPrune derives from requestedIds.
    expect(code).toMatch(/for \(const b of plan\.deletable\)/)
    expect(code).toMatch(/requestedIds: args\.branchIds/)
  })

  it("parses no argument that could stand for more branches than were named", () => {
    // Behavioural, not textual: whatever the parser does with an unknown
    // wildcard-looking flag, it must not produce branch ids - and an empty
    // allowlist is refused by planBackupPrune rather than treated as "all".
    for (const attempt of [["--all"], ["--older-than", "1d"], ["--branches", "*"], ["--branches=*"]]) {
      const parsed = parsePruneArgs(attempt, {})
      if (parsed.branchIds.length === 0) {
        expect(planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: [] }).ok).toBe(false)
      } else {
        // A literal "*" is just an id Neon has never heard of, and an unknown
        // id fails its gate - which refuses the WHOLE plan.
        expect(planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: parsed.branchIds }).ok).toBe(false)
      }
    }
  })

  it("deletes exactly the branches named, never a superset", () => {
    const plan = planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: REQUESTED })
    expect(plan.ok).toBe(true)
    expect(plan.deletable.map((b) => b.id).sort()).toEqual([...REQUESTED].sort())
  })
})
