/**
 * WORKFLOW E AND THE TWO NEW CLOSURE RUNNERS - boundary and contract tests.
 *
 * The closure audit's whole value is that it CANNOT change anything it is
 * measuring, so most of what follows is proof of absence: no write
 * confirmation, no transaction, no append primitive, no INSERT/UPDATE/DELETE/
 * TRUNCATE/MERGE, no Prisma writer, no Render mutation helper, no Neon branch
 * mutation helper, no ref write, no workflow dispatch, no chaining.
 *
 * IT ALSO CARRIES THE RAW-SQL CONTRACT. A second read-only Production runner
 * now issues raw SQL, and the defect class that failed Workflow C run
 * 34113346563 with PostgreSQL 42703 (a column that does not exist, written
 * from memory) does not care which file it lands in. The closure gate's
 * statements are validated against the SAME Prisma DMMF physical-column
 * authority the first-baseline runner's are.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { FIRST_BASELINE, MAINTENANCE_TRANSACTION_TYPE, SPONSOR_TRANSACTION_TYPE } from "@/lib/economy/first-baseline"
import { FINANCIAL_TRANSACTION_TYPES } from "@/lib/economy/service"
import { PHASE_3R_CLOSURE } from "./phase3r-closure"
import { physicalColumns, quotedColumns, rawStatements, relationFields, undeclaredColumnUses } from "./dmmf-columns"

const ROOT = join(__dirname, "..", "..", "..")

const GATE_PATH = join(ROOT, "scripts/production/phase3r-closure-gate.ts")
const RETENTION_PATH = join(ROOT, "scripts/production/phase3r-backup-retention-audit.ts")
const WORKFLOW_PATH = join(ROOT, "production/workflows/goalx-phase3r-closure-audit.yml")

const gate = readFileSync(GATE_PATH, "utf8")
const retention = readFileSync(RETENTION_PATH, "utf8")
const workflow = readFileSync(WORKFLOW_PATH, "utf8")

/** Comments describe what a command must NOT do, so they are stripped before scanning for it. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
const gateCode = strip(gate)
const retentionCode = strip(retention)
const runners: [string, string][] = [
  ["phase3r-closure-gate.ts", gateCode],
  ["phase3r-backup-retention-audit.ts", retentionCode],
]

const workflowBody = workflow
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n")

/** The six audits the closure workflow runs, in order, as exact npm script names. */
const CLOSURE_COMMANDS = [
  "prod:economy:audit",
  "prod:economy:activation",
  "prod:post-deploy-check",
  "prod:retention:verify",
  "prod:phase3r:backup-retention-audit",
  "prod:phase3r:closure-gate",
] as const

// ===========================================================================
// THE WORKFLOW
// ===========================================================================

