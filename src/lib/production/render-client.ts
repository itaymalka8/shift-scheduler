// Low-level Render REST API client (https://api.render.com/v1). Nothing in
// this file is called unless RENDER_API_KEY is present - see
// createRenderClient(). Every request carries the key in an Authorization
// header only; the key is never included in a URL, never logged, and never
// embedded in a thrown error's message (see RenderApiError below).
//
// HONESTY NOTE ON API SHAPES: implemented from Render's published v1 API
// documentation, not verified against a live call in this session (no
// RENDER_API_KEY was available while writing this). Endpoints used here
// (list/get services, list/get/create deploys, suspend, resume) are the
// stable, long-documented ones. Response field extraction is written
// defensively (see readServiceSuspended/readDeployStatus below) so that an
// unexpected shape produces an "unknown" value and a clear note, never a
// silent misreport or a crash. The first real call this project makes
// against a live account is also this code's first real verification -
// treat any prod:render:status run as that verification, not just routine
// usage.
//
// DELIBERATELY NOT IMPLEMENTED: a "run this Cron Job right now" action
// distinct from its own schedule. Render's v1 API has no documented,
// stable endpoint for manually invoking a Cron Job service's scheduled
// command outside of its cron schedule - the closest resource ("Jobs",
// POST /services/:id/jobs) is documented for one-off command runs on a
// different service shape and is not confirmed to apply the same way to a
// type=cron_job service. Rather than invent behavior against an
// unconfirmed endpoint, this is reported as a limitation - see
// render-ops.ts's triggerCronRunNow.

const RENDER_API_BASE = "https://api.render.com/v1"

export class RenderApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = "RenderApiError"
  }
}

export interface RenderClient {
  apiKey: string
}

export class RenderCredentialsMissingError extends Error {
  constructor() {
    super("RENDER_API_KEY is not set.")
    this.name = "RenderCredentialsMissingError"
  }
}

export function createRenderClient(env: Record<string, string | undefined> = process.env): RenderClient {
  const apiKey = env.RENDER_API_KEY
  if (!apiKey) throw new RenderCredentialsMissingError()
  return { apiKey }
}

async function renderFetch<T>(client: RenderClient, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${RENDER_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    // Never let a raw error object through - it could echo back the
    // request (headers included) in some fetch implementations.
    throw new RenderApiError(`Render API request failed: ${error instanceof Error ? error.message : "network error"}`)
  }

  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : `HTTP ${response.status}`
    throw new RenderApiError(`Render API error on ${path}: ${message}`, response.status)
  }

  return body as T
}

export interface RenderServiceSummary {
  id: string
  name: string
  type: string
}

interface RenderServiceListEntry {
  cursor?: string
  service: { id: string; name: string; type: string }
}

/**
 * Lists every service on the account, paging through Render's cursor-based
 * pagination until a page comes back short of the page size. Bounded at 20
 * pages (2000 services) purely as a runaway-loop guard - no real account
 * this tool targets is expected to come close.
 */
export async function getRenderServices(client: RenderClient): Promise<RenderServiceSummary[]> {
  const PAGE_SIZE = 100
  const MAX_PAGES = 20
  const all: RenderServiceSummary[] = []
  let cursor: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (cursor) query.set("cursor", cursor)
    const entries = await renderFetch<RenderServiceListEntry[]>(client, `/services?${query.toString()}`)
    for (const entry of entries) {
      all.push({ id: entry.service.id, name: entry.service.name, type: entry.service.type })
    }
    if (entries.length < PAGE_SIZE) break
    cursor = entries[entries.length - 1]?.cursor
    if (!cursor) break
  }

  return all
}

export async function findServiceByName(client: RenderClient, name: string): Promise<RenderServiceSummary | null> {
  const query = new URLSearchParams({ name, limit: "20" })
  const entries = await renderFetch<RenderServiceListEntry[]>(client, `/services?${query.toString()}`)
  const exact = entries.find((entry) => entry.service.name === name)
  return exact ? { id: exact.service.id, name: exact.service.name, type: exact.service.type } : null
}

export type AutoDeployState = "on" | "off" | "unknown"

export interface RenderServiceDetail {
  id: string
  name: string
  type: string
  suspended: boolean | "unknown"
}

