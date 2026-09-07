/**
 * THE PHASE 3R CLOSURE AUTHORITIES - pure predicate tests.
 *
 * Closure is a claim that everything is still where it was approved to be, so
 * almost every test here is a NEGATIVE: it moves exactly one thing and proves
 * the gate refuses with a stable, greppable code. A gate that only ever sees
 * the healthy fixture has been tested for agreement, not for judgement.
 */
import {
  FIRST_BASELINE,
  evaluateFirstBaselineGate,
  type EconomyActivityReading,
  type FirstBaselineReading,
  type HistoryRow,
  type OrphanReading,
  type SecondBaselineReading,
} from "@/lib/economy/first-baseline"
import { PHASE_3R_ACTIVATION_START } from "@/lib/economy/config"
import { ATTENDANCE_QUALITY_FLOOR } from "@/lib/stadium/attendance-quality"
import { MINIMUM_RETAINED_BACKUPS } from "./backup-prune"
import type { NeonBranchSummary } from "./neon-client"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  APPROVED_ACTIVATION_INSTANT,
  PHASE_3R_CLOSURE,
  evaluateBackupRetention,
  evaluateFrozenClosureGate,
  runtimeActivationMatchesContract,
  type BackupRetentionReading,
  type ClosureReading,
} from "./phase3r-closure"

const ACTIVATION = new Date(PHASE_3R_CLOSURE.activationInstantIso)
const STAMPED = new Date("2026-09-07T12:32:25.620Z")
const TARGET = FIRST_BASELINE.targetCommit
const PROD_BRANCH = PHASE_3R_CLOSURE.neonProductionBranchId

const codes = (result: { refusals: { code: string }[] }) => result.refusals.map((r) => r.code)

// ===========================================================================
// THE FROZEN CONTRACT ITSELF
// ===========================================================================

describe("the frozen Phase 3R closure contract", () => {
  it("names the approved activation instant, and the RUNTIME constant still equals it", () => {
    expect(PHASE_3R_CLOSURE.activationInstantIso).toBe("2026-09-24T13:00:00.000Z")
    expect(PHASE_3R_ACTIVATION_START.toISOString()).toBe("2026-09-24T13:00:00.000Z")
    expect(runtimeActivationMatchesContract()).toBe(true)
    expect(APPROVED_ACTIVATION_INSTANT.getTime()).toBe(PHASE_3R_ACTIVATION_START.getTime())
  })

  it("names the approved Production branch, Neon branch, limit and recovery points", () => {
    expect(PHASE_3R_CLOSURE.productionBranchName).toBe("claude/goalx-manager-game-y3ht29")
    expect(PHASE_3R_CLOSURE.neonProductionBranchId).toBe("br-proud-band-b16r2qjs")
    expect(PHASE_3R_CLOSURE.expectedBranchLimit).toBe(10)
    expect(PHASE_3R_CLOSURE.requiredRecoveryPoints).toEqual([
      { id: "br-red-union-b1mmvmgr", name: "pre-deploy-goalx-2026-09-07-0824" },
      { id: "br-dry-river-b1ira70b", name: "pre-deploy-goalx-2026-09-07-0829" },
    ])
  })

  it("is frozen - the contract cannot be edited at runtime", () => {
    expect(Object.isFrozen(PHASE_3R_CLOSURE)).toBe(true)
  })
})

// ===========================================================================
// 5. NEON BACKUP RETENTION
// ===========================================================================

const branch = (id: string, name: string, parentId: string | null, primary = false): NeonBranchSummary => ({
  id,
  name,
  createdAt: "2026-09-07T08:24:00.000Z",
  parentId,
  primary,
})

/**
 * The CURRENT expected Production inventory: nine branches - Production, five
 * pre-deploy backups of it, and three branches that are not backups at all.
 * Nine is what the account holds today, not a passing condition; the audit
 * asserts the retention floor and the project limit, never a branch total.
 */
