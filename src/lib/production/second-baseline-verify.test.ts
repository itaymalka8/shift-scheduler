/**
 * THE SECOND BASELINE VERIFICATION - contract and boundary tests.
 *
 * The verification's whole value is that it CANNOT write. So most of what
 * follows is proof of absence: no write confirmation, no transaction, no lock,
 * no append primitive, no INSERT/UPDATE/DELETE, and a workflow that is never
 * handed a credential capable of changing anything.
 *
 * The "0 new rows" claim is the interesting one. It is established WITHOUT
 * running the baseline: the strict first-baseline gate is evaluated against the
 * current state and required to REFUSE with HISTORY_NOT_EMPTY. That is the same
 * code path that would do the writing, asked whether it could - rather than run
 * and observed to decline.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  FIRST_BASELINE,
  evaluateFirstBaselineGate,
  evaluateProductionEnvironmentGate,
  evaluateSecondBaselineState,
  evaluateSecondBaselineVerification,
  type EconomyActivityReading,
  type FirstBaselineReading,
  type HistoryRow,
  type OrphanReading,
  type SecondBaselineReading,
} from "@/lib/economy/first-baseline"
import { ATTENDANCE_QUALITY_FLOOR } from "@/lib/stadium/attendance-quality"

const ROOT = join(__dirname, "..", "..", "..")
const RUNNER_PATH = join(ROOT, "scripts/production/economy-second-baseline-verify.ts")
const runner = readFileSync(RUNNER_PATH, "utf8")
/** Comments describe what the command must NOT do, so they are stripped before scanning for it. */
const runnerCode = runner.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

const WORKFLOW_PATH = join(ROOT, "production/workflows/goalx-economy-second-baseline-verify.yml")
const workflow = readFileSync(WORKFLOW_PATH, "utf8")
const workflowBody = workflow
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n")

const ACTIVATION = new Date("2026-09-24T13:00:00.000Z")
const STAMPED = new Date("2026-09-07T12:32:10.000Z")