/**
 * Render represents Auto Deploy as the string "yes" / "no" on the service
 * object. Some API iterations have used a plain boolean, so both known
 * shapes are read - and ANYTHING else (a missing field, a new enum value,
 * a non-object body) is "unknown", never guessed as "off". That default
 * matters: "unknown" is what the safe-deploy guard treats as REFUSE, so a
 * shape this function cannot read can only ever make the pipeline stricter,
 * never accidentally permissive.
 */
export function readServiceAutoDeploy(raw: unknown): AutoDeployState {
  if (!raw || typeof raw !== "object") return "unknown"
  const value = (raw as Record<string, unknown>).autoDeploy
  if (value === "yes") return "on"
  if (value === "no") return "off"
  if (value === true) return "on"
  if (value === false) return "off"
  return "unknown"
}

export interface RenderServiceSource {
  repo: string | null
  branch: string | null
}

/** The connected git source of a service - `repo` and `branch` are top-level on Render's service object. Null (never guessed) when the shape doesn't match. */
export function readServiceSource(raw: unknown): RenderServiceSource {
  if (!raw || typeof raw !== "object") return { repo: null, branch: null }
  const obj = raw as Record<string, unknown>
  return {
    repo: typeof obj.repo === "string" ? obj.repo : null,
    branch: typeof obj.branch === "string" ? obj.branch : null,
  }
}

/** Render has represented "is this service suspended" a couple of different ways across API iterations - both known shapes are checked defensively rather than assumed. */
function readServiceSuspended(raw: unknown): boolean | "unknown" {
  if (!raw || typeof raw !== "object") return "unknown"
  const obj = raw as Record<string, unknown>
  if (typeof obj.suspended === "string") return obj.suspended === "suspended"
  if (typeof obj.suspended === "boolean") return obj.suspended
  if (Array.isArray(obj.suspenders)) return obj.suspenders.length > 0
  return "unknown"
}

/** The full, unshaped service JSON - kept available for callers that need a field readServiceDetail doesn't extract (e.g. a Cron Job's schedule/command). */
export async function getServiceRaw(client: RenderClient, serviceId: string): Promise<Record<string, unknown>> {
  return renderFetch<Record<string, unknown>>(client, `/services/${serviceId}`)
}

export function readServiceDetail(raw: Record<string, unknown>, fallbackId: string): RenderServiceDetail {
  return {
    id: String(raw.id ?? fallbackId),
    name: String(raw.name ?? "unknown"),
    type: String(raw.type ?? "unknown"),
    suspended: readServiceSuspended(raw),
  }
}

export async function getServiceDetail(client: RenderClient, serviceId: string): Promise<RenderServiceDetail> {
  const raw = await getServiceRaw(client, serviceId)
  return readServiceDetail(raw, serviceId)
}

export interface RenderCronDetails {
  schedule: string | null
  command: string | null
}

/** Render nests a Cron Job's schedule/command under serviceDetails.cronJobDetails / serviceDetails.startCommand on the full service object - extracted defensively per this file's header. */
export function readCronDetails(raw: Record<string, unknown>): RenderCronDetails {
  const serviceDetails = (raw.serviceDetails && typeof raw.serviceDetails === "object" ? raw.serviceDetails : {}) as Record<string, unknown>
  const cronJobDetails = (serviceDetails.cronJobDetails && typeof serviceDetails.cronJobDetails === "object" ? serviceDetails.cronJobDetails : {}) as Record<
    string,
    unknown
  >
  const schedule = typeof cronJobDetails.schedule === "string" ? cronJobDetails.schedule : null
  const command = typeof serviceDetails.startCommand === "string" ? serviceDetails.startCommand : null
  return { schedule, command }
}

/** A web service's public URL lives under serviceDetails.url on the full service object. Returns null (never guesses) when the shape doesn't match. */
export function readServiceUrl(raw: Record<string, unknown>): string | null {
  const serviceDetails = (raw.serviceDetails && typeof raw.serviceDetails === "object" ? raw.serviceDetails : {}) as Record<string, unknown>
  return typeof serviceDetails.url === "string" ? serviceDetails.url : null
}

export interface RenderDeploySummary {
  id: string
  status: string
  createdAt: string | null
  commitId: string | null
  commitMessage: string | null
}

function readDeploySummary(raw: unknown): RenderDeploySummary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const commit = (obj.commit && typeof obj.commit === "object" ? obj.commit : {}) as Record<string, unknown>
  return {
    id: String(obj.id ?? "unknown"),
    status: String(obj.status ?? "unknown"),
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : null,
    commitId: typeof commit.id === "string" ? commit.id : null,
    commitMessage: typeof commit.message === "string" ? commit.message : null,
  }
}

