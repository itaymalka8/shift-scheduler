import {
  MINIMUM_RETAINED_BACKUPS,
  identifyBackups,
  planBackupPrune,
  recommendPruneCandidates,
  supersededBy,
  distinctBackupDays,
  parsePruneArgs,
  verifyPostPrune,
} from "./backup-prune"
import type { NeonBranchSummary } from "./neon-client"

const PROD = "br-production-id"

function branch(over: Partial<NeonBranchSummary> & { id: string; name: string }): NeonBranchSummary {
  return { createdAt: "2026-09-03T00:00:00Z", parentId: PROD, primary: false, ...over }
}

const production = branch({ id: PROD, name: "production", parentId: null, primary: true })

// Nine backups mirroring the real project's shape: five from 09-03, four
// from 09-04. Ids are deliberately unrelated to the ordering so nothing can
// accidentally sort by id and look correct.
const b0303_1121 = branch({ id: "br-k", name: "pre-deploy-goalx-2026-09-03-1121" })
const b0303_1544 = branch({ id: "br-c", name: "pre-deploy-goalx-2026-09-03-1544" })
const b0303_1838 = branch({ id: "br-h", name: "pre-deploy-goalx-2026-09-03-1838" })
const b0303_1958 = branch({ id: "br-a", name: "pre-deploy-goalx-2026-09-03-1958" })
const b0303_2107 = branch({ id: "br-z", name: "pre-deploy-goalx-2026-09-03-2107" })
const b0304_0421 = branch({ id: "br-m", name: "pre-deploy-goalx-2026-09-04-0421" })
const b0304_0721 = branch({ id: "br-b", name: "pre-deploy-goalx-2026-09-04-0721" })
const b0304_0937 = branch({ id: "br-y", name: "pre-deploy-goalx-2026-09-04-0937" })
const b0304_1057 = branch({ id: "br-d", name: "pre-deploy-goalx-2026-09-04-1057" })

const ALL = [
  production,
  b0303_1544,
  b0304_1057,
  b0303_1121,
  b0304_0721,
  b0303_2107,
  b0304_0937,
  b0303_1838,
  b0304_0421,
  b0303_1958,
]

const plan = (requestedIds: string[], branches = ALL) => planBackupPrune({ branches, productionBranchId: PROD, requestedIds })

describe("identifyBackups", () => {
  it("orders newest first by the instant in the name, not by id or list order", () => {
    expect(identifyBackups(ALL, PROD).map((b) => b.name)).toEqual([
      "pre-deploy-goalx-2026-09-04-1057",
      "pre-deploy-goalx-2026-09-04-0937",
      "pre-deploy-goalx-2026-09-04-0721",
      "pre-deploy-goalx-2026-09-04-0421",
      "pre-deploy-goalx-2026-09-03-2107",
      "pre-deploy-goalx-2026-09-03-1958",
      "pre-deploy-goalx-2026-09-03-1838",
      "pre-deploy-goalx-2026-09-03-1544",
      "pre-deploy-goalx-2026-09-03-1121",
    ])
  })

  it("excludes production itself even if production were somehow named like a backup", () => {
    const disguised = branch({ id: PROD, name: "pre-deploy-goalx-2026-09-01-0000", parentId: null, primary: true })
    expect(identifyBackups([disguised, b0303_1121], PROD).map((b) => b.id)).toEqual([b0303_1121.id])
  })

  it("excludes a backup-named branch that is not a child of production", () => {
    const orphan = branch({ id: "br-orphan", name: "pre-deploy-goalx-2026-09-01-0000", parentId: "br-something-else" })
    expect(identifyBackups([production, orphan], PROD)).toHaveLength(0)
  })

  it("excludes branches whose names only resemble the convention", () => {
    const lookalikes = [
      branch({ id: "br-1", name: "pre-deploy-goalx-manual" }),
      branch({ id: "br-2", name: "pre-deploy-goalx-2026-09-03-1121-copy" }),
      branch({ id: "br-3", name: "restore-pre-deploy-goalx-2026-09-03-1121" }),
      branch({ id: "br-4", name: "pre-deploy-goalx-2026-13-03-1121" }), // month 13
      branch({ id: "br-5", name: "pre-deploy-goalx-2026-02-31-1121" }), // 31 February
      branch({ id: "br-6", name: "dev" }),
    ]
    expect(identifyBackups([production, ...lookalikes], PROD)).toHaveLength(0)
  })
})

