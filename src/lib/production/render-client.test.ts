import {
  createRenderClient,
  findServiceByName,
  getRenderServices,
  getServiceRaw,
  RenderApiError,
  RenderCredentialsMissingError,
  readCronDetails,
  readServiceDetail,
  readServiceUrl,
  suspendService,
  type RenderClient,
} from "./render-client"

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response)
}

describe("createRenderClient", () => {
  it("throws when RENDER_API_KEY is missing", () => {
    expect(() => createRenderClient({})).toThrow(RenderCredentialsMissingError)
  })

  it("returns a client carrying the key when present", () => {
    expect(createRenderClient({ RENDER_API_KEY: "secret-key" })).toEqual({ apiKey: "secret-key" })
  })
})

describe("Render API error mapping", () => {
  const client: RenderClient = { apiKey: "fake-key-for-tests" }

  it("wraps a non-2xx response in RenderApiError with status and message", async () => {
    mockFetchOnce(404, { message: "service not found" })
    await expect(suspendService(client, "srv-1")).rejects.toMatchObject({
      name: "RenderApiError",
      status: 404,
      message: expect.stringContaining("service not found"),
    })
  })

  it("falls back to a generic HTTP status message when the body has no message field", async () => {
    mockFetchOnce(500, {})
    await expect(suspendService(client, "srv-1")).rejects.toThrow(/HTTP 500/)
  })

  it("wraps a network-level failure without leaking the request itself", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"))
    await expect(suspendService(client, "srv-1")).rejects.toBeInstanceOf(RenderApiError)
  })

  it("never includes the API key in a thrown error's message", async () => {
    const secretClient: RenderClient = { apiKey: "sk-super-secret-render-key-123" }
    mockFetchOnce(401, { message: "unauthorized" })
    try {
      await suspendService(secretClient, "srv-1")
      throw new Error("expected suspendService to throw")
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("sk-super-secret-render-key-123")
    }
  })
})

describe("getRenderServices pagination", () => {
  it("pages through cursor-based results until a short page is returned", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      cursor: `c${i}`,
      service: { id: `s${i}`, name: `svc-${i}`, type: "web_service" },
    }))
    const page2 = [{ cursor: "c100", service: { id: "s100", name: "svc-100", type: "web_service" } }]

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(page1) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(page2) } as unknown as Response)

    const services = await getRenderServices({ apiKey: "k" })
    expect(services).toHaveLength(101)
    expect(services[0]).toEqual({ id: "s0", name: "svc-0", type: "web_service" })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("stops after a single short page", async () => {
    mockFetchOnce(200, [{ cursor: "c0", service: { id: "s0", name: "only-one", type: "cron_job" } }])
    const services = await getRenderServices({ apiKey: "k" })
    expect(services).toEqual([{ id: "s0", name: "only-one", type: "cron_job" }])
  })
})

describe("findServiceByName", () => {
  it("returns only an exact name match", async () => {
    mockFetchOnce(200, [
      { service: { id: "s1", name: "goalx-manager", type: "web_service" } },
      { service: { id: "s2", name: "goalx-manager-fixture-processor", type: "cron_job" } },
    ])
    const found = await findServiceByName({ apiKey: "k" }, "goalx-manager")
    expect(found).toEqual({ id: "s1", name: "goalx-manager", type: "web_service" })
  })

  it("returns null when nothing matches exactly", async () => {
    mockFetchOnce(200, [{ service: { id: "s1", name: "something-else", type: "web_service" } }])
    const found = await findServiceByName({ apiKey: "k" }, "goalx-manager")
    expect(found).toBeNull()
  })
})

describe("defensive shape readers", () => {
  it("reads suspended as a string enum", () => {
    expect(readServiceDetail({ id: "s1", name: "n", type: "web_service", suspended: "suspended" }, "s1").suspended).toBe(true)
    expect(readServiceDetail({ id: "s1", name: "n", type: "web_service", suspended: "not_suspended" }, "s1").suspended).toBe(false)
  })

  it("reads suspended as a boolean", () => {
    expect(readServiceDetail({ id: "s1", name: "n", type: "web_service", suspended: true }, "s1").suspended).toBe(true)
  })

  it("reads suspended from a suspenders array", () => {
    expect(readServiceDetail({ id: "s1", name: "n", type: "web_service", suspenders: ["user"] }, "s1").suspended).toBe(true)
    expect(readServiceDetail({ id: "s1", name: "n", type: "web_service", suspenders: [] }, "s1").suspended).toBe(false)
  })

  it("reports unknown rather than guessing on an unrecognized shape", () => {
    expect(readServiceDetail({ id: "s1", name: "n", type: "web_service" }, "s1").suspended).toBe("unknown")
  })

  it("extracts cron schedule and command when present", () => {
    const raw = { serviceDetails: { startCommand: "npm run process-scheduled-jobs", cronJobDetails: { schedule: "*/2 * * * *" } } }
    expect(readCronDetails(raw)).toEqual({ schedule: "*/2 * * * *", command: "npm run process-scheduled-jobs" })
  })

  it("returns nulls for cron details on an unrecognized shape rather than guessing", () => {
    expect(readCronDetails({})).toEqual({ schedule: null, command: null })
  })

  it("extracts the web service url when present", () => {
    expect(readServiceUrl({ serviceDetails: { url: "https://goalx-manager.onrender.com" } })).toBe("https://goalx-manager.onrender.com")
  })

  it("returns null for url on an unrecognized shape", () => {
    expect(readServiceUrl({})).toBeNull()
  })
})

describe("getServiceRaw", () => {
  it("returns the raw parsed body untouched", async () => {
    mockFetchOnce(200, { id: "s1", name: "n", custom: "field" })
    const raw = await getServiceRaw({ apiKey: "k" }, "s1")
    expect(raw).toEqual({ id: "s1", name: "n", custom: "field" })
  })
})
