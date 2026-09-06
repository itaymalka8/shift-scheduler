/**
 * THE ONE-TIME RENDER SOURCE MIGRATION, as pure orchestration.
 *
 * WHAT IT DOES. Moves the two existing Render services from the repository
 * they are currently built from to the canonical one, on the same branch, and
 * then deploys the exact approved commit - without recreating a service,
 * without touching any other configuration field, and without ever letting a
 * deploy reach Production that has no fresh Neon backup behind it.
 *
 * WHY IT IS NOT A GENERAL CAPABILITY. Every value it is allowed to move
 * between is frozen in RENDER_SOURCE_MIGRATION below. There is no "migrate
 * service X to repo Y" surface: the from-repo, the to-repo, the branch, the
 * target commit and both service ids are constants, and a live state that does
 * not match them exactly is refused rather than adapted to. A source-change
 * capability that accepted arbitrary arguments would outlive this migration by
 * years and be exercised approximately never, which is the shape of capability
 * this project has already decided to remove rather than guard (see
 * .github/workflows/production-ops.yml on backup pruning).
 *
 * ORDERING IS THE WHOLE POINT. The PATCH that changes the source is issued
 * only after: the write confirmation, the canonical repo/branch/commit
 * verification, both services' identity and current-source verification, Auto
 * Deploy proven OFF on both, an immutable before-snapshot of every readable
 * config field, a Neon backup created AND verified, and Cron suspended AND
 * verified suspended. A source change that happens before any of those is a
 * source change nobody can undo cheaply.
 *
 * NO AUTOMATIC REPAIR, EVER. If one service migrates and the other does not,
 * or one deploys and the other does not, or any protected field drifts, the
 * run stops with recoveryRequired = true and reports the exact state. It never
 * rolls a source back, never recreates a service, never re-triggers a deploy
 * to "fix" one, and never resumes Cron on a failure path.
 *
 * Every side effect is behind MigrationDeps, which the script fills in with
 * real Render/Neon/GitHub calls and the tests fill in with mocks. Nothing in
 * this file makes a network call, reads an env var, or touches a database.
 */

/** The single approved migration. Every field is asserted against live state before anything is written. */
export const RENDER_SOURCE_MIGRATION = Object.freeze({
  fromRepo: "https://github.com/itaymalka8/shift-scheduler",
  toRepo: "https://github.com/itaymalka8/goalx-manager",
  branch: "claude/goalx-manager-game-y3ht29",
  targetCommit: "063342e70fe5285aa3de050b7e344c83d51ec459",
  webServiceId: "srv-da7tt1gu01pc73c0ck40",
  cronServiceId: "crn-da9cg0ijnfac73de1ie0",
  cronSchedule: "*/2 * * * *",
} as const)

export type MigrationContract = typeof RENDER_SOURCE_MIGRATION

/**
 * The PATCH body, built here and nowhere else.
 *
 * Exactly two keys. No nulls, no empty strings, no third field - a body that
 * carried buildCommand, startCommand, schedule, plan, region or name would be
 * able to change them, and Render's partial-update semantics mean a wrong or
 * empty value UNSETS rather than errors.
 */
export function buildServiceSourcePatch(repo: string, branch: string): { repo: string; branch: string } {
  if (typeof repo !== "string" || repo.trim().length === 0) throw new Error("source patch refused: repo must be a non-empty string")
  if (typeof branch !== "string" || branch.trim().length === 0) throw new Error("source patch refused: branch must be a non-empty string")
  return { repo, branch }
}

/** Everything about a service this migration is able to read, and therefore everything it can prove unchanged. */
export interface ServiceConfigSnapshot {
  id: string
  repo: string | null
  branch: string | null
  autoDeploy: "on" | "off" | "unknown"
  buildCommand: string | null
  startCommand: string | null
  /** Cron only; null for the web service. */
  schedule: string | null
  /** NAMES ONLY. Values are never read into this process, so they cannot be logged. */
  envVarNames: string[]
  /** Newest deploy id at snapshot time, or null when the service has none. Used to detect a deploy born from the PATCH. */
  latestDeployId: string | null
}

