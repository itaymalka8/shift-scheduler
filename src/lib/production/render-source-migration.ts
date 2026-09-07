/**
 * THE ONE-TIME RENDER SOURCE MIGRATION, as pure orchestration.
 *
 * WHAT IT DOES, AND THE ONE THING IT DELIBERATELY DOES NOT. It moves the two
 * existing Render services from the repository they are currently built from to
 * the canonical one, on the same branch, without recreating a service and
 * without touching any other configuration field. IT DOES NOT DEPLOY. It does
 * not trigger a deploy, wait for one, or run any check that assumes one
 * happened, and it cannot reach a deploy endpoint on any path - success or
 * failure. When it finishes, Production is still running exactly the commit it
 * was running before; only Render's source metadata has moved.
 *
 * WHY THE SPLIT. This project has exactly one deployment authority,
 * `npm run prod:deploy:safe`, and a migration that also deployed would be a
 * second one - with its own ordering, its own failure modes, and its own
 * opportunity to diverge from the contract the first one enforces. Migrating
 * the source and deploying a commit are also two decisions that deserve two
 * approvals. So this command changes source metadata and stops; the deploy is
 * a separate, separately-approved run of prod:deploy:safe afterwards.
 *
 * IT DOES NOT RESUME CRON, AND THAT IS THE POINT OF THE SUSPENDED HANDOFF.
 * Render records a deploy trigger of `service_resumed`: resuming a suspended
 * service can CREATE A DEPLOYMENT. A migration that resumed Cron would
 * therefore be able to print "DEPLOY PERFORMED: NO" and then cause a deploy
 * one call later, after its own final check had already passed - the check
 * would be true when it ran and false by the time anyone read it. So a
 * successful source migration ends with Cron DELIBERATELY SUSPENDED, and the
 * resume happens inside prod:deploy:safe, where a resume-triggered deployment
 * is part of the approved deploy rather than a surprise after one.
 *
 * IT STILL SITS BEHIND THE FULL SAFETY ORDERING, because a source change is
 * itself a Production write with no cheap undo, and because Render could in
 * principle deploy off the back of one - the backup exists and Cron is down
 * before the first PATCH precisely so that possibility is survivable, and
 * steps 11 and 14 prove it did not happen.
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
  /** The commit that newest deploy carried - the commit Production is actually running. Must be identical before and after. */
  latestDeployCommit: string | null
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

/**
 * Did the PATCH itself create a deploy? Render documents that a configuration
 * change through the Update Service API does not deploy, regardless of
 * autoDeploy. This does not take that on trust: a newest-deploy id differing
 * from the one snapshotted immediately before the PATCH means one appeared, and
 * the run stops rather than assuming it is harmless - a deploy nobody approved
 * is a deploy nobody approved, whatever commit it carries.
 */
export function deployAppearedFromPatch(beforeLatestDeployId: string | null, afterLatestDeployId: string | null): boolean {
  if (afterLatestDeployId === null) return false
  return afterLatestDeployId !== beforeLatestDeployId
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
  /** The commit Production was running when this started, and still is. */
  deployedCommitBefore: { web: string | null; cron: string | null } | null
  deployedCommitAfter: { web: string | null; cron: string | null } | null
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
}

