import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  parseGithubRepoUrl,
  readCanonicalHead,
  readShaFromRefResponse,
  type ReadCanonicalHeadDeps,
} from "./canonical-head"
import { RENDER_SOURCE_MIGRATION, verifyPreMigrationState } from "./render-source-migration"

const ROOT = join(__dirname, "..", "..", "..")
const C = RENDER_SOURCE_MIGRATION
const TARGET = "063342e70fe5285aa3de050b7e344c83d51ec459"
const SOURCE = { repoUrl: C.toRepo, branch: C.branch }

function deps(over: Partial<ReadCanonicalHeadDeps> = {}): ReadCanonicalHeadDeps {
  return {
    fetchRef: jest.fn(async () => ({ ref: `refs/heads/${C.branch}`, object: { sha: TARGET, type: "commit" } })),
    gitLsRemote: jest.fn(() => `${TARGET}\trefs/heads/${C.branch}\n`),
    env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: "ghs_fake_token_value" },
    ...over,
  }
}

describe("parsing the canonical repo url", () => {
  it("reads owner and repo from a GitHub HTTPS url", () => {
    expect(parseGithubRepoUrl("https://github.com/itaymalka8/goalx-manager")).toEqual({ owner: "itaymalka8", repo: "goalx-manager" })
    expect(parseGithubRepoUrl("https://github.com/itaymalka8/goalx-manager.git")).toEqual({ owner: "itaymalka8", repo: "goalx-manager" })
  })

  it("returns null - never a guess - for anything else", () => {
    for (const bad of ["git@github.com:itaymalka8/goalx-manager.git", "https://gitlab.com/a/b", "https://github.com/onlyowner", "", "   "]) {
      expect(parseGithubRepoUrl(bad)).toBeNull()
    }
  })
})

describe("extracting the SHA from a git-ref response", () => {
  it("reads object.sha when it is a full 40-character SHA", () => {
    expect(readShaFromRefResponse({ object: { sha: TARGET } })).toBe(TARGET)
    expect(readShaFromRefResponse({ object: { sha: TARGET.toUpperCase() } })).toBe(TARGET)
  })

  it("returns null on every unexpected shape rather than rummaging for a SHA", () => {
    for (const bad of [
      null,
      undefined,
      "a string",
      {},
      { object: null },
      { object: {} },
      { object: { sha: 42 } },
      { object: { sha: TARGET.slice(0, 7) } }, // short SHA is NOT accepted
      { object: { sha: `${TARGET}extra` } },
      { object: { sha: "zzzz42e70fe5285aa3de050b7e344c83d51ec459" } }, // non-hex
      { sha: TARGET }, // right value, wrong place
    ]) {
      expect(readShaFromRefResponse(bad)).toBeNull()
    }
  })
})

describe("reading the canonical head of a PRIVATE repository", () => {
  it("uses the authenticated API and returns the exact SHA", async () => {
    const d = deps()
    const result = await readCanonicalHead(SOURCE, d)
    expect(result).toEqual({ ok: true, sha: TARGET, detail: expect.stringContaining(TARGET) })
    expect(d.fetchRef).toHaveBeenCalledWith("itaymalka8", "goalx-manager", C.branch, "ghs_fake_token_value")
    // The unauthenticated git path is NOT used when a token exists.
    expect(d.gitLsRemote).not.toHaveBeenCalled()
  })

  it("accepts GH_TOKEN as well as GITHUB_TOKEN", async () => {
    const d = deps({ env: { GITHUB_ACTIONS: "true", GH_TOKEN: "ghs_other" } })
    expect((await readCanonicalHead(SOURCE, d)).sha).toBe(TARGET)
  })

  it("FAILS CLOSED in Actions with no token - it does not fall back to an unauthenticated git read", async () => {
    const d = deps({ env: { GITHUB_ACTIONS: "true" } })
    const result = await readCanonicalHead(SOURCE, d)
    expect(result.ok).toBe(false)
    expect(result.sha).toBeNull()
    expect(result.detail).toMatch(/no GitHub token available/)
    expect(d.gitLsRemote).not.toHaveBeenCalled()
  })

  it("FAILS CLOSED when the API request throws", async () => {
    const d = deps({
      fetchRef: jest.fn(async () => {
        throw new Error("HTTP 404")
      }),
    })
    const result = await readCanonicalHead(SOURCE, d)
    expect(result.ok).toBe(false)
    expect(result.sha).toBeNull()
    expect(result.detail).toMatch(/failed: HTTP 404/)
  })

  it("FAILS CLOSED on an unreadable or malformed response, including a short SHA", async () => {
    for (const body of [{}, { object: {} }, { object: { sha: "063342e" } }, "not json", null]) {
      const result = await readCanonicalHead(SOURCE, deps({ fetchRef: jest.fn(async () => body) }))
      expect(result.ok).toBe(false)
      expect(result.sha).toBeNull()
      expect(result.detail).toMatch(/did not contain a readable 40-character SHA/)
    }
  })

  it("FAILS CLOSED on a repo url it cannot parse", async () => {
    const result = await readCanonicalHead({ repoUrl: "git@github.com:x/y.git", branch: "main" }, deps())
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/not a GitHub HTTPS url/)
  })

  it("NEVER puts the token in the returned detail", async () => {
    const token = "ghs_super_secret_value"
    for (const d of [
      deps({ env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: token } }),
      deps({
        env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: token },
        fetchRef: jest.fn(async () => {
          throw new Error("HTTP 401")
        }),
      }),
      deps({ env: { GITHUB_ACTIONS: "true", GITHUB_TOKEN: token }, fetchRef: jest.fn(async () => ({})) }),
    ]) {
      const result = await readCanonicalHead(SOURCE, d)
      expect(result.detail.includes(token)).toBe(false)
    }
  })

  it("LOCALLY, with no token, still uses the developer's authenticated git", async () => {
    const d = deps({ env: {} })
    const result = await readCanonicalHead(SOURCE, d)
    expect(result.ok).toBe(true)
    expect(result.sha).toBe(TARGET)
    expect(d.gitLsRemote).toHaveBeenCalledWith(C.toRepo, C.branch)
  })

  it("FAILS CLOSED when the local git read throws or returns no SHA", async () => {
    const thrown = await readCanonicalHead(SOURCE, deps({
      env: {},
      gitLsRemote: jest.fn(() => {
        throw new Error("could not read Username")
      }),
    }))
    expect(thrown.ok).toBe(false)
    expect(thrown.detail).toMatch(/git ls-remote .* failed/)

    for (const output of ["", "\n", "not-a-sha\trefs/heads/x\n", "063342e\trefs/heads/x\n"]) {
      const r = await readCanonicalHead(SOURCE, deps({ env: {}, gitLsRemote: jest.fn(() => output) }))
      expect(r.ok).toBe(false)
      expect(r.sha).toBeNull()
    }
  })
})

