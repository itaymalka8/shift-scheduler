/**
 * The production-facing Render surface every scripts/production/*.ts file
 * that talks to Render goes through. Read operations (status, deploy
 * history) never check anything beyond RENDER_API_KEY being present.
 * Mutating operations (suspendCron, resumeCron, triggerDeploy) additionally
 * call assertProductionWriteConfirmed() before making any request -
 * exactly once per call, which is also exactly once per PRODUCTION_WRITE_
 * CONFIRM the caller set for its whole run (see write-guard.ts): a single
 * `npm run prod:deploy:safe` invocation sets that env var once and every
 * mutating step inside it re-checks the same value, so nothing here ever
 * prompts a second time.
 *
 * Service discovery is by name (see render-discovery.ts) - RENDER_WEB_
 * SERVICE_ID / RENDER_CRON_SERVICE_ID are optional overrides, never
 * required inputs.
 *
 * LIMITATION (see render-client.ts's header for the full reasoning):
 * there is no function here for "run this Cron Job's command right now,
 * outside its schedule". Render's v1 API has no documented, stable
 * endpoint for that on a type=cron_job service - inventing one against an
 * unconfirmed shape would be worse than not having the feature. The
 * closest real lever this file exposes is triggerDeploy() on the WEB
 * service, which is a genuinely documented action.
 */
import {
  createRenderClient,
  findServiceByName as clientFindServiceByName,
  getDeploy,
  getRenderServices as clientGetRenderServices,
  getServiceDetail,
  getServiceRaw,
  readCronDetails,
  readServiceDetail,
  readServiceUrl,
  listDeploys as clientListDeploys,
  createDeploy,
  resumeService,
  suspendService,
  RENDER_DEPLOY_FAILURE_STATUSES,
  RENDER_DEPLOY_SUCCESS_STATUSES,
  getEnvVar,
  setEnvVar,
  type RenderDeploySummary,
  type RenderServiceDetail,
  type RenderServiceSummary,
} from "./render-client"
import { resolveCronServiceId, resolveWebServiceId } from "./render-discovery"
import { assertProductionWriteConfirmed } from "./write-guard"

export type { RenderDeploySummary, RenderServiceDetail, RenderServiceSummary }

export async function getRenderServices(env: Record<string, string | undefined> = process.env): Promise<RenderServiceSummary[]> {
  return clientGetRenderServices(createRenderClient(env))
}

export async function findServiceByName(
  name: string,
  env: Record<string, string | undefined> = process.env
): Promise<RenderServiceSummary | null> {
  return clientFindServiceByName(createRenderClient(env), name)
}

export async function getWebServiceStatus(env: Record<string, string | undefined> = process.env): Promise<RenderServiceDetail> {
  const client = createRenderClient(env)
  const id = await resolveWebServiceId(client, env)
  return getServiceDetail(client, id)
}

/** Read-only. The web service's public URL, if Render's API exposes one for it - null otherwise (never guessed). */
export async function getWebServiceUrl(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const client = createRenderClient(env)
  const id = await resolveWebServiceId(client, env)
  const raw = await getServiceRaw(client, id)
  return readServiceUrl(raw)
}

export interface CronStatus extends RenderServiceDetail {
  schedule: string | null
  command: string | null
}

/** Render's Cron Job schedule/command live under serviceDetails.cronJobDetails on the full service object - extracted defensively (see render-client.ts's header on API-shape honesty). */
export async function getCronStatus(env: Record<string, string | undefined> = process.env): Promise<CronStatus> {
  const client = createRenderClient(env)
  const id = await resolveCronServiceId(client, env)
  const raw = await getServiceRaw(client, id)
  return { ...readServiceDetail(raw, id), ...readCronDetails(raw) }
}

export async function listDeploys(
  serviceId: string,
  limit = 5,
  env: Record<string, string | undefined> = process.env
): Promise<RenderDeploySummary[]> {
  return clientListDeploys(createRenderClient(env), serviceId, limit)
}

