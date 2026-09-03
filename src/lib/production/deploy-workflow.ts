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
 *
 * Every external call from step E onward (Suspend Cron, Verify Cron
 * suspended, Trigger Deploy, Wait for Deploy, Verify Web live, Resume
 * Cron, Verify Cron active) is wrapped so a thrown exception (a Render API
 * error, a network blip) produces the same structured FAIL outcome as a
 * "normal" failure - it never escapes as an unhandled rejection. Cron
 * state is fail-closed: it is only ever reported "suspended" or "active"
 * immediately after a status read that said so, and "unknown" the moment
 * that read is missing or fails - never assumed from an earlier reading,
 * because Cron's real state may have changed since.
 */

export interface DeploySafeStepLog {
  step: string
  ok: boolean
  detail: string
}

export type CronState = "suspended" | "active" | "unknown"

export interface DeploySafeOutcome {
  outcome: "PASS" | "FAIL"
  steps: DeploySafeStepLog[]
  failedStep: string | null
  reason: string | null
  webStatus: string | null
  cronStatus: string | null
  cronState: CronState
  backupBranchId: string | null
  recommendedRecovery: string | null
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

const NEVER_AUTO_RESTORE = "Do not restore the database automatically - that is a human decision."

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cronStateOf(status: ServiceStatus): CronState {
  if (status.suspended === true) return "suspended"
  if (status.suspended === false) return "active"
  return "unknown"
}

function recoveryForUntouchedCron(cronState: CronState): string {
  return `Cron was not touched by this run (current state: ${cronState.toUpperCase()}). Re-run prod:preflight / prod:backup:list to see current state before retrying. ${NEVER_AUTO_RESTORE}`
}

function recoveryForSuspendedOrUnknownCron(cronState: CronState): string {
  if (cronState === "unknown") {
    return `Cron state: UNKNOWN - it could NOT be confirmed, so treat it as neither active nor suspended. Manually check the Cron service on Render's dashboard before deciding whether to resume it. Do not trigger another deploy until this is resolved. ${NEVER_AUTO_RESTORE}`
  }
  return `Cron is left ${cronState.toUpperCase()} on purpose - it was never auto-resumed. Investigate the web service and this deploy before resuming manually with \`PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:cron:resume\`. ${NEVER_AUTO_RESTORE}`
}

function recoveryForPostDeployCronFailure(cronState: CronState): string {
  return `The deploy itself succeeded and the app is live, but the system did NOT return to full operational state - Cron is ${cronState.toUpperCase()}, not confirmed active. Manually check the Cron service on Render's dashboard and resume it once confirmed safe with \`PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:cron:resume\`. ${NEVER_AUTO_RESTORE}`
}

export async function runDeploySafeWorkflow(deps: DeployWorkflowDeps): Promise<DeploySafeOutcome> {
  const steps: DeploySafeStepLog[] = []
  let backupBranchId: string | null = null
  let webStatusText: string | null = null
  let cronStatusText: string | null = null
  let cronState: CronState = "unknown"

  // Best-effort refresh used only for building an accurate failure report -
  // never trusted for any control-flow decision, and never let to throw
  // itself: a failed refresh just leaves state at its fail-closed default
  // ("unknown" for Cron) rather than guessing from a stale reading.
  async function refreshWebStatusForReport(): Promise<void> {
    try {
      const web = await deps.getWebStatus()
      webStatusText = `suspended=${web.suspended}`
    } catch (error) {
      webStatusText = `unknown (status check failed: ${errorMessage(error)})`
    }
  }

  async function refreshCronStatusForReport(): Promise<void> {
    try {
      const cron = await deps.getCronStatus()
      cronState = cronStateOf(cron)
      cronStatusText = `suspended=${cron.suspended}`
    } catch (error) {
      cronState = "unknown"
      cronStatusText = `unknown (status check failed: ${errorMessage(error)})`
    }
  }

  const fail = (failedStep: string, reason: string, recommendedRecovery: string): DeploySafeOutcome => ({
    outcome: "FAIL",
    steps,
    failedStep,
    reason,
    webStatus: webStatusText,
    cronStatus: cronStatusText,
    cronState,
    backupBranchId,
    recommendedRecovery,
  })

  // Thrown-exception failures before Cron is ever touched (A-D): Cron's
  // real state hasn't been affected by this run, but is still worth a
  // best-effort read for the report rather than left blank.
  async function failBeforeCronTouched(stepName: string, reason: string): Promise<DeploySafeOutcome> {
    await refreshCronStatusForReport()
    steps.push({ step: stepName, ok: false, detail: reason })
    return fail(stepName, reason, recoveryForUntouchedCron(cronState))
  }

  // Thrown-exception failures from step E onward: Cron has been (or was
  // about to be) suspended, so the recovery guidance always assumes it may
  // still be suspended (or unknown) and never suggests auto-resuming.
  async function failAfterCronTouched(stepName: string, reason: string): Promise<DeploySafeOutcome> {
    await refreshWebStatusForReport()
    await refreshCronStatusForReport()
    steps.push({ step: stepName, ok: false, detail: reason })
    return fail(stepName, reason, recoveryForSuspendedOrUnknownCron(cronState))
  }

  // A. Production Preflight
  const preflight = await deps.runPreflight()
  steps.push({ step: "A. Preflight", ok: preflight.pass, detail: preflight.summary })
  if (!preflight.pass) return failBeforeCronTouched("A. Preflight", "Production preflight failed.")

  // B. Render status
  let web: ServiceStatus
  let cronInitial: ServiceStatus
  try {
    web = await deps.getWebStatus()
    cronInitial = await deps.getCronStatus()
  } catch (error) {
    return failBeforeCronTouched("B. Render status", `Could not read Render service status: ${errorMessage(error)}`)
  }
  webStatusText = `suspended=${web.suspended}`
  cronStatusText = `suspended=${cronInitial.suspended}`
  cronState = cronStateOf(cronInitial)
  steps.push({ step: "B. Render status", ok: true, detail: `web(${webStatusText}) cron(${cronStatusText})` })

  // C. Neon backup create
  let backup: BackupResult
  try {
    backup = await deps.createBackup()
  } catch (error) {
    const detail = errorMessage(error)
    steps.push({ step: "C. Create backup", ok: false, detail })
    return failBeforeCronTouched("C. Create backup", `Backup creation failed: ${detail}`)
  }
  backupBranchId = backup.id
  steps.push({ step: "C. Create backup", ok: true, detail: `${backup.name} (${backup.id})` })

  // D. Verify backup exists
  const verification = await deps.verifyBackup(backup.id)
  const backupOk = verification.exists && verification.isChildOfProduction
  steps.push({ step: "D. Verify backup", ok: backupOk, detail: `exists=${verification.exists} isChildOfProduction=${verification.isChildOfProduction}` })
  if (!backupOk) return failBeforeCronTouched("D. Verify backup", "Backup could not be verified - refusing to proceed without a confirmed backup.")

  // E. Suspend Cron
  try {
    await deps.suspendCron()
  } catch (error) {
    return failAfterCronTouched("E. Suspend cron", `Failed to suspend Cron: ${errorMessage(error)}. Never proceed to deploy without a confirmed suspend.`)
  }
  steps.push({ step: "E. Suspend cron", ok: true, detail: "suspend requested" })

  // F. Verify Cron is suspended
  let cronAfterSuspend: ServiceStatus
  try {
    cronAfterSuspend = await deps.getCronStatus()
  } catch (error) {
    return failAfterCronTouched(
      "F. Verify cron suspended",
      `Could not verify Cron suspended after requesting it: ${errorMessage(error)}. Never proceed to deploy without a confirmed suspend.`
    )
  }
  cronStatusText = `suspended=${cronAfterSuspend.suspended}`
  cronState = cronStateOf(cronAfterSuspend)
  const suspended = cronState === "suspended"
  steps.push({ step: "F. Verify cron suspended", ok: suspended, detail: cronStatusText })
  if (!suspended) {
    return fail(
      "F. Verify cron suspended",
      "Cron did not report suspended after the suspend request. Never proceed to deploy without a confirmed suspend.",
      recoveryForSuspendedOrUnknownCron(cronState)
    )
  }

  // G. Trigger Web Deploy
  let deploy: DeployTrigger
  try {
    deploy = await deps.triggerDeploy()
  } catch (error) {
    return failAfterCronTouched(
      "G. Trigger deploy",
      `Failed to trigger deploy: ${errorMessage(error)}. Confirm on Render whether a partial deploy exists before retrying.`
    )
  }
  steps.push({ step: "G. Trigger deploy", ok: true, detail: deploy.id })

  // H. Wait for Deploy completion
  let waited: WaitForDeployResult
  try {
    waited = await deps.waitForDeploy(deploy.id)
  } catch (error) {
    return failAfterCronTouched(
      "H. Wait for deploy",
      `Deploy outcome could not be confirmed due to an API error: ${errorMessage(error)}. Check Render's dashboard directly - do not assume the deploy succeeded or failed.`
    )
  }
  steps.push({ step: "H. Wait for deploy", ok: waited.outcome === "success", detail: `${waited.outcome} (${waited.status})` })
  if (waited.outcome !== "success") {
    await refreshWebStatusForReport()
    await refreshCronStatusForReport()
    return fail(
      "H. Wait for deploy",
      `Deploy did not succeed: ${waited.outcome} (${waited.status}).`,
      recoveryForSuspendedOrUnknownCron(cronState)
    )
  }

  // I. Verify Web Service is live
  let live: boolean
  try {
    live = await deps.isWebLive()
  } catch (error) {
    return failAfterCronTouched(
      "I. Verify web live",
      `Could not check whether the web service is live: ${errorMessage(error)}. Check manually - do not assume the deploy is healthy.`
    )
  }
  steps.push({ step: "I. Verify web live", ok: live, detail: live ? "live" : "not responding" })
  if (!live) {
    await refreshWebStatusForReport()
    await refreshCronStatusForReport()
    return fail(
      "I. Verify web live",
      "Web service did not respond as live after a successful deploy status.",
      recoveryForSuspendedOrUnknownCron(cronState)
    )
  }

  // J. prod:post-deploy-check
  const postDeploy = await deps.runPostDeployCheck()
  steps.push({ step: "J. Post-deploy check", ok: postDeploy.pass, detail: postDeploy.summary })
  if (!postDeploy.pass) {
    await refreshWebStatusForReport()
    await refreshCronStatusForReport()
    return fail("J. Post-deploy check", "Post-deploy check failed.", recoveryForSuspendedOrUnknownCron(cronState))
  }

  // K. prod:scheduled-check (dry check only - never process-scheduled-jobs)
  const dryCheck = await deps.runScheduledDryCheck()
  steps.push({ step: "K. Scheduled dry check", ok: true, detail: dryCheck.summary })

  // L. Resume Cron - the only path that ever calls this. If this itself
  // fails, the deploy succeeded and the app is live, but the system has NOT
  // returned to full operational state - that is reported as an overall
  // FAIL, never masked by the app's own health.
  try {
    await deps.resumeCron()
  } catch (error) {
    await refreshWebStatusForReport()
    await refreshCronStatusForReport()
    steps.push({ step: "L. Resume cron", ok: false, detail: `Resume failed: ${errorMessage(error)}` })
    return fail(
      "L. Resume cron",
      `Deploy succeeded and the app is live, but resuming Cron failed: ${errorMessage(error)}. The system did not return to full operational state.`,
      recoveryForPostDeployCronFailure(cronState)
    )
  }
  steps.push({ step: "L. Resume cron", ok: true, detail: "resume requested" })

  // M. Verify Cron active
  let cronAfterResume: ServiceStatus
  try {
    cronAfterResume = await deps.getCronStatus()
  } catch (error) {
    cronState = "unknown"
    cronStatusText = `unknown (status check failed: ${errorMessage(error)})`
    steps.push({ step: "M. Verify cron active", ok: false, detail: cronStatusText })
    return fail(
      "M. Verify cron active",
      `Deploy succeeded and Cron resume was requested, but Cron's status could not be confirmed afterward: ${errorMessage(error)}. The system did not return to a confirmed operational state.`,
      recoveryForPostDeployCronFailure(cronState)
    )
  }
  cronStatusText = `suspended=${cronAfterResume.suspended}`
  cronState = cronStateOf(cronAfterResume)
  const active = cronState === "active"
  steps.push({ step: "M. Verify cron active", ok: active, detail: cronStatusText })
  if (!active) {
    return fail(
      "M. Verify cron active",
      "Deploy succeeded, but Cron did not report active after the resume request. The system did not return to full operational state.",
      recoveryForPostDeployCronFailure(cronState)
    )
  }

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
    cronState,
    backupBranchId,
    recommendedRecovery: null,
  }
}