export interface MigrationRefusal {
  code: string
  detail: string
}

/**
 * THE PRE-MIGRATION GATE. Fail-closed on every field: an "unknown" Auto Deploy
 * is refused exactly like an "on" one, and a null repo (a shape this code could
 * not read) is refused exactly like a wrong one. Returns EVERY refusal rather
 * than the first, so an operator sees the whole picture in one run instead of
 * fixing one thing at a time.
 */
export function verifyPreMigrationState(input: {
  contract: MigrationContract
  web: ServiceConfigSnapshot
  cron: ServiceConfigSnapshot
  githubHead: string
}): { ok: boolean; refusals: MigrationRefusal[] } {
  const { contract, web, cron, githubHead } = input
  const refusals: MigrationRefusal[] = []

  if (githubHead !== contract.targetCommit) {
    refusals.push({
      code: "GITHUB_HEAD_MISMATCH",
      detail: `canonical branch head is ${githubHead || "(unreadable)"}, expected ${contract.targetCommit}`,
    })
  }

  const checkService = (label: string, snap: ServiceConfigSnapshot, expectedId: string) => {
    if (snap.id !== expectedId) {
      refusals.push({ code: "SERVICE_ID_MISMATCH", detail: `${label} id is ${snap.id}, expected ${expectedId}` })
    }
    if (snap.repo !== contract.fromRepo) {
      refusals.push({
        code: "UNEXPECTED_SOURCE_REPO",
        detail: `${label} repo is ${snap.repo ?? "(unreadable)"}, expected the pre-migration repo ${contract.fromRepo}`,
      })
    }
    if (snap.branch !== contract.branch) {
      refusals.push({ code: "UNEXPECTED_BRANCH", detail: `${label} branch is ${snap.branch ?? "(unreadable)"}, expected ${contract.branch}` })
    }
    if (snap.autoDeploy !== "off") {
      refusals.push({ code: "AUTO_DEPLOY_NOT_OFF", detail: `${label} Auto Deploy is ${snap.autoDeploy}; it must be proven off` })
    }
  }

  checkService("web", web, contract.webServiceId)
  checkService("cron", cron, contract.cronServiceId)

  if (cron.schedule !== contract.cronSchedule) {
    refusals.push({ code: "UNEXPECTED_CRON_SCHEDULE", detail: `cron schedule is ${cron.schedule ?? "(unreadable)"}, expected ${contract.cronSchedule}` })
  }

  return { ok: refusals.length === 0, refusals }
}

export interface ConfigDrift {
  field: string
  before: string
  after: string
}

/**
 * DRIFT DETECTION across the PATCH.
 *
 * repo is expected to change and is checked against the contract instead. Every
 * other readable field must be byte-identical: id, branch, autoDeploy,
 * buildCommand, startCommand, schedule, and the SET of env var names (order is
 * not meaningful, membership is).
 *
 * A field that reads null on both sides is reported as UNREADABLE drift, not
 * silently accepted - "I could not see it before and I cannot see it now" is
 * not evidence that it survived.
 */
export function detectConfigDrift(before: ServiceConfigSnapshot, after: ServiceConfigSnapshot, expectedRepoAfter: string): ConfigDrift[] {
  const drift: ConfigDrift[] = []
  const cmp = (field: string, b: string | null, a: string | null) => {
    if (b === null && a === null) {
      drift.push({ field, before: "(unreadable)", after: "(unreadable)" })
      return
    }
    if (b !== a) drift.push({ field, before: String(b), after: String(a) })
  }

  if (before.id !== after.id) drift.push({ field: "id", before: before.id, after: after.id })
  if (after.repo !== expectedRepoAfter) drift.push({ field: "repo", before: String(before.repo), after: String(after.repo) })
  cmp("branch", before.branch, after.branch)
  if (before.autoDeploy !== after.autoDeploy || after.autoDeploy !== "off") {
    drift.push({ field: "autoDeploy", before: before.autoDeploy, after: after.autoDeploy })
  }
  cmp("buildCommand", before.buildCommand, after.buildCommand)
  cmp("startCommand", before.startCommand, after.startCommand)
  if (before.schedule !== null || after.schedule !== null) cmp("schedule", before.schedule, after.schedule)

  const beforeNames = [...before.envVarNames].sort()
  const afterNames = [...after.envVarNames].sort()
  if (beforeNames.join(",") !== afterNames.join(",")) {
    drift.push({ field: "envVarNames", before: beforeNames.join(",") || "(none)", after: afterNames.join(",") || "(none)" })
  }

  return drift
}

