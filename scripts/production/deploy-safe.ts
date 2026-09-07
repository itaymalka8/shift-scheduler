/**
 * The one command a full Trial Season deploy needs: Preflight -> Render
 * status -> Neon backup -> verify backup -> suspend Cron -> verify
 * suspended -> trigger Web deploy -> wait -> verify live -> post-deploy
 * check -> scheduled dry check -> resume Cron -> verify active. Stops on
 * the first failed step; never auto-resumes Cron after anything past the
 * suspend step fails (see src/lib/production/deploy-workflow.ts's header).
 *
 * Requires PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION -
 * set ONCE for this whole run, not once per step (see write-guard.ts and
 * render-ops.ts's header on why that's the same thing here).
 *
 * Never runs `prisma migrate deploy` itself - Render's own buildCommand
 * already does that as part of the web deploy this script triggers.
 * Never runs `process-scheduled-jobs` - step K is prod:scheduled-check,
 * a read-only dry run, not the real job.
 *
 * Run with: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:deploy:safe
 */
import { execFileSync } from "node:child_process"
import { runDeploySafeWorkflow, type DeploySafeHandoff, type DeployWorkflowDeps } from "../../src/lib/production/deploy-workflow"
import { fetchGithubRef, readCanonicalHead } from "../../src/lib/production/canonical-head"
import {
  RENDER_SOURCE_MIGRATION,
  verifyDeployHandoffState,
  verifyPostDeployTargetCommits,
} from "../../src/lib/production/render-source-migration"
import { getDeployStatus, getServiceConfigSnapshot } from "../../src/lib/production/render-ops"
import {
  getWebServiceStatus,
  getCronStatus,
  suspendCron,
  resumeCron,
  triggerDeploy,
  waitForDeploy,
  getWebServiceUrl,
  getAutoDeployReading,
} from "../../src/lib/production/render-ops"
import { createBackupBranch, verifyBackupBranch } from "../../src/lib/production/neon-ops"
import { ProductionWriteNotConfirmedError, assertProductionWriteConfirmed } from "../../src/lib/production/write-guard"