const healthyBranches = (): NeonBranchSummary[] => [
  branch(PROD_BRANCH, "production", null, true),
  branch("br-red-union-b1mmvmgr", "pre-deploy-goalx-2026-09-07-0824", PROD_BRANCH),
  branch("br-dry-river-b1ira70b", "pre-deploy-goalx-2026-09-07-0829", PROD_BRANCH),
  branch("br-old-one-000000001", "pre-deploy-goalx-2026-09-06-1200", PROD_BRANCH),
  branch("br-old-two-000000002", "pre-deploy-goalx-2026-09-05-1200", PROD_BRANCH),
  branch("br-old-three-00000003", "pre-deploy-goalx-2026-09-04-1200", PROD_BRANCH),
  branch("br-dev-000000000000001", "development", PROD_BRANCH),
  branch("br-scratch-0000000002", "scratch", PROD_BRANCH),
  branch("br-preview-0000000003", "preview-pr-12", PROD_BRANCH),
]

const healthyRetention = (): BackupRetentionReading => ({
  projectId: "quiet-forest-12345678",
  projectName: "Goalx",
  branchLimit: 10,
  branches: healthyBranches(),
  productionBranch: { id: PROD_BRANCH, name: "production", primary: true },
})

const retention = (mutate: (reading: BackupRetentionReading) => void = () => {}) => {
  const reading = healthyRetention()
  mutate(reading)
  return evaluateBackupRetention(reading)
}

describe("Neon backup retention - the current 9-branch inventory", () => {
  it("PASSES on the expected current inventory", () => {
    const result = retention()
    expect(result.refusals).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.branchCount).toBe(9)
    expect(result.branchLimit).toBe(10)
  })

  it("counts only genuine pre-deploy backups of Production - never the other branches", () => {
    const result = retention()
    expect(result.backups.map((b) => b.id).sort()).toEqual(
      ["br-dry-river-b1ira70b", "br-old-one-000000001", "br-old-three-00000003", "br-old-two-000000002", "br-red-union-b1mmvmgr"].sort()
    )
    // development / scratch / preview are children of Production but are not
    // backup-shaped, so they cannot pad the count.
    expect(result.backups.map((b) => b.name)).not.toContain("development")
  })

  it("imports the retention floor from the prune authority rather than restating it", () => {
    expect(retention().retentionFloor).toBe(MINIMUM_RETAINED_BACKUPS)
    const source = readFileSync(join(__dirname, "phase3r-closure.ts"), "utf8")
    expect(source).toContain('import { identifyBackups, MINIMUM_RETAINED_BACKUPS, type BackupBranch } from "./backup-prune"')
    // No local copy of the number.
    expect(/MINIMUM_RETAINED_BACKUPS\s*=/.test(source)).toBe(false)
  })
})