export async function getLatestDeploy(
  serviceId: string,
  env: Record<string, string | undefined> = process.env
): Promise<RenderDeploySummary | null> {
  const deploys = await clientListDeploys(createRenderClient(env), serviceId, 1)
  return deploys[0] ?? null
}

export interface WaitForDeployOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  env?: Record<string, string | undefined>
}

export type WaitForDeployOutcome = "success" | "failure" | "timeout"

export interface WaitForDeployResult {
  outcome: WaitForDeployOutcome
  deploy: RenderDeploySummary
}

const DEFAULT_DEPLOY_TIMEOUT_MS = 15 * 60_000
const DEFAULT_DEPLOY_POLL_INTERVAL_MS = 15_000

export async function waitForDeploy(serviceId: string, deployId: string, options: WaitForDeployOptions = {}): Promise<WaitForDeployResult> {
  const client = createRenderClient(options.env ?? process.env)
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEPLOY_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_DEPLOY_POLL_INTERVAL_MS
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const startedAt = now()
  let deploy = await getDeploy(client, serviceId, deployId)

  for (;;) {
    if (RENDER_DEPLOY_SUCCESS_STATUSES.has(deploy.status)) return { outcome: "success", deploy }
    if (RENDER_DEPLOY_FAILURE_STATUSES.has(deploy.status)) return { outcome: "failure", deploy }
    if (now() - startedAt >= timeoutMs) return { outcome: "timeout", deploy }
    await sleep(pollIntervalMs)
    deploy = await getDeploy(client, serviceId, deployId)
  }
}

/** MUTATES Production (suspends the Cron service) - requires PRODUCTION_WRITE_CONFIRM. */
export async function suspendCron(env: Record<string, string | undefined> = process.env): Promise<void> {
  assertProductionWriteConfirmed(env)
  const client = createRenderClient(env)
  const id = await resolveCronServiceId(client, env)
  await suspendService(client, id)
}

/** MUTATES Production (resumes the Cron service) - requires PRODUCTION_WRITE_CONFIRM. */
export async function resumeCron(env: Record<string, string | undefined> = process.env): Promise<void> {
  assertProductionWriteConfirmed(env)
  const client = createRenderClient(env)
  const id = await resolveCronServiceId(client, env)
  await resumeService(client, id)
}

/** MUTATES Production (triggers a new deploy of the web service's current branch) - requires PRODUCTION_WRITE_CONFIRM. */
export async function triggerDeploy(env: Record<string, string | undefined> = process.env): Promise<RenderDeploySummary> {
  assertProductionWriteConfirmed(env)
  const client = createRenderClient(env)
  const id = await resolveWebServiceId(client, env)
  return createDeploy(client, id)
}

/** Read-only. Returns a specific deploy if deployId is given, otherwise the web service's latest. */
export async function getDeployStatus(
  deployId?: string,
  env: Record<string, string | undefined> = process.env
): Promise<RenderDeploySummary | null> {
  const client = createRenderClient(env)
  const webServiceId = await resolveWebServiceId(client, env)
  if (deployId) return getDeploy(client, webServiceId, deployId)
  const deploys = await clientListDeploys(client, webServiceId, 1)
  return deploys[0] ?? null
}

/**
 * Read-only. The web service's own current value for one env var key -
 * used to read back PRODUCTION_OPS_READ_TOKEN transiently (see ops-token.ts
 * and scripts/production/ops-check.ts) without ever storing it in this
 * session's own environment variables.
 */
export async function getWebServiceEnvVar(key: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const client = createRenderClient(env)
  const id = await resolveWebServiceId(client, env)
  return getEnvVar(client, id, key)
}

/**
 * MUTATES Production (sets one env var on the web service, which Render
 * will redeploy for) - requires PRODUCTION_WRITE_CONFIRM. Never touches any
 * other env var - see render-client.ts's setEnvVar for why a bulk-replace
 * endpoint is never used here.
 */
export async function setWebServiceEnvVar(key: string, value: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  assertProductionWriteConfirmed(env)
  const client = createRenderClient(env)
  const id = await resolveWebServiceId(client, env)
  await setEnvVar(client, id, key, value)
}
