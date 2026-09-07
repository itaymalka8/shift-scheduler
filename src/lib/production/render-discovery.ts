import { findServiceByName, type RenderClient } from "./render-client"

// The two real service names in this project's render.yaml. Discovery
// looks these up by name so no Service ID ever needs to be typed in by
// hand - RENDER_WEB_SERVICE_ID / RENDER_CRON_SERVICE_ID exist only as an
// override for the rare case discovery can't be trusted (e.g. two services
// sharing a name across environments).
export const WEB_SERVICE_NAME = "goalx-manager"
export const CRON_SERVICE_NAME = "goalx-manager-fixture-processor"

// In-memory only, per process - never written to disk, never shared across
// runs. A long-lived process (the deploy:safe workflow, which calls these
// several times) pays the discovery API call once; a fresh script
// invocation starts with a cold cache and re-discovers.
let cachedWebServiceId: string | null = null
let cachedCronServiceId: string | null = null

export function resetRenderDiscoveryCache(): void {
  cachedWebServiceId = null
  cachedCronServiceId = null
}

async function resolveServiceId(
  client: RenderClient,
  overrideId: string | undefined,
  name: string,
  getCache: () => string | null,
  setCache: (id: string) => void
): Promise<string> {
  if (overrideId) return overrideId
  const cached = getCache()
  if (cached) return cached
  const found = await findServiceByName(client, name)
  if (!found) {
    throw new Error(
      `No Render service named "${name}" was found on this account. Set an explicit RENDER_WEB_SERVICE_ID / RENDER_CRON_SERVICE_ID override instead of relying on discovery.`
    )
  }
  setCache(found.id)
  return found.id
}

export async function resolveWebServiceId(client: RenderClient, env: Record<string, string | undefined> = process.env): Promise<string> {
  return resolveServiceId(
    client,
    env.RENDER_WEB_SERVICE_ID,
    WEB_SERVICE_NAME,
    () => cachedWebServiceId,
    (id) => (cachedWebServiceId = id)
  )
}

export async function resolveCronServiceId(client: RenderClient, env: Record<string, string | undefined> = process.env): Promise<string> {
  return resolveServiceId(
    client,
    env.RENDER_CRON_SERVICE_ID,
    CRON_SERVICE_NAME,
    () => cachedCronServiceId,
    (id) => (cachedCronServiceId = id)
  )
}
