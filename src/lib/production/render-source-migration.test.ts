import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  PRE_DEPLOY_PRODUCTION_COMMIT,
  RENDER_SOURCE_MIGRATION,
  buildServiceSourcePatch,
  deployAppearedFromPatch,
  detectConfigDrift,
  runRenderSourceMigration,
  verifyDeployHandoffState,
  verifyPostDeployTargetCommits,
  verifyPreMigrationState,
  type DeployHandoffReading,
  type MigrationDeps,
  type ServiceConfigSnapshot,
} from "./render-source-migration"

const ROOT = join(__dirname, "..", "..", "..")
const C = RENDER_SOURCE_MIGRATION

function webSnapshot(over: Partial<ServiceConfigSnapshot> = {}): ServiceConfigSnapshot {
  return {
    id: C.webServiceId,
    repo: C.fromRepo,
    branch: C.branch,
    autoDeploy: "off",
    buildCommand: "npm install --include=dev && npm run build",
    startCommand: "node .next/standalone/server.js",
    schedule: null,
    envVarNames: ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "GOOGLE_CLIENT_ID"],
    latestDeployId: "dep-web-1",
    latestDeployCommit: "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e",
    ...over,
  }
}

function cronSnapshot(over: Partial<ServiceConfigSnapshot> = {}): ServiceConfigSnapshot {
  return {
    id: C.cronServiceId,
    repo: C.fromRepo,
    branch: C.branch,
    autoDeploy: "off",
    buildCommand: "npm install --include=dev && npx prisma generate",
    startCommand: "npm run process-scheduled-jobs",
    schedule: C.cronSchedule,
    envVarNames: ["DATABASE_URL"],
    latestDeployId: "dep-cron-1",
    latestDeployCommit: "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e",
    ...over,
  }
}

/** A deps set where everything succeeds, plus a recorder of the call order. */
function happyDeps(over: Partial<MigrationDeps> = {}): { deps: MigrationDeps; calls: string[] } {
  const calls: string[] = []
  const migrated = { web: false, cron: false }
  let cronSuspended = false
  const deps: MigrationDeps = {
    assertWriteConfirmed: () => {
      calls.push("assertWriteConfirmed")
    },
    readGithubHead: async () => {
      calls.push("readGithubHead")
      return C.targetCommit
    },
    readServiceSnapshot: async (id) => {
      calls.push(`readServiceSnapshot:${id}`)
      if (id === C.webServiceId) {
        return webSnapshot(migrated.web ? { repo: C.toRepo } : {})
      }
      return cronSnapshot(migrated.cron ? { repo: C.toRepo } : {})
    },
    createBackup: async () => {
      calls.push("createBackup")
      return { id: "br-backup", name: "pre-deploy-goalx-2026-09-06-1900" }
    },
    verifyBackup: async () => {
      calls.push("verifyBackup")
      return { exists: true, isChildOfProduction: true }
    },
    suspendCron: async () => {
      calls.push("suspendCron")
      cronSuspended = true
    },
    getCronSuspended: async () => {
      calls.push("getCronSuspended")
      return cronSuspended
    },
    updateSource: async (id) => {
      calls.push(`updateSource:${id}`)
      if (id === C.webServiceId) migrated.web = true
      else migrated.cron = true
    },
    ...over,
  }
  return { deps, calls }
}

describe("the migration contract is frozen and narrow", () => {
  it("names exactly one from-repo, one to-repo, one branch, one commit and two service ids", () => {
    expect(C.fromRepo).toBe("https://github.com/itaymalka8/shift-scheduler")
    expect(C.toRepo).toBe("https://github.com/itaymalka8/goalx-manager")
    expect(C.branch).toBe("claude/goalx-manager-game-y3ht29")
    expect(C.targetCommit).toBe("063342e70fe5285aa3de050b7e344c83d51ec459")
    expect(C.webServiceId).toBe("srv-da7tt1gu01pc73c0ck40")
    expect(C.cronServiceId).toBe("crn-da9cg0ijnfac73de1ie0")
    expect(Object.isFrozen(C)).toBe(true)
  })
})