describe("Neon backup retention FAILS CLOSED", () => {
  it("fewer backups than the retention floor", () => {
    const result = retention((r) => {
      // Keep only the two required recovery points; that is below the floor of 3.
      r.branches = r.branches!.filter((b) => !b.name.startsWith("pre-deploy-goalx-2026-09-0") || b.id.startsWith("br-red") || b.id.startsWith("br-dry"))
    })
    expect(codes(result)).toContain("RETENTION_FLOOR")
    expect(result.ok).toBe(false)
  })

  it("a missing br-red-union-b1mmvmgr recovery point", () => {
    const result = retention((r) => {
      r.branches = r.branches!.filter((b) => b.id !== "br-red-union-b1mmvmgr")
    })
    expect(codes(result)).toContain("RECOVERY_POINT_MISSING")
    expect(result.refusals.some((f) => f.detail.includes("br-red-union-b1mmvmgr"))).toBe(true)
    expect(result.ok).toBe(false)
  })

  it("a missing br-dry-river-b1ira70b recovery point", () => {
    const result = retention((r) => {
      r.branches = r.branches!.filter((b) => b.id !== "br-dry-river-b1ira70b")
    })
    expect(codes(result)).toContain("RECOVERY_POINT_MISSING")
    expect(result.refusals.some((f) => f.detail.includes("br-dry-river-b1ira70b"))).toBe(true)
  })

  it("a required recovery point renamed", () => {
    const result = retention((r) => {
      r.branches = r.branches!.map((b) => (b.id === "br-red-union-b1mmvmgr" ? { ...b, name: "pre-deploy-goalx-2026-09-07-9999" } : b))
    })
    expect(codes(result)).toContain("RECOVERY_POINT_NAME")
  })

  it("a required recovery point with the WRONG PARENT - a branch of a branch is not a recovery point", () => {
    const result = retention((r) => {
      r.branches = r.branches!.map((b) => (b.id === "br-dry-river-b1ira70b" ? { ...b, parentId: "br-dev-000000000000001" } : b))
    })
    expect(codes(result)).toContain("RECOVERY_POINT_NOT_CHILD_OF_PRODUCTION")
    // ...and the prune authority stops recognising it as a backup at all.
    expect(codes(result)).toContain("RECOVERY_POINT_NOT_A_BACKUP")
  })

  it("a NON-BACKUP branch cannot satisfy the backup count", () => {
    const result = retention((r) => {
      // Replace every real backup with plausibly-named non-backup branches.
      r.branches = [
        branch(PROD_BRANCH, "production", null, true),
        branch("br-a-1", "backup-1", PROD_BRANCH),
        branch("br-a-2", "backup-2", PROD_BRANCH),
        branch("br-a-3", "backup-3", PROD_BRANCH),
        branch("br-a-4", "pre-deploy", PROD_BRANCH),
        branch("br-a-5", "pre-deploy-goalx", PROD_BRANCH),
      ]
    })
    expect(result.backups).toEqual([])
    expect(codes(result)).toContain("RETENTION_FLOOR")
    expect(codes(result)).toContain("RECOVERY_POINT_MISSING")
    expect(result.ok).toBe(false)
  })

  it("the WRONG Production branch id", () => {
    const result = retention((r) => {
      r.productionBranch = { id: "br-someone-elses-0001", name: "production", primary: true }
    })
    expect(codes(result)).toContain("PRODUCTION_BRANCH_ID")
    expect(result.ok).toBe(false)
  })

  it("Production no longer the project's primary branch", () => {
    const result = retention((r) => {
      r.productionBranch = { id: PROD_BRANCH, name: "production", primary: false }
    })
    expect(codes(result)).toContain("PRODUCTION_BRANCH_NOT_PRIMARY")
  })

  it("the Production branch absent from the inventory", () => {
    const result = retention((r) => {
      r.branches = r.branches!.filter((b) => b.id !== PROD_BRANCH)
    })
    expect(codes(result)).toContain("PRODUCTION_BRANCH_ABSENT")
  })

  it("an UNREADABLE branch inventory", () => {
    const result = retention((r) => (r.branches = null))
    expect(codes(result)).toContain("BRANCH_INVENTORY_UNREADABLE")
    expect(result.ok).toBe(false)
    expect(result.branchCount).toBeNull()
  })

  it("an UNREADABLE branch limit", () => {
    const result = retention((r) => (r.branchLimit = null))
    expect(codes(result)).toContain("BRANCH_LIMIT_UNREADABLE")
    expect(result.ok).toBe(false)
    // ...and no limit comparison is invented from a value that was not read.
    expect(codes(result)).not.toContain("BRANCH_LIMIT")
    expect(codes(result)).not.toContain("BRANCH_COUNT_OVER_LIMIT")
  })

  it("an UNREADABLE project", () => {
    const result = retention((r) => (r.projectId = null))
    expect(codes(result)).toContain("PROJECT_UNREADABLE")
  })

  it("an UNREADABLE Production branch", () => {
    const result = retention((r) => (r.productionBranch = null))
    expect(codes(result)).toContain("PRODUCTION_BRANCH_UNREADABLE")
    expect(codes(result)).not.toContain("PRODUCTION_BRANCH_ID")
  })

  it("a branch limit that is not the approved 10", () => {
    expect(codes(retention((r) => (r.branchLimit = 20)))).toContain("BRANCH_LIMIT")
    expect(codes(retention((r) => (r.branchLimit = 5)))).toContain("BRANCH_LIMIT")
  })

  it("a branch count OVER the project limit", () => {
    const result = retention((r) => {
      r.branchLimit = 10
      r.branches = [...r.branches!, branch("br-extra-1", "extra-1", PROD_BRANCH), branch("br-extra-2", "extra-2", PROD_BRANCH)]
    })
    expect(codes(result)).toContain("BRANCH_COUNT_OVER_LIMIT")
    expect(result.ok).toBe(false)
  })

  it("the correct branch limit passes, and the count is reported rather than pinned", () => {
    const result = retention()
    expect(codes(result)).not.toContain("BRANCH_LIMIT")
    expect(codes(result)).not.toContain("BRANCH_COUNT_OVER_LIMIT")
    // Ten branches - exactly at the limit - is still legal.
    const atLimit = retention((r) => {
      r.branches = [...r.branches!, branch("br-tenth-000000000001", "tenth", PROD_BRANCH)]
    })
    expect(codes(atLimit)).not.toContain("BRANCH_COUNT_OVER_LIMIT")
    expect(atLimit.ok).toBe(true)
  })
})

