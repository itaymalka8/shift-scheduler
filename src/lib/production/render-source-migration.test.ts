import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  RENDER_SOURCE_MIGRATION,
  buildServiceSourcePatch,
  deployAppearedFromPatch,
  deployMatchesTarget,
  detectConfigDrift,
  runRenderSourceMigration,
  verifyPreMigrationState,
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
    ...over,
  }
}

/** A deps set where everything succeeds, plus a recorder of the call order. */
function happyDeps(over: Partial<MigrationDeps> = {}): { deps: MigrationDeps; calls: string[] } {
  const calls: string[] = []
  const migrated = { web: false, cron: false }
  const deployed = { web: false, cron: false }
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
    },
    getCronSuspended: async () => {
      calls.push("getCronSuspended")
      return true
    },
    updateSource: async (id) => {
      calls.push(`updateSource:${id}`)
      if (id === C.webServiceId) migrated.web = true
      else migrated.cron = true
    },
    deployWebPinned: async (commitId) => {
      calls.push(`deployWebPinned:${commitId}`)
      deployed.web = true
      return { id: "dep-web-2", status: "build_in_progress", commitId }
    },
    deployCronUnpinned: async () => {
      calls.push("deployCronUnpinned")
      deployed.cron = true
      return { id: "dep-cron-2", status: "build_in_progress", commitId: C.targetCommit }
    },
    waitForDeploy: async (serviceId, deployId) => {
      calls.push(`waitForDeploy:${deployId}`)
      return { id: deployId, status: "live", commitId: C.targetCommit }
    },
    postDeployCheck: async () => {
      calls.push("postDeployCheck")
      return { pass: true, summary: "all checks passed" }
    },
    resumeCron: async () => {
      calls.push("resumeCron")
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

  it("requires an exact commit match, never a prefix", () => {
    expect(deployMatchesTarget({ id: "d", status: "live", commitId: C.targetCommit }, C.targetCommit)).toBe(true)
    expect(deployMatchesTarget({ id: "d", status: "live", commitId: C.targetCommit.slice(0, 7) }, C.targetCommit)).toBe(false)
    expect(deployMatchesTarget({ id: "d", status: "live", commitId: null }, C.targetCommit)).toBe(false)
  })
})

describe("the orchestration - happy path", () => {
  it("passes and performs every step in the required order", async () => {
    const { deps, calls } = happyDeps()
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("PASS")
    expect(out.recoveryRequired).toBe(false)
    expect(out.webSourceChanged && out.cronSourceChanged).toBe(true)
    expect(out.cronState).toBe("active")

    const idx = (needle: string) => calls.findIndex((c) => c.startsWith(needle))
    // Backup and cron suspension both strictly precede the FIRST source PATCH.
    expect(idx("createBackup")).toBeLessThan(idx("updateSource"))
    expect(idx("verifyBackup")).toBeLessThan(idx("updateSource"))
    expect(idx("suspendCron")).toBeLessThan(idx("updateSource"))
    expect(idx("getCronSuspended")).toBeLessThan(idx("updateSource"))
    // Write confirmation is first of all.
    expect(idx("assertWriteConfirmed")).toBe(0)
    // Deploys come after both PATCHes; resume is last.
    expect(idx("updateSource")).toBeLessThan(idx("deployWebPinned"))
    expect(calls[calls.length - 1]).toBe("resumeCron")
  })

  it("pins the WEB deploy to the exact target commit", async () => {
    const { deps, calls } = happyDeps()
    await runRenderSourceMigration(deps)
    expect(calls).toContain(`deployWebPinned:${C.targetCommit}`)
  })

  it("deploys the CRON without a commitId, because Render does not support one there", async () => {
    const { deps, calls } = happyDeps()
    await runRenderSourceMigration(deps)
    expect(calls).toContain("deployCronUnpinned")
    expect(calls.some((c) => c.startsWith("deployCronUnpinned:"))).toBe(false)
  })

  it("re-reads the GitHub head immediately before EACH deploy, not once at the start", async () => {
    const { deps, calls } = happyDeps()
    await runRenderSourceMigration(deps)
    expect(calls.filter((c) => c === "readGithubHead")).toHaveLength(3)
  })
})

describe("the orchestration - nothing is written before the gate passes", () => {
  const mutating = ["createBackup", "suspendCron", "updateSource", "deployWebPinned", "deployCronUnpinned", "resumeCron"]

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

  it("a PARTIAL deployment (web deployed, cron deploy failed) sets Recovery Required", async () => {
    const { deps } = happyDeps({
      deployCronUnpinned: async () => {
        throw new Error("Render API 500")
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.recoveryRequired).toBe(true)
    expect(out.recoveryDetail).toMatch(/PARTIAL DEPLOYMENT/)
    expect(out.webDeployId).not.toBeNull()
    expect(out.cronDeployId).toBeNull()
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
    expect(calls.some((c) => c.startsWith("deployWebPinned"))).toBe(false)
    expect(calls.some((c) => c.startsWith("deployCronUnpinned"))).toBe(false)
  })

  it("a CRON DEPLOY ON THE WRONG COMMIT stops - this is the branch-tip race, detected", async () => {
    const { deps } = happyDeps({
      deployCronUnpinned: async () => ({ id: "dep-cron-2", status: "build_in_progress", commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.failedStep).toBe("16b. Cron deploy commit")
    expect(out.recoveryRequired).toBe(true)
    expect(out.recoveryDetail).toMatch(/PARTIAL DEPLOYMENT/)
  })

  it("a branch head that MOVED between the gate and the deploy stops before deploying", async () => {
    let reads = 0
    const { deps, calls } = happyDeps({
      readGithubHead: async () => {
        reads += 1
        return reads === 1 ? C.targetCommit : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.failedStep).toBe("13. Head recheck (web)")
    expect(calls.some((c) => c.startsWith("deploy"))).toBe(false)
  })

  it("a FAILED POST-DEPLOY CHECK is never reported as success, and cron is left suspended", async () => {
    const { deps, calls } = happyDeps({ postDeployCheck: async () => ({ pass: false, summary: "migrations 22/23" }) })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.recoveryRequired).toBe(true)
    expect(calls).not.toContain("resumeCron")
  })

  it("a deploy that finishes on the wrong commit is a failure even if it went live", async () => {
    const { deps } = happyDeps({
      waitForDeploy: async (_serviceId, deployId) => ({ id: deployId, status: "live", commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    })
    const out = await runRenderSourceMigration(deps)
    expect(out.outcome).toBe("FAIL")
    expect(out.recoveryRequired).toBe(true)
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

  it("pins the web deploy and sends no commitId for the cron deploy", () => {
    expect(script).toMatch(/triggerServiceDeploy\(C\.webServiceId, commitId\)/)
    expect(script).toMatch(/triggerServiceDeploy\(C\.cronServiceId, undefined\)/)
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
