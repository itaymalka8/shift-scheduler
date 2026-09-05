import { listBranches, listProjects, type NeonBranchSummary, type NeonClient } from "./neon-client"

// The one real Neon project backing this app, same discovery-by-name
// pattern as WEB_SERVICE_NAME/CRON_SERVICE_NAME in render-discovery.ts.
// NEON_PROJECT_ID exists only as an override for the rare case this exact
// name can't be trusted (e.g. a rename, or two projects sharing the name).
export const PROJECT_NAME = "Goalx"

/**
 * Resolves the Neon project id: NEON_PROJECT_ID if set, otherwise the one
 * project named exactly PROJECT_NAME, otherwise (only when that name-based
 * lookup can't produce a single answer) discovered when the account has
 * exactly one project. Anything else is genuinely ambiguous and this
 * refuses to guess, asking for an explicit override instead.
 */
export async function resolveProjectId(client: NeonClient, env: Record<string, string | undefined> = process.env): Promise<string> {
  if (env.NEON_PROJECT_ID) return env.NEON_PROJECT_ID

  const projects = await listProjects(client)
  const byName = projects.filter((p) => p.name === PROJECT_NAME)
  if (byName.length === 1) return byName[0].id
  if (byName.length > 1) {
    throw new Error(`${byName.length} Neon projects are named "${PROJECT_NAME}" on this account - set NEON_PROJECT_ID explicitly rather than guessing.`)
  }

  if (projects.length === 1) return projects[0].id
  if (projects.length === 0) {
    throw new Error("No Neon projects found on this account - set NEON_PROJECT_ID explicitly.")
  }
  throw new Error(
    `${projects.length} Neon projects found on this account (${projects.map((p) => p.name).join(", ")}), none named "${PROJECT_NAME}" - set NEON_PROJECT_ID explicitly rather than guessing.`
  )
}

/**
 * Resolves the production branch: NEON_PRODUCTION_BRANCH_ID if set,
 * otherwise the one branch marked primary/default, falling back to a
 * branch literally named "production" or "main" only if there is exactly
 * one such match. Any genuine ambiguity refuses to guess.
 */
export async function resolveProductionBranchId(
  client: NeonClient,
  projectId: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  if (env.NEON_PRODUCTION_BRANCH_ID) return env.NEON_PRODUCTION_BRANCH_ID

  const branches = await listBranches(client, projectId)
  const primaries = branches.filter((b) => b.primary)
  if (primaries.length === 1) return primaries[0].id
  if (primaries.length > 1) {
    throw new Error(`${primaries.length} branches are marked primary on project ${projectId} - set NEON_PRODUCTION_BRANCH_ID explicitly.`)
  }

  const byName = (name: string): NeonBranchSummary[] => branches.filter((b) => b.name.toLowerCase() === name)
  for (const candidate of ["production", "main"]) {
    const matches = byName(candidate)
    if (matches.length === 1) return matches[0].id
    if (matches.length > 1) {
      throw new Error(`${matches.length} branches are named "${candidate}" on project ${projectId} - set NEON_PRODUCTION_BRANCH_ID explicitly.`)
    }
  }

  throw new Error(
    `Could not identify a production branch on project ${projectId} (none marked primary, none named "production" or "main") - set NEON_PRODUCTION_BRANCH_ID explicitly.`
  )
}