/** A deploy as this migration needs to see it. */
export interface DeployRecord {
  id: string
  status: string
  commitId: string | null
}

/**
 * Did the PATCH itself create a deploy? Render documents that it does not.
 * This does not take that on trust: a newest-deploy id that differs from the
 * one snapshotted immediately before the PATCH means one appeared, and the run
 * stops rather than assuming it is harmless - even if it is deploying the right
 * commit, it went out without passing through this pipeline's own ordering.
 */
export function deployAppearedFromPatch(beforeLatestDeployId: string | null, afterLatestDeployId: string | null): boolean {
  if (afterLatestDeployId === null) return false
  return afterLatestDeployId !== beforeLatestDeployId
}

export function deployMatchesTarget(deploy: DeployRecord, targetCommit: string): boolean {
  return deploy.commitId === targetCommit
}

export interface MigrationStepLog {
  step: string
  ok: boolean
  detail: string
}

export interface MigrationOutcome {
  outcome: "PASS" | "FAIL"
  steps: MigrationStepLog[]
  failedStep: string | null
  reason: string | null
  /** True whenever Production may be in a half-migrated or half-deployed state. */
  recoveryRequired: boolean
  recoveryDetail: string | null
  backupBranchId: string | null
  webSourceChanged: boolean
  cronSourceChanged: boolean
  webDeployId: string | null
  cronDeployId: string | null
  cronState: "suspended" | "active" | "unknown"
}

export interface BackupRecord {
  id: string
  name: string
}

