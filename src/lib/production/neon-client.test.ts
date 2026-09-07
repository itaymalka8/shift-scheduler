import { createBranch, createNeonClient, getBranchDetails, listBranches, listProjects, NeonCredentialsMissingError, type NeonClient } from "./neon-client"

afterEach(() => {
  jest.restoreAllMocks()
})

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

describe("createNeonClient", () => {
  it("throws when NEON_API_KEY is missing", () => {
    expect(() => createNeonClient({})).toThrow(NeonCredentialsMissingError)
  })

  it("returns a client carrying the key when present", () => {
    expect(createNeonClient({ NEON_API_KEY: "secret" })).toEqual({ apiKey: "secret" })
  })
})

describe("Neon API error mapping", () => {
  const client: NeonClient = { apiKey: "fake-key" }

  it("wraps a non-2xx response in NeonApiError with status and message", async () => {
    mockFetchOnce(404, { message: "branch not found" })
    await expect(getBranchDetails(client, "proj-1", "br-1")).rejects.toMatchObject({
      name: "NeonApiError",
      status: 404,
      message: expect.stringContaining("branch not found"),
    })
  })

  it("never includes the API key in a thrown error's message", async () => {
    const secretClient: NeonClient = { apiKey: "neon-super-secret-abc123" }
    mockFetchOnce(401, { message: "unauthorized" })
    try {
      await getBranchDetails(secretClient, "proj-1", "br-1")
      throw new Error("expected getBranchDetails to throw")
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("neon-super-secret-abc123")
    }
  })
})

describe("listProjects / listBranches shape reading", () => {
  const client: NeonClient = { apiKey: "k" }

  it("maps project list entries", async () => {
    mockFetchOnce(200, { projects: [{ id: "p1", name: "goalx" }] })
    expect(await listProjects(client)).toEqual([{ id: "p1", name: "goalx" }])
  })

  it("reads primary via the 'primary' field", async () => {
    mockFetchOnce(200, { branches: [{ id: "b1", name: "production", created_at: "2026-01-01T00:00:00Z", primary: true }] })
    const branches = await listBranches(client, "p1")
    expect(branches[0].primary).toBe(true)
  })

  it("falls back to the older 'default' field for primary", async () => {
    mockFetchOnce(200, { branches: [{ id: "b1", name: "main", created_at: "2026-01-01T00:00:00Z", default: true }] })
    const branches = await listBranches(client, "p1")
    expect(branches[0].primary).toBe(true)
  })

  it("reports primary=false when neither field is set", async () => {
    mockFetchOnce(200, { branches: [{ id: "b1", name: "feature-x", created_at: "2026-01-01T00:00:00Z" }] })
    const branches = await listBranches(client, "p1")
    expect(branches[0].primary).toBe(false)
  })
})

describe("createBranch", () => {
  it("sends parent_id and name, and reads back the created branch", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ branch: { id: "b2", name: "pre-deploy-goalx-2026-09-02-1200", created_at: "2026-09-02T12:00:00Z", parent_id: "b1" } }),
    } as unknown as Response)

    const branch = await createBranch({ apiKey: "k" }, "p1", { name: "pre-deploy-goalx-2026-09-02-1200", parentId: "b1" })
    expect(branch).toEqual({ id: "b2", name: "pre-deploy-goalx-2026-09-02-1200", createdAt: "2026-09-02T12:00:00Z", parentId: "b1", primary: false })

    const call = (global.fetch as jest.Mock).mock.calls[0]
    expect(call[0]).toContain("/projects/p1/branches")
    const sentBody = JSON.parse((call[1] as RequestInit).body as string)
    expect(sentBody).toEqual({ branch: { parent_id: "b1", name: "pre-deploy-goalx-2026-09-02-1200" } })
  })
})
