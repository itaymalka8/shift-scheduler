import { runDeploySafeWorkflow, type DeploySafeHandoff, type DeployWorkflowDeps } from "./deploy-workflow"

function makeDeps(overrides: Partial<DeployWorkflowDeps> = {}): DeployWorkflowDeps {
  return {
    // Default for every existing test: auto-deploy already disabled on both
    // services, so step 0 passes and the rest of the pipeline is what is
    // under test. Tests that care about the guard override this.
    getAutoDeployReading: jest.fn(async () => ({ web: "off" as const, cron: "off" as const })),
    runPreflight: jest.fn(async () => ({ pass: true, summary: "PRODUCTION PREFLIGHT: PASS" })),
    getWebStatus: jest.fn(async () => ({ id: "web-1", suspended: false })),
    getCronStatus: jest.fn(async () => ({ id: "cron-1", suspended: false })),
    createBackup: jest.fn(async () => ({ id: "backup-1", name: "pre-deploy-goalx-2026-09-02-1200" })),
    verifyBackup: jest.fn(async () => ({ exists: true, isChildOfProduction: true })),
    suspendCron: jest.fn(async () => undefined),
    triggerDeploy: jest.fn(async () => ({ id: "deploy-1" })),
    waitForDeploy: jest.fn(async () => ({ outcome: "success" as const, status: "live" })),
    isWebLive: jest.fn(async () => true),
    runPostDeployCheck: jest.fn(async () => ({ pass: true, summary: "PRODUCTION POST-DEPLOY CHECK: PASS" })),
    runScheduledDryCheck: jest.fn(async () => ({ summary: "0 fixtures due" })),
    resumeCron: jest.fn(async () => undefined),
    ...overrides,
  }
}

// Sequences getCronStatus so "F. Verify cron suspended" sees suspended=true
// and "M. Verify cron active" (after resume) sees suspended=false, matching
// what a real suspend-then-resume round trip would report.
function makeHappyPathDeps(overrides: Partial<DeployWorkflowDeps> = {}): DeployWorkflowDeps {
  const getCronStatus = jest
    .fn()
    .mockResolvedValueOnce({ id: "cron-1", suspended: false }) // B. initial status
    .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // F. after suspend
    .mockResolvedValueOnce({ id: "cron-1", suspended: false }) // M. after resume
  return makeDeps({ getCronStatus, ...overrides })
}

// Same B/F sequence as makeHappyPathDeps, but for a failure between G and L:
// the third read is the best-effort refresh a thrown-exception failure
// triggers for its report, not the post-resume check - cron is genuinely
// unaffected by those steps, so it still reads suspended=true here.
function makeSuspendedThenFailDeps(overrides: Partial<DeployWorkflowDeps> = {}): DeployWorkflowDeps {
  const getCronStatus = jest
    .fn()
    .mockResolvedValueOnce({ id: "cron-1", suspended: false }) // B. initial status
    .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // F. after suspend
    .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // best-effort refresh after a later throw
  return makeDeps({ getCronStatus, ...overrides })
}

describe("runDeploySafeWorkflow - success path", () => {
  it("runs every step in order and resumes cron only at the end", async () => {
    const deps = makeHappyPathDeps()
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("PASS")
    expect(result.failedStep).toBeNull()
    expect(result.cronState).toBe("active")
    expect(result.backupBranchId).toBe("backup-1")

    expect(deps.runPreflight).toHaveBeenCalledTimes(1)
    expect(deps.createBackup).toHaveBeenCalledTimes(1)
    expect(deps.verifyBackup).toHaveBeenCalledWith("backup-1")
    expect(deps.suspendCron).toHaveBeenCalledTimes(1)
    expect(deps.triggerDeploy).toHaveBeenCalledTimes(1)
    expect(deps.waitForDeploy).toHaveBeenCalledWith("deploy-1")
    expect(deps.runPostDeployCheck).toHaveBeenCalledTimes(1)
    expect(deps.runScheduledDryCheck).toHaveBeenCalledTimes(1)
    expect(deps.resumeCron).toHaveBeenCalledTimes(1)

    const stepNames = result.steps.map((s) => s.step)
    expect(stepNames).toEqual([
      "0. Auto-deploy guard",
      "A. Preflight",
      "B. Render status",
      "C. Create backup",
      "D. Verify backup",
      "E. Suspend cron",
      "F. Verify cron suspended",
      "G. Trigger deploy",
      "H. Wait for deploy",
      "I. Verify web live",
      "J. Post-deploy check",
      "K. Scheduled dry check",
      "L. Resume cron",
      "M. Verify cron active",
      "N. Poll next cron run",
    ])
    expect(result.steps.every((s) => s.ok)).toBe(true)
  })

  it("reports the Render-API limitation for step N rather than inventing polling", async () => {
    const result = await runDeploySafeWorkflow(makeHappyPathDeps())
    const stepN = result.steps.find((s) => s.step === "N. Poll next cron run")
    expect(stepN?.detail).toMatch(/LIMITATION/)
  })
})