export interface MigrationDeps {
  /** Throws unless PRODUCTION_WRITE_CONFIRM is set to the canonical value. */
  assertWriteConfirmed: () => void
  /** The canonical repository's branch head, read fresh from GitHub. */
  readGithubHead: () => Promise<string>
  readServiceSnapshot: (serviceId: string) => Promise<ServiceConfigSnapshot>
  createBackup: () => Promise<BackupRecord>
  verifyBackup: (backupId: string) => Promise<{ exists: boolean; isChildOfProduction: boolean }>
  suspendCron: () => Promise<void>
  getCronSuspended: () => Promise<boolean>
  /** Issues the two-key PATCH. Implementations must go through updateServiceSource. */
  updateSource: (serviceId: string, repo: string, branch: string) => Promise<void>
  /** Web only: commitId pins the deploy. */
  deployWebPinned: (commitId: string) => Promise<DeployRecord>
  /** Cron only: Render does not support commitId here, so this deploys the connected branch. */
  deployCronUnpinned: () => Promise<DeployRecord>
  waitForDeploy: (serviceId: string, deployId: string) => Promise<DeployRecord>
  postDeployCheck: () => Promise<{ pass: boolean; summary: string }>
  resumeCron: () => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The migration.
 *
 * THE CRON RACE, STATED HONESTLY. Render's Deploys API does not accept a
 * commitId for a Cron Job, so the Cron deploy is a branch-tip deploy. Between
 * the branch-head check immediately before that request and Render resolving
 * the tip, a push could move the branch, and this code cannot prevent that -
 * there is no lock in this project or in Render that holds a GitHub ref still.
 * What it does instead is DETECT it: the head is re-read immediately before the
 * request, and the created deploy's own commitId is then required to equal the
 * target exactly. A push landing inside that window produces a deploy whose
 * commit differs, and the run stops with recoveryRequired. That is detection,
 * not atomicity, and it is not claimed to be more.
 */
export async function runRenderSourceMigration(deps: MigrationDeps, contract: MigrationContract = RENDER_SOURCE_MIGRATION): Promise<MigrationOutcome> {
  const steps: MigrationStepLog[] = []
  let backupBranchId: string | null = null
  let webSourceChanged = false
  let cronSourceChanged = false
  let webDeployId: string | null = null
  let cronDeployId: string | null = null
  let cronState: MigrationOutcome["cronState"] = "unknown"

  const result = (
    outcome: "PASS" | "FAIL",
    failedStep: string | null,
    reason: string | null,
    recoveryRequired: boolean,
    recoveryDetail: string | null
  ): MigrationOutcome => ({
    outcome,
    steps,
    failedStep,
    reason,
    recoveryRequired,
    recoveryDetail,
    backupBranchId,
    webSourceChanged,
    cronSourceChanged,
    webDeployId,
    cronDeployId,
    cronState,
  })

  // Nothing below this line has touched Production yet, so a failure here is
  // never a recovery situation.
  const failClean = (step: string, reason: string) => result("FAIL", step, reason, false, null)
  // Past the first source PATCH, any failure may leave a half-migrated pair.
  const failDirty = (step: string, reason: string, detail: string) => result("FAIL", step, reason, true, detail)

  // 1. Production write confirmation - before any read that costs anything.
  try {
    deps.assertWriteConfirmed()
  } catch (error) {
    steps.push({ step: "1. Write confirmation", ok: false, detail: errorMessage(error) })
    return failClean("1. Write confirmation", errorMessage(error))
  }
  steps.push({ step: "1. Write confirmation", ok: true, detail: "confirmed" })

  // 2. Canonical GitHub head.
  let githubHead: string
  try {
    githubHead = await deps.readGithubHead()
  } catch (error) {
    steps.push({ step: "2. GitHub head", ok: false, detail: errorMessage(error) })
    return failClean("2. GitHub head", `Could not read the canonical branch head: ${errorMessage(error)}`)
  }
  steps.push({ step: "2. GitHub head", ok: true, detail: githubHead })

  // 3. Both services' before-snapshots.
  let webBefore: ServiceConfigSnapshot
  let cronBefore: ServiceConfigSnapshot
  try {
    webBefore = await deps.readServiceSnapshot(contract.webServiceId)
    cronBefore = await deps.readServiceSnapshot(contract.cronServiceId)
  } catch (error) {
    steps.push({ step: "3. Before snapshot", ok: false, detail: errorMessage(error) })
    return failClean("3. Before snapshot", `Could not read the services: ${errorMessage(error)}`)
  }
  steps.push({
    step: "3. Before snapshot",
    ok: true,
    detail: `web(${webBefore.repo} ${webBefore.branch} autoDeploy=${webBefore.autoDeploy}) cron(${cronBefore.repo} ${cronBefore.branch} autoDeploy=${cronBefore.autoDeploy} schedule=${cronBefore.schedule})`,
  })

  // 4. The gate. Identity, current source, branch, Auto Deploy, schedule, head.
  const gate = verifyPreMigrationState({ contract, web: webBefore, cron: cronBefore, githubHead })
  steps.push({
    step: "4. Pre-migration gate",
    ok: gate.ok,
    detail: gate.ok ? "all checks passed" : gate.refusals.map((r) => `[${r.code}] ${r.detail}`).join("; "),
  })
  if (!gate.ok) return failClean("4. Pre-migration gate", "Live state does not match the approved migration contract. Nothing was changed.")

  // 5. Neon backup - BEFORE the first source change, not before the deploy.
  let backup: BackupRecord
  try {
    backup = await deps.createBackup()
  } catch (error) {
    steps.push({ step: "5. Create backup", ok: false, detail: errorMessage(error) })
    return failClean("5. Create backup", `Backup creation failed: ${errorMessage(error)}. No source was changed.`)
  }
  backupBranchId = backup.id
  steps.push({ step: "5. Create backup", ok: true, detail: `${backup.name} (${backup.id})` })

  // 6. Verify it.
  let backupOk = false
  try {
    const v = await deps.verifyBackup(backup.id)
    backupOk = v.exists && v.isChildOfProduction
    steps.push({ step: "6. Verify backup", ok: backupOk, detail: `exists=${v.exists} isChildOfProduction=${v.isChildOfProduction}` })
  } catch (error) {
    steps.push({ step: "6. Verify backup", ok: false, detail: errorMessage(error) })
  }
  if (!backupOk) return failClean("6. Verify backup", "Backup could not be verified. No source was changed.")

  // 7. Suspend Cron - so no scheduled run starts against a half-migrated pair.
  try {
    await deps.suspendCron()
    steps.push({ step: "7. Suspend cron", ok: true, detail: "suspend requested" })
  } catch (error) {
    steps.push({ step: "7. Suspend cron", ok: false, detail: errorMessage(error) })
    return failClean("7. Suspend cron", `Failed to suspend Cron: ${errorMessage(error)}. No source was changed.`)
  }

  // 8. Verify suspended.
  try {
    const suspended = await deps.getCronSuspended()
    cronState = suspended ? "suspended" : "active"
    steps.push({ step: "8. Verify cron suspended", ok: suspended, detail: `suspended=${suspended}` })
    if (!suspended) return failClean("8. Verify cron suspended", "Cron did not report suspended. No source was changed.")
  } catch (error) {
    cronState = "unknown"
    steps.push({ step: "8. Verify cron suspended", ok: false, detail: errorMessage(error) })
    return failClean("8. Verify cron suspended", `Could not confirm Cron suspended: ${errorMessage(error)}. No source was changed.`)
  }

  // 9. THE WEB SOURCE PATCH. First write that cannot be undone cheaply.
  try {
    await deps.updateSource(contract.webServiceId, contract.toRepo, contract.branch)
    webSourceChanged = true
    steps.push({ step: "9. Web source PATCH", ok: true, detail: `${contract.fromRepo} -> ${contract.toRepo}` })
  } catch (error) {
    steps.push({ step: "9. Web source PATCH", ok: false, detail: errorMessage(error) })
    return failClean("9. Web source PATCH", `Web source update failed: ${errorMessage(error)}. Neither service was changed; Cron is left suspended.`)
  }

  // 10. Verify the web service, including that no deploy was born from the PATCH.
  let webAfter: ServiceConfigSnapshot
  try {
    webAfter = await deps.readServiceSnapshot(contract.webServiceId)
  } catch (error) {
    return failDirty("10. Verify web after PATCH", `Could not re-read the web service: ${errorMessage(error)}`, "Web source was changed; its post-state is unverified.")
  }
  const webDrift = detectConfigDrift(webBefore, webAfter, contract.toRepo)
  steps.push({
    step: "10. Verify web after PATCH",
    ok: webDrift.length === 0,
    detail: webDrift.length === 0 ? "no drift" : webDrift.map((d) => `${d.field}: ${d.before} -> ${d.after}`).join("; "),
  })
  if (webDrift.length > 0) {
    return failDirty("10. Verify web after PATCH", "Configuration drift on the web service.", "Web source changed and drifted; Cron untouched and suspended.")
  }
  if (deployAppearedFromPatch(webBefore.latestDeployId, webAfter.latestDeployId)) {
    steps.push({ step: "10b. Web unexpected deploy", ok: false, detail: `new deploy ${webAfter.latestDeployId} appeared from the PATCH` })
    return failDirty(
      "10b. Web unexpected deploy",
      "A deploy appeared from the source PATCH, which Render documents should not happen.",
      `Web deploy ${webAfter.latestDeployId} was not triggered by this pipeline. Do not trigger another.`
    )
  }
  steps.push({ step: "10b. Web unexpected deploy", ok: true, detail: "none" })

  // 11. THE CRON SOURCE PATCH.
  try {
    await deps.updateSource(contract.cronServiceId, contract.toRepo, contract.branch)
    cronSourceChanged = true
    steps.push({ step: "11. Cron source PATCH", ok: true, detail: `${contract.fromRepo} -> ${contract.toRepo}` })
  } catch (error) {
    steps.push({ step: "11. Cron source PATCH", ok: false, detail: errorMessage(error) })
    return failDirty("11. Cron source PATCH", `Cron source update failed: ${errorMessage(error)}`, "PARTIAL MIGRATION: web source changed, cron source did NOT.")
  }

  // 12. Verify the cron service the same way.
  let cronAfter: ServiceConfigSnapshot
  try {
    cronAfter = await deps.readServiceSnapshot(contract.cronServiceId)
  } catch (error) {
    return failDirty("12. Verify cron after PATCH", `Could not re-read the cron service: ${errorMessage(error)}`, "Both sources changed; cron post-state unverified.")
  }
  const cronDrift = detectConfigDrift(cronBefore, cronAfter, contract.toRepo)
  steps.push({
    step: "12. Verify cron after PATCH",
    ok: cronDrift.length === 0,
    detail: cronDrift.length === 0 ? "no drift" : cronDrift.map((d) => `${d.field}: ${d.before} -> ${d.after}`).join("; "),
  })
  if (cronDrift.length > 0) return failDirty("12. Verify cron after PATCH", "Configuration drift on the cron service.", "Both sources changed; cron drifted.")
  if (deployAppearedFromPatch(cronBefore.latestDeployId, cronAfter.latestDeployId)) {
    steps.push({ step: "12b. Cron unexpected deploy", ok: false, detail: `new deploy ${cronAfter.latestDeployId} appeared from the PATCH` })
    return failDirty(
      "12b. Cron unexpected deploy",
      "A deploy appeared from the cron source PATCH.",
      `Cron deploy ${cronAfter.latestDeployId} was not triggered by this pipeline. Do not trigger another.`
    )
  }
  steps.push({ step: "12b. Cron unexpected deploy", ok: true, detail: "none" })

  // 13. Re-read the GitHub head immediately before deploying, then deploy the
  //     web service PINNED to the exact commit.
  try {
    const headNow = await deps.readGithubHead()
    if (headNow !== contract.targetCommit) {
      steps.push({ step: "13. Head recheck (web)", ok: false, detail: `head moved to ${headNow}` })
      return failDirty("13. Head recheck (web)", "The canonical branch head moved after the source migration.", "Both sources migrated; nothing deployed.")
    }
    steps.push({ step: "13. Head recheck (web)", ok: true, detail: headNow })
  } catch (error) {
    return failDirty("13. Head recheck (web)", `Could not re-read the branch head: ${errorMessage(error)}`, "Both sources migrated; nothing deployed.")
  }

  let webDeploy: DeployRecord
  try {
    webDeploy = await deps.deployWebPinned(contract.targetCommit)
    webDeployId = webDeploy.id
    steps.push({ step: "14. Deploy web (pinned)", ok: true, detail: `${webDeploy.id} commit=${webDeploy.commitId ?? "unknown"}` })
  } catch (error) {
    return failDirty("14. Deploy web (pinned)", `Web deploy failed to start: ${errorMessage(error)}`, "Both sources migrated; web deploy did not start.")
  }
  if (!deployMatchesTarget(webDeploy, contract.targetCommit)) {
    steps.push({ step: "14b. Web deploy commit", ok: false, detail: `${webDeploy.commitId ?? "unknown"} != ${contract.targetCommit}` })
    return failDirty("14b. Web deploy commit", "The web deploy is not the approved commit.", `Web deploy ${webDeploy.id} targets ${webDeploy.commitId ?? "unknown"}.`)
  }
  steps.push({ step: "14b. Web deploy commit", ok: true, detail: contract.targetCommit })

  // 15. Cron: head recheck again, then an UNPINNED deploy, then assert its commit.
  try {
    const headNow = await deps.readGithubHead()
    if (headNow !== contract.targetCommit) {
      steps.push({ step: "15. Head recheck (cron)", ok: false, detail: `head moved to ${headNow}` })
      return failDirty("15. Head recheck (cron)", "The canonical branch head moved before the cron deploy.", "Both sources migrated; web deployed, cron not deployed.")
    }
    steps.push({ step: "15. Head recheck (cron)", ok: true, detail: headNow })
  } catch (error) {
    return failDirty("15. Head recheck (cron)", `Could not re-read the branch head: ${errorMessage(error)}`, "Both sources migrated; web deployed, cron not deployed.")
  }

  let cronDeploy: DeployRecord
  try {
    cronDeploy = await deps.deployCronUnpinned()
    cronDeployId = cronDeploy.id
    steps.push({ step: "16. Deploy cron (branch tip - commitId unsupported)", ok: true, detail: `${cronDeploy.id} commit=${cronDeploy.commitId ?? "unknown"}` })
  } catch (error) {
    return failDirty("16. Deploy cron", `Cron deploy failed to start: ${errorMessage(error)}`, "PARTIAL DEPLOYMENT: web deployed, cron deploy did not start.")
  }
  if (!deployMatchesTarget(cronDeploy, contract.targetCommit)) {
    steps.push({ step: "16b. Cron deploy commit", ok: false, detail: `${cronDeploy.commitId ?? "unknown"} != ${contract.targetCommit}` })
    return failDirty(
      "16b. Cron deploy commit",
      "The cron deploy is not the approved commit - the branch tip resolved to something else.",
      `PARTIAL DEPLOYMENT: web is on ${contract.targetCommit}, cron deploy ${cronDeploy.id} targets ${cronDeploy.commitId ?? "unknown"}.`
    )
  }
  steps.push({ step: "16b. Cron deploy commit", ok: true, detail: contract.targetCommit })

  // 17-18. Wait for both, requiring the finished deploys to still be the target.
  for (const [label, serviceId, deploy] of [
    ["17. Wait web deploy", contract.webServiceId, webDeploy],
    ["18. Wait cron deploy", contract.cronServiceId, cronDeploy],
  ] as const) {
    let finished: DeployRecord
    try {
      finished = await deps.waitForDeploy(serviceId, deploy.id)
    } catch (error) {
      return failDirty(label, `Waiting for the deploy failed: ${errorMessage(error)}`, "One or both deploys are in an unknown state.")
    }
    const live = finished.status === "live" || finished.status === "succeeded"
    const commitOk = deployMatchesTarget(finished, contract.targetCommit)
    steps.push({ step: label, ok: live && commitOk, detail: `${finished.status} commit=${finished.commitId ?? "unknown"}` })
    if (!live || !commitOk) {
      return failDirty(label, `Deploy did not finish on the approved commit (status=${finished.status}).`, "PARTIAL DEPLOYMENT - inspect both services before acting.")
    }
  }

  // 19. Existing post-deploy verification, unchanged.
  let post: { pass: boolean; summary: string }
  try {
    post = await deps.postDeployCheck()
  } catch (error) {
    return failDirty("19. Post-deploy check", `Post-deploy check failed to run: ${errorMessage(error)}`, "Both deploys completed; verification did not run.")
  }
  steps.push({ step: "19. Post-deploy check", ok: post.pass, detail: post.summary })
  if (!post.pass) return failDirty("19. Post-deploy check", "Post-deploy verification failed.", "Both deploys completed but Production did not verify.")

  // 20. Resume Cron - ONLY on the full success path, exactly as prod:deploy:safe does.
  try {
    await deps.resumeCron()
    cronState = "active"
    steps.push({ step: "20. Resume cron", ok: true, detail: "resume requested" })
  } catch (error) {
    cronState = "unknown"
    steps.push({ step: "20. Resume cron", ok: false, detail: errorMessage(error) })
    return failDirty("20. Resume cron", `Failed to resume Cron: ${errorMessage(error)}`, "Migration and deploys succeeded; Cron is still suspended.")
  }

  return result("PASS", null, null, false, null)
}