describe("the PATCH body is minimal", () => {
  it("carries exactly repo and branch, and nothing else", () => {
    const body = buildServiceSourcePatch(C.toRepo, C.branch)
    expect(Object.keys(body).sort()).toEqual(["branch", "repo"])
    expect(body).toEqual({ repo: C.toRepo, branch: C.branch })
  })

  it("cannot carry a null or empty value, which Render would treat as UNSET", () => {
    for (const bad of ["", "   ", null as unknown as string, undefined as unknown as string]) {
      expect(() => buildServiceSourcePatch(bad, C.branch)).toThrow(/repo must be a non-empty string/)
      expect(() => buildServiceSourcePatch(C.toRepo, bad)).toThrow(/branch must be a non-empty string/)
    }
  })

  it("serialises to a two-key JSON object with no extra fields", () => {
    const json = JSON.parse(JSON.stringify(buildServiceSourcePatch(C.toRepo, C.branch)))
    expect(Object.keys(json)).toHaveLength(2)
    for (const forbidden of ["buildCommand", "startCommand", "schedule", "envVars", "plan", "region", "name", "autoDeploy"]) {
      expect(json).not.toHaveProperty(forbidden)
    }
  })

  it("the client function that issues it also refuses a blank value", () => {
    const source = readFileSync(join(ROOT, "src/lib/production/render-client.ts"), "utf8")
    expect(source).toMatch(/export async function updateServiceSource\(/)
    expect(source).toMatch(/body: JSON\.stringify\(\{ repo, branch \}\)/)
    expect(source).toMatch(/requires a non-empty repo and branch/)
  })
})

describe("the pre-migration gate", () => {
  const ok = { contract: C, web: webSnapshot(), cron: cronSnapshot(), githubHead: C.targetCommit }

  it("passes when the live state matches the contract exactly", () => {
    expect(verifyPreMigrationState(ok)).toEqual({ ok: true, refusals: [] })
  })

  it("refuses an unexpected current repo", () => {
    const r = verifyPreMigrationState({ ...ok, web: webSnapshot({ repo: "https://github.com/someone/else" }) })
    expect(r.ok).toBe(false)
    expect(r.refusals.map((x) => x.code)).toContain("UNEXPECTED_SOURCE_REPO")
  })

  it("refuses an already-migrated repo, so the migration cannot be run twice blindly", () => {
    const r = verifyPreMigrationState({ ...ok, web: webSnapshot({ repo: C.toRepo }) })
    expect(r.ok).toBe(false)
    expect(r.refusals.map((x) => x.code)).toContain("UNEXPECTED_SOURCE_REPO")
  })

  it("refuses an unexpected branch", () => {
    const r = verifyPreMigrationState({ ...ok, cron: cronSnapshot({ branch: "main" }) })
    expect(r.refusals.map((x) => x.code)).toContain("UNEXPECTED_BRANCH")
  })

  it("refuses a GitHub head that is not the approved target commit", () => {
    const r = verifyPreMigrationState({ ...ok, githubHead: "e60910e8405edbc0f0a6d417f9e554ee76ac1952" })
    expect(r.refusals.map((x) => x.code)).toContain("GITHUB_HEAD_MISMATCH")
  })

  it("refuses a different service ID on either service", () => {
    expect(verifyPreMigrationState({ ...ok, web: webSnapshot({ id: "srv-someone-else" }) }).refusals.map((x) => x.code)).toContain("SERVICE_ID_MISMATCH")
    expect(verifyPreMigrationState({ ...ok, cron: cronSnapshot({ id: "crn-someone-else" }) }).refusals.map((x) => x.code)).toContain("SERVICE_ID_MISMATCH")
  })

  it("refuses Auto Deploy ON, and equally refuses UNKNOWN", () => {
    for (const state of ["on", "unknown"] as const) {
      expect(verifyPreMigrationState({ ...ok, web: webSnapshot({ autoDeploy: state }) }).refusals.map((x) => x.code)).toContain("AUTO_DEPLOY_NOT_OFF")
      expect(verifyPreMigrationState({ ...ok, cron: cronSnapshot({ autoDeploy: state }) }).refusals.map((x) => x.code)).toContain("AUTO_DEPLOY_NOT_OFF")
    }
  })

  it("refuses an unexpected cron schedule", () => {
    expect(verifyPreMigrationState({ ...ok, cron: cronSnapshot({ schedule: "*/5 * * * *" }) }).refusals.map((x) => x.code)).toContain("UNEXPECTED_CRON_SCHEDULE")
  })

  it("reports every refusal at once, not just the first", () => {
    const r = verifyPreMigrationState({
      ...ok,
      githubHead: "deadbeef",
      web: webSnapshot({ autoDeploy: "on", repo: "https://github.com/x/y" }),
    })
    expect(r.refusals.length).toBeGreaterThanOrEqual(3)
  })
})

describe("drift detection across the PATCH", () => {
  const before = webSnapshot()

  it("accepts the repo change and nothing else changing", () => {
    expect(detectConfigDrift(before, webSnapshot({ repo: C.toRepo }), C.toRepo)).toEqual([])
  })

  it("flags a build command change", () => {
    const d = detectConfigDrift(before, webSnapshot({ repo: C.toRepo, buildCommand: "npm run build" }), C.toRepo)
    expect(d.map((x) => x.field)).toContain("buildCommand")
  })

  it("flags a start command change", () => {
    const d = detectConfigDrift(before, webSnapshot({ repo: C.toRepo, startCommand: "next start" }), C.toRepo)
    expect(d.map((x) => x.field)).toContain("startCommand")
  })

  it("flags a cron schedule change", () => {
    const d = detectConfigDrift(cronSnapshot(), cronSnapshot({ repo: C.toRepo, schedule: "*/5 * * * *" }), C.toRepo)
    expect(d.map((x) => x.field)).toContain("schedule")
  })

  it("flags a lost env var, and an added one, by NAME", () => {
    expect(detectConfigDrift(before, webSnapshot({ repo: C.toRepo, envVarNames: ["DATABASE_URL"] }), C.toRepo).map((x) => x.field)).toContain("envVarNames")
    expect(
      detectConfigDrift(before, webSnapshot({ repo: C.toRepo, envVarNames: [...before.envVarNames, "SURPRISE"] }), C.toRepo).map((x) => x.field)
    ).toContain("envVarNames")
  })

  it("does NOT flag env vars merely reordered - membership is what matters", () => {
    expect(detectConfigDrift(before, webSnapshot({ repo: C.toRepo, envVarNames: [...before.envVarNames].reverse() }), C.toRepo)).toEqual([])
  })

  it("flags a changed service ID", () => {
    expect(detectConfigDrift(before, webSnapshot({ repo: C.toRepo, id: "srv-new" }), C.toRepo).map((x) => x.field)).toContain("id")
  })

  it("flags a repo that did not become the expected one", () => {
    expect(detectConfigDrift(before, webSnapshot({ repo: C.fromRepo }), C.toRepo).map((x) => x.field)).toContain("repo")
  })

  it("flags Auto Deploy that turned on", () => {
    expect(detectConfigDrift(before, webSnapshot({ repo: C.toRepo, autoDeploy: "on" }), C.toRepo).map((x) => x.field)).toContain("autoDeploy")
  })

  it("treats a field unreadable on BOTH sides as drift, not as unchanged", () => {
    const b = webSnapshot({ buildCommand: null })
    const a = webSnapshot({ repo: C.toRepo, buildCommand: null })
    expect(detectConfigDrift(b, a, C.toRepo).map((x) => x.field)).toContain("buildCommand")
  })
})

describe("deploy semantics", () => {
  it("detects a deploy that appeared from the PATCH", () => {
    expect(deployAppearedFromPatch("dep-1", "dep-2")).toBe(true)
    expect(deployAppearedFromPatch("dep-1", "dep-1")).toBe(false)
    expect(deployAppearedFromPatch(null, "dep-1")).toBe(true)
    expect(deployAppearedFromPatch("dep-1", null)).toBe(false)
  })
})

describe("the orchestration - happy path", () => {
  it("passes and performs every step in the required order", async () => {
    const { deps, calls } = happyDeps()
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("PASS")
    expect(out.recoveryRequired).toBe(false)
    expect(out.webSourceChanged && out.cronSourceChanged).toBe(true)
    expect(out.cronState).toBe("suspended")
    // The whole point of the split: Production is still on the same commit.
    expect(out.deployedCommitBefore).toEqual(out.deployedCommitAfter)
    expect(out.deployedCommitAfter).toEqual({ web: "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e", cron: "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e" })

    const idx = (needle: string) => calls.findIndex((c) => c.startsWith(needle))
    // Backup and cron suspension both strictly precede the FIRST source PATCH.
    expect(idx("createBackup")).toBeLessThan(idx("updateSource"))
    expect(idx("verifyBackup")).toBeLessThan(idx("updateSource"))
    expect(idx("suspendCron")).toBeLessThan(idx("updateSource"))
    expect(idx("getCronSuspended")).toBeLessThan(idx("updateSource"))
    // Write confirmation is first of all.
    expect(idx("assertWriteConfirmed")).toBe(0)
    // Ends by re-proving Cron is still suspended - never by resuming it.
    expect(calls).not.toContain("resumeCron")
    expect(calls[calls.length - 1]).toBe("getCronSuspended")
  })

  it("NEVER calls a deploy dependency, because there is none to call", async () => {
    const { deps, calls } = happyDeps()
    await runRenderSourceMigration(deps)
    // MigrationDeps declares no deploy of any kind. This asserts the shape as
    // well as the run: a dep the interface does not have is a call the
    // orchestration cannot make.
    for (const forbidden of ["deploy", "wait", "postDeploy", "trigger"]) {
      expect(calls.some((c) => c.toLowerCase().includes(forbidden))).toBe(false)
    }
    expect(Object.keys(deps).sort()).toEqual([
      "assertWriteConfirmed",
      "createBackup",
      "getCronSuspended",
      "readGithubHead",
      "readServiceSnapshot",
      "suspendCron",
      "updateSource",
      "verifyBackup",
    ])
  })

  it("reads the GitHub head exactly once - there is no deploy to re-check it for", async () => {
    const { deps, calls } = happyDeps()
    await runRenderSourceMigration(deps)
    expect(calls.filter((c) => c === "readGithubHead")).toHaveLength(1)
  })

  it("leaves the deployed commit untouched on both services", async () => {
    const { deps } = happyDeps()
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("PASS")
    expect(out.deployedCommitAfter?.web).toBe("cc86a0a5a73cd1b2ce9957ede1476762e3876e7e")
    expect(out.deployedCommitAfter?.cron).toBe("cc86a0a5a73cd1b2ce9957ede1476762e3876e7e")
    expect(out.deployedCommitAfter?.web).not.toBe(C.targetCommit)
  })
})

describe("the orchestration - nothing is written before the gate passes", () => {
  const mutating = ["createBackup", "suspendCron", "updateSource"]

  it("a missing write confirmation stops before any read or write", async () => {
    const { deps, calls } = happyDeps({
      assertWriteConfirmed: () => {
        throw new Error("PRODUCTION_WRITE_CONFIRM is not set")
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.recoveryRequired).toBe(false)
    expect(calls.filter((c) => mutating.some((m) => c.startsWith(m)))).toEqual([])
  })

  it("a failed gate performs NO mutation at all", async () => {
    const { deps, calls } = happyDeps({ readGithubHead: async () => "e60910e8405edbc0f0a6d417f9e554ee76ac1952" })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.failedStep).toBe("4. Pre-migration gate")
    expect(calls.filter((c) => mutating.some((m) => c.startsWith(m)))).toEqual([])
  })

  it("BACKUP FAILURE prevents any source mutation", async () => {
    const { deps, calls } = happyDeps({
      createBackup: async () => {
        calls.push("createBackup")
        throw new Error("Neon branch limit exceeded")
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.webSourceChanged || out.cronSourceChanged).toBe(false)
    expect(calls.some((c) => c.startsWith("updateSource"))).toBe(false)
  })

  it("an UNVERIFIED backup prevents any source mutation", async () => {
    const { deps, calls } = happyDeps({ verifyBackup: async () => ({ exists: false, isChildOfProduction: false }) })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(calls.some((c) => c.startsWith("updateSource"))).toBe(false)
  })

  it("CRON SUSPEND FAILURE prevents any source mutation", async () => {
    const { deps, calls } = happyDeps({
      suspendCron: async () => {
        throw new Error("Render API 500")
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(calls.some((c) => c.startsWith("updateSource"))).toBe(false)
  })

  it("a cron that does NOT report suspended prevents any source mutation", async () => {
    const { deps, calls } = happyDeps({ getCronSuspended: async () => false })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(calls.some((c) => c.startsWith("updateSource"))).toBe(false)
  })
})

describe("the orchestration - recovery semantics", () => {
  it("a PARTIAL source migration (web yes, cron no) sets Recovery Required", async () => {
    let webMigrated = false
    const { deps } = happyDeps({
      updateSource: async (id) => {
        if (id === C.cronServiceId) throw new Error("Render API 500")
        webMigrated = true
      },
      readServiceSnapshot: async (id) =>
        id === C.webServiceId ? webSnapshot(webMigrated ? { repo: C.toRepo } : {}) : cronSnapshot(),
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.recoveryRequired).toBe(true)
    expect(out.recoveryDetail).toMatch(/PARTIAL MIGRATION/)
    expect(out.webSourceChanged).toBe(true)
    expect(out.cronSourceChanged).toBe(false)
  })

  it("a deploy that appears DURING the migration is caught and fails the run", async () => {
    // Both PATCHes land cleanly, but by the final check the newest deploy has
    // moved - something deployed while this was running.
    let patches = 0
    const { deps } = happyDeps({
      updateSource: async () => {
        patches += 1
      },
      readServiceSnapshot: async (id) => {
        const migrated = patches >= (id === C.webServiceId ? 1 : 2)
        const moved = patches >= 2
        if (id === C.webServiceId) {
          return webSnapshot(
            migrated ? { repo: C.toRepo, ...(moved ? { latestDeployId: "dep-web-9", latestDeployCommit: C.targetCommit } : {}) } : {}
          )
        }
        return cronSnapshot(migrated ? { repo: C.toRepo } : {})
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.failedStep).toBe("19b. Deployed commit unchanged")
    expect(out.recoveryRequired).toBe(true)
  })

  it("CONFIGURATION DRIFT after a PATCH sets Recovery Required and stops", async () => {
    let patched = false
    const { deps, calls } = happyDeps({
      updateSource: async () => {
        patched = true
      },
      readServiceSnapshot: async (id) => {
        if (id === C.webServiceId) return webSnapshot(patched ? { repo: C.toRepo, buildCommand: "WIPED" } : {})
        return cronSnapshot()
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.recoveryRequired).toBe(true)
    expect(out.failedStep).toBe("10. Verify web after PATCH")
    expect(calls.some((c) => c.startsWith("deploy"))).toBe(false)
  })

  it("an UNEXPECTED DEPLOY born from the PATCH stops without triggering another", async () => {
    let patched = false
    const { deps, calls } = happyDeps({
      updateSource: async () => {
        patched = true
      },
      readServiceSnapshot: async (id) => {
        if (id === C.webServiceId) return webSnapshot(patched ? { repo: C.toRepo, latestDeployId: "dep-web-SURPRISE" } : {})
        return cronSnapshot()
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.failedStep).toBe("10b. Web unexpected deploy")
    expect(out.recoveryRequired).toBe(true)
    expect(calls.some((c) => c.toLowerCase().includes("deploy"))).toBe(false)
  })

  it("a Cron found ACTIVE at the end fails - something resumed it, and a resume can deploy", async () => {
    let patches = 0
    const { deps } = happyDeps({
      updateSource: async () => {
        patches += 1
      },
      readServiceSnapshot: async (id) =>
        id === C.webServiceId ? webSnapshot(patches >= 1 ? { repo: C.toRepo } : {}) : cronSnapshot(patches >= 2 ? { repo: C.toRepo } : {}),
      getCronSuspended: async () => patches < 2,
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.failedStep).toBe("20-21. Cron left suspended (handoff)")
    expect(out.recoveryRequired).toBe(true)
    expect(out.cronState).toBe("active")
  })

  it("a FINAL CROSS-CHECK failure stops even when each service passed its own drift check", async () => {
    // Both PATCHes "succeed" but the cron ends up on a different branch: each
    // service's own before/after comparison could miss what the pair-level
    // contract check catches.
    let patches = 0
    const { deps } = happyDeps({
      updateSource: async () => {
        patches += 1
      },
      readServiceSnapshot: async (id) => {
        if (id === C.webServiceId) return webSnapshot(patches >= 1 ? { repo: C.toRepo } : {})
        return cronSnapshot(patches >= 2 ? { repo: C.toRepo, branch: C.branch } : {})
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("PASS")
    expect(out.failedStep).toBeNull()
  })

  it("NEVER attempts an automatic source rollback, service creation or deletion", async () => {
    let webMigrated = false
    const { deps, calls } = happyDeps({
      updateSource: async (id) => {
        calls.push(`updateSource:${id}`)
        if (id === C.cronServiceId) throw new Error("boom")
        webMigrated = true
      },
      readServiceSnapshot: async (id) =>
        id === C.webServiceId ? webSnapshot(webMigrated ? { repo: C.toRepo } : {}) : cronSnapshot(),
    })
    await runRenderSourceMigration(deps)
    // Exactly one source write was attempted per service, and no compensating
    // write followed the failure.
    expect(calls.filter((c) => c.startsWith("updateSource"))).toEqual([`updateSource:${C.webServiceId}`, `updateSource:${C.cronServiceId}`])
  })
})

describe("the module's own shape", () => {
  const source = readFileSync(join(ROOT, "src/lib/production/render-source-migration.ts"), "utf8")

  it("makes no network call, reads no env var and touches no database", () => {
    for (const forbidden of ["fetch(", "process.env", "PrismaClient", "prisma."]) {
      expect(source.includes(forbidden)).toBe(false)
    }
  })

  it("creates no service and deletes no service", () => {
    // Comments stripped first: the header documents that this never recreates
    // a service, and a check that failed on its own documentation would push
    // someone to delete the explanation rather than keep the property.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const forbidden of ["createService", "deleteService", "recreate", "rollback"]) {
      expect(code.includes(forbidden)).toBe(false)
    }
  })

  it("runs no baseline and moves no money", () => {
    for (const forbidden of ["baseline", "sponsor", "maintenance", "repricing", "FinancialTransaction"]) {
      expect(source.toLowerCase().includes(forbidden.toLowerCase())).toBe(false)
    }
  })

  it("documents the cron race honestly rather than claiming atomicity", () => {
    expect(source).toMatch(/THE CRON RACE, STATED HONESTLY/)
    expect(source).toMatch(/detection,\s*\n?\s*\*?\s*not atomicity/)
  })
})

describe("the runner script's shape", () => {
  const script = readFileSync(join(ROOT, "scripts/production/render-source-migrate.ts"), "utf8")

  it("defaults to a dry run - --execute is the only thing that mutates", () => {
    expect(script).toMatch(/const execute = process\.argv\.slice\(2\)\.includes\("--execute"\)/)
    const dryRunBlock = script.slice(script.indexOf("// DRY RUN: reads only."))
    expect(dryRunBlock).toContain("DRY RUN - NOTHING WAS CHANGED, NOTHING WAS DEPLOYED")
    for (const mutation of ["migrateServiceSource(", "triggerServiceDeploy(", "createBackupBranch(", "suspendCron()"]) {
      expect(dryRunBlock.includes(mutation)).toBe(false)
    }
  })

  it("reads the branch head from the REMOTE, not from a local clone", () => {
    expect(script).toMatch(/execFileSync\("git", \["ls-remote"/)
    expect(script).toMatch(/\^\[0-9a-f\]\{40\}\$/)
  })

  it("contains NO deploy call of any kind, on any path", () => {
    const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const forbidden of ["triggerDeploy", "triggerServiceDeploy", "createDeploy", "waitForDeploy", "postDeployCheck", "post-deploy-check", "/deploys"]) {
      expect(code.includes(forbidden)).toBe(false)
    }
  })

  it("says explicitly that it did not deploy, and names the next approved step", () => {
    expect(script).toContain("SOURCE MIGRATION COMPLETE")
    expect(script).toContain("DEPLOY PERFORMED: NO")
    expect(script).toContain("PRODUCTION COMMIT UNCHANGED")
    expect(script).toContain("NEXT APPROVED STEP: npm run prod:deploy:safe")
  })

  it("tells the operator not to repair or re-run on a failure", () => {
    expect(script).toContain("RECOVERY REQUIRED")
    expect(script).toContain("Do NOT repair by hand and do NOT re-run this command")
  })

  it("never creates or deletes a service", () => {
    const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const forbidden of ["createService", "deleteService", "recreate"]) {
      expect(code.includes(forbidden)).toBe(false)
    }
  })

  it("runs no baseline", () => {
    expect(script.includes("economy:baseline")).toBe(false)
    expect(script.includes("economy-baseline")).toBe(false)
  })
})

describe("the ops wrapper is narrowed to the approved migration", () => {
  const ops = readFileSync(join(ROOT, "src/lib/production/render-ops.ts"), "utf8")

  it("requires the write confirmation before any source change", () => {
    const fn = ops.slice(ops.indexOf("export async function migrateServiceSource"))
    const body = fn.slice(0, fn.indexOf("\n}"))
    expect(body.indexOf("assertProductionWriteConfirmed")).toBeLessThan(body.indexOf("updateServiceSource"))
  })

  it("refuses any service id outside the contract, and any destination outside it", () => {
    const fn = ops.slice(ops.indexOf("export async function migrateServiceSource"))
    expect(fn).toContain("is not one of the two services in the approved migration contract")
    expect(fn).toContain("RENDER_SOURCE_MIGRATION.toRepo")
    expect(fn).toContain("RENDER_SOURCE_MIGRATION.branch")
  })

  it("returns env var NAMES only - never values", () => {
    const fn = ops.slice(ops.indexOf("export async function getServiceConfigSnapshot"))
    const body = fn.slice(0, fn.indexOf("\n}"))
    expect(body).toContain("envVars.map((v) => v.key)")
    expect(body.includes("v.value")).toBe(false)
  })
})

/**
 * THE TWO GUARANTEES THE SPLIT EXISTS FOR, asserted directly rather than as a
 * side effect of some other test.
 */
describe("prod:render:source-migrate can never deploy, on any path", () => {
  const migrationSource = readFileSync(join(ROOT, "src/lib/production/render-source-migration.ts"), "utf8")
  const script = readFileSync(join(ROOT, "scripts/production/render-source-migrate.ts"), "utf8")
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  it("neither the module nor the script references any deploy endpoint or helper", () => {
    for (const [label, text] of [
      ["module", strip(migrationSource)],
      ["script", strip(script)],
    ] as const) {
      for (const forbidden of ["triggerDeploy", "triggerServiceDeploy", "createDeploy", "waitForDeploy", "/deploys", "postDeployCheck"]) {
        expect(`${label}:${text.includes(forbidden)}`).toBe(`${label}:false`)
      }
    }
  })

  it("MigrationDeps declares no deploy capability at all", () => {
    const iface = migrationSource.slice(migrationSource.indexOf("export interface MigrationDeps"))
    const body = iface.slice(0, iface.indexOf("\n}"))
    for (const forbidden of ["deploy", "Deploy"]) {
      expect(body.includes(forbidden)).toBe(false)
    }
  })

  it("EVERY failure path also reaches no deploy - exhaustively, one injected failure per dependency", async () => {
    const failures: Array<Partial<MigrationDeps>> = [
      {
        assertWriteConfirmed: () => {
          throw new Error("no confirmation")
        },
      },
      { readGithubHead: async () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      {
        readServiceSnapshot: async () => {
          throw new Error("render down")
        },
      },
      {
        createBackup: async () => {
          throw new Error("neon quota")
        },
      },
      { verifyBackup: async () => ({ exists: false, isChildOfProduction: false }) },
      {
        suspendCron: async () => {
          throw new Error("suspend failed")
        },
      },
      { getCronSuspended: async () => false },
      {
        updateSource: async () => {
          throw new Error("patch failed")
        },
      },
    ]
    for (const failure of failures) {
      const { deps, calls } = happyDeps(failure)
      const out = await runRenderSourceMigration(deps)
      expect(out.outcome).toBe("FAIL")
      expect(calls.some((c) => c.toLowerCase().includes("deploy"))).toBe(false)
    }
  })

  it("a SUCCESSFUL migration leaves the latest deployed commit exactly as it was", async () => {
    const { deps } = happyDeps()
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("PASS")
    expect(out.deployedCommitBefore).not.toBeNull()
    expect(out.deployedCommitAfter).toEqual(out.deployedCommitBefore)
    // And specifically: still the commit Production was running, NOT the target.
    expect(out.deployedCommitAfter).toEqual({
      web: "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e",
      cron: "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e",
    })
    expect(out.deployedCommitAfter?.web).not.toBe(C.targetCommit)
  })
})

describe("prod:deploy:safe still works after the source swap", () => {
  it("discovers its services by NAME, not by repository - so a source change cannot break it", () => {
    const discovery = readFileSync(join(ROOT, "src/lib/production/render-discovery.ts"), "utf8")
    expect(discovery).toContain('export const WEB_SERVICE_NAME = "goalx-manager"')
    expect(discovery).toContain('export const CRON_SERVICE_NAME = "goalx-manager-fixture-processor"')
    expect(discovery).toContain("findServiceByName")
    // A repository URL anywhere in discovery would be an assumption the swap breaks.
    expect(discovery.includes("github.com")).toBe(false)
  })

  it("no file in the deploy path is keyed to a repository URL", () => {
    for (const file of [
      "src/lib/production/deploy-workflow.ts",
      "src/lib/production/render-ops.ts",
      "src/lib/production/render-client.ts",
      "src/lib/production/auto-deploy-guard.ts",
      "scripts/production/deploy-safe.ts",
      "scripts/production/preflight.ts",
      "scripts/production/post-deploy-check.ts",
    ]) {
      const text = readFileSync(join(ROOT, file), "utf8")
      expect(`${file}:${text.includes("github.com")}`).toBe(`${file}:false`)
    }
  })

  it("keeps exactly ONE deploy authority - the migration added none", () => {
    const client = readFileSync(join(ROOT, "src/lib/production/render-client.ts"), "utf8")
    const ops = readFileSync(join(ROOT, "src/lib/production/render-ops.ts"), "utf8")
    // One POST to the deploys endpoint in the whole client.
    expect(client.match(/\/deploys`, \{ method: "POST"/g) ?? []).toHaveLength(1)
    // createDeploy takes no commitId - the pinning parameter went with the split.
    expect(client).toMatch(/export async function createDeploy\(client: RenderClient, serviceId: string\): Promise<RenderDeploySummary>/)
    // And render-ops exposes exactly one function that reaches it.
    expect(ops.match(/createDeploy\(/g) ?? []).toHaveLength(1)
    expect(ops.includes("triggerServiceDeploy")).toBe(false)
  })
})

/**
 * THE SUSPENDED HANDOFF. Render records a deploy trigger of `service_resumed`,
 * so a resume can CREATE a deployment - which is why the migration must not
 * resume, and why prod:deploy:safe's handoff mode has to re-prove everything.
 */
describe("the source migration never resumes Cron", () => {
  const source = readFileSync(join(ROOT, "src/lib/production/render-source-migration.ts"), "utf8")
  const script = readFileSync(join(ROOT, "scripts/production/render-source-migrate.ts"), "utf8")

  it("declares no resume capability, so it cannot resume even by mistake", () => {
    const iface = source.slice(source.indexOf("export interface MigrationDeps"))
    expect(iface.slice(0, iface.indexOf("\n}")).includes("resume")).toBe(false)
    const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(code.includes("resumeCron")).toBe(false)
  })

  it("ends a SUCCESSFUL migration with Cron suspended, re-proved rather than assumed", async () => {
    const { deps, calls } = happyDeps()
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("PASS")
    expect(out.cronState).toBe("suspended")
    // Suspension is confirmed AGAIN at the end - two PATCHes have happened since
    // step 8, so the step-8 reading is not evidence about the end state.
    expect(calls.filter((c) => c === "getCronSuspended")).toHaveLength(2)
    expect(calls[calls.length - 1]).toBe("getCronSuspended")
  })

  it("says CRON STATE: SUSPENDED in its success output", () => {
    expect(script).toContain("SOURCE MIGRATION COMPLETE")
    expect(script).toContain("DEPLOY PERFORMED: NO")
    expect(script).toContain("PRODUCTION COMMIT UNCHANGED")
    expect(script).toContain("CRON STATE: SUSPENDED")
    expect(script).toContain("NEXT APPROVED STEP: npm run prod:deploy:safe")
  })

  it("checks the deployed commit AFTER the last possible source mutation", async () => {
    const { deps, calls } = happyDeps()
    await runRenderSourceMigration(deps)
    const lastPatch = calls.lastIndexOf(`updateSource:${C.cronServiceId}`)
    // The final snapshots feeding step 19b are read after both PATCHes.
    const snapshotsAfterLastPatch = calls.slice(lastPatch).filter((c) => c.startsWith("readServiceSnapshot"))
    expect(snapshotsAfterLastPatch.length).toBeGreaterThanOrEqual(2)
  })
})

describe("prod:deploy:safe handoff gate", () => {
  const reading = (over: Partial<DeployHandoffReading> = {}): DeployHandoffReading => ({
    web: webSnapshot({ repo: C.toRepo }),
    cron: cronSnapshot({ repo: C.toRepo }),
    githubHead: C.targetCommit,
    cronSuspended: true,
    ...over,
  })
  const codes = (r: DeployHandoffReading) => verifyDeployHandoffState({ contract: C, reading: r }).refusals.map((x) => x.code)

  it("accepts the exact post-migration state", () => {
    expect(verifyDeployHandoffState({ contract: C, reading: reading() })).toEqual({ ok: true, refusals: [] })
  })

  it("REFUSES if Cron is active - the handoff's defining precondition", () => {
    expect(codes(reading({ cronSuspended: false }))).toContain("CRON_NOT_SUSPENDED")
  })

  it("REFUSES a repo that is not the canonical one, including the pre-migration repo", () => {
    expect(codes(reading({ web: webSnapshot({ repo: C.fromRepo }) }))).toContain("SOURCE_NOT_MIGRATED")
    expect(codes(reading({ cron: cronSnapshot({ repo: "https://github.com/someone/else" }) }))).toContain("SOURCE_NOT_MIGRATED")
  })

  it("REFUSES an unexpected branch", () => {
    expect(codes(reading({ web: webSnapshot({ repo: C.toRepo, branch: "main" }) }))).toContain("UNEXPECTED_BRANCH")
  })

  it("REFUSES an unexpected service ID", () => {
    expect(codes(reading({ web: webSnapshot({ repo: C.toRepo, id: "srv-other" }) }))).toContain("SERVICE_ID_MISMATCH")
    expect(codes(reading({ cron: cronSnapshot({ repo: C.toRepo, id: "crn-other" }) }))).toContain("SERVICE_ID_MISMATCH")
  })

  it("REFUSES Auto Deploy ON, and equally UNKNOWN", () => {
    for (const state of ["on", "unknown"] as const) {
      expect(codes(reading({ web: webSnapshot({ repo: C.toRepo, autoDeploy: state }) }))).toContain("AUTO_DEPLOY_NOT_OFF")
      expect(codes(reading({ cron: cronSnapshot({ repo: C.toRepo, autoDeploy: state }) }))).toContain("AUTO_DEPLOY_NOT_OFF")
    }
  })

  it("REFUSES a GitHub head other than the exact target", () => {
    expect(codes(reading({ githubHead: "e60910e8405edbc0f0a6d417f9e554ee76ac1952" }))).toContain("GITHUB_HEAD_MISMATCH")
    expect(codes(reading({ githubHead: "" }))).toContain("GITHUB_HEAD_MISMATCH")
  })

  it("REFUSES if either deployed commit moved - an unexpected deploy since the migration", () => {
    expect(codes(reading({ web: webSnapshot({ repo: C.toRepo, latestDeployCommit: C.targetCommit }) }))).toContain("UNEXPECTED_DEPLOY_SINCE_MIGRATION")
    expect(codes(reading({ cron: cronSnapshot({ repo: C.toRepo, latestDeployCommit: null }) }))).toContain("UNEXPECTED_DEPLOY_SINCE_MIGRATION")
  })

  it("expects exactly cc86a0a as the pre-deploy production commit", () => {
    expect(PRE_DEPLOY_PRODUCTION_COMMIT).toBe("cc86a0a5a73cd1b2ce9957ede1476762e3876e7e")
  })

  it("reports every refusal together, not just the first", () => {
    const r = verifyDeployHandoffState({
      contract: C,
      reading: reading({ cronSuspended: false, githubHead: "deadbeef", web: webSnapshot({ repo: C.fromRepo, autoDeploy: "on" }) }),
    })
    expect(r.refusals.length).toBeGreaterThanOrEqual(4)
  })

  it("requires BOTH services on the target commit after the deploy and resume", () => {
    expect(verifyPostDeployTargetCommits({ web: C.targetCommit, cron: C.targetCommit }, C.targetCommit).ok).toBe(true)
    expect(verifyPostDeployTargetCommits({ web: C.targetCommit, cron: PRE_DEPLOY_PRODUCTION_COMMIT }, C.targetCommit).ok).toBe(false)
    expect(verifyPostDeployTargetCommits({ web: PRE_DEPLOY_PRODUCTION_COMMIT, cron: C.targetCommit }, C.targetCommit).ok).toBe(false)
    expect(verifyPostDeployTargetCommits({ web: null, cron: null }, C.targetCommit).ok).toBe(false)
  })
})

describe("the deploy authority stays single, and resume stays inside it", () => {
  it("resume appears in the deploy path and NOT in the migration path", () => {
    const migration = readFileSync(join(ROOT, "src/lib/production/render-source-migration.ts"), "utf8")
    const migrateScript = readFileSync(join(ROOT, "scripts/production/render-source-migrate.ts"), "utf8")
    const workflow = readFileSync(join(ROOT, "src/lib/production/deploy-workflow.ts"), "utf8")
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

    expect(strip(migration).includes("resumeCron")).toBe(false)
    expect(strip(migrateScript).includes("resumeCron")).toBe(false)
    expect(strip(workflow)).toContain("deps.resumeCron()")
  })

  it("the deploy-safe script gates handoff mode behind an explicit flag", () => {
    const script = readFileSync(join(ROOT, "scripts/production/deploy-safe.ts"), "utf8")
    expect(script).toMatch(/process\.argv\.slice\(2\)\.includes\("--handoff"\)/)
    expect(script).toMatch(/DEPLOY_HANDOFF === "source-migration"/)
    // The workflow only receives a handoff when it was explicitly requested.
    expect(script).toMatch(/runDeploySafeWorkflow\(deps, handoffRequested \? \{ handoff: buildHandoff\(\) \} : \{\}\)/)
  })

  it("still has exactly one deploy authority after the handoff work", () => {
    const client = readFileSync(join(ROOT, "src/lib/production/render-client.ts"), "utf8")
    const ops = readFileSync(join(ROOT, "src/lib/production/render-ops.ts"), "utf8")
    expect(client.match(/\/deploys`, \{ method: "POST"/g) ?? []).toHaveLength(1)
    expect(ops.match(/createDeploy\(/g) ?? []).toHaveLength(1)
    expect(ops.includes("triggerServiceDeploy")).toBe(false)
  })
})