describe("the head feeds the existing gate unchanged", () => {
  const snap = (over = {}) => ({
    id: C.webServiceId,
    repo: C.fromRepo,
    branch: C.branch,
    autoDeploy: "off" as const,
    buildCommand: "b",
    startCommand: "s",
    schedule: null,
    envVarNames: ["DATABASE_URL"],
    latestDeployId: "dep-1",
    latestDeployCommit: "cc86a0a5a73cd1b2ce9957ede1476762e3876e7e",
    ...over,
  })

  const gateWith = (githubHead: string) =>
    verifyPreMigrationState({
      contract: C,
      web: snap(),
      cron: snap({ id: C.cronServiceId, schedule: C.cronSchedule }),
      githubHead,
    })

  it("an authenticated read of the exact SHA passes the gate", async () => {
    const head = await readCanonicalHead(SOURCE, deps())
    expect(gateWith(head.sha ?? "")).toEqual({ ok: true, refusals: [] })
  })

  it("a WRONG SHA is still refused - the comparison is unchanged", async () => {
    const wrong = "e60910e8405edbc0f0a6d417f9e554ee76ac1952"
    const head = await readCanonicalHead(SOURCE, deps({ fetchRef: jest.fn(async () => ({ object: { sha: wrong.padEnd(40, "0") } })) }))
    expect(gateWith(head.sha ?? "").refusals.map((r) => r.code)).toContain("GITHUB_HEAD_MISMATCH")
  })

  it("a failed read yields no SHA, and the gate refuses on the empty value", async () => {
    const head = await readCanonicalHead(SOURCE, deps({ env: { GITHUB_ACTIONS: "true" } }))
    expect(head.sha).toBeNull()
    expect(gateWith(head.sha ?? "").refusals.map((r) => r.code)).toContain("GITHUB_HEAD_MISMATCH")
  })
})

describe("the callers' shape", () => {
  const migrate = readFileSync(join(ROOT, "scripts/production/render-source-migrate.ts"), "utf8")
  const deploy = readFileSync(join(ROOT, "scripts/production/deploy-safe.ts"), "utf8")
  const client = readFileSync(join(ROOT, "src/lib/production/canonical-head.ts"), "utf8")

  it("both Production paths go through the shared reader, not a bare ls-remote", () => {
    for (const [label, text] of [
      ["migrate", migrate],
      ["deploy", deploy],
    ] as const) {
      expect(`${label}:${text.includes("readCanonicalHead(")}`).toBe(`${label}:true`)
      // ls-remote survives ONLY as the injected local fallback.
      const bare = text.match(/execFileSync\("git", \["ls-remote"/g) ?? []
      expect(`${label}:${bare.length}`).toBe(`${label}:1`)
    }
  })

  it("the deploy path reads the head TWICE - the gate's result is never reused for L0", () => {
    expect(deploy).toMatch(/FRESH READ #1/)
    expect(deploy).toMatch(/FRESH READ #2/)
    expect((deploy.match(/await readCanonicalHeadSha\(\)/g) ?? []).length).toBe(2)
  })

  it("the Authorization header is built in exactly one place, and never logged", () => {
    expect((client.match(/Authorization:/g) ?? []).length).toBe(1)
    expect(client.includes("console.log")).toBe(false)
    expect(client.includes("console.info")).toBe(false)
    // A failed response's body is never echoed - status only.
    expect(client).toMatch(/throw new Error\(`HTTP \$\{response\.status\}`\)/)
  })

  it("the source migration tells the operator to dispatch WORKFLOW B, not the ordinary safe deploy", () => {
    expect(migrate).toContain("NEXT APPROVED STEP: dispatch WORKFLOW B")
    expect(migrate).toContain("goalx-render-safe-deploy-handoff.yml")
    expect(migrate).toContain("prod:deploy:safe -- --handoff")
    expect(migrate).toContain("The ORDINARY safe deploy is NOT the next step")
  })

  it("no stale claim that the migration resumes Cron or verifies it active", () => {
    const migrationModule = readFileSync(join(ROOT, "src/lib/production/render-source-migration.ts"), "utf8")
    const code = migrationModule.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(code.includes("resumeCron")).toBe(false)
    expect(migrationModule).toContain("never resumes Cron at all - success included")
  })
})
