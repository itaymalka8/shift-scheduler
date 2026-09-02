// Low-level Neon REST API client (https://console.neon.tech/api/v2 - Neon's
// actual documented base URL, not api.neon.tech). Nothing in this file is
// called unless NEON_API_KEY is present - see createNeonClient(). Every
// request carries the key in an Authorization header only; the key is
// never included in a URL, never logged, and never embedded in a thrown
// error's message (see NeonApiError below).
//
// HONESTY NOTE ON API SHAPES: implemented from Neon's published v2 API
// documentation, not verified against a live call in this session (no
// NEON_API_KEY was available while writing this). The first real call this
// project makes against a live account is also this code's first real
// verification.
//
// A Neon branch is ALWAYS a full copy-on-write copy of data AND schema -
// there is no "schema only" branch option to accidentally pick. Creating a
// branch from the production branch already satisfies "copy data + schema,
// not schema only" by construction.

const NEON_API_BASE = "https://console.neon.tech/api/v2"

export class NeonApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = "NeonApiError"
  }
}

export interface NeonClient {
  apiKey: string
}

export class NeonCredentialsMissingError extends Error {
  constructor() {
    super("NEON_API_KEY is not set.")
    this.name = "NeonCredentialsMissingError"
  }
}

export function createNeonClient(env: Record<string, string | undefined> = process.env): NeonClient {
  const apiKey = env.NEON_API_KEY
  if (!apiKey) throw new NeonCredentialsMissingError()
  return { apiKey }
}

async function neonFetch<T>(client: NeonClient, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${NEON_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    throw new NeonApiError(`Neon API request failed: ${error instanceof Error ? error.message : "network error"}`)
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
    throw new NeonApiError(`Neon API error on ${path}: ${message}`, response.status)
  }

  return body as T
}

export interface NeonProjectSummary {
  id: string
  name: string
}

export async function listProjects(client: NeonClient): Promise<NeonProjectSummary[]> {
  const body = await neonFetch<{ projects: { id: string; name: string }[] }>(client, "/projects?limit=100")
  return body.projects.map((p) => ({ id: p.id, name: p.name }))
}

export async function getProjectDetails(client: NeonClient, projectId: string): Promise<NeonProjectSummary & { createdAt: string | null }> {
  const body = await neonFetch<{ project: { id: string; name: string; created_at?: string } }>(client, `/projects/${projectId}`)
  return { id: body.project.id, name: body.project.name, createdAt: body.project.created_at ?? null }
}

export interface NeonBranchSummary {
  id: string
  name: string
  createdAt: string
  parentId: string | null
  primary: boolean
}

function readBranchSummary(raw: {
  id: string
  name: string
  created_at: string
  parent_id?: string | null
  default?: boolean
  primary?: boolean
}): NeonBranchSummary {
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.created_at,
    parentId: raw.parent_id ?? null,
    // Neon has named this flag "primary" in current docs and "default" in
    // some historical API versions - both are checked defensively.
    primary: raw.primary === true || raw.default === true,
  }
}

export async function listBranches(client: NeonClient, projectId: string): Promise<NeonBranchSummary[]> {
  const body = await neonFetch<{ branches: Parameters<typeof readBranchSummary>[0][] }>(client, `/projects/${projectId}/branches`)
  return body.branches.map(readBranchSummary)
}

export async function getBranchDetails(client: NeonClient, projectId: string, branchId: string): Promise<NeonBranchSummary> {
  const body = await neonFetch<{ branch: Parameters<typeof readBranchSummary>[0] }>(client, `/projects/${projectId}/branches/${branchId}`)
  return readBranchSummary(body.branch)
}

export interface CreateBranchOptions {
  name: string
  parentId: string
}

/** Creates a new branch (a full copy-on-write copy of data + schema) from parentId. MUTATES - provisions new storage on the Neon account. */
export async function createBranch(client: NeonClient, projectId: string, options: CreateBranchOptions): Promise<NeonBranchSummary> {
  const body = await neonFetch<{ branch: Parameters<typeof readBranchSummary>[0] }>(client, `/projects/${projectId}/branches`, {
    method: "POST",
    body: JSON.stringify({ branch: { parent_id: options.parentId, name: options.name } }),
  })
  return readBranchSummary(body.branch)
}
