/**
 * DESTRUCTIVE, ONE-TIME: repoints BOTH Render services at the canonical
 * repository and deploys the approved commit.
 *
 * DRY RUN IS THE DEFAULT. Without --execute this reads Render and GitHub,
 * prints both before-snapshots and the pre-migration gate's verdict, and stops.
 * It writes nothing and needs no PRODUCTION_WRITE_CONFIRM.
 *
 * --execute runs the full ordering in render-source-migration.ts: write
 * confirmation, canonical head, both snapshots, the gate, Neon backup, backup
 * verification, Cron suspend + verify, the two-key source PATCH per service
 * with drift and unexpected-deploy verification after each, a head re-read
 * before each deploy, a COMMIT-PINNED web deploy, an unpinned cron deploy whose
 * commit is asserted afterwards, both waits, the existing post-deploy check,
 * and only then Cron resume.
 *
 * IT NEVER REPAIRS. Any failure past the first PATCH reports
 * RECOVERY REQUIRED with the exact state and stops. No source rollback, no
 * service recreation, no second deploy, no Cron resume on a failure path.
 *
 *   npm run prod:render:source-migrate              # dry run
 *   PRODUCTION_WRITE_CONFIRM=... npm run prod:render:source-migrate -- --execute
 */
import { execFileSync } from "node:child_process"
import {
  RENDER_SOURCE_MIGRATION,
  runRenderSourceMigration,
  verifyPreMigrationState,
  type MigrationDeps,
} from "../../src/lib/production/render-source-migration"
import {
  getCronStatus,
  getServiceConfigSnapshot,
  migrateServiceSource,
  resumeCron,
  suspendCron,
  triggerServiceDeploy,
  waitForDeploy,
} from "../../src/lib/production/render-ops"
import { createBackupBranch, verifyBackupBranch } from "../../src/lib/production/neon-ops"
import { NeonCredentialsMissingError } from "../../src/lib/production/neon-client"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { ProductionWriteNotConfirmedError, assertProductionWriteConfirmed } from "../../src/lib/production/write-guard"

const C = RENDER_SOURCE_MIGRATION

/**
 * The canonical branch head, read from the REMOTE over the wire (ls-remote
 * consults the server) rather than from any local clone, which could be stale
 * or ahead.
 */
function readGithubHead(): string {
  const out = execFileSync("git", ["ls-remote", C.toRepo, `refs/heads/${C.branch}`], { encoding: "utf8" })
  const sha = out.split(/\s+/)[0]?.trim() ?? ""
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`could not read ${C.branch} on ${C.toRepo}`)
  return sha
}

function runPostDeployCheck(): { pass: boolean; summary: string } {
  try {
    const out = execFileSync("npx", ["tsx", "scripts/production/post-deploy-check.ts"], { encoding: "utf8" })
    return { pass: !/\bFAIL\b/.test(out), summary: out.trim().split("\n").slice(-3).join(" | ") }
  } catch (error) {
    return { pass: false, summary: error instanceof Error ? error.message : String(error) }
  }
}

const deps: MigrationDeps = {
  assertWriteConfirmed: () => assertProductionWriteConfirmed(process.env),
  readGithubHead: async () => readGithubHead(),
  readServiceSnapshot: async (serviceId) => getServiceConfigSnapshot(serviceId),
  createBackup: async () => {
    const b = await createBackupBranch()
    return { id: b.id, name: b.name }
  },
  verifyBackup: async (backupId) => verifyBackupBranch(backupId),
  suspendCron: async () => suspendCron(),
  getCronSuspended: async () => (await getCronStatus()).suspended === true,
  updateSource: async (serviceId, repo, branch) => migrateServiceSource(serviceId, repo, branch),
  // WEB: pinned to the exact commit.
  deployWebPinned: async (commitId) => {
    const d = await triggerServiceDeploy(C.webServiceId, commitId)
    return { id: d.id, status: d.status, commitId: d.commitId }
  },
  // CRON: Render does not accept commitId here, so no commitId is sent. The
  // orchestrator asserts the created deploy's commit instead.
  deployCronUnpinned: async () => {
    const d = await triggerServiceDeploy(C.cronServiceId, undefined)
    return { id: d.id, status: d.status, commitId: d.commitId }
  },
  waitForDeploy: async (serviceId, deployId) => {
    const w = await waitForDeploy(serviceId, deployId)
    // Only render-ops' own "success" outcome maps to a live status. A timeout
    // or a failure keeps its real shape in the string so the step log says what
    // actually happened rather than just "not live".
    return {
      id: deployId,
      status: w.outcome === "success" ? "live" : `${w.outcome}:${w.deploy.status}`,
      commitId: w.deploy.commitId,
    }
  },
  postDeployCheck: async () => runPostDeployCheck(),
  resumeCron: async () => resumeCron(),
}

