/**
 * BOUNDARY TESTS FOR WORKFLOW C - the strict first baseline's dispatch surface.
 *
 * The workflow is the only way this command reaches Production without someone
 * holding the credentials at a shell, so the questions here are narrow: WHAT
 * CAN A DISPATCHER CHANGE, and WHAT CREDENTIALS ARE IN SCOPE FOR WHICH STEP?
 *
 * The reviewed bytes live in production/workflows/ rather than .github/, so
 * this copy can never be dispatched from this repository at all; the file
 * published to goalx-manager/main differs only in the pinned SHA, which does
 * not exist until this file is committed.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..")
const WORKFLOW_PATH = join(ROOT, "production/workflows/goalx-economy-first-baseline.yml")
const workflow = readFileSync(WORKFLOW_PATH, "utf8")

/** The header documents what the workflow must NOT do, so it is stripped before scanning for those things. */
const body = workflow
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n")

describe("Workflow C - dispatch surface", () => {
  it("is MANUAL DISPATCH ONLY", () => {
    expect(body).toMatch(/^on:\n\s+workflow_dispatch:\s*$/m)
  })

  it("has NO automatic trigger of any kind", () => {
    for (const trigger of ["push:", "pull_request:", "schedule:", "repository_dispatch:", "workflow_run:", "workflow_call:", "issue_comment:"]) {
      expect(body).not.toContain(trigger)
    }
  })

  it("accepts NO dispatcher inputs - no command, ref, SHA, mode or argument", () => {
    expect(body).not.toContain("inputs:")
    expect(body).not.toMatch(/github\.event\.inputs/)
    expect(body).not.toMatch(/inputs\./)
  })

  it("grants contents: read and nothing more", () => {
    expect(body).toMatch(/^permissions:\n\s+contents: read\s*$/m)
    for (const scope of ["contents: write", "packages:", "id-token:", "actions: write", "deployments:"]) {
      expect(body).not.toContain(scope)
    }
  })
})

describe("Workflow C - checkout", () => {
  it("pins the checkout to an immutable SHA placeholder, never a branch head", () => {
    expect(body).toMatch(/ref: __TOOLING_SHA__/)
    expect(body).not.toMatch(/ref:\s*(main|master|HEAD|refs\/heads)/)
    // Exactly one ref: line, so there is one thing to pin and one thing to review.
    expect((body.match(/^\s+ref:/gm) ?? []).length).toBe(1)
  })

  it("does NOT persist the checkout credential", () => {
    expect(body).toMatch(/persist-credentials: false/)
    expect(body).not.toMatch(/persist-credentials: true/)
  })
})

describe("Workflow C - credentials are confined to the one command step", () => {
  /** Every `env:` block in the file, paired with the step name above it. */
  function envBlocks(): { step: string; keys: string[] }[] {
    const lines = body.split("\n")
    const blocks: { step: string; keys: string[] }[] = []
    let step = "(job)"
    for (let i = 0; i < lines.length; i++) {
      const name = /^\s+- name: (.+)$/.exec(lines[i])
      if (name) step = name[1].trim()
      if (/^\s+env:\s*$/.test(lines[i])) {
        const keys: string[] = []
        for (let j = i + 1; j < lines.length; j++) {
          const entry = /^\s+([A-Z_][A-Z0-9_]*):/.exec(lines[j])
          if (!entry) break
          keys.push(entry[1])
        }
        blocks.push({ step, keys })
      }
    }
    return blocks
  }

  it("declares env on EXACTLY ONE step", () => {
    expect(envBlocks()).toHaveLength(1)
  })

  it("gives that step the four required values and no others", () => {
    const [block] = envBlocks()
    expect(block.step).toContain("prod:economy:first-baseline")
    expect([...block.keys].sort()).toEqual(["GITHUB_TOKEN", "PRODUCTION_DATABASE_URL", "PRODUCTION_WRITE_CONFIRM", "RENDER_API_KEY"])
  })

  it("NEVER gives this workflow NEON_API_KEY - a Neon branch cannot be created or deleted", () => {
    // The header explains the omission; the BODY must not contain the name at all.
    expect(body).not.toContain("NEON_API_KEY")
    expect(workflow).toContain("# NO NEON_API_KEY")
  })

  it("fixes PRODUCTION_WRITE_CONFIRM to the exact literal, never to an input", () => {
    expect(body).toMatch(/PRODUCTION_WRITE_CONFIRM: I_UNDERSTAND_THIS_CHANGES_PRODUCTION\s*$/m)
  })

  it("never puts a credential on the checkout, setup or install step", () => {
    const [block] = envBlocks()
    expect(block.step).not.toMatch(/Checkout|Setup|Install/)
  })
})

describe("Workflow C - what it runs", () => {
  it("runs ONE fixed literal production command", () => {
    const runs = (body.match(/^\s+run: (.+)$/gm) ?? []).map((line) => line.replace(/^\s+run:\s*/, ""))
    expect(runs).toEqual(["npm ci", "npm run prod:economy:first-baseline"])
  })

  it("runs the STRICT first baseline, never the idempotent one", () => {
    expect(body).toContain("npm run prod:economy:first-baseline")
    expect(body).not.toMatch(/npm run prod:economy:baseline(\s|$)/)
  })

  it("performs NO backup, NO deploy, NO Render change and NO second baseline", () => {
    for (const forbidden of ["prod:backup", "prod:deploy", "prod:render", "prod:cron", "second-baseline"]) {
      expect(body).not.toContain(forbidden)
    }
  })

  it("does NOT chain: nothing here dispatches or waits on another workflow", () => {
    for (const chaining of ["actions/github-script", "gh workflow run", "workflow_dispatch:\n        inputs", "needs:"]) {
      expect(body).not.toContain(chaining)
    }
  })

  it("is not reachable from this repository - the reviewed copy is outside .github/workflows", () => {
    expect(WORKFLOW_PATH).toContain("production/workflows")
    expect(WORKFLOW_PATH).not.toContain(".github")
  })
})
