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
 *
 * HANDOFF MODE (options.handoff) IS OPT-IN. With it absent - the default, and
 * every existing caller - this workflow is byte-for-byte the pipeline it has
 * always been.
 *
 * With it present, it CHANGES two things and ADDS three:
 *
 *   CHANGED  0h  an extra gate before preflight re-proves the entire
 *                post-migration state before the first mutation
 *   CHANGED  E   VERIFIES that Cron is already suspended instead of REQUESTING
 *                a suspend, because the source migration suspended it
 *                deliberately. Step F still PROVES the suspension - only the
 *                redundant write is skipped
 *   ADDED    G   the deploy is PINNED to the approved commit via commitId
 *   ADDED    H2  the created deploy's commit must equal the target EXACTLY,
 *                checked before the post-deploy checks and before Resume
 *   ADDED    L0  the canonical branch head is re-read immediately before
 *                Resume, because Resume is what can make Render deploy the
 *                Cron service off that branch
 *   ADDED    M2  after Resume, both services must be on the approved commit
 *
 * Nothing is skipped and nothing is weakened: the backup is still created and
 * verified, the deploy still goes through the same single authority, and every
 * post-deploy check still runs.
 *
 * Step 0 runs before everything else, preflight included: if Render's Auto
 * Deploy is on (or cannot be read), this whole pipeline is theatre - a
 * push already reached Production without it - so it refuses before the
 * first Production mutation rather than performing a backup and a Cron
 * suspend that no longer guard anything. See auto-deploy-guard.ts.
 */
import { evaluateAutoDeployGuard, type AutoDeployReading } from "./auto-deploy-guard"

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
  /** Reads Render's Auto Deploy setting for both services. May throw - step 0 turns a throw into UNKNOWN/UNKNOWN, which refuses. */
  getAutoDeployReading: () => Promise<AutoDeployReading>
  runPreflight: () => Promise<CheckResult>
  getWebStatus: () => Promise<ServiceStatus>
  getCronStatus: () => Promise<ServiceStatus>
  createBackup: () => Promise<BackupResult>
  verifyBackup: (branchId: string) => Promise<VerifyBackupResult>
  suspendCron: () => Promise<void>
  /** commitId PINS the deploy and is WEB-ONLY. Omitted in normal mode, which keeps the original empty body. */
  triggerDeploy: (commitId?: string) => Promise<DeployTrigger>
  waitForDeploy: (deployId: string) => Promise<WaitForDeployResult>
  isWebLive: () => Promise<boolean>
  runPostDeployCheck: () => Promise<CheckResult>
  runScheduledDryCheck: () => Promise<{ summary: string }>
  resumeCron: () => Promise<void>
}

/**
 * The suspended-Cron handoff from prod:render:source-migrate.
 *
 * ABSENT BY DEFAULT. Passing it is an explicit statement that a source
 * migration just finished and left Cron suspended on purpose. `verify` is the
 * caller-supplied gate over the whole post-migration state (see
 * render-source-migration.ts's verifyDeployHandoffState) and MUST fail closed;
 * `verifyTargetCommits` re-reads both services after the deploy and the resume.
 */
export interface DeploySafeHandoff {
  verify: () => Promise<{ ok: boolean; refusals: string[] }>
  /** The approved commit. Sent as the Web deploy's commitId and asserted afterwards. */
  targetCommit: string
  /** The commit the created Web deploy actually carries, read back from Render. */
  verifyWebDeployCommit: (deployId: string) => Promise<{ ok: boolean; detail: string }>
  /**
   * A FRESH read of the canonical branch head, called immediately before the
   * Resume. The gate at 0h read it too, but a backup, a suspend, a deploy and a
   * wait have happened since - and Resume is the step that can make Render
   * deploy the Cron service off that branch.
   */
  verifyCanonicalHead: () => Promise<{ ok: boolean; detail: string }>
  verifyTargetCommits: () => Promise<{ ok: boolean; detail: string }>
}