describe("planBackupPrune - the production branch can never be selected", () => {
  it("refuses the production branch id", () => {
    const p = plan([PROD])
    expect(p.ok).toBe(false)
    expect(p.deletable).toEqual([])
    expect(p.refusals).toEqual([{ branchId: PROD, code: "IS_PRODUCTION", detail: '"production" IS THE PRODUCTION BRANCH' }])
  })

  it("refuses production even when its name looks exactly like a backup", () => {
    const disguised = branch({ id: PROD, name: "pre-deploy-goalx-2026-09-01-0000", parentId: null, primary: true })
    const p = planBackupPrune({ branches: [disguised, b0303_1121, b0303_1544, b0303_1838, b0303_1958], productionBranchId: PROD, requestedIds: [PROD] })
    expect(p.ok).toBe(false)
    expect(p.refusals[0].code).toBe("IS_PRODUCTION")
  })

  it("identity comes from productionBranchId, never from the name 'production'", () => {
    // A decoy branch literally named "production" that is NOT the resolved
    // production branch is still just a non-backup: refused, but as
    // NOT_A_BACKUP, and the real production id is what IS_PRODUCTION guards.
    const decoy = branch({ id: "br-decoy", name: "production" })
    const p = planBackupPrune({ branches: [production, decoy, b0303_1121], productionBranchId: PROD, requestedIds: ["br-decoy"] })
    expect(p.ok).toBe(false)
    expect(p.refusals[0].code).toBe("NOT_A_BACKUP")
  })
})

describe("planBackupPrune - only genuine pre-deploy backups are eligible", () => {
  it("refuses a branch that is not a backup", () => {
    const dev = branch({ id: "br-dev", name: "dev" })
    const p = plan(["br-dev"], [...ALL, dev])
    expect(p.ok).toBe(false)
    expect(p.refusals[0]).toMatchObject({ code: "NOT_A_BACKUP" })
  })

  it("refuses a backup-named branch parented somewhere other than production", () => {
    const orphan = branch({ id: "br-orphan", name: "pre-deploy-goalx-2026-08-01-0000", parentId: "br-elsewhere" })
    const p = plan(["br-orphan"], [...ALL, orphan])
    expect(p.ok).toBe(false)
    expect(p.refusals[0]).toMatchObject({ code: "NOT_CHILD_OF_PRODUCTION" })
  })

  it("refuses an unknown branch id", () => {
    const p = plan(["br-does-not-exist"])
    expect(p.ok).toBe(false)
    expect(p.refusals[0]).toMatchObject({ code: "UNKNOWN_BRANCH" })
    expect(p.deletable).toEqual([])
  })

  it("refuses a duplicated id rather than deleting it once and calling that fine", () => {
    const p = plan([b0303_1121.id, b0303_1121.id])
    expect(p.ok).toBe(false)
    expect(p.refusals[0]).toMatchObject({ code: "DUPLICATE_REQUEST" })
  })
})

