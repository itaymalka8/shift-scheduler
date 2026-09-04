/**
 * The production-facing Neon surface every scripts/production/*.ts file
 * that talks to Neon goes through. Read operations (list/get branches,
 * project details) never check anything beyond NEON_API_KEY being present.
 * createBackupBranch additionally calls assertProductionWriteConfirmed()
 * before making any request - see render-ops.ts's header for why one
 * PRODUCTION_WRITE_CONFIRM covers a whole workflow run, never a per-call
 * prompt.
 *
 * Project/branch discovery is automatic when unambiguous (see
 * neon-discovery.ts) - NEON_PROJECT_ID / NEON_PRODUCTION_BRANCH_ID are
 * optional overrides, never required inputs, and discovery refuses to
 * guess rather than pick wrong when more than one candidate exists.
 *
 * Two mutations live here and only two: createBackupBranch (provisions a
 * recovery point) and deleteBackupBranch (destroys one). Both require
 * PRODUCTION_WRITE_CONFIRM. Deletion additionally re-verifies the branch's
 * identity against a FRESH read taken immediately before the DELETE, rather
 * than trusting the list a caller planned from - see its own header.
 */
import {
  createBranch,
  createNeonClient,
  deleteBranch,
  getBranchDetails as clientGetBranchDetails,
  getProjectDetails as clientGetProjectDetails,
  listBranches as clientListBranches,
  NeonApiError,
  type NeonBranchSummary,
} from "./neon-client"
import { resolveProductionBranchId, resolveProjectId } from "./neon-discovery"
import { assertProductionWriteConfirmed } from "./write-guard"
import { formatBackupBranchName, isBackupBranchName } from "./backup-naming"

export type { NeonBranchSummary }

export async function listBranches(env: Record<string, string | undefined> = process.env): Promise<NeonBranchSummary[]> {
  const client = createNeonClient(env)
  const projectId = await resolveProjectId(client, env)
  return clientListBranches(client, projectId)
}

export async function getProductionBranch(env: Record<string, string | undefined> = process.env): Promise<NeonBranchSummary> {
  const client = createNeonClient(env)
  const projectId = await resolveProjectId(client, env)
  const branchId = await resolveProductionBranchId(client, projectId, env)
  return clientGetBranchDetails(client, projectId, branchId)
}

export async function getBranchDetails(branchId: string, env: Record<string, string | undefined> = process.env): Promise<NeonBranchSummary> {
  const client = createNeonClient(env)
  const projectId = await resolveProjectId(client, env)
  return clientGetBranchDetails(client, projectId, branchId)
}

export async function getProjectDetails(
  env: Record<string, string | undefined> = process.env
): Promise<{ id: string; name: string; createdAt: string | null }> {
  const client = createNeonClient(env)
  const projectId = await resolveProjectId(client, env)
  return clientGetProjectDetails(client, projectId)
}

/**
 * MUTATES (provisions a new Neon branch = an instant point-in-time backup
 * of Production - a Neon branch always carries data AND schema, there is
 * no schema-only option) - requires PRODUCTION_WRITE_CONFIRM.
 */
export async function createBackupBranch(
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date()
): Promise<NeonBranchSummary> {
  assertProductionWriteConfirmed(env)
  const client = createNeonClient(env)
  const projectId = await resolveProjectId(client, env)
  const productionBranchId = await resolveProductionBranchId(client, projectId, env)
  const name = formatBackupBranchName(now)
  return createBranch(client, projectId, { name, parentId: productionBranchId })
}

export interface VerifyBackupBranchResult {
  exists: boolean
  isChildOfProduction: boolean
  branch: NeonBranchSummary | null
}

/**
 * Read-only: confirms a backup branch created earlier is actually there
 * and really is a child of the production branch - the sanity check
 * prod:deploy:safe runs before trusting the backup exists (see its "D.
 * Verify backup exists" step).
 *
 * Only a genuine 404 from Neon is treated as "does not exist" - any other
 * failure (network, auth, a 5xx) is rethrown rather than silently reported
 * as a missing backup, because those two situations call for different
 * responses from a caller deciding whether it's safe to proceed.
 */
export async function verifyBackupBranch(
  branchId: string,
  env: Record<string, string | undefined> = process.env
): Promise<VerifyBackupBranchResult> {
  const client = createNeonClient(env)
  const projectId = await resolveProjectId(client, env)
  const productionBranchId = await resolveProductionBranchId(client, projectId, env)
  try {
    const branch = await clientGetBranchDetails(client, projectId, branchId)
    return { exists: true, isChildOfProduction: branch.parentId === productionBranchId, branch }
  } catch (error) {
    if (error instanceof NeonApiError && error.status === 404) {
      return { exists: false, isChildOfProduction: false, branch: null }
    }
    throw error
  }
}

export class BackupDeletionRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BackupDeletionRefusedError"
  }
}

/**
 * PERMANENTLY DELETES one pre-deploy backup branch. Requires
 * PRODUCTION_WRITE_CONFIRM.
 *
 * THE CHECKS HERE ARE NOT A REPEAT OF THE PLANNER'S - THEY ARE A SECOND
 * READING. backup-prune.ts decides eligibility from the branch list an
 * operator reviewed, which by the time a DELETE is actually sent is a
 * snapshot of the past: branches can have been created, deleted, or
 * (crucially) had the primary flag moved between then and now. So this
 * re-resolves which branch is Production and re-reads the target's own
 * record from the API, and refuses on anything it does not like - even
 * though the planner already said yes.
 *
 * It refuses to delete:
 *   - the production branch, by id resolved through neon-discovery
 *   - anything whose name is not a GoalX pre-deploy backup name
 *   - anything that is not a child of the production branch
 *
 * It does NOT enforce the retention floor. That is a property of a whole
 * plan, not of one branch, and it is enforced in planBackupPrune before any
 * call reaches here.
 */
export async function deleteBackupBranch(branchId: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  assertProductionWriteConfirmed(env)
  const client = createNeonClient(env)
  const projectId = await resolveProjectId(client, env)
  const productionBranchId = await resolveProductionBranchId(client, projectId, env)

  if (branchId === productionBranchId) {
    throw new BackupDeletionRefusedError(`REFUSED: ${branchId} is the production branch of project ${projectId}.`)
  }

  const branch = await clientGetBranchDetails(client, projectId, branchId)

  if (branch.primary) {
    throw new BackupDeletionRefusedError(`REFUSED: branch "${branch.name}" (${branchId}) is marked primary.`)
  }
  if (!isBackupBranchName(branch.name)) {
    throw new BackupDeletionRefusedError(
      `REFUSED: branch "${branch.name}" (${branchId}) does not match the pre-deploy backup naming convention.`
    )
  }
  if (branch.parentId !== productionBranchId) {
    throw new BackupDeletionRefusedError(
      `REFUSED: branch "${branch.name}" (${branchId}) is not a child of the production branch (parent=${branch.parentId ?? "none"}).`
    )
  }

  await deleteBranch(client, projectId, branchId)
}
