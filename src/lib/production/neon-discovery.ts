import { listBranches, listProjects, type NeonBranchSummary, type NeonClient } from "./neon-client"

/**
 * Resolves the Neon project id: NEON_PROJECT_ID if set, otherwise
 * discovered ONLY when the account has exactly one project - anything
 * else (zero, or more than one) is genuinely ambiguous and this refuses to
 * guess, asking for an explicit override instead.
 */
export async function resolveProjectId(client: NeonClient, env: Record<string, string | undefined> = process.env): Promise<string> {
  if (env.NEON_PROJECT_ID) return env.NEON_PROJECT_ID

  const projects = await listProjects(client)
  if (projects.length === 1) return projects[0].id
  if (projects.length === 0) {
    throw new Error("No Neon projects found on this account - set NEON_PROJECT_ID explicitly.")
  }
  throw new Error(
    `${projects.length} Neon projects found on this account (${projects.map((p) => p.name).join(", ")}) - set NEON_PROJECT_ID explicitly rather than guessing.`
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