describe("planBackupPrune - the newest backups are protected", () => {
  it(`protects the newest ${MINIMUM_RETAINED_BACKUPS}`, () => {
    expect(plan([b0303_1121.id]).protectedBackups.map((b) => b.name)).toEqual([
      "pre-deploy-goalx-2026-09-04-1057",
      "pre-deploy-goalx-2026-09-04-0937",
      "pre-deploy-goalx-2026-09-04-0721",
    ])
  })

  it("refuses the newest backup", () => {
    const p = plan([b0304_1057.id])
    expect(p.ok).toBe(false)
    expect(p.refusals[0]).toMatchObject({ code: "PROTECTED_NEWEST" })
  })

  it("refuses the second and third newest too", () => {
    for (const b of [b0304_0937, b0304_0721]) {
      expect(plan([b.id]).refusals[0]).toMatchObject({ code: "PROTECTED_NEWEST" })
    }
  })

  it("allows the fourth newest", () => {
    const p = plan([b0304_0421.id])
    expect(p.ok).toBe(true)
    expect(p.deletable.map((b) => b.id)).toEqual([b0304_0421.id])
  })
})

describe("planBackupPrune - the retention floor fails closed", () => {
  it("refuses a plan that would leave fewer than the minimum", () => {
    // Six backups, asked to delete four -> two would remain.
    const six = [production, b0304_1057, b0304_0937, b0304_0721, b0304_0421, b0303_2107, b0303_1958]
    const p = planBackupPrune({
      branches: six,
      productionBranchId: PROD,
      requestedIds: [b0304_0421.id, b0303_2107.id, b0303_1958.id, b0304_0721.id],
    })
    expect(p.ok).toBe(false)
    expect(p.deletable).toEqual([])
  })

  it("refuses to prune at all when there are only the minimum backups", () => {
    const three = [production, b0304_1057, b0304_0937, b0304_0721]
    const p = planBackupPrune({ branches: three, productionBranchId: PROD, requestedIds: [b0304_0721.id] })
    expect(p.ok).toBe(false)
    expect(p.refusals[0]).toMatchObject({ code: "PROTECTED_NEWEST" })
  })

  it("accepts a plan that lands exactly on the floor", () => {
    const six = [production, b0304_1057, b0304_0937, b0304_0721, b0304_0421, b0303_2107, b0303_1958]
    const p = planBackupPrune({
      branches: six,
      productionBranchId: PROD,
      requestedIds: [b0304_0421.id, b0303_2107.id, b0303_1958.id],
    })
    expect(p.ok).toBe(true)
    expect(p.backupsAfter).toBe(MINIMUM_RETAINED_BACKUPS)
  })
})

describe("planBackupPrune - an explicit allowlist is mandatory", () => {
  it("refuses an empty request rather than treating it as 'everything eligible'", () => {
    const p = plan([])
    expect(p.ok).toBe(false)
    expect(p.deletable).toEqual([])
    expect(p.reason).toMatch(/no wildcard prune/i)
  })
})

describe("planBackupPrune - a partially invalid allowlist deletes NOTHING", () => {
  it("drops every valid entry when one entry is invalid", () => {
    const p = plan([b0303_1121.id, b0303_1544.id, "br-does-not-exist"])
    expect(p.ok).toBe(false)
    expect(p.deletable).toEqual([])
    expect(p.refusals.map((r) => r.code)).toEqual(["UNKNOWN_BRANCH"])
  })

  it("drops everything when one entry is production", () => {
    const p = plan([b0303_1121.id, PROD, b0303_1544.id])
    expect(p.ok).toBe(false)
    expect(p.deletable).toEqual([])
  })

  it("drops everything when one entry is a protected newest backup", () => {
    const p = plan([b0303_1121.id, b0304_1057.id])
    expect(p.ok).toBe(false)
    expect(p.deletable).toEqual([])
  })

  it("reports every refusal at once, not just the first", () => {
    const p = plan([PROD, "br-nope", b0304_1057.id])
    expect(p.refusals.map((r) => r.code).sort()).toEqual(["IS_PRODUCTION", "PROTECTED_NEWEST", "UNKNOWN_BRANCH"])
  })
})