/**
 * NOTE ON WHAT IS ABSENT. There is deliberately no deploy dependency of any
 * kind here - no trigger, no wait, no post-deploy check - and no RESUME either,
 * because a resume can itself trigger a deployment. A dep this interface does
 * not declare is a call the orchestration cannot make, which is a stronger
 * guarantee than a rule saying it must not.
 */

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
  let deployedCommitBefore: MigrationOutcome["deployedCommitBefore"] = null
  let deployedCommitAfter: MigrationOutcome["deployedCommitAfter"] = null
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
    deployedCommitBefore,
    deployedCommitAfter,
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
  deployedCommitBefore = { web: webBefore.latestDeployCommit, cron: cronBefore.latestDeployCommit }
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

  // 15-19. FINAL CROSS-CHECKS, on a FRESH read of both services.
  //
  //         Deliberately not reusing the step 10 / step 12 snapshots. Those
  //         were taken at different moments - the web one before the cron PATCH
  //         was even issued - so a deploy or an edit that landed after a
  //         service's own check would be invisible to a final verdict built
  //         from it. The end state has to be read as an end state.
  let webFinal: ServiceConfigSnapshot
  let cronFinal: ServiceConfigSnapshot
  try {
    webFinal = await deps.readServiceSnapshot(contract.webServiceId)
    cronFinal = await deps.readServiceSnapshot(contract.cronServiceId)
  } catch (error) {
    return failDirty("15-19. Final configuration verification", `Could not re-read the services: ${errorMessage(error)}`, "Both sources were patched; the end state is unverified.")
  }

  const finalRefusals: string[] = []
  for (const [label, snap, expectedId] of [
    ["web", webFinal, contract.webServiceId],
    ["cron", cronFinal, contract.cronServiceId],
  ] as const) {
    if (snap.repo !== contract.toRepo) finalRefusals.push(`${label} repo is ${snap.repo ?? "(unreadable)"}, expected ${contract.toRepo}`)
    if (snap.branch !== contract.branch) finalRefusals.push(`${label} branch is ${snap.branch ?? "(unreadable)"}, expected ${contract.branch}`)
    if (snap.autoDeploy !== "off") finalRefusals.push(`${label} Auto Deploy is ${snap.autoDeploy}, expected off`)
    if (snap.id !== expectedId) finalRefusals.push(`${label} id is ${snap.id}, expected ${expectedId}`)
  }
  if (cronFinal.schedule !== contract.cronSchedule) {
    finalRefusals.push(`cron schedule is ${cronFinal.schedule ?? "(unreadable)"}, expected ${contract.cronSchedule}`)
  }
  steps.push({
    step: "15-19. Final configuration verification",
    ok: finalRefusals.length === 0,
    detail: finalRefusals.length === 0 ? "both services on the canonical source, everything else unchanged" : finalRefusals.join("; "),
  })
  if (finalRefusals.length > 0) {
    return failDirty("15-19. Final configuration verification", finalRefusals.join("; "), "Both sources were patched but the end state does not match the contract.")
  }

  // THE DEPLOY THAT MUST NOT HAVE HAPPENED. Production has to still be running
  // the commit it was running before this command started - same deploy id AND
  // same commit on both services. A changed deploy id was already caught per
  // service above; this states the guarantee the operator actually cares about.
  deployedCommitAfter = { web: webFinal.latestDeployCommit, cron: cronFinal.latestDeployCommit }
  const deployMoved: string[] = []
  if (webFinal.latestDeployId !== webBefore.latestDeployId || webFinal.latestDeployCommit !== webBefore.latestDeployCommit) {
    deployMoved.push(`web ${webBefore.latestDeployCommit ?? "?"} (${webBefore.latestDeployId ?? "?"}) -> ${webFinal.latestDeployCommit ?? "?"} (${webFinal.latestDeployId ?? "?"})`)
  }
  if (cronFinal.latestDeployId !== cronBefore.latestDeployId || cronFinal.latestDeployCommit !== cronBefore.latestDeployCommit) {
    deployMoved.push(`cron ${cronBefore.latestDeployCommit ?? "?"} (${cronBefore.latestDeployId ?? "?"}) -> ${cronFinal.latestDeployCommit ?? "?"} (${cronFinal.latestDeployId ?? "?"})`)
  }
  steps.push({
    step: "19b. Deployed commit unchanged",
    ok: deployMoved.length === 0,
    detail: deployMoved.length === 0 ? `web=${webFinal.latestDeployCommit ?? "none"} cron=${cronFinal.latestDeployCommit ?? "none"} (unchanged)` : deployMoved.join("; "),
  })
  if (deployMoved.length > 0) {
    return failDirty("19b. Deployed commit unchanged", "A deploy happened during the source migration.", deployMoved.join("; "))
  }

  // 20-21. CRON IS LEFT SUSPENDED, DELIBERATELY, and that is re-confirmed here
  //        rather than assumed from step 8 - the run has issued two PATCHes
  //        since then. Resuming is what prod:deploy:safe does, inside the
  //        approved deploy, precisely because a resume can trigger one.
  try {
    const stillSuspended = await deps.getCronSuspended()
    cronState = stillSuspended ? "suspended" : "active"
    steps.push({ step: "20-21. Cron left suspended (handoff)", ok: stillSuspended, detail: `suspended=${stillSuspended}` })
    if (!stillSuspended) {
      return failDirty(
        "20-21. Cron left suspended (handoff)",
        "Cron is not suspended at the end of the migration - something resumed it.",
        "Both sources migrated, but Cron is ACTIVE. A resume can trigger a deployment; check Render before running prod:deploy:safe.",
      )
    }
  } catch (error) {
    cronState = "unknown"
    steps.push({ step: "20-21. Cron left suspended (handoff)", ok: false, detail: errorMessage(error) })
    return failDirty("20-21. Cron left suspended (handoff)", `Could not confirm Cron is still suspended: ${errorMessage(error)}`, "Both sources migrated; Cron state unknown.")
  }

  // 22. Stop. Cron stays suspended until prod:deploy:safe picks up the handoff.
  return result("PASS", null, null, false, null)
}

