import { PRODUCTION_WRITE_CONFIRMATION, ProductionWriteNotConfirmedError } from "./write-guard"

jest.mock("./render-client", () => ({
  createRenderClient: jest.fn(() => ({ apiKey: "fake" })),
  getDeploy: jest.fn(),
  suspendService: jest.fn(),
  resumeService: jest.fn(),
  createDeploy: jest.fn(),
  getServiceDetail: jest.fn(),
  getServiceRaw: jest.fn(() => ({})),
  getRenderServices: jest.fn(),
  findServiceByName: jest.fn(),
  listDeploys: jest.fn(),
  readCronDetails: jest.fn(() => ({ schedule: null, command: null })),
  readServiceDetail: jest.fn(),
  readServiceUrl: jest.fn(() => null),
  RENDER_DEPLOY_SUCCESS_STATUSES: new Set(["live"]),
  RENDER_DEPLOY_FAILURE_STATUSES: new Set(["build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"]),
}))

jest.mock("./render-discovery", () => ({
  resolveCronServiceId: jest.fn(async () => "cron-1"),
  resolveWebServiceId: jest.fn(async () => "web-1"),
}))

import { suspendService, resumeService, getDeploy } from "./render-client"
import { suspendCron, resumeCron, waitForDeploy } from "./render-ops"

const mockSuspendService = suspendService as jest.Mock
const mockResumeService = resumeService as jest.Mock
const mockGetDeploy = getDeploy as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe("suspendCron / resumeCron write guard", () => {
  it("suspendCron refuses without PRODUCTION_WRITE_CONFIRM", async () => {
    await expect(suspendCron({})).rejects.toBeInstanceOf(ProductionWriteNotConfirmedError)
    expect(mockSuspendService).not.toHaveBeenCalled()
  })

  it("suspendCron proceeds with the exact confirmation string", async () => {
    await suspendCron({ PRODUCTION_WRITE_CONFIRM: PRODUCTION_WRITE_CONFIRMATION })
    expect(mockSuspendService).toHaveBeenCalledTimes(1)
  })

  it("resumeCron refuses without PRODUCTION_WRITE_CONFIRM", async () => {
    await expect(resumeCron({})).rejects.toBeInstanceOf(ProductionWriteNotConfirmedError)
    expect(mockResumeService).not.toHaveBeenCalled()
  })

  it("resumeCron proceeds with the exact confirmation string", async () => {
    await resumeCron({ PRODUCTION_WRITE_CONFIRM: PRODUCTION_WRITE_CONFIRMATION })
    expect(mockResumeService).toHaveBeenCalledTimes(1)
  })

  it("a near-miss confirmation value still refuses", async () => {
    await expect(suspendCron({ PRODUCTION_WRITE_CONFIRM: "true" })).rejects.toBeInstanceOf(ProductionWriteNotConfirmedError)
  })
})

describe("waitForDeploy polling and timeout", () => {
  function deploy(status: string) {
    return { id: "d1", status, createdAt: null, commitId: null, commitMessage: null }
  }

  it("returns success immediately when the first poll is already live", async () => {
    mockGetDeploy.mockResolvedValue(deploy("live"))
    const sleep = jest.fn().mockResolvedValue(undefined)
    const result = await waitForDeploy("web-1", "d1", { sleep, env: {} })
    expect(result.outcome).toBe("success")
    expect(sleep).not.toHaveBeenCalled()
  })

  it("polls repeatedly while the deploy is in-flight, then reports success", async () => {
    mockGetDeploy.mockResolvedValueOnce(deploy("build_in_progress")).mockResolvedValueOnce(deploy("update_in_progress")).mockResolvedValueOnce(deploy("live"))
    const sleep = jest.fn().mockResolvedValue(undefined)
    const result = await waitForDeploy("web-1", "d1", { sleep, pollIntervalMs: 1000, env: {} })
    expect(result.outcome).toBe("success")
    expect(mockGetDeploy).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it("reports failure on a known failure status without waiting for timeout", async () => {
    mockGetDeploy.mockResolvedValue(deploy("build_failed"))
    const sleep = jest.fn().mockResolvedValue(undefined)
    const result = await waitForDeploy("web-1", "d1", { sleep, env: {} })
    expect(result.outcome).toBe("failure")
    expect(sleep).not.toHaveBeenCalled()
  })

  it("reports timeout when the deploy never resolves within the budget", async () => {
    mockGetDeploy.mockResolvedValue(deploy("build_in_progress"))
    const sleep = jest.fn().mockResolvedValue(undefined)
    let now = 0
    const clock = () => now
    // Each sleep() call advances the fake clock past the timeout on the second tick.
    sleep.mockImplementation(async () => {
      now += 10_000
    })
    const result = await waitForDeploy("web-1", "d1", { sleep, now: clock, timeoutMs: 15_000, pollIntervalMs: 10_000, env: {} })
    expect(result.outcome).toBe("timeout")
  })
})
