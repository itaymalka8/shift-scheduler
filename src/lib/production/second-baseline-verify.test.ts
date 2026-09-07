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
  evaluateSecondBaselineState,
  type FirstBaselineReading,
  type InsertedRow,
  type OrphanReading,
  type SecondBaselineReading,
} from "@/lib/economy/first-baseline"

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

const clubIds = Array.from({ length: 60 }, (_, i) => `club-${String(i + 1).padStart(2, "0")}`)
const healthyRows = (): InsertedRow[] => clubIds.map((teamId) => ({ teamId, version: 1, reason: "baseline", effectiveAt: STAMPED }))
const healthyOrphan = (): OrphanReading => ({
  fixtureId: FIRST_BASELINE.orphanFixtureId,
  transactionCount: FIRST_BASELINE.orphanTransactionCount,
  net: FIRST_BASELINE.orphanNet,
})

/** The first-baseline gate as it stands AFTER a completed first baseline. */
function gateAfterBaseline(historyRows = 60, historyDistinctTeams = 60, teamCount = 60) {
  const reading: FirstBaselineReading = {
    canonicalHead: null,
    web: null,
    cron: null,
    migrationsApplied: null,
    migrationsTotal: null,
    migration23Applied: null,
    catalog: null,
    teamCount,
    historyRows,
    historyDistinctTeams,
    now: STAMPED,
  }
  return evaluateFirstBaselineGate(reading, FIRST_BASELINE, ACTIVATION)
}

const healthy = (): SecondBaselineReading => ({
  teamCount: 60,
  historyRows: 60,
  historyDistinctTeams: 60,
  rows: healthyRows(),
  teamIds: [...clubIds],
  orphan: healthyOrphan(),
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
      r.rows = [...healthyRows().slice(0, 59), { teamId: "club-01", version: 2, reason: "baseline", effectiveAt: STAMPED }]
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

  it("touches NO Render and NO Neon surface", () => {
    expect(runnerCode).not.toMatch(/RENDER_API_KEY|NEON_API_KEY|render-ops|neon-ops|render-client|neon-client/)
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

  it("holds EXACTLY ONE credential - the database URL - on EXACTLY ONE step", () => {
    const envBlocks = [...workflowBody.matchAll(/^\s+env:\s*$/gm)]
    expect(envBlocks).toHaveLength(1)
    const start = workflowBody.indexOf("env:")
    const keys = [...workflowBody.slice(start).matchAll(/^\s+([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1])
    expect(keys).toEqual(["PRODUCTION_DATABASE_URL"])
  })

  it("has NO PRODUCTION_WRITE_CONFIRM, so no mutating command could run", () => {
    expect(workflowBody).not.toContain("PRODUCTION_WRITE_CONFIRM")
  })

  it("has NO NEON_API_KEY and NO RENDER_API_KEY", () => {
    expect(workflowBody).not.toContain("NEON_API_KEY")
    expect(workflowBody).not.toContain("RENDER_API_KEY")
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
