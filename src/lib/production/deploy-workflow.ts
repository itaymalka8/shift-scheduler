/**
 * The pure orchestration logic behind `npm run prod:deploy:safe`, entirely
 * independent of Render, Neon, or the production database - every real
 * side effect is behind the DeployWorkflowDeps interface, which
 * scripts/production/deploy-safe.ts fills in with real calls and this
 * module's own tests fill in with mocks. Nothing in this file makes a
 * network call, reads an env var, or touches a database.
 *
 * Stop-on-failure is unconditional: the first step that reports failure
 * ends the run right there and nothing after it executes - there is no
 * partial-continue mode. Cron is resumed ONLY on the full success path
 * (step L) - any failure from step E (suspend) onward leaves Cron
 * suspended on purpose, so a human decides whether it's safe to resume
 * rather than the workflow silently putting live traffic back onto a
 * deploy nobody has confirmed is healthy.
 */

export interface DeploySafeStepLog {
  step: string
  ok: boolean
  detail: string
}

export interface DeploySafeOutcome {
  outcome: "PASS" | "FAIL"
  steps: DeploySafeStepLog[]
  failedStep: string | null
  reason: string | null
  webStatus: string | null
  cronStatus: string | null
  backupBranchId: string | null
  cronLeftSuspended: boolean
}

export interface CheckResult {
  pass: boolean
  summary: string
}

export interface ServiceStatus {
  id: string
  suspended: boolean | "unknown"
}

export interface BackupResult {
  id: string
  name: string
}

export interface VerifyBackupResult {
  exists: boolean
  isChildOfProduction: boolean
}

export interface DeployTrigger {
  id: string
}

export type WaitForDeployOutcome = "success" | "failure" | "timeout"

export interface WaitForDeployResult {
  outcome: WaitForDeployOutcome
  status: string
}

export interface DeployWorkflowDeps {
  runPreflight: () => Promise<CheckResult>
  getWebStatus: () => Promise<ServiceStatus>
  getCronStatus: () => Promise<ServiceStatus>
  createBackup: () => Promise<BackupResult>
  verifyBackup: (branchId: string) => Promise<VerifyBackupResult>
  suspendCron: () => Promise<void>
  triggerDeploy: () => Promise<DeployTrigger>
  waitForDeploy: (deployId: string) => Promise<WaitForDeployResult>
  isWebLive: () => Promise<boolean>
  runPostDeployCheck: () => Promise<CheckResult>
  runScheduledDryCheck: () => Promise<{ summary: string }>
  resumeCron: () => Promise<void>
}

