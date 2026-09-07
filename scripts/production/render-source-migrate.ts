/**
 * DESTRUCTIVE, ONE-TIME: repoints BOTH Render services at the canonical
 * repository. IT DOES NOT DEPLOY, AND CANNOT.
 *
 * DRY RUN IS THE DEFAULT. Without --execute this reads Render and GitHub,
 * prints both before-snapshots and the pre-migration gate's verdict, and stops.
 * It writes nothing and needs no PRODUCTION_WRITE_CONFIRM.
 *
 * --execute runs the full ordering in render-source-migration.ts: write
 * confirmation, canonical head, both snapshots, the gate, Neon backup, backup
 * verification, Cron suspend + verify, the two-key source PATCH per service
 * with drift and unexpected-deploy verification after each, the final
 * pair-level configuration checks, a proof that the deployed commit did not
 * move, Cron resume, and Cron-active verification. Then it stops.
 *
 * PRODUCTION KEEPS RUNNING THE COMMIT IT WAS ALREADY RUNNING. Only Render's
 * source metadata changes.
 *
 * IT LEAVES CRON SUSPENDED ON PURPOSE. Render can turn a resume into a
 * deployment (trigger `service_resumed`), so resuming here would let this
 * command print "DEPLOY PERFORMED: NO" and then cause a deploy a call later.
 * The resume belongs to prod:deploy:safe's handoff mode, where a
 * resume-triggered deployment is part of the approved deploy. Deploying is a separate, separately-approved run of
 * `npm run prod:deploy:safe`, which remains this project's ONLY deployment
 * authority - there is no deploy call anywhere in this file or in the module it
 * drives.
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
import { getCronStatus, getServiceConfigSnapshot, migrateServiceSource, suspendCron } from "../../src/lib/production/render-ops"
import { createBackupBranch, verifyBackupBranch } from "../../src/lib/production/neon-ops"
import { fetchGithubRef, readCanonicalHead } from "../../src/lib/production/canonical-head"
import { NeonCredentialsMissingError } from "../../src/lib/production/neon-client"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { ProductionWriteNotConfirmedError, assertProductionWriteConfirmed } from "../../src/lib/production/write-guard"

const C = RENDER_SOURCE_MIGRATION

/**
 * The canonical branch head, through the shared reader.
 *
 * NOT a bare `git ls-remote`: the canonical repository is PRIVATE, and the
 * Production workflows check out with persist-credentials: false so the job
 * holds no credential that could write to git. An unauthenticated git read
 * against a private repo has no auth to use and dies. The shared reader uses
 * the GitHub API with a read-only token when one is present, and keeps the git
 * read only for local shells, where git is already authenticated. Everything
 * fails closed - see canonical-head.ts.
 */
async function readGithubHead(): Promise<string> {
  const result = await readCanonicalHead(
    { repoUrl: C.toRepo, branch: C.branch },
    {
      fetchRef: fetchGithubRef,
      gitLsRemote: (repoUrl, branch) => execFileSync("git", ["ls-remote", repoUrl, `refs/heads/${branch}`], { encoding: "utf8" }),
      env: process.env,
    }
  )
  if (!result.ok || result.sha === null) throw new Error(result.detail)
  return result.sha
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
  console.info(`  latest deploy: ${s.latestDeployId ?? "(none)"} commit=${s.latestDeployCommit ?? "(none)"}`)
}

async function main() {
  const execute = process.argv.slice(2).includes("--execute")

  console.info("=== prod:render:source-migrate ===")
  console.info(`Mode:   ${execute ? "EXECUTE (CHANGES RENDER SOURCE METADATA - DOES NOT DEPLOY)" : "DRY RUN (read-only, changes nothing)"}`)
  console.info(`From:   ${C.fromRepo}`)
  console.info(`To:     ${C.toRepo}`)
  console.info(`Branch: ${C.branch}`)
  console.info(`Commit: ${C.targetCommit}  (the head this gate requires - NOT deployed by this command)\n`)

  try {
    if (execute) {
      const outcome = await runRenderSourceMigration(deps)
      for (const s of outcome.steps) console.info(`[${s.ok ? "OK" : "FAIL"}] ${s.step}: ${s.detail}`)
      console.info("")
      if (outcome.outcome === "PASS") {
        console.info("SOURCE MIGRATION COMPLETE")
        console.info("DEPLOY PERFORMED: NO")
        console.info(
          `PRODUCTION COMMIT UNCHANGED: web=${outcome.deployedCommitAfter?.web ?? "unknown"} cron=${outcome.deployedCommitAfter?.cron ?? "unknown"}`
        )
        console.info("CRON STATE: SUSPENDED")
        console.info("NEXT APPROVED STEP: dispatch WORKFLOW B -")
        console.info("  .github/workflows/goalx-render-safe-deploy-handoff.yml on goalx-manager/main")
        console.info("  which runs: npm run prod:deploy:safe -- --handoff")
        console.info("  The ORDINARY safe deploy is NOT the next step: Cron is deliberately suspended,")
        console.info("  and only the handoff path expects that and re-proves the post-migration state.")
        return
      }
      console.error(`FAILED STEP: ${outcome.failedStep}`)
      console.error(`REASON:      ${outcome.reason}`)
      console.error(`RECOVERY REQUIRED: ${outcome.recoveryRequired ? "YES" : "NO"}`)
      if (outcome.recoveryDetail) console.error(`  ${outcome.recoveryDetail}`)
      console.error(`  web source changed: ${outcome.webSourceChanged}   cron source changed: ${outcome.cronSourceChanged}`)
      console.error(`  deployed commit before: web=${outcome.deployedCommitBefore?.web ?? "?"} cron=${outcome.deployedCommitBefore?.cron ?? "?"}`)
      console.error(`  deployed commit after:  web=${outcome.deployedCommitAfter?.web ?? "?"} cron=${outcome.deployedCommitAfter?.cron ?? "?"}`)
      console.error(`  cron state: ${outcome.cronState}   backup: ${outcome.backupBranchId ?? "none"}`)
      console.error("\nDo NOT repair by hand and do NOT re-run this command. Report this output.")
      process.exitCode = 1
      return
    }

    // DRY RUN: reads only.
    const head = await readGithubHead()
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
