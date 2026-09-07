/**
 * THE CANONICAL BRANCH HEAD, read the same way by every caller that needs it.
 *
 * WHY THIS MODULE EXISTS. Two Production paths verify that the canonical branch
 * still points at the approved commit - the source migration's pre-migration
 * gate, and the safe deploy's handoff gate plus its final pre-Resume check. Both
 * originally shelled out to `git ls-remote <https url>`. That works in a
 * developer's shell, where git is authenticated, and FAILS in GitHub Actions
 * against a PRIVATE repository whenever the checkout ran with
 * persist-credentials: false - which is exactly how the Production workflows are
 * configured, deliberately, so the job holds no credential that could write to
 * git. The credential that makes a later authenticated git command possible is
 * the persisted one; without it the read prompts for a username and dies.
 *
 * That is a fail-closed failure, so it could not have deployed anything wrong -
 * but a gate that cannot perform the read it depends on is a gate that always
 * refuses, and shipping one would have meant discovering it during a Production
 * run instead of before.
 *
 * THE FIX, AT LEAST PRIVILEGE. When a GitHub token is available, the head is
 * read through the REST API with a read-only Authorization header, which needs
 * no persisted git credential and no write capability of any kind. The token is
 * passed only to the one step that runs the Production command; it is never
 * logged, never echoed, and never included in a thrown error's message.
 *
 * EVERYTHING FAILS CLOSED. A missing token where authentication is required, a
 * failed request, an unexpected response shape, a missing ref, a malformed or
 * short SHA, an unreadable body - each returns a refusal, never a guess and
 * never a partial value. The caller then compares the SHA to the approved
 * commit exactly, as it always did; nothing about that comparison is relaxed.
 */

/** Exactly forty lowercase hex characters. Anything else is not a commit id. */
const FULL_SHA = /^[0-9a-f]{40}$/

export interface CanonicalHeadResult {
  ok: boolean
  /** The 40-character SHA, or null on any failure. */
  sha: string | null
  /** Human-readable, safe to print - never contains a token. */
  detail: string
}

export interface CanonicalHeadSource {
  /** e.g. "https://github.com/itaymalka8/goalx-manager" */
  repoUrl: string
  /** e.g. "claude/goalx-manager-game-y3ht29" */
  branch: string
}

/** owner/repo from a GitHub HTTPS url. Null - never a guess - on any other shape. */
export function parseGithubRepoUrl(repoUrl: string): { owner: string; repo: string } | null {
  const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(repoUrl.trim())
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export interface ReadCanonicalHeadDeps {
  /** Authenticated GitHub API read. Injected so tests never touch the network. */
  fetchRef: (owner: string, repo: string, branch: string, token: string) => Promise<unknown>
  /** Unauthenticated local fallback - a developer's own git. */
  gitLsRemote: (repoUrl: string, branch: string) => string
  env: Record<string, string | undefined>
}

/**
 * Pull the SHA out of GitHub's git-ref response.
 *
 * Shape: { ref, node_id, url, object: { sha, type, url } }. Anything that does
 * not match yields null rather than an attempt to find a SHA elsewhere in the
 * body - a value found by rummaging is not a value anyone verified.
 */
export function readShaFromRefResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const object = (body as Record<string, unknown>).object
  if (!object || typeof object !== "object") return null
  const sha = (object as Record<string, unknown>).sha
  if (typeof sha !== "string") return null
  const trimmed = sha.trim().toLowerCase()
  return FULL_SHA.test(trimmed) ? trimmed : null
}

/**
 * Read the canonical branch head.
 *
 * IN GITHUB ACTIONS the API path is REQUIRED, not merely preferred: falling back
 * to an unauthenticated git read there would reintroduce exactly the failure
 * this module exists to prevent, and would do so silently. So when GITHUB_ACTIONS
 * is set, a missing token is a refusal rather than a reason to try git.
 *
 * LOCALLY, with no token, the git read is kept - a developer's own git is
 * already authenticated and this is the read they have always used.
 */
export async function readCanonicalHead(source: CanonicalHeadSource, deps: ReadCanonicalHeadDeps): Promise<CanonicalHeadResult> {
  const { repoUrl, branch } = source
  const parsed = parseGithubRepoUrl(repoUrl)
  if (!parsed) {
    return { ok: false, sha: null, detail: `canonical repo url is not a GitHub HTTPS url: ${repoUrl}` }
  }

  const token = deps.env.GITHUB_TOKEN ?? deps.env.GH_TOKEN ?? null
  const inActions = deps.env.GITHUB_ACTIONS === "true"

  if (token) {
    let body: unknown
    try {
      body = await deps.fetchRef(parsed.owner, parsed.repo, branch, token)
    } catch (error) {
      // The message is ours, not the request's - a raw error could echo headers.
      return { ok: false, sha: null, detail: `GitHub API read of ${parsed.owner}/${parsed.repo}@${branch} failed: ${describe(error)}` }
    }
    const sha = readShaFromRefResponse(body)
    if (!sha) {
      return { ok: false, sha: null, detail: `GitHub API response for ${parsed.owner}/${parsed.repo}@${branch} did not contain a readable 40-character SHA` }
    }
    return { ok: true, sha, detail: `${sha} (GitHub API, authenticated read of ${parsed.owner}/${parsed.repo}@${branch})` }
  }

  if (inActions) {
    return {
      ok: false,
      sha: null,
      detail:
        "no GitHub token available in this Actions job, and the canonical repository is private - " +
        "an unauthenticated git read would fail. Refusing rather than attempting it.",
    }
  }

  let output: string
  try {
    output = deps.gitLsRemote(repoUrl, branch)
  } catch (error) {
    return { ok: false, sha: null, detail: `git ls-remote of ${repoUrl}@${branch} failed: ${describe(error)}` }
  }
  const candidate = output.split(/\s+/)[0]?.trim().toLowerCase() ?? ""
  if (!FULL_SHA.test(candidate)) {
    return { ok: false, sha: null, detail: `git ls-remote of ${repoUrl}@${branch} did not yield a 40-character SHA` }
  }
  return { ok: true, sha: candidate, detail: `${candidate} (git ls-remote of ${repoUrl}@${branch})` }
}

/** Never let a raw error object through - some carry the request, headers included. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error"
}

/**
 * The real API call. Kept separate from the logic above so every test runs
 * without a network, and so this is the ONLY place an Authorization header is
 * constructed for this purpose.
 */
export async function fetchGithubRef(owner: string, repo: string, branch: string, token: string): Promise<unknown> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  if (!response.ok) {
    // Status only. A response body from a failed auth attempt can echo detail
    // that is better not put in a log line.
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}
