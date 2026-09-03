import { runDeploySafeWorkflow, type DeployWorkflowDeps } from "./deploy-workflow"

function makeDeps(overrides: Partial<DeployWorkflowDeps> = {}): DeployWorkflowDeps {
  return {
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
