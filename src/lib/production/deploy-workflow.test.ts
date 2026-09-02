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

describe("runDeploySafeWorkflow - success path", () => {
  it("runs every step in order and resumes cron only at the end", async () => {
    const deps = makeHappyPathDeps()
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("PASS")
    expect(result.failedStep).toBeNull()
    expect(result.cronLeftSuspended).toBe(false)
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

describe("runDeploySafeWorkflow - stop on failure", () => {
  it("stops at A when preflight fails, and touches nothing else", async () => {
    const deps = makeDeps({ runPreflight: jest.fn(async () => ({ pass: false, summary: "PRODUCTION PREFLIGHT: FAIL" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("A. Preflight")
    expect(result.cronLeftSuspended).toBe(false)
    expect(deps.getWebStatus).not.toHaveBeenCalled()
    expect(deps.createBackup).not.toHaveBeenCalled()
    expect(deps.suspendCron).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("stops at C when backup creation throws, and never suspends cron", async () => {
    const deps = makeDeps({ createBackup: jest.fn(async () => { throw new Error("Neon API error: quota exceeded") }) })
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
    const deps = makeDeps({ getCronStatus: jest.fn().mockResolvedValueOnce({ id: "cron-1", suspended: false }).mockResolvedValueOnce({ id: "cron-1", suspended: false }) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("F. Verify cron suspended")
    expect(deps.triggerDeploy).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("leaves cron suspended (never auto-resumes) when the deploy fails", async () => {
    const deps = makeHappyPathDeps({ waitForDeploy: jest.fn(async () => ({ outcome: "failure" as const, status: "build_failed" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.outcome).toBe("FAIL")
    expect(result.failedStep).toBe("H. Wait for deploy")
    expect(result.cronLeftSuspended).toBe(true)
    expect(deps.resumeCron).not.toHaveBeenCalled()
    expect(deps.runPostDeployCheck).not.toHaveBeenCalled()
  })

  it("leaves cron suspended when the deploy times out", async () => {
    const deps = makeHappyPathDeps({ waitForDeploy: jest.fn(async () => ({ outcome: "timeout" as const, status: "build_in_progress" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.failedStep).toBe("H. Wait for deploy")
    expect(result.cronLeftSuspended).toBe(true)
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("leaves cron suspended when the web service does not respond as live", async () => {
    const deps = makeHappyPathDeps({ isWebLive: jest.fn(async () => false) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.failedStep).toBe("I. Verify web live")
    expect(result.cronLeftSuspended).toBe(true)
    expect(deps.runPostDeployCheck).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("leaves cron suspended when post-deploy-check fails, and never runs the scheduled dry check or resumes", async () => {
    const deps = makeHappyPathDeps({ runPostDeployCheck: jest.fn(async () => ({ pass: false, summary: "PRODUCTION POST-DEPLOY CHECK: FAIL" })) })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.failedStep).toBe("J. Post-deploy check")
    expect(result.cronLeftSuspended).toBe(true)
    expect(deps.runScheduledDryCheck).not.toHaveBeenCalled()
    expect(deps.resumeCron).not.toHaveBeenCalled()
  })

  it("stops at M when cron does not report active after resume", async () => {
    const getCronStatus = jest
      .fn()
      .mockResolvedValueOnce({ id: "cron-1", suspended: false })
      .mockResolvedValueOnce({ id: "cron-1", suspended: true })
      .mockResolvedValueOnce({ id: "cron-1", suspended: true }) // still suspended after resume attempt
    const deps = makeDeps({ getCronStatus })
    const result = await runDeploySafeWorkflow(deps)

    expect(result.failedStep).toBe("M. Verify cron active")
    expect(deps.resumeCron).toHaveBeenCalledTimes(1)
  })
})