// ===========================================================================
// 6. THE FINAL FROZEN CLOSURE GATE
// ===========================================================================

const clubIds = Array.from({ length: 60 }, (_, i) => `club-${String(i + 1).padStart(2, "0")}`)

const healthyRows = (): HistoryRow[] =>
  clubIds.map((teamId) => ({
    teamId,
    version: 1,
    reason: "baseline",
    effectiveAt: STAMPED,
    weeklyPayroll: 240_000,
    attendanceQuality: ATTENDANCE_QUALITY_FLOOR + 470,
  }))

const healthyOrphan = (): OrphanReading => ({
  fixtureId: FIRST_BASELINE.orphanFixtureId,
  transactionCount: FIRST_BASELINE.orphanTransactionCount,
  net: FIRST_BASELINE.orphanNet,
})

const healthyActivity = (): EconomyActivityReading => ({
  sponsorSettlementCount: 0,
  maintenanceSettlementCount: 0,
  repricingRowCount: 0,
})

const healthyEnvironment = (historyRows = 60, historyDistinctTeams = 60, teamCount = 60): FirstBaselineReading => ({
  canonicalHead: TARGET,
  web: { repo: FIRST_BASELINE.repo, branch: FIRST_BASELINE.branch, autoDeploy: "off", deployedCommit: TARGET },
  cron: {
    repo: FIRST_BASELINE.repo,
    branch: FIRST_BASELINE.branch,
    autoDeploy: "off",
    deployedCommit: TARGET,
    suspended: false,
    schedule: FIRST_BASELINE.cronSchedule,
  },
  migrationsApplied: 23,
  migrationsTotal: 23,
  migration23Applied: true,
  catalog: {
    tableExists: true,
    teamIdFkOnDeleteRestrict: true,
    uniqueTeamIdVersion: true,
    asOfIndex: true,
    updateTriggerEnabled: true,
    deleteTriggerEnabled: true,
    truncateTriggerEnabled: true,
  },
  teamCount,
  historyRows,
  historyDistinctTeams,
  now: STAMPED,
})

const healthySecondBaseline = (): SecondBaselineReading => ({
  environment: healthyEnvironment(),
  teamCount: 60,
  historyRows: 60,
  historyDistinctTeams: 60,
  rows: healthyRows(),
  teamIds: [...clubIds],
  orphan: healthyOrphan(),
  activity: healthyActivity(),
  firstBaselineGate: evaluateFirstBaselineGate(healthyEnvironment(), FIRST_BASELINE, ACTIVATION),
  now: STAMPED,
})

const healthyClosure = (): ClosureReading => ({
  secondBaseline: healthySecondBaseline(),
  activationStart: ACTIVATION,
  canonicalBranchName: PHASE_3R_CLOSURE.productionBranchName,
})

const gate = (mutate: (reading: ClosureReading) => void = () => {}) => {
  const reading = healthyClosure()
  mutate(reading)
  return evaluateFrozenClosureGate(reading)
}
const env = (mutate: (e: FirstBaselineReading) => void) => gate((r) => mutate(r.secondBaseline.environment))