export async function runDeploySafeWorkflow(deps: DeployWorkflowDeps): Promise<DeploySafeOutcome> {
  const steps: DeploySafeStepLog[] = []
  let backupBranchId: string | null = null
  let webStatusText: string | null = null
  let cronStatusText: string | null = null

  const fail = (failedStep: string, reason: string, cronLeftSuspended: boolean): DeploySafeOutcome => ({
    outcome: "FAIL",
    steps,
    failedStep,
    reason,
    webStatus: webStatusText,
    cronStatus: cronStatusText,
    backupBranchId,
    cronLeftSuspended,
  })

  // A. Production Preflight
  const preflight = await deps.runPreflight()
  steps.push({ step: "A. Preflight", ok: preflight.pass, detail: preflight.summary })
  if (!preflight.pass) return fail("A. Preflight", "Production preflight failed.", false)

  // B. Render status
  const web = await deps.getWebStatus()
  const cron = await deps.getCronStatus()
  webStatusText = `suspended=${web.suspended}`
  cronStatusText = `suspended=${cron.suspended}`
  steps.push({ step: "B. Render status", ok: true, detail: `web(${webStatusText}) cron(${cronStatusText})` })

  // C. Neon backup create
  let backup: BackupResult
  try {
    backup = await deps.createBackup()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    steps.push({ step: "C. Create backup", ok: false, detail })
    return fail("C. Create backup", `Backup creation failed: ${detail}`, false)
  }
  backupBranchId = backup.id
  steps.push({ step: "C. Create backup", ok: true, detail: `${backup.name} (${backup.id})` })

  // D. Verify backup exists
  const verification = await deps.verifyBackup(backup.id)
  const backupOk = verification.exists && verification.isChildOfProduction
  steps.push({ step: "D. Verify backup", ok: backupOk, detail: `exists=${verification.exists} isChildOfProduction=${verification.isChildOfProduction}` })
  if (!backupOk) return fail("D. Verify backup", "Backup could not be verified - refusing to proceed without a confirmed backup.", false)

  // E. Suspend Cron
  await deps.suspendCron()
  steps.push({ step: "E. Suspend cron", ok: true, detail: "suspend requested" })

  // F. Verify Cron is suspended
  const cronAfterSuspend = await deps.getCronStatus()
  cronStatusText = `suspended=${cronAfterSuspend.suspended}`
  const suspended = cronAfterSuspend.suspended === true
  steps.push({ step: "F. Verify cron suspended", ok: suspended, detail: cronStatusText })
  if (!suspended) return fail("F. Verify cron suspended", "Cron did not report suspended after the suspend request.", false)

  // G. Trigger Web Deploy
  const deploy = await deps.triggerDeploy()
  steps.push({ step: "G. Trigger deploy", ok: true, detail: deploy.id })

  // H. Wait for Deploy completion
  const waited = await deps.waitForDeploy(deploy.id)
  steps.push({ step: "H. Wait for deploy", ok: waited.outcome === "success", detail: `${waited.outcome} (${waited.status})` })
  if (waited.outcome !== "success") {
    return fail(
      "H. Wait for deploy",
      `Deploy did not succeed: ${waited.outcome} (${waited.status}).`,
      true // Cron intentionally left suspended - never auto-resumed after a failed/unclear deploy.
    )
  }

  // I. Verify Web Service is live
  const live = await deps.isWebLive()
  steps.push({ step: "I. Verify web live", ok: live, detail: live ? "live" : "not responding" })
  if (!live) return fail("I. Verify web live", "Web service did not respond as live after a successful deploy status.", true)

  // J. prod:post-deploy-check
  const postDeploy = await deps.runPostDeployCheck()
  steps.push({ step: "J. Post-deploy check", ok: postDeploy.pass, detail: postDeploy.summary })
  if (!postDeploy.pass) return fail("J. Post-deploy check", "Post-deploy check failed.", true)

  // K. prod:scheduled-check (dry check only - never process-scheduled-jobs)
  const dryCheck = await deps.runScheduledDryCheck()
  steps.push({ step: "K. Scheduled dry check", ok: true, detail: dryCheck.summary })

  // L. Resume Cron - the only path that ever calls this.
  await deps.resumeCron()
  steps.push({ step: "L. Resume cron", ok: true, detail: "resume requested" })

  // M. Verify Cron active
  const cronAfterResume = await deps.getCronStatus()
  cronStatusText = `suspended=${cronAfterResume.suspended}`
  const active = cronAfterResume.suspended === false
  steps.push({ step: "M. Verify cron active", ok: active, detail: cronStatusText })
  if (!active) return fail("M. Verify cron active", "Cron did not report active after the resume request.", true)

  // N. Poll for next successful Cron run - LIMITATION, not invented. Render's
  // v1 API has no documented per-run Cron execution log distinct from its
  // deploy history (see render-client.ts's header). Reported here rather
  // than faked.
  steps.push({
    step: "N. Poll next cron run",
    ok: true,
    detail: "LIMITATION: Render API exposes no per-run Cron log endpoint - not polled, reported instead of invented.",
  })

  return {
    outcome: "PASS",
    steps,
    failedStep: null,
    reason: null,
    webStatus: webStatusText,
    cronStatus: cronStatusText,
    backupBranchId,
    cronLeftSuspended: false,
  }
}