describe("Workflow E - the closure audit dispatch surface", () => {
  it("is MANUAL DISPATCH ONLY, with no inputs", () => {
    expect(workflowBody).toContain("on:\n  workflow_dispatch:")
    expect(workflowBody).not.toContain("inputs:")
    expect(workflowBody).not.toContain("schedule:")
    expect(workflowBody).not.toContain("push:")
    expect(workflowBody).not.toContain("pull_request:")
    expect(workflowBody).not.toContain("repository_dispatch:")
    expect(workflowBody).not.toContain("workflow_call:")
    expect(workflowBody).not.toContain("workflow_run:")
  })

  it("grants contents: read and nothing more", () => {
    expect(workflowBody).toContain("permissions:\n  contents: read")
    expect(workflowBody).not.toMatch(/contents:\s*write/)
    expect(workflowBody).not.toMatch(/\bpackages:|actions:\s*write|id-token:|deployments:|pull-requests:\s*write/)
  })

  it("pins an IMMUTABLE SHA placeholder and does not persist credentials", () => {
    expect(workflowBody).toContain("ref: __TOOLING_SHA__")
    expect(workflowBody).toContain("persist-credentials: false")
    // The reviewed copy never pins a branch head.
    expect(workflowBody).not.toMatch(/ref:\s*(main|master|HEAD)\b/)
  })

  it("runs Node 22", () => {
    expect(workflowBody).toContain("node-version: 22")
  })

  it("has NO EXECUTABLE PRODUCTION_WRITE_CONFIRM - the header may explain its absence", () => {
    // Every mutating command in this project asserts it before its first
    // write, so its total absence from the executable body is what makes the
    // whole workflow unable to write. The header DOCUMENTS that absence, and
    // documentation must never fail a test about code - so the check runs on
    // the comment-stripped body, and separately forbids any assignment form
    // anywhere in the raw bytes, commented out or not.
    expect(workflowBody).not.toContain("PRODUCTION_WRITE_CONFIRM")
    expect(workflow).not.toMatch(/PRODUCTION_WRITE_CONFIRM\s*[:=]/)
  })

  it("gives NEON_API_KEY to the backup-retention step ALONE", () => {
    const steps = workflowBody.split(/\n      - name: /)
    const withNeon = steps.filter((step) => step.includes("NEON_API_KEY"))
    expect(withNeon).toHaveLength(1)
    expect(withNeon[0]).toContain("prod:phase3r:backup-retention-audit")
    // That step gets nothing else.
    expect(withNeon[0]).not.toContain("PRODUCTION_DATABASE_URL")
    expect(withNeon[0]).not.toContain("RENDER_API_KEY")
  })

  it("gives RENDER_API_KEY and GITHUB_TOKEN to the final closure gate ALONE", () => {
    const steps = workflowBody.split(/\n      - name: /)
    const withRender = steps.filter((step) => step.includes("RENDER_API_KEY"))
    expect(withRender).toHaveLength(1)
    expect(withRender[0]).toContain("prod:phase3r:closure-gate")
    const withToken = steps.filter((step) => step.includes("GITHUB_TOKEN"))
    expect(withToken).toHaveLength(1)
    expect(withToken[0]).toContain("prod:phase3r:closure-gate")
  })

  it("uses ONLY the three approved read secrets, plus Neon for GETs", () => {
    const secrets = new Set([...workflowBody.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))
    expect([...secrets].sort()).toEqual(["GITHUB_TOKEN", "NEON_API_KEY", "PRODUCTION_DATABASE_URL", "RENDER_API_KEY"])
  })

  it("runs EXACTLY the six fixed closure commands, each once, in order", () => {
    const invoked = [...workflowBody.matchAll(/npm run (prod:[a-z0-9:-]+)/g)].map((m) => m[1])
    expect(invoked).toEqual([...CLOSURE_COMMANDS])
    // Every one is a real script, and none carries a flag or argument separator.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
    for (const command of CLOSURE_COMMANDS) expect(typeof pkg.scripts[command]).toBe("string")
    expect(workflowBody).not.toMatch(/npm run [^\n]*--/)
  })

  it("NEVER runs a baseline, a deploy, a prune or any other mutating command", () => {
    for (const forbidden of [
      "prod:economy:first-baseline",
      "prod:economy:baseline",
      "prod:deploy:safe",
      "prod:deploy:trigger",
      "prod:backup:create",
      "prod:backup:prune",
      "prod:render:autodeploy",
      "prod:cron:suspend",
      "prod:cron:resume",
      "prod:render:source-migrate",
      "prod:economy:recalibrate",
      "prod:eras:backfill",
      "prod:eras:classify",
    ]) {
      expect(workflowBody).not.toContain(forbidden)
    }
  })

  it("does not CHAIN - it dispatches nothing, re-runs nothing and pushes nothing", () => {
    expect(workflowBody).not.toMatch(/gh workflow run|workflow_dispatch.*\bcreate\b|actions\/github-script/)
    expect(workflowBody).not.toMatch(/\bgit (push|tag|commit|apply)\b/)
    expect(workflowBody).not.toMatch(/peter-evans|create-pull-request|softprops\/action-gh-release/)
    // The only actions it uses are checkout and setup-node.
    const uses = [...workflowBody.matchAll(/uses:\s*([^\s]+)/g)].map((m) => m[1])
    expect(uses).toEqual(["actions/checkout@v4", "actions/setup-node@v4"])
  })

  it("REQUIRES each audit's exact terminal verdict, not merely a zero exit", () => {
    expect(workflowBody).toContain("grep -qxF 'ECONOMY AUDIT: REPORTED'")
    expect(workflowBody).toContain("grep -qxF 'PHASE 3R ACTIVATION CHECK: PASS'")
    expect(workflowBody).toContain("grep -qxF 'PRODUCTION POST-DEPLOY CHECK: PASS'")
    expect(workflowBody).toContain("grep -qxF 'HISTORICAL RETENTION VERIFICATION: PASS'")
    expect(workflowBody).toContain("grep -qxF 'PHASE 3R BACKUP RETENTION AUDIT: PASS'")
    expect(workflowBody).toContain("grep -qxF 'FINAL FROZEN PRODUCTION GATE: PASS'")
    expect(workflowBody).toContain("grep -qxF 'RECOVERY REQUIRED: NO'")
    // The economy audit's failure lines must be ABSENT, not merely unread.
    expect(workflowBody).toContain("! grep -q 'PHASE 3R AUDIT FAILURE'")
    expect(workflowBody).toContain("! grep -q 'ACTIVATION GATE: FAIL'")
  })

  it("captures output by REDIRECTION, never a pipe - a pipeline would mask the exit status", () => {
    const runLines = workflowBody.split("\n").filter((line) => line.includes("npm run prod:"))
    expect(runLines).toHaveLength(6)
    for (const line of runLines) {
      expect(line).toContain('> "$RUNNER_TEMP/')
      // No PIPELINE. `||` is a shell OR, not a pipe, and is how the captured
      // log is printed before the step fails - so a lone `|` is what is
      // forbidden, since only a pipeline can swallow the exit status.
      expect(line.replace(/\|\|/g, "")).not.toContain("|")
    }
  })

  it("prints the closure summary but NEVER declares Phase 3R closed", () => {
    expect(workflowBody).toContain("echo 'PHASE 3R CLOSURE AUDIT: PASS'")
    expect(workflow).not.toMatch(/PHASE 3R CLOSED|PHASE 3R IS CLOSED|CLOSURE: CLOSED/)
    // The summary is the LAST step, so it is reachable only after every audit.
    expect(workflowBody.lastIndexOf("Closure audit summary")).toBeGreaterThan(workflowBody.lastIndexOf("npm run prod:phase3r:closure-gate"))
  })

  it("is not reachable from this repository - the reviewed copy lives outside .github/workflows", () => {
    expect(WORKFLOW_PATH).toContain(join("production", "workflows"))
    expect(() => readFileSync(join(ROOT, ".github/workflows/goalx-phase3r-closure-audit.yml"), "utf8")).toThrow()
  })
})