describe("the final frozen closure gate passes only on the exact approved state", () => {
  it("PASSES on the accepted Production state, with recovery NOT required", () => {
    const result = gate()
    expect(result.refusals).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.recoveryRequired).toBe(false)
    expect(result.canonicalSecondBaseline.ok).toBe(true)
  })

  it("reports the canonical second-baseline verdict SEPARATELY, evaluated on the same fresh reading", () => {
    const result = gate((r) => {
      r.secondBaseline.historyRows = 59
      r.secondBaseline.environment.historyRows = 59
    })
    expect(codes(result.canonicalSecondBaseline)).toContain("HISTORY_ROWS")
    expect(result.ok).toBe(false)
  })

  it("recoveryRequired is DERIVED from the refusals, never accepted as an input", () => {
    expect(gate().recoveryRequired).toBe(false)
    expect(gate((r) => (r.canonicalBranchName = "main")).recoveryRequired).toBe(true)
    const source = readFileSync(join(__dirname, "phase3r-closure.ts"), "utf8")
    expect(source).toContain("recoveryRequired: refusals.length > 0")
    // The reading has no field a caller could set to claim recovery is not needed.
    expect(source).not.toMatch(/recoveryRequired\s*:\s*boolean\s*\|\s*null/)
  })
})

describe("the closure gate FAILS CLOSED on the activation instant", () => {
  it("activation moved away from the approved instant", () => {
    const result = gate((r) => (r.activationStart = new Date("2026-09-25T13:00:00.000Z")))
    expect(codes(result)).toContain("ACTIVATION_INSTANT_CHANGED")
    expect(result.ok).toBe(false)
  })

  it("activation moved by even one millisecond", () => {
    expect(codes(gate((r) => (r.activationStart = new Date(ACTIVATION.getTime() + 1))))).toContain("ACTIVATION_INSTANT_CHANGED")
  })

  it("activation no longer in the future", () => {
    // Judged against the same instant the rest of the gate uses, so this is
    // "the crossing has happened", not "the constant changed".
    const result = gate((r) => {
      r.secondBaseline.environment.now = new Date(ACTIVATION.getTime() + 1)
      r.secondBaseline.now = new Date(ACTIVATION.getTime() + 1)
    })
    expect(codes(result)).toContain("ENV_ACTIVATION_NOT_FUTURE")
    expect(result.ok).toBe(false)
  })
})