const TARGET = FIRST_BASELINE.targetCommit
const clubIds = Array.from({ length: 60 }, (_, i) => `club-${String(i + 1).padStart(2, "0")}`)
const healthyRows = (): HistoryRow[] =>
  clubIds.map((teamId) => ({
    teamId,
    version: 1,
    reason: "baseline",
    effectiveAt: STAMPED,
    weeklyPayroll: 41_000,
    attendanceQuality: ATTENDANCE_QUALITY_FLOOR + 120,
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

/** A FULL, healthy Production environment reading - the same shape the first baseline gates on. */
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

/** The first-baseline gate as it stands AFTER a completed first baseline. */
function gateAfterBaseline(historyRows = 60, historyDistinctTeams = 60, teamCount = 60) {
  return evaluateFirstBaselineGate(healthyEnvironment(historyRows, historyDistinctTeams, teamCount), FIRST_BASELINE, ACTIVATION)
}

const healthy = (): SecondBaselineReading => ({
  environment: healthyEnvironment(),
  teamCount: 60,
  historyRows: 60,
  historyDistinctTeams: 60,
  rows: healthyRows(),
  teamIds: [...clubIds],
  orphan: healthyOrphan(),
  activity: healthyActivity(),
  firstBaselineGate: gateAfterBaseline(),
  now: STAMPED,
})

const verify = (mutate: (reading: SecondBaselineReading) => void = () => {}) => {
  const reading = healthy()
  mutate(reading)
  return evaluateSecondBaselineState(reading, FIRST_BASELINE, ACTIVATION)
}
const codes = (result: { refusals: { code: string }[] }) => result.refusals.map((r) => r.code)

describe("the second baseline verification passes only on the exact post-baseline state", () => {
  it("PASSES on 60 clubs, 60 rows, 60/60 coverage, all invariants held", () => {
    expect(verify()).toEqual({ ok: true, refusals: [] })
  })

  it("FAILS on a club count that is not 60", () => {
    expect(codes(verify((r) => (r.teamCount = 61)))).toContain("CLUB_COUNT")
    expect(codes(verify((r) => (r.teamCount = null)))).toContain("CLUB_COUNT")
  })

  it("FAILS on a row count that is not 60", () => {
    expect(codes(verify((r) => (r.historyRows = 59)))).toContain("HISTORY_ROWS")
    expect(codes(verify((r) => (r.historyRows = 61)))).toContain("HISTORY_ROWS")
    expect(codes(verify((r) => (r.historyRows = null)))).toContain("HISTORY_ROWS")
  })

  it("FAILS on incomplete distinct coverage", () => {
    expect(codes(verify((r) => (r.historyDistinctTeams = 59)))).toContain("HISTORY_COVERAGE")
  })

  it("FAILS when a real club has no history, even if the counts look right", () => {
    const result = verify((r) => {
      // 60 rows, but two belong to one club and one club is missing.
      r.rows = [
        ...healthyRows().slice(0, 59),
        { teamId: "club-01", version: 2, reason: "baseline", effectiveAt: STAMPED, weeklyPayroll: 41_000, attendanceQuality: ATTENDANCE_QUALITY_FLOOR },
      ]
    })
    expect(result.ok).toBe(false)
    expect(codes(result)).toEqual(expect.arrayContaining(["DUPLICATE_TEAM_HISTORY", "CLUB_NOT_COVERED", "VERSION_NOT_1"]))
  })

  it("FAILS on any row whose version is not 1", () => {
    expect(codes(verify((r) => (r.rows![7] = { ...r.rows![7], version: 2 })))).toContain("VERSION_NOT_1")
  })

  it("FAILS on any row whose reason is not baseline", () => {
    expect(codes(verify((r) => (r.rows![7] = { ...r.rows![7], reason: "registration" })))).toContain("REASON_NOT_BASELINE")
  })

  it("FAILS on any row stamped at or after activation", () => {
    expect(codes(verify((r) => (r.rows![7] = { ...r.rows![7], effectiveAt: ACTIVATION })))).toContain("EFFECTIVE_AT_NOT_BEFORE_ACTIVATION")
  })

  it("FAILS when the acknowledged orphan is not historical truth", () => {
    expect(codes(verify((r) => (r.orphan = { ...healthyOrphan(), transactionCount: 4 })))).toContain("ORPHAN_NOT_HISTORICAL_TRUTH")
    expect(codes(verify((r) => (r.orphan = { ...healthyOrphan(), net: 1 })))).toContain("ORPHAN_NOT_HISTORICAL_TRUTH")
  })

  it("treats every UNREADABLE value as a failure, never as a pass", () => {
    expect(codes(verify((r) => (r.rows = null)))).toContain("ROWS_UNREADABLE")
    expect(codes(verify((r) => (r.teamIds = null)))).toContain("TEAM_IDS_UNREADABLE")
    expect(codes(verify((r) => (r.orphan = null)))).toContain("ORPHAN_UNREADABLE")
  })
})

describe("ZERO NEW ROWS is proved without writing", () => {
  it("requires the strict first-baseline gate to REFUSE", () => {
    const stillOpen = verify((r) => (r.firstBaselineGate = { ok: true, refusals: [] }))
    expect(stillOpen.ok).toBe(false)
    expect(codes(stillOpen)).toEqual(expect.arrayContaining(["FIRST_BASELINE_WOULD_STILL_RUN", "GATE_NOT_REFUSING_ON_HISTORY"]))
  })

  it("requires the refusal to be HISTORY_NOT_EMPTY specifically", () => {
    // Refusing for an unrelated reason is not proof that a second run would
    // write nothing - the history could still be empty.
    const wrongReason = verify((r) => (r.firstBaselineGate = { ok: false, refusals: [{ code: "CRON_NOT_ACTIVE", detail: "x" }] }))
    expect(codes(wrongReason)).toContain("GATE_NOT_REFUSING_ON_HISTORY")
  })

  it("the REAL gate, given the post-baseline state, refuses on HISTORY_NOT_EMPTY", () => {
    const gate = gateAfterBaseline(60, 60, 60)
    expect(gate.ok).toBe(false)
    expect(gate.refusals.map((r) => r.code)).toEqual(expect.arrayContaining(["HISTORY_NOT_EMPTY", "HISTORY_COVERAGE_NOT_ZERO"]))
  })

  it("and would NOT refuse on history if the league were still empty - so the check is meaningful", () => {
    const gate = gateAfterBaseline(0, 0, 60)
    expect(gate.refusals.map((r) => r.code)).not.toContain("HISTORY_NOT_EMPTY")
  })
})

describe("the FULL Production environment gate is enforced, not skipped", () => {
  it("uses the SAME authority the first baseline used", () => {
    // One definition of "Production is in the approved state", read by both.
    expect(evaluateProductionEnvironmentGate(healthyEnvironment(), FIRST_BASELINE, ACTIVATION)).toEqual({ ok: true, refusals: [] })
  })

  const envCases: [string, (env: FirstBaselineReading) => void, string][] = [
    ["a canonical head that is not the target", (env) => (env.canonicalHead = "1111111111111111111111111111111111111111"), "ENV_CANONICAL_HEAD"],
    ["an unreadable canonical head", (env) => (env.canonicalHead = null), "ENV_CANONICAL_HEAD"],
    ["a wrong Web source", (env) => (env.web!.repo = "https://github.com/itaymalka8/shift-scheduler"), "ENV_WEB_SOURCE"],
    ["a wrong Cron source", (env) => (env.cron!.repo = "https://github.com/itaymalka8/shift-scheduler"), "ENV_CRON_SOURCE"],
    ["a wrong Web branch", (env) => (env.web!.branch = "main"), "ENV_WEB_BRANCH"],
    ["a wrong Cron branch", (env) => (env.cron!.branch = "main"), "ENV_CRON_BRANCH"],
    ["Auto Deploy ON for Web", (env) => (env.web!.autoDeploy = "on"), "ENV_WEB_AUTO_DEPLOY"],
    ["an UNREADABLE Auto Deploy for Cron", (env) => (env.cron!.autoDeploy = "unknown"), "ENV_CRON_AUTO_DEPLOY"],
    ["a Web deployed commit that is not the target", (env) => (env.web!.deployedCommit = "1111111111111111111111111111111111111111"), "ENV_WEB_COMMIT"],
    ["a Cron deployed commit that is not the target", (env) => (env.cron!.deployedCommit = "1111111111111111111111111111111111111111"), "ENV_CRON_COMMIT"],
    ["a suspended Cron", (env) => (env.cron!.suspended = true), "ENV_CRON_NOT_ACTIVE"],
    ["a wrong Cron schedule", (env) => (env.cron!.schedule = "*/5 * * * *"), "ENV_CRON_SCHEDULE"],
    ["migrations that are not 23/23", (env) => (env.migrationsApplied = 22), "ENV_MIGRATIONS"],
    ["a missing Migration 23", (env) => (env.migration23Applied = false), "ENV_MIGRATION_23"],
    ["a disabled UPDATE protection trigger", (env) => (env.catalog!.updateTriggerEnabled = false), "ENV_CATALOG_UPDATE_TRIGGER"],
    ["a disabled DELETE protection trigger", (env) => (env.catalog!.deleteTriggerEnabled = false), "ENV_CATALOG_DELETE_TRIGGER"],
    ["a disabled TRUNCATE protection trigger", (env) => (env.catalog!.truncateTriggerEnabled = false), "ENV_CATALOG_TRUNCATE_TRIGGER"],
    ["a missing as-of index", (env) => (env.catalog!.asOfIndex = false), "ENV_CATALOG_AS_OF_INDEX"],
    ["an unreadable catalog", (env) => (env.catalog = null), "ENV_CATALOG_UNREADABLE"],
    ["an activation boundary already reached", (env) => (env.now = new Date(ACTIVATION.getTime())), "ENV_ACTIVATION_NOT_FUTURE"],
    ["an unreadable Web service", (env) => (env.web = null), "ENV_WEB_UNREADABLE"],
    ["an unreadable Cron service", (env) => (env.cron = null), "ENV_CRON_UNREADABLE"],
  ]

  it.each(envCases)("FAILS the verification on %s", (_label, mutate, code) => {
    const result = verify((r) => mutate(r.environment))
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain(code)
  })

  it("reports environment refusals under an ENV_ prefix, so their origin is unambiguous", () => {
    const result = verify((r) => (r.environment.canonicalHead = null))
    expect(codes(result).filter((code) => code.startsWith("ENV_")).length).toBeGreaterThan(0)
  })
})

describe("the counts go through the canonical second-baseline predicate", () => {
  it("evaluateSecondBaselineVerification is the authority, and it agrees on the healthy state", () => {
    expect(evaluateSecondBaselineVerification({ historyRows: 60, historyDistinctTeams: 60, teamCount: 60, rowsWritten: 0 })).toEqual({
      ok: true,
      refusals: [],
    })
  })

  it("its refusal codes are the ones the verification reports", () => {
    const direct = evaluateSecondBaselineVerification({ historyRows: 59, historyDistinctTeams: 59, teamCount: 60, rowsWritten: 0 })
    const viaState = verify((r) => {
      r.historyRows = 59
      r.historyDistinctTeams = 59
    })
    for (const code of direct.refusals.map((refusal) => refusal.code)) expect(codes(viaState)).toContain(code)
  })

  it("rowsWritten is 0 by construction - this command has no write path to produce anything else", () => {
    // The runner cannot write at all...
    expect(/\$executeRaw|appendTeamEconomicState|\$transaction/.test(runnerCode)).toBe(false)
    // ...so the predicate is handed a literal 0 in the core module, rather than
    // a counter that something could increment.
    const core = readFileSync(join(ROOT, "src/lib/economy/first-baseline.ts"), "utf8")
    expect(core).toContain("rowsWritten: 0,")
  })
})

describe("the economic aggregates and the repricing marker", () => {
  it("FAILS on a negative or non-integer weeklyPayroll", () => {
    expect(codes(verify((r) => (r.rows![3] = { ...r.rows![3], weeklyPayroll: -1 })))).toContain("WEEKLY_PAYROLL_INVALID")
    expect(codes(verify((r) => (r.rows![3] = { ...r.rows![3], weeklyPayroll: 1.5 })))).toContain("WEEKLY_PAYROLL_INVALID")
  })

  it("FAILS on an attendanceQuality below the canonical floor", () => {
    expect(codes(verify((r) => (r.rows![3] = { ...r.rows![3], attendanceQuality: ATTENDANCE_QUALITY_FLOOR - 1 })))).toContain(
      "ATTENDANCE_QUALITY_BELOW_FLOOR"
    )
  })

  it("accepts attendanceQuality exactly AT the floor - a squad of replacement players is legal", () => {
    expect(verify((r) => (r.rows![3] = { ...r.rows![3], attendanceQuality: ATTENDANCE_QUALITY_FLOOR })).ok).toBe(true)
  })

  it("FAILS if any repricing row is in history while activation is still ahead", () => {
    expect(codes(verify((r) => (r.activity!.repricingRowCount = 1)))).toContain("REPRICING_BEFORE_ACTIVATION")
    expect(codes(verify((r) => (r.activity!.repricingRowCount = null)))).toContain("REPRICING_BEFORE_ACTIVATION")
  })

  it("REQUIRES the sponsor and maintenance counters to be READABLE", () => {
    expect(codes(verify((r) => (r.activity!.sponsorSettlementCount = null)))).toContain("SPONSOR_COUNT_UNREADABLE")
    expect(codes(verify((r) => (r.activity!.maintenanceSettlementCount = null)))).toContain("MAINTENANCE_COUNT_UNREADABLE")
  })

  it("does NOT assert a specific settlement count - it has no authority for what those ought to be", () => {
    // A non-zero count is reported, not refused. Inventing an expected number
    // would be asserting something this command cannot know.
    expect(verify((r) => (r.activity!.sponsorSettlementCount = 240)).ok).toBe(true)
    expect(verify((r) => (r.activity!.maintenanceSettlementCount = 17)).ok).toBe(true)
  })

  it("FAILS when the activity counters are entirely unreadable", () => {
    expect(codes(verify((r) => (r.activity = null)))).toContain("ACTIVITY_UNREADABLE")
  })

  it("the runner measures sponsor and maintenance through the canonical typed constants", () => {
    expect(runnerCode).toContain('WHERE "type" = ${SPONSOR_TRANSACTION_TYPE}')
    expect(runnerCode).toContain('WHERE "type" = ${MAINTENANCE_TRANSACTION_TYPE}')
    expect(runnerCode).toContain(`WHERE "reason" = 'repricing'`)
  })

  it("the runner reads weeklyPayroll and attendanceQuality from the history rows", () => {
    expect(runnerCode).toContain('SELECT "teamId", "version", "reason", "effectiveAt", "weeklyPayroll", "attendanceQuality"')
  })
})

describe("the verifier command has NO write path", () => {
  it("never requires or sets PRODUCTION_WRITE_CONFIRM", () => {
    expect(runnerCode).not.toContain("PRODUCTION_WRITE_CONFIRM")
    expect(runnerCode).not.toContain("assertProductionWriteConfirmed")
  })

  it("opens NO transaction and takes NO lock", () => {
    expect(runnerCode).not.toContain("$transaction")
    expect(runnerCode).not.toMatch(/acquire\w*Lock|acquireEconomyHistory|acquirePhase3RActivation|lockTeamRoster/)
  })

  it("imports NO append primitive and issues NO write statement", () => {
    expect(runnerCode).not.toContain("appendTeamEconomicState")
    expect(runnerCode).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/)
    expect(runnerCode).not.toMatch(/\$executeRaw/)
    expect(runnerCode).not.toMatch(/\.create\(|\.createMany\(|\.update\(|\.updateMany\(|\.delete\(|\.deleteMany\(|\.upsert\(/)
  })

  it("touches NO Neon surface at all, and only READ helpers on Render", () => {
    expect(runnerCode).not.toMatch(/NEON_API_KEY|neon-ops|neon-client|createBackupBranch|deleteBranch/)
    expect(runnerCode).not.toMatch(/updateServiceSource|createDeploy|suspendCron|resumeCron|setWebServiceEnvVar/)
  })

  it("proves the FULL environment gate rather than skipping it", () => {
    expect(runnerCode).toContain("evaluateProductionEnvironmentGate")
    expect(runnerCode).toContain("readCanonicalHead")
    expect(runnerCode).toContain("getWebServiceConfig")
    expect(runnerCode).toContain("getCronServiceConfig")
    expect(runnerCode).toContain("readCatalog")
    expect(runnerCode).toContain("_prisma_migrations")
  })

  it("proves zero new rows through the GATE, not by running the baseline", () => {
    expect(runnerCode).toContain("evaluateFirstBaselineGate")
    expect(runnerCode).toContain("evaluateSecondBaselineState")
    expect(runnerCode).not.toContain("runFirstBaselineTransaction")
  })

  it("reads the orphan through the canonical prefix and never repairs it", () => {
    expect(runnerCode).toContain("orphanReferencePrefix")
    expect(runnerCode).toContain('starts_with("referenceId", ${prefix})')
    expect(runnerCode).not.toMatch(/"fixtureId"/)
  })

  it("is a SEPARATE command from both baselines", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
    expect(pkg.scripts["prod:economy:second-baseline-verify"]).toBe("tsx scripts/production/economy-second-baseline-verify.ts")
    expect(pkg.scripts["prod:economy:first-baseline"]).toBe("tsx scripts/production/economy-first-baseline.ts")
    expect(pkg.scripts["prod:economy:second-baseline-verify"]).not.toBe(pkg.scripts["prod:economy:first-baseline"])
    expect(pkg.scripts["prod:economy:second-baseline-verify"]).not.toBe(pkg.scripts["prod:economy:baseline"])
  })
})

describe("Workflow D - read-only dispatch surface", () => {
  it("is MANUAL DISPATCH ONLY, with no inputs", () => {
    expect(workflowBody).toMatch(/^on:\n\s+workflow_dispatch:\s*$/m)
    expect(workflowBody).not.toContain("inputs:")
    for (const trigger of ["push:", "pull_request:", "schedule:", "repository_dispatch:", "workflow_run:", "workflow_call:"]) {
      expect(workflowBody).not.toContain(trigger)
    }
  })

  it("grants contents: read and nothing more", () => {
    expect(workflowBody).toMatch(/^permissions:\n\s+contents: read\s*$/m)
    expect(workflowBody).not.toContain("contents: write")
  })

  it("pins an immutable SHA placeholder and does not persist credentials", () => {
    expect(workflowBody).toMatch(/ref: __TOOLING_SHA__/)
    expect((workflowBody.match(/^\s+ref:/gm) ?? []).length).toBe(1)
    expect(workflowBody).toContain("persist-credentials: false")
  })

  it("holds its credentials on EXACTLY ONE step, and they are exactly the three READS", () => {
    const envBlocks = [...workflowBody.matchAll(/^\s+env:\s*$/gm)]
    expect(envBlocks).toHaveLength(1)
    const start = workflowBody.indexOf("env:")
    const keys = [...workflowBody.slice(start).matchAll(/^\s+([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1])
    // Render and GitHub are needed to IDENTIFY Production before measuring it.
    // Every call the command makes with them is a read.
    expect([...keys].sort()).toEqual(["GITHUB_TOKEN", "PRODUCTION_DATABASE_URL", "RENDER_API_KEY"])
  })

  it("has NO PRODUCTION_WRITE_CONFIRM, so no mutating command could run", () => {
    expect(workflowBody).not.toContain("PRODUCTION_WRITE_CONFIRM")
  })

  it("has NO NEON_API_KEY - no Neon branch can be created or deleted", () => {
    expect(workflowBody).not.toContain("NEON_API_KEY")
  })

  it("the Render key it does hold cannot mutate, because every mutating helper needs the absent write confirmation", () => {
    expect(workflowBody).toContain("RENDER_API_KEY")
    expect(workflowBody).not.toContain("PRODUCTION_WRITE_CONFIRM")
    // The command only calls read helpers.
    expect(runnerCode).toMatch(/getWebServiceConfig|getCronServiceConfig|getCronStatus|getLatestDeploy/)
    expect(runnerCode).not.toMatch(/updateServiceSource|createDeploy|suspendCron|resumeCron|setWebServiceEnvVar|setAutoDeploy/)
  })

  it("runs ONE fixed literal read-only command", () => {
    const runs = (workflowBody.match(/^\s+run: (.+)$/gm) ?? []).map((line) => line.replace(/^\s+run:\s*/, ""))
    expect(runs).toEqual(["npm ci", "npm run prod:economy:second-baseline-verify"])
  })

  it("never runs either baseline and never chains", () => {
    expect(workflowBody).not.toMatch(/prod:economy:baseline|prod:economy:first-baseline/)
    for (const chaining of ["actions/github-script", "gh workflow run", "needs:"]) expect(workflowBody).not.toContain(chaining)
  })

  it("is not reachable from this repository - the reviewed copy is outside .github/workflows", () => {
    expect(WORKFLOW_PATH).toContain("production/workflows")
    expect(WORKFLOW_PATH).not.toContain(".github")
  })
})