// ===========================================================================
// THE RUNNERS: NO WRITE PATH
// ===========================================================================

describe("the closure runners have NO write path", () => {
  it.each(runners)("%s never requires or sets PRODUCTION_WRITE_CONFIRM", (_name, code) => {
    expect(code).not.toContain("PRODUCTION_WRITE_CONFIRM")
    expect(code).not.toContain("assertProductionWriteConfirmed")
  })

  it.each(runners)("%s opens NO transaction and takes NO lock", (_name, code) => {
    expect(code).not.toContain("$transaction")
    expect(code).not.toMatch(/acquire\w*Lock|acquireEconomyHistory|acquirePhase3RActivation|lockTeamRoster|lockTeamSquads/)
  })

  it.each(runners)("%s imports NO append primitive and issues NO write statement", (_name, code) => {
    expect(code).not.toContain("appendTeamEconomicState")
    expect(code).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bMERGE\b/)
    expect(code).not.toMatch(/\$executeRaw|\$executeRawUnsafe|\$queryRawUnsafe/)
    expect(code).not.toMatch(/\.create\(|\.createMany\(|\.update\(|\.updateMany\(|\.delete\(|\.deleteMany\(|\.upsert\(/)
  })

  it.each(runners)("%s touches NO Render mutation helper", (_name, code) => {
    expect(code).not.toMatch(/updateServiceSource|createDeploy|suspendCron|resumeCron|setWebServiceEnvVar|setAutoDeploy/)
  })

  it.each(runners)("%s touches NO Neon mutation helper", (_name, code) => {
    expect(code).not.toMatch(/createBackupBranch|deleteBackupBranch|createBranch|deleteBranch|restoreBranch|resetBranch|renameBranch/)
  })

  it.each(runners)("%s writes no git ref and dispatches no workflow", (_name, code) => {
    expect(code).not.toMatch(/git push|git tag|createRef|updateRef|workflow_dispatch|rerunWorkflow|actions_run_trigger/)
  })

  it("the closure gate holds NO Neon credential at all", () => {
    expect(gateCode).not.toMatch(/NEON_API_KEY|neon-ops|neon-client|neon-discovery/)
  })

  it("the retention audit holds NO database or Render credential at all", () => {
    expect(retentionCode).not.toMatch(/PRODUCTION_DATABASE_URL|PrismaClient|RENDER_API_KEY|render-ops/)
  })

  it("the retention audit imports ONLY GET helpers from neon-ops", () => {
    const imported = /import \{([^}]*)\} from "\.\.\/\.\.\/src\/lib\/production\/neon-ops"/.exec(retentionCode)
    expect(imported).not.toBeNull()
    const names = imported![1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
    expect(names.sort()).toEqual(["getProductionBranch", "getProjectDetails", "listBranches"])
  })
})

// ===========================================================================
// THE RUNNERS: THE AUTHORITIES THEY USE
// ===========================================================================

describe("the closure runners defer to the existing authorities", () => {
  it("the retention audit imports the prune authority's floor rather than restating a number", () => {
    expect(retentionCode).toContain('import { MINIMUM_RETAINED_BACKUPS } from "../../src/lib/production/backup-prune"')
    expect(/MINIMUM_RETAINED_BACKUPS\s*=/.test(retentionCode)).toBe(false)
    // The retention count itself is computed by the shared authority.
    const authority = readFileSync(join(__dirname, "phase3r-closure.ts"), "utf8")
    expect(authority).toContain("identifyBackups(branches, contract.neonProductionBranchId)")
  })

  it("the closure gate proves the FULL environment rather than skipping it", () => {
    expect(gateCode).toContain("evaluateProductionEnvironmentGate")
    expect(gateCode).toContain("readCanonicalHead")
    expect(gateCode).toContain("getWebServiceConfig")
    expect(gateCode).toContain("getCronServiceConfig")
    expect(gateCode).toContain("getCronStatus")
    expect(gateCode).toContain("getLatestDeploy")
    expect(gateCode).toContain("readCatalog")
    expect(gateCode).toContain("_prisma_migrations")
  })

  it("the closure gate RE-READS the second baseline rather than remembering Workflow D", () => {
    expect(gateCode).toContain("evaluateFrozenClosureGate")
    expect(gateCode).toContain("evaluateFirstBaselineGate")
    // No historical run id, status or conclusion is an input to the verdict.
    expect(gateCode).not.toMatch(/34137678240|workflowRun|previousConclusion/)
    expect(gateCode).not.toContain("runFirstBaselineTransaction")
  })

  it("the closure gate reads the orphan through the canonical prefix and never repairs it", () => {
    expect(gateCode).toContain("orphanReferencePrefix")
    expect(gateCode).toContain('starts_with("referenceId", ${prefix})')
    expect(gateCode).not.toMatch(/"fixtureId"/)
  })

  it("the closure gate compares the RUNTIME activation constant, not a literal of its own", () => {
    expect(gateCode).toContain("activationStart: PHASE_3R_ACTIVATION_START")
    // The approved instant appears in the frozen contract, not inline here.
    expect(gateCode).not.toContain("2026-09-24T13:00:00.000Z")
    expect(PHASE_3R_CLOSURE.activationInstantIso).toBe("2026-09-24T13:00:00.000Z")
  })

  it("both new commands are SEPARATE scripts from every baseline command", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
    expect(pkg.scripts["prod:phase3r:backup-retention-audit"]).toBe("tsx scripts/production/phase3r-backup-retention-audit.ts")
    expect(pkg.scripts["prod:phase3r:closure-gate"]).toBe("tsx scripts/production/phase3r-closure-gate.ts")
    for (const baseline of ["prod:economy:first-baseline", "prod:economy:baseline", "prod:economy:second-baseline-verify"]) {
      expect(pkg.scripts["prod:phase3r:closure-gate"]).not.toBe(pkg.scripts[baseline])
    }
  })
})

// ===========================================================================
// THE CLOSURE GATE'S RAW SQL - THE SAME PHYSICAL-COLUMN CONTRACT
// ===========================================================================

const APPLICATION_MODELS = ["Team", "FinancialTransaction", "TeamEconomicState"] as const
const NON_MODEL_RELATIONS = ["pg_class", "pg_namespace", "pg_constraint", "pg_indexes", "pg_trigger", "_prisma_migrations"]

describe("the closure gate's raw SQL is inventoried and validated against Prisma DMMF", () => {
  it("every raw statement is found, and every relation is one this test recognises", () => {
    const statements = rawStatements(gate)
    // A fixed, reviewable number. If it changes, a query was added or removed
    // and is audited by the assertions below rather than escaping them.
    expect(statements.length).toBe(14)
    for (const statement of statements) {
      if (statement.relation === null) continue
      const known =
        ([...APPLICATION_MODELS] as string[]).includes(statement.relation) || NON_MODEL_RELATIONS.includes(statement.relation)
      expect({ relation: statement.relation, known }).toEqual({ relation: statement.relation, known: true })
    }
  })

  it("NO application query names a column its Prisma model does not declare", () => {
    expect(undeclaredColumnUses(gate, APPLICATION_MODELS)).toEqual([])
  })

  it("NO query names a Prisma RELATION field - a relation is not a column", () => {
    const offenders: string[] = []
    for (const statement of rawStatements(gate)) {
      const relation = statement.relation
      if (!relation || !([...APPLICATION_MODELS] as string[]).includes(relation)) continue
      for (const column of quotedColumns(statement.sql, relation)) {
        if (relationFields(relation).has(column)) offenders.push(`${relation}."${column}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("the exact identifiers that failed in Production before are absent", () => {
    expect(physicalColumns("FinancialTransaction").has("fixtureId")).toBe(false)
    expect(gate).not.toMatch(/"fixtureId"/)
    expect(physicalColumns("Fixture").has("homeGoals")).toBe(false)
    expect(gate).not.toMatch(/"homeGoals"|"awayGoals"/)
  })

  it("the settlement counts filter on REAL transaction types from the canonical catalog", () => {
    expect(FINANCIAL_TRANSACTION_TYPES).toContain(SPONSOR_TRANSACTION_TYPE)
    expect(FINANCIAL_TRANSACTION_TYPES).toContain(MAINTENANCE_TRANSACTION_TYPE)
    expect(gateCode).toContain('WHERE "type" = ${SPONSOR_TRANSACTION_TYPE}')
    expect(gateCode).toContain('WHERE "type" = ${MAINTENANCE_TRANSACTION_TYPE}')
    // Never the literals that matched nothing before AND nothing after.
    expect(gateCode).not.toMatch(/'SPONSOR'|'STADIUM_MAINTENANCE'/)
  })

  it("every raw FORM in the gate is a template - the one non-template call is the shared executor", () => {
    // $queryRaw<...>`...` templates, plus Prisma.sql`...` templates.
    const templates = rawStatements(gate).length
    const allQueryRaw = [...gate.matchAll(/\$queryRaw/g)].length
    // countScalar is the single executor that takes a Prisma.Sql value rather
    // than a template of its own, so the totals differ by exactly one.
    expect(allQueryRaw).toBe(templates - [...gate.matchAll(/Prisma\.sql`/g)].length + 1)
    expect(gateCode).toContain("async function countScalar(db: Db, sql: Prisma.Sql)")
  })

  it("the gate reads weeklyPayroll and attendanceQuality, which the closure contract judges", () => {
    expect(gateCode).toContain('SELECT "teamId", "version", "reason", "effectiveAt", "weeklyPayroll", "attendanceQuality"')
  })

  it("the frozen target it measures against is the approved one", () => {
    expect(FIRST_BASELINE.targetCommit).toBe("063342e70fe5285aa3de050b7e344c83d51ec459")
    expect(PHASE_3R_CLOSURE.productionBranchName).toBe(FIRST_BASELINE.branch)
  })
})