export async function listDeploys(client: RenderClient, serviceId: string, limit = 5): Promise<RenderDeploySummary[]> {
  const entries = await renderFetch<{ deploy: unknown }[]>(client, `/services/${serviceId}/deploys?limit=${limit}`)
  return entries.map((entry) => readDeploySummary(entry.deploy))
}

export async function getDeploy(client: RenderClient, serviceId: string, deployId: string): Promise<RenderDeploySummary> {
  const raw = await renderFetch<unknown>(client, `/services/${serviceId}/deploys/${deployId}`)
  return readDeploySummary(raw)
}

/** Triggers a new deploy of the service's currently connected branch (an empty body deploys latest, per Render's documented Deploys API). */
export async function createDeploy(client: RenderClient, serviceId: string): Promise<RenderDeploySummary> {
  const raw = await renderFetch<unknown>(client, `/services/${serviceId}/deploys`, { method: "POST", body: "{}" })
  return readDeploySummary(raw)
}

/**
 * MUTATES the service's Auto Deploy setting via Render's documented Update
 * Service endpoint (PATCH /services/:id).
 *
 * The body carries EXACTLY ONE key - autoDeploy. Render's PATCH is a
 * partial update, so every field omitted here (repo, branch, build command,
 * start command, cron schedule, plan, region, name, env vars) is left
 * untouched by definition. That is why this function takes a boolean and
 * builds the body itself rather than accepting a caller-supplied patch
 * object: there is no way to reach this endpoint from this codebase with
 * any other field in the payload.
 */
export async function setServiceAutoDeploy(client: RenderClient, serviceId: string, enabled: boolean): Promise<AutoDeployState> {
  const raw = await renderFetch<Record<string, unknown>>(client, `/services/${serviceId}`, {
    method: "PATCH",
    body: JSON.stringify({ autoDeploy: enabled ? "yes" : "no" }),
  })
  // Render echoes the updated service back. Read the setting out of that
  // echo rather than assuming the write took - but the caller is still
  // expected to re-read the service independently before believing it.
  return readServiceAutoDeploy(raw)
}

export async function suspendService(client: RenderClient, serviceId: string): Promise<void> {
  await renderFetch<unknown>(client, `/services/${serviceId}/suspend`, { method: "POST" })
}

export async function resumeService(client: RenderClient, serviceId: string): Promise<void> {
  await renderFetch<unknown>(client, `/services/${serviceId}/resume`, { method: "POST" })
}

export const RENDER_DEPLOY_SUCCESS_STATUSES = new Set(["live"])
export const RENDER_DEPLOY_FAILURE_STATUSES = new Set(["build_failed", "update_failed", "canceled", "deactivated", "pre_deploy_failed"])

export interface RenderEnvVar {
  key: string
  value: string
}

interface RenderEnvVarListEntry {
  cursor?: string
  envVar: RenderEnvVar
}

export async function listEnvVars(client: RenderClient, serviceId: string): Promise<RenderEnvVar[]> {
  const entries = await renderFetch<RenderEnvVarListEntry[]>(client, `/services/${serviceId}/env-vars?limit=100`)
  return entries.map((entry) => entry.envVar)
}

export async function getEnvVar(client: RenderClient, serviceId: string, key: string): Promise<string | null> {
  const vars = await listEnvVars(client, serviceId)
  return vars.find((v) => v.key === key)?.value ?? null
}

/**
 * Upserts exactly ONE env var by key, via Render's single-key PUT endpoint -
 * deliberately never Render's bulk "replace all env vars" endpoint. A bulk
 * replace requires resending every existing variable, and omitting even one
 * (DATABASE_URL, NEXTAUTH_SECRET, ...) would delete it from Production.
 * There is no bulk-write function anywhere in this file - only this
 * single-key form exists, so that mistake isn't possible to make by
 * accident here.
 *
 * Setting an env var on a live Render service triggers Render to redeploy
 * it so the new value takes effect - that is Render's own behavior, not
 * something this function does separately.
 */
export async function setEnvVar(client: RenderClient, serviceId: string, key: string, value: string): Promise<void> {
  await renderFetch<unknown>(client, `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  })
}