export interface DeploySafeOptions {
  handoff?: DeploySafeHandoff
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

export async function runDeploySafeWorkflow(deps: DeployWorkflowDeps, options: DeploySafeOptions = {}): Promise<DeploySafeOutcome> {
  const handoff = options.handoff ?? null
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

  // 0. Auto-deploy guard. Deliberately the FIRST thing that happens -
  //    before preflight, before the backup, before Cron is touched - so a
  //    refusal here costs nothing and mutates nothing.
  let autoDeploy: AutoDeployReading
  try {
    autoDeploy = await deps.getAutoDeployReading()
  } catch (error) {
    // A failed read is not a reason to continue: it is exactly the case
    // this guard exists for. Both services collapse to UNKNOWN, which the
    // evaluator refuses.
    autoDeploy = { web: "unknown", cron: "unknown" }
    steps.push({ step: "0. Auto-deploy guard", ok: false, detail: `auto-deploy state could not be read: ${errorMessage(error)}` })
    const refusal = evaluateAutoDeployGuard(autoDeploy)
    return fail("0. Auto-deploy guard", refusal.reason ?? "Auto Deploy state could not be confirmed.", recoveryForUntouchedCron("unknown"))
  }
  const autoDeployGuard = evaluateAutoDeployGuard(autoDeploy)
  steps.push({ step: "0. Auto-deploy guard", ok: autoDeployGuard.allowed, detail: autoDeployGuard.detail })
  if (!autoDeployGuard.allowed) {
    // No Production mutation has happened and none will: nothing after
    // this line runs. Cron was never touched, so the recovery text says so
    // rather than implying something needs unwinding.
    return fail("0. Auto-deploy guard", autoDeployGuard.reason ?? "Auto Deploy guard refused.", recoveryForUntouchedCron("unknown"))
  }

  // 0h. HANDOFF GATE - only when handoff mode was explicitly requested. It runs
  //     before preflight and before any Production mutation, so a refusal here
  //     costs nothing. Absent handoff mode, this block does not exist.
  if (handoff) {
    let verdict: { ok: boolean; refusals: string[] }
    try {
      verdict = await handoff.verify()
    } catch (error) {
      // A gate that could not be evaluated refuses, exactly like the
      // auto-deploy guard above.
      steps.push({ step: "0h. Source-migration handoff", ok: false, detail: `handoff state could not be read: ${errorMessage(error)}` })
      return fail("0h. Source-migration handoff", `Handoff state could not be confirmed: ${errorMessage(error)}`, recoveryForUntouchedCron(cronState))
    }
    steps.push({ step: "0h. Source-migration handoff", ok: verdict.ok, detail: verdict.ok ? "post-migration state verified" : verdict.refusals.join("; ") })
    if (!verdict.ok) {
      return fail("0h. Source-migration handoff", `Handoff refused: ${verdict.refusals.join("; ")}`, recoveryForUntouchedCron(cronState))
    }
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

  // E. Suspend Cron.
  //
  //    IN HANDOFF MODE NO SUSPEND REQUEST IS SENT. Cron is already suspended by
  //    the source migration, and gate 0h proved it; re-requesting it would be a
  //    redundant Production write whose only effect could be a surprise. Step F
  //    below then verifies the suspension exactly as it always does - the proof
  //    is unchanged, only the redundant request is skipped.
  if (handoff) {
    steps.push({ step: "E. Suspend cron", ok: true, detail: "HANDOFF: already suspended by the source migration - no suspend request sent" })
  } else {
    try {
      await deps.suspendCron()
    } catch (error) {
      return failAfterCronTouched("E. Suspend cron", `Failed to suspend Cron: ${errorMessage(error)}. Never proceed to deploy without a confirmed suspend.`)
    }
    steps.push({ step: "E. Suspend cron", ok: true, detail: "suspend requested" })
  }

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
    // HANDOFF PINS THE WEB DEPLOY. Normal mode passes nothing and keeps the
    // original empty-body behaviour byte for byte.
    deploy = handoff ? await deps.triggerDeploy(handoff.targetCommit) : await deps.triggerDeploy()
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

  // H2. HANDOFF ONLY: the deploy that just finished must be the approved
  //     commit, EXACTLY - no prefix matching. This runs before the post-deploy
  //     checks and before Resume, because everything after it is only
  //     meaningful if the right code is live. A mismatch stops here with Cron
  //     still suspended: no retry, no second deploy.
  if (handoff) {
    let webCommit: { ok: boolean; detail: string }
    try {
      webCommit = await handoff.verifyWebDeployCommit(deploy.id)
    } catch (error) {
      return failAfterCronTouched("H2. Verify web deploy commit", `Could not read the deployed commit: ${errorMessage(error)}. Cron is left suspended.`)
    }
    steps.push({ step: "H2. Verify web deploy commit", ok: webCommit.ok, detail: webCommit.detail })
    if (!webCommit.ok) {
      return fail(
        "H2. Verify web deploy commit",
        `The web deploy is not the approved commit: ${webCommit.detail}. No retry and no second deploy.`,
        recoveryForSuspendedOrUnknownCron(cronState)
      )
    }
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

  // L0. HANDOFF ONLY: THE LAST BRANCH CHECK BEFORE RESUME.
  //
  //     Resume is the step that can make Render deploy the Cron service, and it
  //     deploys the BRANCH - Render does not accept a commitId for Cron Jobs.
  //     So the branch head is re-read here, as late as possible, and the run
  //     stops if it moved. Cron stays suspended; nothing is repaired, no branch
  //     is moved, no deploy is triggered.
  //
  //     THIS IS NOT ATOMIC AND IS NOT CLAIMED TO BE. A push landing between
  //     this read and Render resolving the branch during Resume would still be
  //     picked up. Nothing in this project can hold a GitHub ref still; what it
  //     can do is make that window as small as possible and then DETECT the
  //     result at M2, which requires both services on the exact target commit.
  if (handoff) {
    let head: { ok: boolean; detail: string }
    try {
      head = await handoff.verifyCanonicalHead()
    } catch (error) {
      return fail(
        "L0. Canonical head before resume",
        `Could not re-read the canonical branch head before resuming Cron: ${errorMessage(error)}. Cron is left suspended.`,
        recoveryForSuspendedOrUnknownCron(cronState)
      )
    }
    steps.push({ step: "L0. Canonical head before resume", ok: head.ok, detail: head.detail })
    if (!head.ok) {
      return fail(
        "L0. Canonical head before resume",
        `The canonical branch head moved before Cron resume: ${head.detail}. Cron is left suspended and was NOT resumed.`,
        recoveryForSuspendedOrUnknownCron(cronState)
      )
    }
  }

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

  // M2. HANDOFF ONLY: prove both services are actually running the approved
  //     commit AFTER the resume. This is the step the whole suspended handoff
  //     exists for - Render can turn a resume into a deployment, so the resume
  //     that just happened may itself have deployed the Cron service, and that
  //     deployment has to be the approved commit like any other.
  if (handoff) {
    let targets: { ok: boolean; detail: string }
    try {
      targets = await handoff.verifyTargetCommits()
    } catch (error) {
      steps.push({ step: "M2. Verify target commit on both services", ok: false, detail: errorMessage(error) })
      return fail("M2. Verify target commit on both services", `Could not read the deployed commits: ${errorMessage(error)}`, recoveryForPostDeployCronFailure(cronState))
    }
    steps.push({ step: "M2. Verify target commit on both services", ok: targets.ok, detail: targets.detail })
    if (!targets.ok) {
      return fail(
        "M2. Verify target commit on both services",
        `Deploy and resume completed but the services are not both on the approved commit: ${targets.detail}`,
        recoveryForPostDeployCronFailure(cronState)
      )
    }
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