function describeSnapshot(label: string, s: Awaited<ReturnType<typeof getServiceConfigSnapshot>>): void {
  console.info(`${label}:`)
  console.info(`  id:            ${s.id}`)
  console.info(`  repo:          ${s.repo ?? "unreadable"}`)
  console.info(`  branch:        ${s.branch ?? "unreadable"}`)
  console.info(`  autoDeploy:    ${s.autoDeploy}`)
  console.info(`  buildCommand:  ${s.buildCommand ?? "unreadable"}`)
  console.info(`  startCommand:  ${s.startCommand ?? "unreadable"}`)
  console.info(`  schedule:      ${s.schedule ?? "(none - not a cron)"}`)
  console.info(`  env var NAMES: ${s.envVarNames.join(", ") || "(none)"}`)
  console.info(`  latest deploy: ${s.latestDeployId ?? "(none)"}`)
}

async function main() {
  const execute = process.argv.slice(2).includes("--execute")

  console.info("=== prod:render:source-migrate ===")
  console.info(`Mode:   ${execute ? "EXECUTE (CHANGES RENDER AND DEPLOYS PRODUCTION)" : "DRY RUN (read-only, changes nothing)"}`)
  console.info(`From:   ${C.fromRepo}`)
  console.info(`To:     ${C.toRepo}`)
  console.info(`Branch: ${C.branch}`)
  console.info(`Commit: ${C.targetCommit}\n`)

  try {
    if (execute) {
      const outcome = await runRenderSourceMigration(deps)
      for (const s of outcome.steps) console.info(`[${s.ok ? "OK" : "FAIL"}] ${s.step}: ${s.detail}`)
      console.info("")
      if (outcome.outcome === "PASS") {
        console.info("RENDER SOURCE MIGRATION: PASS")
        return
      }
      console.error(`FAILED STEP: ${outcome.failedStep}`)
      console.error(`REASON:      ${outcome.reason}`)
      console.error(`RECOVERY REQUIRED: ${outcome.recoveryRequired ? "YES" : "NO"}`)
      if (outcome.recoveryDetail) console.error(`  ${outcome.recoveryDetail}`)
      console.error(`  web source changed: ${outcome.webSourceChanged}   cron source changed: ${outcome.cronSourceChanged}`)
      console.error(`  web deploy: ${outcome.webDeployId ?? "none"}   cron deploy: ${outcome.cronDeployId ?? "none"}`)
      console.error(`  cron state: ${outcome.cronState}   backup: ${outcome.backupBranchId ?? "none"}`)
      console.error("\nDo NOT repair by hand and do NOT re-run this command. Report this output.")
      process.exitCode = 1
      return
    }

    // DRY RUN: reads only.
    const head = readGithubHead()
    console.info(`GitHub ${C.branch} head: ${head}`)
    console.info(`  ${head === C.targetCommit ? "MATCHES the approved target commit" : "DOES NOT MATCH the approved target commit"}\n`)

    const web = await getServiceConfigSnapshot(C.webServiceId)
    const cron = await getServiceConfigSnapshot(C.cronServiceId)
    describeSnapshot("Web", web)
    console.info("")
    describeSnapshot("Cron", cron)

    const gate = verifyPreMigrationState({ contract: C, web, cron, githubHead: head })
    console.info(`\nPRE-MIGRATION GATE: ${gate.ok ? "PASS" : "REFUSE"}`)
    for (const r of gate.refusals) console.error(`  [${r.code}] ${r.detail}`)
    console.info("\nDRY RUN - NOTHING WAS CHANGED, NOTHING WAS DEPLOYED.")
    if (gate.ok) {
      console.info("To execute: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:render:source-migrate -- --execute")
    }
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError || error instanceof RenderCredentialsMissingError || error instanceof NeonCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:render:source-migrate failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
