/**
 * PLANNED INTERFACE ONLY. No implementation, no network calls - every
 * function below throws immediately. This file exists so the shape of a
 * future prod:backup:create / prod:backup:list implementation is decided
 * and typed now, without granting this session (or anyone importing this
 * file today) any actual ability to reach Neon.
 *
 * Neon's REST API (https://api.neon.tech/api/v2) - checked against Neon's
 * public API documentation only, never invoked - does support all three
 * branch operations this audit was asked about:
 *   - POST   /projects/:id/branches               create a branch
 *   - GET    /projects/:id/branches                list branches
 *   - DELETE /projects/:id/branches/:branchId      delete a branch
 *
 * Neon branches are copy-on-write, so creating one from the production
 * branch - either at the current moment or at a specific past LSN/
 * timestamp - is effectively an instant point-in-time backup without ever
 * running pg_dump against the live database.
 *
 * Three env vars this repo does not read anywhere today would gate it:
 *   NEON_API_KEY               - a Neon API key
 *   NEON_PROJECT_ID            - the Neon project id
 *   NEON_PRODUCTION_BRANCH_ID  - the branch id backups are taken FROM
 *
 * listBackupBranches would stay read-only. createBackupBranch mutates (it
 * provisions new storage) and would need assertProductionWriteConfirmed()
 * (see write-guard.ts) before it may ever call Neon for real.
 *
 * deleteBackupBranch is included below only because the audit this file
 * documents was asked whether Neon's API supports deletion - it does - not
 * because a prod:backup:delete command is planned. No CLI command exists
 * for it on purpose: destroying a backup is a decision that should never
 * be one npm script away.
 */

export interface NeonCredentials {
  apiKey: string
  projectId: string
  productionBranchId: string
}

export class NeonOpsNotImplementedError extends Error {
  constructor(operation: string) {
    super(`${operation} is not implemented yet - planned interface only (no Neon API call was made).`)
    this.name = "NeonOpsNotImplementedError"
  }
}

/** Reads the three env vars a real implementation would need. Only checks presence - never validates them against Neon, since that would require making the very API call this file deliberately does not make. */
export function readNeonCredentials(env: Record<string, string | undefined> = process.env): NeonCredentials | null {
  const { NEON_API_KEY, NEON_PROJECT_ID, NEON_PRODUCTION_BRANCH_ID } = env
  if (!NEON_API_KEY || !NEON_PROJECT_ID || !NEON_PRODUCTION_BRANCH_ID) return null
  return { apiKey: NEON_API_KEY, projectId: NEON_PROJECT_ID, productionBranchId: NEON_PRODUCTION_BRANCH_ID }
}

export interface NeonBranchSummary {
  id: string
  name: string
  createdAt: string
  parentId: string | null
}

/** Planned: POST /projects/:NEON_PROJECT_ID/branches with parent_id=NEON_PRODUCTION_BRANCH_ID. MUTATES (provisions storage) - requires assertProductionWriteConfirmed() once built. */
export async function createBackupBranch(): Promise<NeonBranchSummary> {
  throw new NeonOpsNotImplementedError("createBackupBranch")
}

/** Planned: GET /projects/:NEON_PROJECT_ID/branches. Read-only once built. */
export async function listBackupBranches(): Promise<NeonBranchSummary[]> {
  throw new NeonOpsNotImplementedError("listBackupBranches")
}

/** Planned only insofar as the audit checked feasibility - no CLI command is planned for this (see file header). MUTATES (destroys storage) - would require assertProductionWriteConfirmed() and almost certainly a second explicit confirmation if ever built. */
export async function deleteBackupBranch(branchId: string): Promise<void> {
  throw new NeonOpsNotImplementedError(`deleteBackupBranch(${branchId})`)
}