describe("the closure gate FAILS CLOSED on GitHub and Render", () => {
  it("the canonical head is wrong", () => {
    expect(codes(env((e) => (e.canonicalHead = "0".repeat(40))))).toContain("ENV_CANONICAL_HEAD")
  })

  it("the canonical head is UNREADABLE", () => {
    expect(codes(env((e) => (e.canonicalHead = null)))).toContain("ENV_CANONICAL_HEAD")
  })

  it("the Production branch NAME is wrong or unreadable", () => {
    expect(codes(gate((r) => (r.canonicalBranchName = "main")))).toContain("PRODUCTION_BRANCH_NAME")
    expect(codes(gate((r) => (r.canonicalBranchName = null)))).toContain("PRODUCTION_BRANCH_NAME")
  })

  it.each([
    ["the Web repo is wrong", (e: FirstBaselineReading) => (e.web!.repo = "https://github.com/someone/else")],
    ["the Web branch is wrong", (e: FirstBaselineReading) => (e.web!.branch = "main")],
    ["Web Auto Deploy is ON", (e: FirstBaselineReading) => (e.web!.autoDeploy = "on")],
    ["Web Auto Deploy is UNREADABLE", (e: FirstBaselineReading) => (e.web!.autoDeploy = "unknown")],
    ["the Web deployed commit is wrong", (e: FirstBaselineReading) => (e.web!.deployedCommit = "1".repeat(40))],
    ["the Web service is UNREADABLE", (e: FirstBaselineReading) => (e.web = null)],
    ["the Cron repo is wrong", (e: FirstBaselineReading) => (e.cron!.repo = "https://github.com/someone/else")],
    ["the Cron branch is wrong", (e: FirstBaselineReading) => (e.cron!.branch = "main")],
    ["Cron Auto Deploy is ON", (e: FirstBaselineReading) => (e.cron!.autoDeploy = "on")],
    ["Cron Auto Deploy is UNREADABLE", (e: FirstBaselineReading) => (e.cron!.autoDeploy = "unknown")],
    ["the Cron deployed commit is wrong", (e: FirstBaselineReading) => (e.cron!.deployedCommit = "1".repeat(40))],
    ["Cron is SUSPENDED", (e: FirstBaselineReading) => (e.cron!.suspended = true)],
    ["Cron suspension is UNREADABLE", (e: FirstBaselineReading) => (e.cron!.suspended = null)],
    ["the Cron schedule is wrong", (e: FirstBaselineReading) => (e.cron!.schedule = "*/5 * * * *")],
    ["the Cron schedule is UNREADABLE", (e: FirstBaselineReading) => (e.cron!.schedule = null)],
    ["the Cron service is UNREADABLE", (e: FirstBaselineReading) => (e.cron = null)],
  ])("%s", (_label, mutate) => {
    const result = env(mutate as (e: FirstBaselineReading) => void)
    expect(result.ok).toBe(false)
    expect(result.recoveryRequired).toBe(true)
    expect(result.refusals.every((f) => f.code.startsWith("ENV_"))).toBe(true)
  })

  it("Web and Cron DIVERGE - both on real commits, but not the same one", () => {
    const result = env((e) => {
      e.web!.deployedCommit = TARGET
      e.cron!.deployedCommit = "2".repeat(40)
    })
    expect(codes(result)).toContain("ENV_WEB_CRON_DIVERGED")
    expect(result.ok).toBe(false)
  })
})

describe("the closure gate FAILS CLOSED on the database", () => {
  it("migrations are not 23/23", () => {
    expect(codes(env((e) => (e.migrationsApplied = 22)))).toContain("ENV_MIGRATIONS")
    expect(codes(env((e) => (e.migrationsTotal = 24)))).toContain("ENV_MIGRATIONS")
    expect(codes(env((e) => (e.migrationsApplied = null)))).toContain("ENV_MIGRATIONS")
  })

  it("Migration 23 is missing or unreadable", () => {
    expect(codes(env((e) => (e.migration23Applied = false)))).toContain("ENV_MIGRATION_23")
    expect(codes(env((e) => (e.migration23Applied = null)))).toContain("ENV_MIGRATION_23")
  })

  it.each([
    ["the table is missing", "tableExists", "ENV_CATALOG_TABLE"],
    ["the FK is not ON DELETE RESTRICT", "teamIdFkOnDeleteRestrict", "ENV_CATALOG_FK_RESTRICT"],
    ["UNIQUE(teamId, version) is missing", "uniqueTeamIdVersion", "ENV_CATALOG_UNIQUE_TEAM_VERSION"],
    ["the as-of index is missing", "asOfIndex", "ENV_CATALOG_AS_OF_INDEX"],
    ["the UPDATE trigger is disabled", "updateTriggerEnabled", "ENV_CATALOG_UPDATE_TRIGGER"],
    ["the DELETE trigger is disabled", "deleteTriggerEnabled", "ENV_CATALOG_DELETE_TRIGGER"],
    ["the TRUNCATE trigger is disabled", "truncateTriggerEnabled", "ENV_CATALOG_TRUNCATE_TRIGGER"],
  ])("catalog: %s", (_label, key, code) => {
    // Each of the seven has its OWN code, so a report names which one failed.
    const asFalse = env((e) => ((e.catalog as unknown as Record<string, boolean | null>)[key] = false))
    expect(codes(asFalse)).toContain(code)
    const asNull = env((e) => ((e.catalog as unknown as Record<string, boolean | null>)[key] = null))
    expect(codes(asNull)).toContain(code)
  })

  it("the whole catalog is unreadable", () => {
    expect(codes(env((e) => (e.catalog = null)))).toContain("ENV_CATALOG_UNREADABLE")
  })

  it("the club count is not 60", () => {
    expect(codes(env((e) => (e.teamCount = 59)))).toContain("ENV_CLUB_COUNT")
    expect(codes(env((e) => (e.teamCount = null)))).toContain("ENV_CLUB_COUNT")
  })
})

