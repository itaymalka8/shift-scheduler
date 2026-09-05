import { PRODUCTION_WRITE_CONFIRMATION, ProductionWriteNotConfirmedError } from "./write-guard"

jest.mock("./neon-client", () => {
  const actual = jest.requireActual("./neon-client")
  return {
    createNeonClient: jest.fn(() => ({ apiKey: "fake" })),
    createBranch: jest.fn(),
    getBranchDetails: jest.fn(),
    getProjectDetails: jest.fn(),
    listBranches: jest.fn(),
    deleteBranch: jest.fn(),
    NeonApiError: actual.NeonApiError,
  }
})

jest.mock("./neon-discovery", () => ({
  resolveProjectId: jest.fn(async () => "proj-1"),
  resolveProductionBranchId: jest.fn(async () => "prod-branch-1"),
}))

import { createBranch, deleteBranch, getBranchDetails, NeonApiError } from "./neon-client"
import { BackupDeletionRefusedError, createBackupBranch, deleteBackupBranch, verifyBackupBranch } from "./neon-ops"

const mockCreateBranch = createBranch as jest.Mock
const mockGetBranchDetails = getBranchDetails as jest.Mock
const mockDeleteBranch = deleteBranch as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe("createBackupBranch write guard", () => {
  it("refuses without PRODUCTION_WRITE_CONFIRM", async () => {
    await expect(createBackupBranch({})).rejects.toBeInstanceOf(ProductionWriteNotConfirmedError)
    expect(mockCreateBranch).not.toHaveBeenCalled()
  })

  it("creates a branch off the production branch, named with the given timestamp, once confirmed", async () => {
    mockCreateBranch.mockResolvedValue({ id: "backup-1", name: "pre-deploy-goalx-2026-09-02-1200", createdAt: "t", parentId: "prod-branch-1", primary: false })
    const now = new Date(Date.UTC(2026, 8, 2, 12, 0))
    const branch = await createBackupBranch({ PRODUCTION_WRITE_CONFIRM: PRODUCTION_WRITE_CONFIRMATION }, now)
    expect(branch.id).toBe("backup-1")
    expect(mockCreateBranch).toHaveBeenCalledWith(expect.anything(), "proj-1", { name: "pre-deploy-goalx-2026-09-02-1200", parentId: "prod-branch-1" })
  })
})

describe("verifyBackupBranch", () => {
  it("reports exists=true and isChildOfProduction=true for a real child branch", async () => {
    mockGetBranchDetails.mockResolvedValue({ id: "backup-1", name: "b", createdAt: "t", parentId: "prod-branch-1", primary: false })
    const result = await verifyBackupBranch("backup-1", {})
    expect(result).toEqual({ exists: true, isChildOfProduction: true, branch: expect.objectContaining({ id: "backup-1" }) })
  })

  it("reports isChildOfProduction=false when the branch exists but isn't a child of production", async () => {
    mockGetBranchDetails.mockResolvedValue({ id: "backup-1", name: "b", createdAt: "t", parentId: "some-other-branch", primary: false })
    const result = await verifyBackupBranch("backup-1", {})
    expect(result.exists).toBe(true)
    expect(result.isChildOfProduction).toBe(false)
  })

  it("reports exists=false on a genuine 404 from Neon", async () => {
    mockGetBranchDetails.mockRejectedValue(new NeonApiError("not found", 404))
    const result = await verifyBackupBranch("missing-branch", {})
    expect(result).toEqual({ exists: false, isChildOfProduction: false, branch: null })
  })

  it("does NOT report exists=false on a non-404 failure - it propagates instead", async () => {
    mockGetBranchDetails.mockRejectedValue(new NeonApiError("service unavailable", 503))
    await expect(verifyBackupBranch("backup-1", {})).rejects.toThrow("service unavailable")
  })

  it("propagates a network-level error rather than reporting a false negative", async () => {
    mockGetBranchDetails.mockRejectedValue(new Error("network down"))
    await expect(verifyBackupBranch("backup-1", {})).rejects.toThrow("network down")
  })
})

describe("deleteBackupBranch", () => {
  const CONFIRMED = { PRODUCTION_WRITE_CONFIRM: PRODUCTION_WRITE_CONFIRMATION }
  const goodBackup = {
    id: "backup-1",
    name: "pre-deploy-goalx-2026-09-03-1121",
    createdAt: "t",
    parentId: "prod-branch-1",
    primary: false,
  }

  it("REFUSES without PRODUCTION_WRITE_CONFIRM, before making any API call", async () => {
    await expect(deleteBackupBranch("backup-1", {})).rejects.toBeInstanceOf(ProductionWriteNotConfirmedError)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
    expect(mockGetBranchDetails).not.toHaveBeenCalled()
  })

  it("REFUSES a confirmation that is merely truthy rather than the exact string", async () => {
    for (const value of ["true", "1", "yes", "I_UNDERSTAND_THIS_CHANGES_PRODUCTION ", ""]) {
      await expect(deleteBackupBranch("backup-1", { PRODUCTION_WRITE_CONFIRM: value })).rejects.toBeInstanceOf(ProductionWriteNotConfirmedError)
    }
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it("REFUSES the production branch id without even reading the branch", async () => {
    await expect(deleteBackupBranch("prod-branch-1", CONFIRMED)).rejects.toBeInstanceOf(BackupDeletionRefusedError)
    expect(mockGetBranchDetails).not.toHaveBeenCalled()
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it("REFUSES a branch the API reports as primary, even if the planner cleared it", async () => {
    mockGetBranchDetails.mockResolvedValue({ ...goodBackup, primary: true })
    await expect(deleteBackupBranch("backup-1", CONFIRMED)).rejects.toThrow(/marked primary/)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it("REFUSES a branch whose name is not the backup convention", async () => {
    mockGetBranchDetails.mockResolvedValue({ ...goodBackup, name: "dev" })
    await expect(deleteBackupBranch("backup-1", CONFIRMED)).rejects.toThrow(/naming convention/)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it("REFUSES a backup-named branch that is not a child of production", async () => {
    mockGetBranchDetails.mockResolvedValue({ ...goodBackup, parentId: "some-other-branch" })
    await expect(deleteBackupBranch("backup-1", CONFIRMED)).rejects.toThrow(/not a child of the production branch/)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it("re-reads identity from the API rather than trusting the caller", async () => {
    mockGetBranchDetails.mockResolvedValue(goodBackup)
    await deleteBackupBranch("backup-1", CONFIRMED)
    expect(mockGetBranchDetails).toHaveBeenCalledWith(expect.anything(), "proj-1", "backup-1")
    expect(mockDeleteBranch).toHaveBeenCalledWith(expect.anything(), "proj-1", "backup-1")
  })

  it("propagates a Neon API failure instead of reporting a deletion that did not happen", async () => {
    mockGetBranchDetails.mockResolvedValue(goodBackup)
    mockDeleteBranch.mockRejectedValue(new NeonApiError("Neon API error on /branches: rate limited", 429))
    await expect(deleteBackupBranch("backup-1", CONFIRMED)).rejects.toBeInstanceOf(NeonApiError)
  })

  it("surfaces a 404 on the identity read rather than treating it as already-deleted", async () => {
    mockGetBranchDetails.mockRejectedValue(new NeonApiError("Neon API error: not found", 404))
    await expect(deleteBackupBranch("backup-1", CONFIRMED)).rejects.toBeInstanceOf(NeonApiError)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })
})