describe("planBackupPrune - the happy path", () => {
  it("accepts the three oldest and reports the resulting counts", () => {
    const p = plan([b0303_1121.id, b0303_1544.id, b0303_1838.id])
    expect(p.ok).toBe(true)
    expect(p.refusals).toEqual([])
    expect(p.deletable.map((b) => b.name)).toEqual([
      "pre-deploy-goalx-2026-09-03-1838",
      "pre-deploy-goalx-2026-09-03-1544",
      "pre-deploy-goalx-2026-09-03-1121",
    ])
    expect(p.backupsAfter).toBe(6)
    expect(p.totalBranchesAfter).toBe(7)
  })

  it("is order-insensitive - the same set in any order yields the same plan", () => {
    const a = plan([b0303_1121.id, b0303_1544.id, b0303_1838.id])
    const b = plan([b0303_1838.id, b0303_1121.id, b0303_1544.id])
    expect(a.deletable.map((x) => x.id)).toEqual(b.deletable.map((x) => x.id))
  })
})

describe("recommendPruneCandidates", () => {
  it("recommends the oldest eligible backups, oldest last", () => {
    expect(recommendPruneCandidates(ALL, PROD, 3)!.map((b) => b.name)).toEqual([
      "pre-deploy-goalx-2026-09-03-1838",
      "pre-deploy-goalx-2026-09-03-1544",
      "pre-deploy-goalx-2026-09-03-1121",
    ])
  })

  it("never recommends a protected newest backup", () => {
    const recommended = recommendPruneCandidates(ALL, PROD, 6)!
    const protectedIds = identifyBackups(ALL, PROD).slice(0, MINIMUM_RETAINED_BACKUPS).map((b) => b.id)
    expect(recommended.some((r) => protectedIds.includes(r.id))).toBe(false)
  })

  it("returns null rather than breaking the floor", () => {
    expect(recommendPruneCandidates(ALL, PROD, 7)).toBeNull()
    expect(recommendPruneCandidates([production, b0304_1057, b0304_0937, b0304_0721], PROD, 1)).toBeNull()
  })

  it("its own recommendation always passes planBackupPrune", () => {
    const recommended = recommendPruneCandidates(ALL, PROD, 3)!
    expect(plan(recommended.map((b) => b.id)).ok).toBe(true)
  })
})

describe("supersededBy / distinctBackupDays", () => {
  it("lists only the recovery points taken after a candidate", () => {
    const backups = identifyBackups(ALL, PROD)
    const candidate = backups.find((b) => b.name.endsWith("09-03-1121"))!
    expect(supersededBy(backups, candidate)).toHaveLength(8)
  })

  it("shows the retained set still spans both deployment days", () => {
    const backups = identifyBackups(ALL, PROD)
    const survivors = backups.filter((b) => !["br-k", "br-c", "br-h"].includes(b.id))
    expect(distinctBackupDays(survivors)).toEqual(["2026-09-03", "2026-09-04"])
  })
})

