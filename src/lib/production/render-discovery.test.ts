import { resetRenderDiscoveryCache, resolveCronServiceId, resolveWebServiceId, WEB_SERVICE_NAME, CRON_SERVICE_NAME } from "./render-discovery"
import { findServiceByName, type RenderClient } from "./render-client"

jest.mock("./render-client", () => ({ findServiceByName: jest.fn() }))

const mockFindServiceByName = findServiceByName as jest.Mock
const client: RenderClient = { apiKey: "k" }

beforeEach(() => {
  resetRenderDiscoveryCache()
  mockFindServiceByName.mockReset()
})

describe("resolveWebServiceId", () => {
  it("uses the RENDER_WEB_SERVICE_ID override without calling the API", async () => {
    const id = await resolveWebServiceId(client, { RENDER_WEB_SERVICE_ID: "srv-override" })
    expect(id).toBe("srv-override")
    expect(mockFindServiceByName).not.toHaveBeenCalled()
  })

  it("discovers the service by name when no override is set", async () => {
    mockFindServiceByName.mockResolvedValue({ id: "srv-discovered", name: WEB_SERVICE_NAME, type: "web_service" })
    const id = await resolveWebServiceId(client, {})
    expect(id).toBe("srv-discovered")
  })

  it("throws a clear error when discovery finds nothing, rather than guessing", async () => {
    mockFindServiceByName.mockResolvedValue(null)
    await expect(resolveWebServiceId(client, {})).rejects.toThrow(/No Render service named/)
  })

  it("caches the discovered id across calls within the same process", async () => {
    mockFindServiceByName.mockResolvedValue({ id: "srv-cached", name: WEB_SERVICE_NAME, type: "web_service" })
    await resolveWebServiceId(client, {})
    await resolveWebServiceId(client, {})
    expect(mockFindServiceByName).toHaveBeenCalledTimes(1)
  })
})

describe("resolveCronServiceId", () => {
  it("uses the RENDER_CRON_SERVICE_ID override without calling the API", async () => {
    const id = await resolveCronServiceId(client, { RENDER_CRON_SERVICE_ID: "cron-override" })
    expect(id).toBe("cron-override")
    expect(mockFindServiceByName).not.toHaveBeenCalled()
  })

  it("discovers the cron service by its own distinct name", async () => {
    mockFindServiceByName.mockResolvedValue({ id: "cron-discovered", name: CRON_SERVICE_NAME, type: "cron_job" })
    const id = await resolveCronServiceId(client, {})
    expect(id).toBe("cron-discovered")
  })

  it("keeps web and cron caches independent", async () => {
    mockFindServiceByName
      .mockResolvedValueOnce({ id: "web-1", name: WEB_SERVICE_NAME, type: "web_service" })
      .mockResolvedValueOnce({ id: "cron-1", name: CRON_SERVICE_NAME, type: "cron_job" })
    const webId = await resolveWebServiceId(client, {})
    const cronId = await resolveCronServiceId(client, {})
    expect(webId).toBe("web-1")
    expect(cronId).toBe("cron-1")
    expect(mockFindServiceByName).toHaveBeenCalledTimes(2)
  })
})
