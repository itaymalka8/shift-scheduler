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
import { runDeploySafeWorkflow, type DeployWorkflowDeps } from "../../src/lib/production/deploy-workflow"
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
  triggerDeploy: async () => triggerDeploy(),
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

async function main() {
  console.info("=== prod:deploy:safe ===\n")

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

  const result = await runDeploySafeWorkflow(deps)

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