/**
 * The commit Production is running before the Phase 3R deploy, and must STILL
 * be running when prod:deploy:safe picks up the handoff. If it has moved,
 * something deployed in between and the handoff is not the state that was
 * reviewed.
 */
export const PRE_DEPLOY_PRODUCTION_COMMIT = "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e"

export interface DeployHandoffReading {
  web: ServiceConfigSnapshot
  cron: ServiceConfigSnapshot
  githubHead: string
  cronSuspended: boolean
}

/**
 * THE HANDOFF GATE, for prod:deploy:safe's opt-in handoff mode.
 *
 * A suspended Cron is normally a reason for the deploy pipeline to be
 * suspicious - it means something interrupted a previous run. In handoff mode
 * it is expected, because the source migration left it that way ON PURPOSE so
 * that the resume (which Render can turn into a deployment - trigger
 * `service_resumed`) happens inside the approved deploy rather than after an
 * unrelated command has already declared success.
 *
 * Because that inverts a safety expectation, this gate is deliberately the
 * strictest in the codebase: it re-proves the ENTIRE post-migration state
 * before the deploy is allowed to mutate anything. Every field is fail-closed,
 * an unreadable value is refused exactly like a wrong one, and all refusals are
 * returned together.
 */
export function verifyDeployHandoffState(input: {
  contract: MigrationContract
  reading: DeployHandoffReading
  expectedProductionCommit?: string
}): { ok: boolean; refusals: MigrationRefusal[] } {
  const { contract, reading } = input
  const expectedProductionCommit = input.expectedProductionCommit ?? PRE_DEPLOY_PRODUCTION_COMMIT
  const refusals: MigrationRefusal[] = []

  // The handoff's defining precondition. An ACTIVE cron means either the
  // migration did not finish, or something resumed it since - and a resume may
  // already have deployed.
  if (!reading.cronSuspended) {
    refusals.push({ code: "CRON_NOT_SUSPENDED", detail: "handoff mode requires Cron to be already suspended by the source migration" })
  }

  if (reading.githubHead !== contract.targetCommit) {
    refusals.push({ code: "GITHUB_HEAD_MISMATCH", detail: `canonical branch head is ${reading.githubHead || "(unreadable)"}, expected ${contract.targetCommit}` })
  }

  for (const [label, snap, expectedId] of [
    ["web", reading.web, contract.webServiceId],
    ["cron", reading.cron, contract.cronServiceId],
  ] as const) {
    if (snap.id !== expectedId) refusals.push({ code: "SERVICE_ID_MISMATCH", detail: `${label} id is ${snap.id}, expected ${expectedId}` })
    // The migration must ALREADY have happened - this is the post-migration
    // state, so the repo has to be the canonical one, not the old one.
    if (snap.repo !== contract.toRepo) {
      refusals.push({ code: "SOURCE_NOT_MIGRATED", detail: `${label} repo is ${snap.repo ?? "(unreadable)"}, expected ${contract.toRepo}` })
    }
    if (snap.branch !== contract.branch) {
      refusals.push({ code: "UNEXPECTED_BRANCH", detail: `${label} branch is ${snap.branch ?? "(unreadable)"}, expected ${contract.branch}` })
    }
    if (snap.autoDeploy !== "off") {
      refusals.push({ code: "AUTO_DEPLOY_NOT_OFF", detail: `${label} Auto Deploy is ${snap.autoDeploy}; it must be proven off` })
    }
    // No deploy may have happened between the migration and this handoff.
    if (snap.latestDeployCommit !== expectedProductionCommit) {
      refusals.push({
        code: "UNEXPECTED_DEPLOY_SINCE_MIGRATION",
        detail: `${label} deployed commit is ${snap.latestDeployCommit ?? "(unreadable)"}, expected ${expectedProductionCommit} - something deployed since the source migration`,
      })
    }
  }

  if (reading.cron.schedule !== contract.cronSchedule) {
    refusals.push({ code: "UNEXPECTED_CRON_SCHEDULE", detail: `cron schedule is ${reading.cron.schedule ?? "(unreadable)"}, expected ${contract.cronSchedule}` })
  }

  return { ok: refusals.length === 0, refusals }
}

/** After the deploy AND the resume: both services must be running the approved commit. */
export function verifyPostDeployTargetCommits(
  deployed: { web: string | null; cron: string | null },
  targetCommit: string
): { ok: boolean; detail: string } {
  const ok = deployed.web === targetCommit && deployed.cron === targetCommit
  return { ok, detail: `web=${deployed.web ?? "unreadable"} cron=${deployed.cron ?? "unreadable"} expected=${targetCommit}` }
}
