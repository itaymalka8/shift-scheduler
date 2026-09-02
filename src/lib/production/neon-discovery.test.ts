import { resolveProductionBranchId, resolveProjectId } from "./neon-discovery"
import { listBranches, listProjects, type NeonClient } from "./neon-client"

jest.mock("./neon-client", () => ({ listBranches: jest.fn(), listProjects: jest.fn() }))

const mockListProjects = listProjects as jest.Mock
const mockListBranches = listBranches as jest.Mock
const client: NeonClient = { apiKey: "k" }

beforeEach(() => {
  mockListProjects.mockReset()
  mockListBranches.mockReset()
})

describe("resolveProjectId", () => {
  it("uses NEON_PROJECT_ID override without calling the API", async () => {
    const id = await resolveProjectId(client, { NEON_PROJECT_ID: "proj-override" })
    expect(id).toBe("proj-override")
    expect(mockListProjects).not.toHaveBeenCalled()
  })

  it("auto-selects the single project when exactly one exists", async () => {
    mockListProjects.mockResolvedValue([{ id: "proj-1", name: "goalx" }])
    expect(await resolveProjectId(client, {})).toBe("proj-1")
  })

  it("refuses to guess when zero projects exist", async () => {
    mockListProjects.mockResolvedValue([])
    await expect(resolveProjectId(client, {})).rejects.toThrow(/No Neon projects found/)
  })

  it("refuses to guess when more than one project exists", async () => {
    mockListProjects.mockResolvedValue([
      { id: "proj-1", name: "goalx-prod" },
      { id: "proj-2", name: "goalx-staging" },
    ])
    await expect(resolveProjectId(client, {})).rejects.toThrow(/2 Neon projects found/)
  })
})

describe("resolveProductionBranchId", () => {
  it("uses NEON_PRODUCTION_BRANCH_ID override without calling the API", async () => {
    const id = await resolveProductionBranchId(client, "proj-1", { NEON_PRODUCTION_BRANCH_ID: "branch-override" })
    expect(id).toBe("branch-override")
    expect(mockListBranches).not.toHaveBeenCalled()
  })

  it("picks the single branch marked primary", async () => {
    mockListBranches.mockResolvedValue([
      { id: "b1", name: "production", createdAt: "t", parentId: null, primary: true },
      { id: "b2", name: "feature-x", createdAt: "t", parentId: "b1", primary: false },
    ])
    expect(await resolveProductionBranchId(client, "proj-1", {})).toBe("b1")
  })

  it("refuses to guess when more than one branch is marked primary", async () => {
    mockListBranches.mockResolvedValue([
      { id: "b1", name: "a", createdAt: "t", parentId: null, primary: true },
      { id: "b2", name: "b", createdAt: "t", parentId: null, primary: true },
    ])
    await expect(resolveProductionBranchId(client, "proj-1", {})).rejects.toThrow(/2 branches are marked primary/)
  })

  it("falls back to a branch literally named 'production' when none is marked primary", async () => {
    mockListBranches.mockResolvedValue([
      { id: "b1", name: "production", createdAt: "t", parentId: null, primary: false },
      { id: "b2", name: "dev", createdAt: "t", parentId: "b1", primary: false },
    ])
    expect(await resolveProductionBranchId(client, "proj-1", {})).toBe("b1")
  })

  it("falls back to 'main' only when 'production' doesn't exist", async () => {
    mockListBranches.mockResolvedValue([
      { id: "b1", name: "main", createdAt: "t", parentId: null, primary: false },
      { id: "b2", name: "dev", createdAt: "t", parentId: "b1", primary: false },
    ])
    expect(await resolveProductionBranchId(client, "proj-1", {})).toBe("b1")
  })

  it("refuses to guess when nothing is primary and no production/main branch exists", async () => {
    mockListBranches.mockResolvedValue([{ id: "b1", name: "feature-x", createdAt: "t", parentId: null, primary: false }])
    await expect(resolveProductionBranchId(client, "proj-1", {})).rejects.toThrow(/Could not identify a production branch/)
  })
})