describe("the closure gate FAILS CLOSED on TeamEconomicState", () => {
  it("the club count read alongside history is not 60", () => {
    expect(codes(gate((r) => (r.secondBaseline.teamCount = 59)))).toContain("CLUB_COUNT")
  })

  it("history rows are not 60", () => {
    expect(codes(gate((r) => (r.secondBaseline.historyRows = 61)))).toContain("HISTORY_ROWS")
    expect(codes(gate((r) => (r.secondBaseline.historyRows = null)))).toContain("HISTORY_ROWS")
  })

  it("coverage is not 60", () => {
    expect(codes(gate((r) => (r.secondBaseline.historyDistinctTeams = 59)))).toContain("HISTORY_COVERAGE")
    expect(codes(gate((r) => (r.secondBaseline.historyDistinctTeams = null)))).toContain("HISTORY_COVERAGE")
  })

  it("a club has TWO rows and another has none", () => {
    const result = gate((r) => {
      r.secondBaseline.rows![1] = { ...r.secondBaseline.rows![1], teamId: clubIds[0] }
    })
    expect(codes(result)).toContain("DUPLICATE_TEAM_HISTORY")
    expect(codes(result)).toContain("CLUB_NOT_COVERED")
  })

  it("a real club is missing from history entirely", () => {
    const result = gate((r) => {
      r.secondBaseline.rows = r.secondBaseline.rows!.slice(0, 59)
    })
    expect(codes(result)).toContain("ROWS_READBACK")
    expect(codes(result)).toContain("CLUB_NOT_COVERED")
  })

  it("the rows are unreadable, and the roster is unreadable", () => {
    expect(codes(gate((r) => (r.secondBaseline.rows = null)))).toContain("ROWS_UNREADABLE")
    expect(codes(gate((r) => (r.secondBaseline.teamIds = null)))).toContain("TEAM_IDS_UNREADABLE")
  })

  it("a row is not version 1", () => {
    expect(codes(gate((r) => (r.secondBaseline.rows![7] = { ...r.secondBaseline.rows![7], version: 2 })))).toContain("VERSION_NOT_1")
  })

  it("a row's reason is not baseline", () => {
    expect(codes(gate((r) => (r.secondBaseline.rows![7] = { ...r.secondBaseline.rows![7], reason: "repricing" })))).toContain(
      "REASON_NOT_BASELINE"
    )
  })

  it("a row's effectiveAt is AT or AFTER activation", () => {
    expect(codes(gate((r) => (r.secondBaseline.rows![7] = { ...r.secondBaseline.rows![7], effectiveAt: ACTIVATION })))).toContain(
      "EFFECTIVE_AT_NOT_BEFORE_ACTIVATION"
    )
    expect(
      codes(gate((r) => (r.secondBaseline.rows![7] = { ...r.secondBaseline.rows![7], effectiveAt: new Date(ACTIVATION.getTime() + 1000) })))
    ).toContain("EFFECTIVE_AT_NOT_BEFORE_ACTIVATION")
  })

  it("a bad or non-integer weeklyPayroll", () => {
    expect(codes(gate((r) => (r.secondBaseline.rows![3] = { ...r.secondBaseline.rows![3], weeklyPayroll: -1 })))).toContain(
      "WEEKLY_PAYROLL_INVALID"
    )
    expect(codes(gate((r) => (r.secondBaseline.rows![3] = { ...r.secondBaseline.rows![3], weeklyPayroll: 1.5 })))).toContain(
      "WEEKLY_PAYROLL_INVALID"
    )
    expect(
      codes(gate((r) => (r.secondBaseline.rows![3] = { ...r.secondBaseline.rows![3], weeklyPayroll: null as unknown as number })))
    ).toContain("WEEKLY_PAYROLL_INVALID")
  })

  it("a bad or null attendanceQuality", () => {
    expect(
      codes(gate((r) => (r.secondBaseline.rows![3] = { ...r.secondBaseline.rows![3], attendanceQuality: ATTENDANCE_QUALITY_FLOOR - 1 })))
    ).toContain("ATTENDANCE_QUALITY_BELOW_FLOOR")
    expect(
      codes(gate((r) => (r.secondBaseline.rows![3] = { ...r.secondBaseline.rows![3], attendanceQuality: null as unknown as number })))
    ).toContain("ATTENDANCE_QUALITY_BELOW_FLOOR")
  })
})