function runProductionScript(relativePath: string): { pass: boolean; summary: string } {
  try {
    const output = execFileSync("npx", ["tsx", relativePath], {
      encoding: "utf8",
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { pass: true, summary: output.trim() }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    const summary = [err.stdout, err.stderr].filter(Boolean).join("\n").trim()
    return { pass: false, summary: summary || `exited with status ${err.status}` }
  }
}

async function checkWebLive(): Promise<boolean> {
  const url = await getWebServiceUrl()
  if (!url) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

const deps: DeployWorkflowDeps = {
  // Deliberately NOT wrapped in a try/catch here - the workflow's step 0
  // owns that, and turning a throw into UNKNOWN/UNKNOWN (which refuses) is
  // its decision to make, not this adapter's.
  getAutoDeployReading: async () => getAutoDeployReading(),
  runPreflight: async () => runProductionScript("scripts/production/preflight.ts"),
  getWebStatus: async () => getWebServiceStatus(),
  getCronStatus: async () => getCronStatus(),
  createBackup: async () => createBackupBranch(),
  verifyBackup: async (branchId) => verifyBackupBranch(branchId),
  suspendCron: async () => suspendCron(),
  triggerDeploy: async (commitId?: string) => triggerDeploy(commitId),
  waitForDeploy: async (deployId) => {
    const web = await getWebServiceStatus()
    const result = await waitForDeploy(web.id, deployId)
    return { outcome: result.outcome, status: result.deploy.status }
  },
  isWebLive: checkWebLive,
  runPostDeployCheck: async () => runProductionScript("scripts/production/post-deploy-check.ts"),
  runScheduledDryCheck: async () => {
    const result = runProductionScript("scripts/production/scheduled-dry-check.ts")
    return { summary: result.summary }
  },
  resumeCron: async () => resumeCron(),
}

/**
 * HANDOFF MODE, opt-in via --handoff (or DEPLOY_HANDOFF=source-migration).
 *
 * Only for the one case it was built for: prod:render:source-migrate has just
 * repointed both services at the canonical repository and left Cron SUSPENDED
 * on purpose, because Render can turn a resume into a deployment. Without the
 * flag this command behaves exactly as it always has - a suspended Cron is
 * still the anomaly it has always been.
 *
 * The flag does not relax anything. It adds a gate that re-proves the entire
 * post-migration state before the first mutation, skips only the REDUNDANT
 * suspend request (step F still proves Cron suspended), and adds a check that
 * both services end up on the approved commit after the resume.
 */
/**
 * Every canonical-head read in this file goes through here, and each CALL is a
 * fresh read - the 0h gate's result is never cached for L0. See
 * canonical-head.ts for why this is an authenticated API read rather than
 * `git ls-remote`: the canonical repository is private and the Production
 * workflows check out with persist-credentials: false, so no git credential
 * survives into the command step.
 */
async function readCanonicalHeadSha(): Promise<{ sha: string | null; detail: string }> {
  const C = RENDER_SOURCE_MIGRATION
  const result = await readCanonicalHead(
    { repoUrl: C.toRepo, branch: C.branch },
    {
      fetchRef: fetchGithubRef,
      gitLsRemote: (repoUrl, branch) => execFileSync("git", ["ls-remote", repoUrl, `refs/heads/${branch}`], { encoding: "utf8" }),
      env: process.env,
    }
  )
  return { sha: result.ok ? result.sha : null, detail: result.detail }
}

function buildHandoff(): DeploySafeHandoff {
  const C = RENDER_SOURCE_MIGRATION
  return {
    verify: async () => {
      const [web, cron, cronStatus] = await Promise.all([
        getServiceConfigSnapshot(C.webServiceId),
        getServiceConfigSnapshot(C.cronServiceId),
        getCronStatus(),
      ])
      // FRESH READ #1 - the handoff gate's own.
      const head = await readCanonicalHeadSha()
      const verdict = verifyDeployHandoffState({
        contract: C,
        reading: { web, cron, githubHead: head.sha ?? "", cronSuspended: cronStatus.suspended === true },
      })
      return { ok: verdict.ok, refusals: verdict.refusals.map((r) => `[${r.code}] ${r.detail}`) }
    },
    targetCommit: C.targetCommit,
    // Read the created deploy back from Render and require the EXACT commit.
    verifyWebDeployCommit: async (deployId) => {
      const deploy = await getDeployStatus(deployId)
      const actual = deploy?.commitId ?? null
      return { ok: actual === C.targetCommit, detail: `deploy ${deployId} commit=${actual ?? "unreadable"} expected=${C.targetCommit}` }
    },
    // A FRESH read, immediately before Resume - not the one the 0h gate took.
    // FRESH READ #2 - a separate call, immediately before Resume. Nothing from
    // the gate's read is reused: a cached value would say nothing about the
    // branch at the moment Resume can make Render deploy from it.
    verifyCanonicalHead: async () => {
      const head = await readCanonicalHeadSha()
      return { ok: head.sha === C.targetCommit, detail: `${head.detail} expected=${C.targetCommit}` }
    },
    verifyTargetCommits: async () => {
      const [web, cron] = await Promise.all([getServiceConfigSnapshot(C.webServiceId), getServiceConfigSnapshot(C.cronServiceId)])
      return verifyPostDeployTargetCommits({ web: web.latestDeployCommit, cron: cron.latestDeployCommit }, C.targetCommit)
    },
  }
}

async function main() {
  const handoffRequested = process.argv.slice(2).includes("--handoff") || process.env.DEPLOY_HANDOFF === "source-migration"

  console.info("=== prod:deploy:safe ===")
  console.info(`Mode: ${handoffRequested ? "SOURCE-MIGRATION HANDOFF (Cron expected already suspended)" : "NORMAL"}\n`)

  try {
    assertProductionWriteConfirmed()
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }

  const result = await runDeploySafeWorkflow(deps, handoffRequested ? { handoff: buildHandoff() } : {})

  for (const step of result.steps) {
    console.info(`[${step.ok ? "OK" : "FAIL"}] ${step.step}`)
    for (const line of step.detail.split("\n")) console.info(`    ${line}`)
  }

  console.info("")
  if (result.outcome === "FAIL") {
    console.error(`FAILED STEP: ${result.failedStep}`)
    console.error(`Reason: ${result.reason}`)
    console.error(`Current Web status: ${result.webStatus ?? "unknown"}`)
    console.error(`Current Cron status: ${result.cronStatus ?? "unknown"} (${result.cronState.toUpperCase()})`)
    console.error(`Backup branch created: ${result.backupBranchId ?? "(none)"}`)
    console.error(`Recommended recovery: ${result.recommendedRecovery}`)
  }

  console.info(`\nPRODUCTION DEPLOY: ${result.outcome}`)
  process.exitCode = result.outcome === "PASS" ? 0 : 1
}

main().catch((error) => {
  console.error("prod:deploy:safe crashed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