describe("runDeploySafeWorkflow - stop on failure (structural, not thrown)", () => {
  it("stops at A when preflight fails, and touches nothing else", async () => {
    const deps = makeDeps({ runPreflight: jest.fn(async () => ({ pass: false, summary: "PRODUCTION PREFLIGHT: FAIL" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("A. Preflight")
    expect(deps.getWebStatus).not.toHaveBeenCalled()
    expect(deps.createBackup).not.toHaveBeenCalled()
    expect(deps.suspendCron).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
    expect(result.recommendedRecovery).toMatch(/not touched/)
  })

  it("stops at C when backup creation throws, and never suspends cron", async () => {
    const deps = makeDeps({
      createBackup: jest.fn(async () => {
        throw new Error("Neon API error: quota exceeded")
      }),
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("C. Create backup")
    expect(result.reason).toContain("quota exceeded")
    expect(deps.suspendCron).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("stops at D when the backup can't be verified, and never suspends cron", async () => {
    const deps = makeDeps({ verifyBackup: jest.fn(async () => ({ exists: false, isChildOfProduction: false })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("D. Verify backup")
    expect(deps.suspendCron).not.toHaveBeenCalled()
  })

  it("stops at F when cron does not report suspended, and never triggers a deploy", async () => {
    const deps = makeDeps({
      getCronStatus: jest.fn().mockResolvedValueOnce({ id: "cron-1", suspended: false }).mockResolvedValueOnce({ id: "cron-1", suspended: false }),
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("F. Verify cron suspended")
    expect(result.cronState).toBe("active")
    expect(deps.triggerDeploy).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("leaves cron suspended (never auto-resumes) when the deploy fails", async () => {
    const deps = makeSuspendedThenFailDeps({ waitForDeploy: jest.fn(async () => ({ outcome: "failure" as const, status: "build_failed" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("H. Wait for deploy")
    expect(result.cronState).toBe("suspended")
    expect(deps.resumeCron).not.toHaveBeenCalled()
    expect(deps.runPostDeployCheck).not.toHaveBeenCalled()
  })

  it("leaves cron suspended when the deploy times out", async () => {
    const deps = makeSuspendedThenFailDeps({ waitForDeploy: jest.fn(async () => ({ outcome: "timeout" as const, status: "build_in_progress" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.failedStep).toBe("H. Wait for deploy")
    expect(result.cronState).toBe("suspended")
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("leaves cron suspended when the web service does not respond as live", async () => {
    const deps = makeSuspendedThenFailDeps({ isWebLive: jest.fn(async () => false) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.failedStep).toBe("I. Verify web live")
    expect(result.cronState).toBe("suspended")
    expect(deps.runPostDeployCheck).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("leaves cron suspended when post-deploy-check fails, and never runs the scheduled dry check or resumes", async () => {
    const deps = makeSuspendedThenFailDeps({ runPostDeployCheck: jest.fn(async () => ({ pass: false, summary: "PRODUCTION POST-DEPLOY CHECK: FAIL" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.failedStep).toBe("J. Post-deploy check")
    expect(result.cronState).toBe("suspended")
    expect(deps.runScheduledDryCheck).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("stops at M when cron does not report active after resume, and reports it as an overall FAIL despite a healthy deploy", async () => {
    const getCronStatus = jest
      .fn()
      .mockResolvedValueOnce({ id: "cron-1", suspended: false })
      .mockResolvedValueOnce({ id: "cron-1", suspended: true })
      .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // still suspended after resume attempt
    const deps = makeDeps({ getCronStatus })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("M. Verify cron active")
    expect(result.cronState).toBe("suspended")
    expect(deps.resumeCron).toHaveBeenCalledTimes(1)
    expect(result.recommendedRecovery).toMatch(/did NOT return to full operational state|not confirmed active/)
  })
})

describe("runDeploySafeWorkflow - thrown exceptions from external calls never escape as unhandled rejections", () => {
  it("E. suspendCron throws -> structured FAIL, cron state re-checked (not assumed), deploy never triggered", async () => {
    const deps = makeDeps({
      suspendCron: jest.fn(async () => {
        throw new Error("Render API error: 503 Service Unavailable")
      }),
      // Best-effort re-check after the throw still can't confirm state.
      getCronStatus: jest
        .fn()
        .mockResolvedValueOnce({ id: "cron-1", suspended: false }) // B. initial
        .mockRejectedValueOnce(new Error("Render API error: 503 Service Unavailable")), // refresh attempt after E throws
    })

    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("E. Suspend cron")
    expect(result.cronState).toBe("unknown")
    expect(result.reason).toContain("503 Service Unavailable")
    expect(deps.triggerDeploy).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
    expect(result.recommendedRecovery).toMatch(/UNKNOWN/)
  })

  it("F. getCronStatus throws after suspend -> structured FAIL, cron reported UNKNOWN (never assumed suspended), deploy never triggered", async () => {
    const deps = makeDeps({
      getCronStatus: jest
        .fn()
        .mockResolvedValueOnce({ id: "cron-1", suspended: false }) // B. initial
        .mockRejectedValue(new Error("network timeout")), // F. verify, and any refresh attempt
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("F. Verify cron suspended")
    expect(result.cronState).toBe("unknown")
    expect(result.reason).toContain("network timeout")
    expect(deps.triggerDeploy).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("G. triggerDeploy throws -> structured FAIL, cron left suspended, deploy never waited on", async () => {
    const deps = makeSuspendedThenFailDeps({
      triggerDeploy: jest.fn(async () => {
        throw new Error("Render API error: 500 Internal Server Error")
      }),
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("G. Trigger deploy")
    expect(result.cronState).toBe("suspended")
    expect(deps.waitForDeploy).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("H. waitForDeploy throws -> structured FAIL, never assumes the deploy succeeded, cron left suspended", async () => {
    const deps = makeSuspendedThenFailDeps({
      waitForDeploy: jest.fn(async () => {
        throw new Error("Render API error: connection reset")
      }),
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("H. Wait for deploy")
    expect(result.cronState).toBe("suspended")
    expect(deps.isWebLive).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
    expect(result.reason).toMatch(/do not assume/i)
  })

  it("I. web health check throws -> structured FAIL, never assumes the web service is healthy, cron left suspended", async () => {
    const deps = makeSuspendedThenFailDeps({
      isWebLive: jest.fn(async () => {
        throw new Error("fetch failed: ECONNREFUSED")
      }),
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("I. Verify web live")
    expect(result.cronState).toBe("suspended")
    expect(deps.runPostDeployCheck).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("L. resumeCron throws -> overall FAIL even though the deploy succeeded and the app is live", async () => {
    const deps = makeSuspendedThenFailDeps({
      resumeCron: jest.fn(async () => {
        throw new Error("Render API error: 502 Bad Gateway")
      }),
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("L. Resume cron")
    expect(result.reason).toMatch(/deploy succeeded and the app is live/i)
    expect(result.reason).toMatch(/did not return to full operational state/i)
    expect(result.recommendedRecovery).toMatch(/did NOT return to full operational state/)
    // Every step through K (post-deploy check, scheduled dry check) genuinely ran.
    expect(deps.runPostDeployCheck).toHaveBeenCalledTimes(1)
    expect(deps.runScheduledDryCheck).toHaveBeenCalledTimes(1)
  })

  it("M. getCronStatus throws after resume -> overall FAIL, cron reported UNKNOWN not assumed active", async () => {
    const getCronStatus = jest
      .fn()
      .mockResolvedValueOnce({ id: "cron-1", suspended: false }) // B. initial
      .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // F. after suspend
      .mockRejectedValueOnce(new Error("network timeout")) // M. after resume
    const deps = makeDeps({ getCronStatus })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("M. Verify cron active")
    expect(result.cronState).toBe("unknown")
    expect(deps.resumeCron).toHaveBeenCalledTimes(1)
    expect(result.recommendedRecovery).toMatch(/UNKNOWN|not confirmed/)
  })
})

describe("runDeploySafeWorkflow - no destructive or secret-leaking behavior under any thrown-exception path", () => {
  const thrownScenarios: Array<[string, Partial<DeployWorkflowDeps>]> = [
    ["E", { suspendCron: jest.fn(async () => { throw new Error("boom: fake-secret-abc123") }) }],
    [
      "F",
      {
        getCronStatus: jest
          .fn()
          .mockResolvedValueOnce({ id: "cron-1", suspended: false })
          .mockRejectedValue(new Error("boom: fake-secret-abc123")),
      },
    ],
    ["G", { triggerDeploy: jest.fn(async () => { throw new Error("boom: fake-secret-abc123") }) }],
    ["H", { waitForDeploy: jest.fn(async () => { throw new Error("boom: fake-secret-abc123") }) }],
    ["I", { isWebLive: jest.fn(async () => { throw new Error("boom: fake-secret-abc123") }) }],
    ["L", { resumeCron: jest.fn(async () => { throw new Error("boom: fake-secret-abc123") }) }],
  ]

  it.each(thrownScenarios)("%s: fails structurally, and the report never contains a fabricated or credential-shaped value", async (_label, overrides) => {
    const deps = makeSuspendedThenFailDeps(overrides)
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    // No dep exposes a restore/delete operation at all - DeployWorkflowDeps
    // has no such method, so there is nothing destructive this code could
    // even call. This assertion documents that guarantee at the type level:
    expect(Object.keys(deps)).not.toEqual(expect.arrayContaining(["restoreDatabase", "deleteBranch", "deleteService"]))
    // The thrown message is reported verbatim (expected - it's the whole
    // point of a structured failure report), but this layer never receives
    // RENDER_API_KEY/NEON_API_KEY/PRODUCTION_DATABASE_URL or constructs an
    // Authorization header or a connection string, so nothing credential-
    // shaped can appear anywhere in the report even by accident.
    const allText = JSON.stringify(result)
    expect(allText).toContain("fake-secret-abc123") // the real error IS reported
    expect(allText).not.toMatch(/Bearer\s|postgres(ql)?:\/\/|RENDER_API_KEY=|NEON_API_KEY=|PRODUCTION_DATABASE_URL=/i)
  })

  it("a failure past suspend never calls resumeCron unless the full success path (through K) was reached", async () => {
    const deps = makeSuspendedThenFailDeps({
      triggerDeploy: jest.fn(async () => {
        throw new Error("boom")
      }),
    })
    await runDeploySafeWorkflow(deps)
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })
})


describe("step 0 - the auto-deploy guard, before any Production mutation", () => {
  // Every dep that can change Production. If the guard works, NONE of these
  // may be called - checked individually below rather than as a summary, so
  // a failure names the exact operation that leaked through.
  const MUTATING_DEPS = ["createBackup", "suspendCron", "triggerDeploy", "resumeCron"] as const

  function expectNoProductionMutation(deps: DeployWorkflowDeps) {
    for (const name of MUTATING_DEPS) {
      expect(deps[name]).not.toHaveBeenCalled()
    }
    // Preflight is read-only, but the guard is meant to run before even
    // that - a refusal should cost nothing at all.
    expect(deps.runPreflight).not.toHaveBeenCalled()
  }

  it("proceeds when auto-deploy is confirmed OFF on both services", async () => {
    const deps = makeHappyPathDeps()
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("PASS")
    expect(result.steps[0]).toEqual({ step: "0. Auto-deploy guard", ok: true, detail: "web=OFF cron=OFF" })
    expect(deps.getAutoDeployReading).toHaveBeenCalledTimes(1)
  })

  it("refuses when web auto-deploy is ON, before backup / cron suspend / deploy", async () => {
    const deps = makeDeps({ getAutoDeployReading: jest.fn(async () => ({ web: "on" as const, cron: "off" as const })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("0. Auto-deploy guard")
    expect(result.reason).toContain("ENABLED")
    expectNoProductionMutation(deps)
  })

  it("refuses when cron auto-deploy is ON", async () => {
    const deps = makeDeps({ getAutoDeployReading: jest.fn(async () => ({ web: "off" as const, cron: "on" as const })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("0. Auto-deploy guard")
    expectNoProductionMutation(deps)
  })

  it("refuses when auto-deploy is UNKNOWN - it is never assumed to be off", async () => {
    const deps = makeDeps({ getAutoDeployReading: jest.fn(async () => ({ web: "unknown" as const, cron: "off" as const })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("0. Auto-deploy guard")
    expect(result.reason).toContain("UNKNOWN")
    expectNoProductionMutation(deps)
  })

  it("fails closed when the Render API throws: an unreadable setting refuses exactly like an enabled one", async () => {
    const deps = makeDeps({
      getAutoDeployReading: jest.fn(async () => {
        throw new Error("Render API error on /services/srv-1: HTTP 503")
      }),
    })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("0. Auto-deploy guard")
    expect(result.reason).toContain("UNKNOWN")
    expect(result.steps[0].ok).toBe(false)
    expect(result.steps[0].detail).toContain("HTTP 503")
    expectNoProductionMutation(deps)
  })

  it("leaves cron untouched on a refusal and says so, rather than implying something needs unwinding", async () => {
    const deps = makeDeps({ getAutoDeployReading: jest.fn(async () => ({ web: "on" as const, cron: "on" as const })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.backupBranchId).toBeNull()
    expect(result.cronState).toBe("unknown")
    expect(result.recommendedRecovery).toContain("Cron was not touched by this run")
    expect(result.recommendedRecovery).toContain("Do not restore the database automatically")
  })

  it("never leaks a credential-shaped value into the refusal report", async () => {
    const deps = makeDeps({
      getAutoDeployReading: jest.fn(async () => {
        throw new Error("Render API request failed: network error")
      }),
    })
    const result = await runDeploySafeWorkflow(deps)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/rnd_[A-Za-z0-9]/)
    expect(serialized).not.toMatch(/Bearer\s+\S/)
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//)
  })
})

/**
 * HANDOFF MODE. Opt-in, and it exists for exactly one situation: the source
 * migration has just repointed both Render services and left Cron SUSPENDED on
 * purpose, because Render can turn a resume into a deployment (deploy trigger
 * `service_resumed`). Without the option nothing about this workflow changes.
 */
describe("prod:deploy:safe handoff mode", () => {
  const TARGET = "063342e70fe5285aa3de050b7e344c83d51ec459"

  function okHandoff(over: Partial<DeploySafeHandoff> = {}): DeploySafeHandoff {
    return {
      verify: jest.fn(async () => ({ ok: true, refusals: [] })),
      targetCommit: TARGET,
      verifyWebDeployCommit: jest.fn(async (deployId: string) => ({ ok: true, detail: `deploy ${deployId} commit=${TARGET}` })),
      verifyCanonicalHead: jest.fn(async () => ({ ok: true, detail: `canonical head=${TARGET}` })),
      verifyTargetCommits: jest.fn(async () => ({ ok: true, detail: `web=${TARGET} cron=${TARGET}` })),
      ...over,
    }
  }

  // Cron is ALREADY suspended when handoff mode starts, and stays suspended
  // until the resume at step L.
  function handoffCronStatus() {
    return jest
      .fn()
      .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // B. initial - already suspended
      .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // F. still suspended, no request sent
      .mockResolvedValueOnce({ id: "cron-1", suspended: false }) // M. after resume
  }

  it("passes and NEVER sends a redundant suspend request", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, { handoff: okHandoff() })
    expect(result.outcome).toBe("PASS")
    expect(deps.suspendCron).not.toHaveBeenCalled()
    expect(result.steps.find((s) => s.step === "E. Suspend cron")!.detail).toMatch(/no suspend request sent/)
    // Step F still PROVES the suspension - only the redundant write is skipped.
    expect(result.steps.find((s) => s.step === "F. Verify cron suspended")!.ok).toBe(true)
  })

  it("still creates AND verifies its own fresh Neon backup", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, { handoff: okHandoff() })
    expect(deps.createBackup).toHaveBeenCalledTimes(1)
    expect(deps.verifyBackup).toHaveBeenCalledTimes(1)
    expect(result.backupBranchId).toBe("backup-1")
  })

  it("refuses BEFORE any Production mutation when the gate says no", async () => {
    const deps = makeDeps()
    const result = await runDeploySafeWorkflow(deps, {
      handoff: okHandoff({ verify: jest.fn(async () => ({ ok: false, refusals: ["[CRON_NOT_SUSPENDED] cron is active"] })) }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("0h. Source-migration handoff")
    expect(result.reason).toMatch(/CRON_NOT_SUSPENDED/)
    // Nothing was touched: no preflight, no backup, no suspend, no deploy.
    expect(deps.runPreflight).not.toHaveBeenCalled()
    expect(deps.createBackup).not.toHaveBeenCalled()
    expect(deps.suspendCron).not.toHaveBeenCalled()
    expect(deps.triggerDeploy).not.toHaveBeenCalled()
  })

  it("refuses when the gate itself cannot be evaluated - fail closed", async () => {
    const deps = makeDeps()
    const result = await runDeploySafeWorkflow(deps, {
      handoff: okHandoff({
        verify: jest.fn(async () => {
          throw new Error("render unreachable")
        }),
      }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("0h. Source-migration handoff")
    expect(deps.createBackup).not.toHaveBeenCalled()
  })

  it("runs the gate AFTER the auto-deploy guard, so an Auto Deploy ON still refuses first", async () => {
    const handoff = okHandoff()
    const deps = makeDeps({ getAutoDeployReading: jest.fn(async () => ({ web: "on" as const, cron: "off" as const })) })
    const result = await runDeploySafeWorkflow(deps, { handoff })
    expect(result.failedStep).toBe("0. Auto-deploy guard")
    expect(handoff.verify).not.toHaveBeenCalled()
  })

  it("resumes Cron only through this workflow, and then proves BOTH services are on the target commit", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const handoff = okHandoff()
    const result = await runDeploySafeWorkflow(deps, { handoff })
    expect(result.outcome).toBe("PASS")
    expect(deps.resumeCron).toHaveBeenCalledTimes(1)
    expect(handoff.verifyTargetCommits).toHaveBeenCalledTimes(1)
    const m2 = result.steps.find((s) => s.step === "M2. Verify target commit on both services")!
    expect(m2.ok).toBe(true)
    // M2 comes after the resume, because the resume itself can deploy.
    const stepNames = result.steps.map((s) => s.step)
    expect(stepNames.indexOf("L. Resume cron")).toBeLessThan(stepNames.indexOf("M2. Verify target commit on both services"))
  })

  it("FAILS when the post-resume commit check does not match, and never redeploys", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, {
      handoff: okHandoff({ verifyTargetCommits: jest.fn(async () => ({ ok: false, detail: "web=063342e cron=cc86a0a expected=063342e" })) }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("M2. Verify target commit on both services")
    expect(deps.triggerDeploy).toHaveBeenCalledTimes(1)
  })
})

describe("prod:deploy:safe normal mode is unchanged by the handoff work", () => {
  it("still REQUESTS the suspend when no handoff is passed", async () => {
    const deps = makeHappyPathDeps()
    const result = await runDeploySafeWorkflow(deps)
    expect(result.outcome).toBe("PASS")
    expect(deps.suspendCron).toHaveBeenCalledTimes(1)
    expect(result.steps.find((s) => s.step === "E. Suspend cron")!.detail).toBe("suspend requested")
  })

  it("adds no handoff step at all - the step list is exactly what it was", async () => {
    const result = await runDeploySafeWorkflow(makeHappyPathDeps())
    expect(result.steps.map((s) => s.step)).toEqual([
      "0. Auto-deploy guard",
      "A. Preflight",
      "B. Render status",
      "C. Create backup",
      "D. Verify backup",
      "E. Suspend cron",
      "F. Verify cron suspended",
      "G. Trigger deploy",
      "H. Wait for deploy",
      "I. Verify web live",
      "J. Post-deploy check",
      "K. Scheduled dry check",
      "L. Resume cron",
      "M. Verify cron active",
      "N. Poll next cron run",
    ])
  })

  it("passing an empty options object behaves identically to passing nothing", async () => {
    const a = await runDeploySafeWorkflow(makeHappyPathDeps())
    const b = await runDeploySafeWorkflow(makeHappyPathDeps(), {})
    expect(b.steps.map((s) => s.step)).toEqual(a.steps.map((s) => s.step))
    expect(b.outcome).toBe(a.outcome)
  })
})

/**
 * THE THREE PRE-EXECUTE HARDENINGS.
 *
 * 1. The Web deploy is PINNED to the approved commit and verified afterwards.
 * 2. The canonical branch head is re-read immediately before Resume, because
 *    Resume is what can make Render deploy the Cron service off that branch.
 * 3. Neither is optional in handoff mode, and neither exists outside it.
 */
describe("handoff pins the Web deploy to the exact commit", () => {
  const TARGET = "063342e70fe5285aa3de050b7e344c83d51ec459"

  function handoffCronStatus() {
    return jest
      .fn()
      .mockResolvedValueOnce({ id: "cron-1", suspended: true })
      .mockResolvedValueOnce({ id: "cron-1", suspended: true })
      .mockResolvedValueOnce({ id: "cron-1", suspended: false })
  }

  function okHandoff2(over: Partial<DeploySafeHandoff> = {}): DeploySafeHandoff {
    return {
      verify: jest.fn(async () => ({ ok: true, refusals: [] })),
      targetCommit: TARGET,
      verifyWebDeployCommit: jest.fn(async () => ({ ok: true, detail: `commit=${TARGET}` })),
      verifyCanonicalHead: jest.fn(async () => ({ ok: true, detail: `head=${TARGET}` })),
      verifyTargetCommits: jest.fn(async () => ({ ok: true, detail: `web=${TARGET} cron=${TARGET}` })),
      ...over,
    }
  }

  it("passes the exact commitId to the single deploy authority", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, { handoff: okHandoff2() })
    expect(result.outcome).toBe("PASS")
    expect(deps.triggerDeploy).toHaveBeenCalledWith(TARGET)
    expect(deps.triggerDeploy).toHaveBeenCalledTimes(1)
  })

  it("NORMAL mode still calls it with no argument, so the body stays {}", async () => {
    const deps = makeHappyPathDeps()
    await runDeploySafeWorkflow(deps)
    expect(deps.triggerDeploy).toHaveBeenCalledWith()
    expect(deps.triggerDeploy).not.toHaveBeenCalledWith(TARGET)
  })

  it("verifies the created deploy's commit BEFORE post-deploy checks and BEFORE resume", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const handoff = okHandoff2()
    const result = await runDeploySafeWorkflow(deps, { handoff })
    const names = result.steps.map((s) => s.step)
    expect(names).toContain("H2. Verify web deploy commit")
    expect(names.indexOf("H2. Verify web deploy commit")).toBeLessThan(names.indexOf("J. Post-deploy check"))
    expect(names.indexOf("H2. Verify web deploy commit")).toBeLessThan(names.indexOf("L. Resume cron"))
    expect(handoff.verifyWebDeployCommit).toHaveBeenCalledWith("deploy-1")
  })

  it("a WRONG web deploy commit stops, leaves Cron suspended, and never redeploys", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, {
      handoff: okHandoff2({ verifyWebDeployCommit: jest.fn(async () => ({ ok: false, detail: "commit=cc86a0a expected=063342e" })) }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("H2. Verify web deploy commit")
    expect(deps.triggerDeploy).toHaveBeenCalledTimes(1)
    expect(deps.resumeCron).not.toHaveBeenCalled()
    expect(deps.runPostDeployCheck).not.toHaveBeenCalled()
    expect(result.recommendedRecovery).toMatch(/left SUSPENDED/i)
  })

  it("an unreadable deploy commit also stops, and does not resume", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, {
      handoff: okHandoff2({
        verifyWebDeployCommit: jest.fn(async () => {
          throw new Error("render unreachable")
        }),
      }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("H2. Verify web deploy commit")
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })
})

describe("handoff re-reads the canonical head immediately before Resume", () => {
  const TARGET = "063342e70fe5285aa3de050b7e344c83d51ec459"

  function handoffCronStatus() {
    return jest
      .fn()
      .mockResolvedValueOnce({ id: "cron-1", suspended: true })
      .mockResolvedValueOnce({ id: "cron-1", suspended: true })
      .mockResolvedValueOnce({ id: "cron-1", suspended: false })
  }

  function base(over: Partial<DeploySafeHandoff> = {}): DeploySafeHandoff {
    return {
      verify: jest.fn(async () => ({ ok: true, refusals: [] })),
      targetCommit: TARGET,
      verifyWebDeployCommit: jest.fn(async () => ({ ok: true, detail: `commit=${TARGET}` })),
      verifyCanonicalHead: jest.fn(async () => ({ ok: true, detail: `head=${TARGET}` })),
      verifyTargetCommits: jest.fn(async () => ({ ok: true, detail: `web=${TARGET} cron=${TARGET}` })),
      ...over,
    }
  }

  it("reads it again - the 0h gate's read is not reused - and does so right before Resume", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const handoff = base()
    const result = await runDeploySafeWorkflow(deps, { handoff })
    expect(result.outcome).toBe("PASS")
    expect(handoff.verifyCanonicalHead).toHaveBeenCalledTimes(1)
    const names = result.steps.map((s) => s.step)
    expect(names.indexOf("L0. Canonical head before resume")).toBe(names.indexOf("L. Resume cron") - 1)
    // And it comes after the deploy, not near the start.
    expect(names.indexOf("G. Trigger deploy")).toBeLessThan(names.indexOf("L0. Canonical head before resume"))
  })

  it("a MOVED head prevents the Resume entirely", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, {
      handoff: base({ verifyCanonicalHead: jest.fn(async () => ({ ok: false, detail: "head=deadbeef expected=063342e" })) }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("L0. Canonical head before resume")
    expect(deps.resumeCron).not.toHaveBeenCalled()
    expect(result.reason).toMatch(/was NOT resumed/)
  })

  it("a FAILED head read also prevents the Resume - fail closed", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, {
      handoff: base({
        verifyCanonicalHead: jest.fn(async () => {
          throw new Error("ls-remote failed")
        }),
      }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("L0. Canonical head before resume")
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("Resume itself never carries a commitId - Render does not support one for Cron", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    await runDeploySafeWorkflow(deps, { handoff: base() })
    expect(deps.resumeCron).toHaveBeenCalledTimes(1)
    expect(deps.resumeCron).toHaveBeenCalledWith()
  })

  it("M2 still requires BOTH services on the exact target after Resume", async () => {
    const deps = makeDeps({ getCronStatus: handoffCronStatus() })
    const result = await runDeploySafeWorkflow(deps, {
      handoff: base({ verifyTargetCommits: jest.fn(async () => ({ ok: false, detail: `web=${TARGET} cron=cc86a0a` })) }),
    })
    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("M2. Verify target commit on both services")
    expect(deps.triggerDeploy).toHaveBeenCalledTimes(1)
  })

  it("normal mode has neither new step", async () => {
    const result = await runDeploySafeWorkflow(makeHappyPathDeps())
    const names = result.steps.map((s) => s.step)
    expect(names).not.toContain("H2. Verify web deploy commit")
    expect(names).not.toContain("L0. Canonical head before resume")
    expect(names).not.toContain("M2. Verify target commit on both services")
  })
})