describe("verifyPostPrune", () => {
  const after = ALL.filter((b) => ![b0303_1121.id, b0303_1544.id, b0303_1838.id].includes(b.id))
  const deleted = [b0303_1121.id, b0303_1544.id, b0303_1838.id]
  const base = {
    branchesAfter: after,
    productionBranchIdBefore: PROD,
    productionBranchIdAfter: PROD,
    deletedIds: deleted,
    branchesBefore: ALL.length,
  }

  it("passes when production survives, the ids are gone, and the floor holds", () => {
    const v = verifyPostPrune(base)
    expect(v.ok).toBe(true)
    expect(v.checks.every((c) => c.ok)).toBe(true)
  })

  it("FAILS when the production branch is missing afterwards", () => {
    const v = verifyPostPrune({ ...base, branchesAfter: after.filter((b) => b.id !== PROD) })
    expect(v.ok).toBe(false)
    expect(v.checks.find((c) => c.name === "Production branch exists")!.ok).toBe(false)
  })

  it("FAILS when the production branch id changed", () => {
    const v = verifyPostPrune({ ...base, productionBranchIdAfter: "br-something-new" })
    expect(v.ok).toBe(false)
    expect(v.checks.find((c) => c.name === "Production branch id unchanged")!.ok).toBe(false)
  })

  it("FAILS when a branch reported deleted is still present", () => {
    const v = verifyPostPrune({ ...base, branchesAfter: ALL })
    expect(v.ok).toBe(false)
    expect(v.checks.find((c) => c.name === "Every requested branch is gone")!.ok).toBe(false)
  })

  it("FAILS when fewer than the minimum backups remain", () => {
    const stripped = [production, b0304_1057, b0304_0937]
    const v = verifyPostPrune({ ...base, branchesAfter: stripped, deletedIds: [], branchesBefore: 3 })
    expect(v.ok).toBe(false)
    expect(v.checks.find((c) => c.name.startsWith("At least"))!.ok).toBe(false)
  })

  it("FAILS when the branch count did not fall by the number deleted", () => {
    const v = verifyPostPrune({ ...base, branchesBefore: 20 })
    expect(v.ok).toBe(false)
    expect(v.checks.find((c) => c.name.startsWith("Branch count"))!.ok).toBe(false)
  })

  it("proves capacity for a new backup when the branch limit is known", () => {
    expect(verifyPostPrune({ ...base, branchLimit: 10 }).checks.find((c) => c.name.startsWith("Room for"))!.ok).toBe(true)
    expect(verifyPostPrune({ ...base, branchLimit: 7 }).checks.find((c) => c.name.startsWith("Room for"))!.ok).toBe(false)
  })
})

describe("parsePruneArgs - dry run is the default", () => {
  it("defaults execute to false with no arguments at all", () => {
    expect(parsePruneArgs([], {})).toEqual({ branchIds: [], execute: false, slotsToFree: 3 })
  })

  it("stays a dry run when branches are given but --execute is not", () => {
    expect(parsePruneArgs(["--branches", "br-a,br-b"], {}).execute).toBe(false)
  })

  it("only the literal --execute flag turns execution on", () => {
    expect(parsePruneArgs(["--execute"], {}).execute).toBe(true)
    for (const near of ["--Execute", "-execute", "--execute=true", "--exec", "execute"]) {
      expect(parsePruneArgs([near], {}).execute).toBe(false)
    }
  })

  it("only the literal env string 'true' turns execution on", () => {
    expect(parsePruneArgs([], { PRUNE_EXECUTE: "true" }).execute).toBe(true)
    for (const near of ["1", "yes", "TRUE", "", "false"]) {
      expect(parsePruneArgs([], { PRUNE_EXECUTE: near }).execute).toBe(false)
    }
  })
})

describe("parsePruneArgs - the allowlist", () => {
  it("accepts comma-separated, space-separated, repeated and = forms", () => {
    expect(parsePruneArgs(["--branches", "br-a,br-b"], {}).branchIds).toEqual(["br-a", "br-b"])
    expect(parsePruneArgs(["--branches", "br-a br-b"], {}).branchIds).toEqual(["br-a", "br-b"])
    expect(parsePruneArgs(["--branch", "br-a", "--branch", "br-b"], {}).branchIds).toEqual(["br-a", "br-b"])
    expect(parsePruneArgs(["--branches=br-a,br-b"], {}).branchIds).toEqual(["br-a", "br-b"])
  })

  it("falls back to PRUNE_BRANCH_IDS only when no flag was given", () => {
    expect(parsePruneArgs([], { PRUNE_BRANCH_IDS: "br-a,br-b" }).branchIds).toEqual(["br-a", "br-b"])
    expect(parsePruneArgs(["--branches", "br-flag"], { PRUNE_BRANCH_IDS: "br-env" }).branchIds).toEqual(["br-flag"])
  })

  it("yields an empty allowlist for a dangling --branches, which planBackupPrune then refuses", () => {
    expect(parsePruneArgs(["--branches"], {}).branchIds).toEqual([])
    expect(planBackupPrune({ branches: ALL, productionBranchId: PROD, requestedIds: [] }).ok).toBe(false)
  })
})
