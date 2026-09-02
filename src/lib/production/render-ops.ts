/**
 * PLANNED INTERFACE ONLY. No implementation, no network calls - every
 * function below throws immediately. This file exists so the shape of a
 * future prod:cron:status / prod:cron:suspend / prod:cron:resume /
 * prod:deploy:status implementation is decided and typed now, without
 * granting this session (or anyone importing this file today) any actual
 * ability to reach Render.
 *
 * Render's REST API (https://api.render.com/v1) is what a real
 * implementation would call - checked against Render's public API
 * documentation only, never invoked:
 *   - GET  /v1/services/:id                read a service's current state
 *   - GET  /v1/services/:id/deploys        read deploy history
 *   - POST /v1/services/:id/suspend        suspend a service (a Cron Job is
 *                                          a "service" in Render's API, so
 *                                          this applies to the cron job too)
 *   - POST /v1/services/:id/resume         resume a suspended service
 *
 * Three env vars this repo does not read anywhere today would gate it:
 *   RENDER_API_KEY           - a Render personal/team API key
 *   RENDER_CRON_SERVICE_ID   - goalx-manager-fixture-processor's service id
 *   RENDER_WEB_SERVICE_ID    - goalx-manager's (the web service) service id
 *
 * getCronStatus/getDeployStatus would stay read-only. suspendCron/
 * resumeCron mutate a live Render service and would need
 * assertProductionWriteConfirmed() (see write-guard.ts) before ever calling
 * out to Render for real - the same rule every other mutating production
 * script must follow.
 */

export interface RenderCredentials {
  apiKey: string
  cronServiceId: string
  webServiceId: string
}

export class RenderOpsNotImplementedError extends Error {
  constructor(operation: string) {
    super(`${operation} is not implemented yet - planned interface only (no Render API call was made).`)
    this.name = "RenderOpsNotImplementedError"
  }
}

/** Reads the three env vars a real implementation would need. Only checks presence - never validates them against Render, since that would require making the very API call this file deliberately does not make. */
export function readRenderCredentials(env: Record<string, string | undefined> = process.env): RenderCredentials | null {
  const { RENDER_API_KEY, RENDER_CRON_SERVICE_ID, RENDER_WEB_SERVICE_ID } = env
  if (!RENDER_API_KEY || !RENDER_CRON_SERVICE_ID || !RENDER_WEB_SERVICE_ID) return null
  return { apiKey: RENDER_API_KEY, cronServiceId: RENDER_CRON_SERVICE_ID, webServiceId: RENDER_WEB_SERVICE_ID }
}

export interface CronStatus {
  serviceId: string
  suspended: boolean
  lastDeployAt: string | null
}

/** Planned: GET /v1/services/:RENDER_CRON_SERVICE_ID. Read-only once built. */
export async function getCronStatus(): Promise<CronStatus> {
  throw new RenderOpsNotImplementedError("getCronStatus")
}

/** Planned: POST /v1/services/:RENDER_CRON_SERVICE_ID/suspend. MUTATES Production - requires assertProductionWriteConfirmed() once built. */
export async function suspendCron(): Promise<void> {
  throw new RenderOpsNotImplementedError("suspendCron")
}

/** Planned: POST /v1/services/:RENDER_CRON_SERVICE_ID/resume. MUTATES Production - requires assertProductionWriteConfirmed() once built. */
export async function resumeCron(): Promise<void> {
  throw new RenderOpsNotImplementedError("resumeCron")
}

export interface DeployStatus {
  serviceId: string
  status: string
  createdAt: string
}

/** Planned: GET /v1/services/:RENDER_WEB_SERVICE_ID/deploys?limit=1. Read-only once built. */
export async function getDeployStatus(): Promise<DeployStatus> {
  throw new RenderOpsNotImplementedError("getDeployStatus")
}