describe("the closure gate FAILS CLOSED on the frozen pre-activation contract", () => {
  it("any sponsorIncome settlement before activation", () => {
    expect(codes(gate((r) => (r.secondBaseline.activity!.sponsorSettlementCount = 1)))).toContain("SPONSOR_BEFORE_ACTIVATION")
  })

  it("any stadiumMaintenance settlement before activation", () => {
    expect(codes(gate((r) => (r.secondBaseline.activity!.maintenanceSettlementCount = 1)))).toContain("MAINTENANCE_BEFORE_ACTIVATION")
  })

  it("any salary repricing row before activation", () => {
    expect(codes(gate((r) => (r.secondBaseline.activity!.repricingRowCount = 1)))).toContain("REPRICING_BEFORE_ACTIVATION")
  })

  it("an unreadable counter fails SEPARATELY from a non-zero one", () => {
    const sponsor = gate((r) => (r.secondBaseline.activity!.sponsorSettlementCount = null))
    expect(codes(sponsor)).toContain("SPONSOR_COUNT_UNREADABLE")
    expect(codes(sponsor)).not.toContain("SPONSOR_BEFORE_ACTIVATION")
    const maintenance = gate((r) => (r.secondBaseline.activity!.maintenanceSettlementCount = null))
    expect(codes(maintenance)).toContain("MAINTENANCE_COUNT_UNREADABLE")
    expect(codes(maintenance)).not.toContain("MAINTENANCE_BEFORE_ACTIVATION")
  })
})

describe("the closure gate FAILS CLOSED on the acknowledged orphan", () => {
  it("the orphan's row count is not 3", () => {
    expect(codes(gate((r) => (r.secondBaseline.orphan!.transactionCount = 4)))).toContain("ORPHAN_NOT_HISTORICAL_TRUTH")
    expect(codes(gate((r) => (r.secondBaseline.orphan!.transactionCount = 2)))).toContain("ORPHAN_NOT_HISTORICAL_TRUTH")
  })

  it("the orphan's net is not +213629 - a repair or a reversal is a FAILURE, not a fix", () => {
    expect(codes(gate((r) => (r.secondBaseline.orphan!.net = 0)))).toContain("ORPHAN_NOT_HISTORICAL_TRUTH")
    expect(codes(gate((r) => (r.secondBaseline.orphan!.net = 213_628)))).toContain("ORPHAN_NOT_HISTORICAL_TRUTH")
  })

  it("the orphan is unreadable", () => {
    expect(codes(gate((r) => (r.secondBaseline.orphan = null)))).toContain("ORPHAN_UNREADABLE")
  })
})

describe("the closure gate still proves a second first-baseline could not write", () => {
  it("the first-baseline gate PASSING is itself a refusal", () => {
    const result = gate((r) => (r.secondBaseline.firstBaselineGate = { ok: true, refusals: [] }))
    expect(codes(result)).toContain("FIRST_BASELINE_WOULD_STILL_RUN")
    expect(codes(result)).toContain("GATE_NOT_REFUSING_ON_HISTORY")
  })

  it("refusing for some OTHER reason than HISTORY_NOT_EMPTY is not the proof required", () => {
    const result = gate(
      (r) => (r.secondBaseline.firstBaselineGate = { ok: false, refusals: [{ code: "CANONICAL_HEAD", detail: "unrelated" }] })
    )
    expect(codes(result)).toContain("GATE_NOT_REFUSING_ON_HISTORY")
  })
})
