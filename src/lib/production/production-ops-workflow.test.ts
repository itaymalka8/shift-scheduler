/**
 * BOUNDARY TESTS FOR .github/workflows/production-ops.yml.
 *
 * The workflow is the one place where a Production command can be started by
 * someone who is not sitting at a shell with the credentials in hand, so the
 * question these tests answer is narrow and specific: WHICH COMMANDS CAN A
 * DISPATCHER REACH, AND WITH WHAT IN SCOPE?
 *
 * The properties pinned here are the ones that have already failed once in this
 * project's history: backup deletion was previously a dropdown option whose
 * only gate was "branch_ids must be non-empty" - satisfied by the same dispatch
 * it was meant to restrain. These assertions exist so that shape cannot return
 * unnoticed for any command.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..")
const WORKFLOW_PATH = join(ROOT, ".github/workflows/production-ops.yml")
const workflow = readFileSync(WORKFLOW_PATH, "utf8")

/** The dropdown values, read out of the YAML rather than restated here. */
function dropdownOptions(): string[] {
  const start = workflow.indexOf("        options:")
  const rest = workflow.slice(start).split("\n").slice(1)
  const options: string[] = []
  for (const line of rest) {
    const match = /^\s{10}- (\S+)$/.exec(line)
    if (!match) break
    options.push(match[1])
  }
  return options
}

/**
 * The body of one job block: its header line up to the next top-level job
 * header. Line-based rather than regex-over-the-whole-file, so a comment
 * containing a colon cannot silently extend a block into the next job - which
 * would make an "X is absent from this job" assertion pass for the wrong reason.
 */
function jobBlock(name: string): string {
  const lines = workflow.split("\n")
  const isJobHeader = (line: string) => /^ {2}[a-z][a-z-]*:$/.test(line)
  const start = lines.findIndex((line) => line === `  ${name}:`)
  expect(start).toBeGreaterThan(-1)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (isJobHeader(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

/**
 * A job's EXECUTABLE lines only. Comments are stripped because the workflow
 * documents the absence of PRODUCTION_WRITE_CONFIRM from the read-only job in
 * a comment inside that job - an assertion that failed on its own explanation
 * would push someone to delete the explanation rather than keep the property.
 */
function executableJob(name: string): string {
  return jobBlock(name)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
}

describe("the workflow is manual-only", () => {
  it("triggers on workflow_dispatch and nothing else", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m)
    for (const trigger of ["  push:", "  pull_request:", "  schedule:", "  repository_dispatch:"]) {
      expect(workflow.includes(`\n${trigger}`)).toBe(false)
    }
  })
})

describe("prod:render:source-migrate is reachable ONLY as a dry run", () => {
  it("appears in the dropdown as the bare npm script name", () => {
    expect(dropdownOptions()).toContain("prod:render:source-migrate")
  })

  it("no dropdown value carries a flag, an argument separator, or --execute", () => {
    for (const option of dropdownOptions()) {
      expect(option).toMatch(/^[a-z0-9:-]+$/)
      expect(option.includes("--")).toBe(false)
      expect(option.includes(" ")).toBe(false)
    }
  })

  it("every dropdown value is a real npm script - an unrecognised one could not run anyway", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>
    for (const option of dropdownOptions()) {
      expect(`${option}:${Object.hasOwn(scripts, option)}`).toBe(`${option}:true`)
    }
  })

  it("the npm script it maps to does NOT pass --execute", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>
    expect(scripts["prod:render:source-migrate"]).toBe("tsx scripts/production/render-source-migrate.ts")
    expect(scripts["prod:render:source-migrate"].includes("--execute")).toBe(false)
  })

  it("the run step is still the unchanged, quoted single-command form", () => {
    // Quoted, so a value containing spaces stays ONE argument rather than
    // becoming a script name plus flags.
    expect(workflow).toContain('run: npm run "$COMMAND"')
    // Exactly one RUN STEP of that form (the header comment quotes it too).
    expect(workflow.match(/^ +run: npm run "\$COMMAND"$/gm) ?? []).toHaveLength(1)
  })

  it("routes to the read-only job, because that job excludes only the three write commands", () => {
    const guard = workflow.slice(workflow.indexOf("  read-only:"), workflow.indexOf("runs-on", workflow.indexOf("  read-only:")))
    expect(guard).toContain("prod:deploy:safe")
    expect(guard).toContain("prod:render:autodeploy:off")
    expect(guard).toContain("prod:backup:create")
    // Not named in the exclusion list, so it falls through to read-only.
    expect(guard.includes("prod:render:source-migrate")).toBe(false)
  })

  it("gets no dedicated write job of its own", () => {
    const jobNames = workflow
      .split("\n")
      .filter((line) => /^ {2}[a-z][a-z-]*:$/.test(line))
      .map((line) => line.trim().replace(":", ""))
    expect(jobNames).toEqual(["read-only", "autodeploy-off", "backup-create", "safe-deploy"])
  })
})

describe("the read-only job cannot mutate Production", () => {
  const readOnly = executableJob("read-only")

  it("never sets PRODUCTION_WRITE_CONFIRM", () => {
    expect(readOnly.includes("PRODUCTION_WRITE_CONFIRM")).toBe(false)
  })

  it("keeps its existing shared credential contract unchanged", () => {
    for (const key of ["RENDER_API_KEY", "NEON_API_KEY", "PRODUCTION_DATABASE_URL"]) {
      expect(readOnly).toContain(`${key}: \${{ secrets.${key} }}`)
    }
  })

  it("passes only COMMAND and PRUNE_BRANCH_IDS as non-secret inputs", () => {
    const env = readOnly.slice(readOnly.indexOf("        env:", readOnly.indexOf("Run production command")))
    expect(env).toContain("COMMAND: ${{ github.event.inputs.command }}")
    expect(env).toContain("PRUNE_BRANCH_IDS: ${{ github.event.inputs.branch_ids }}")
    // No other dispatch input reaches the command.
    expect((env.match(/github\.event\.inputs\./g) ?? []).length).toBe(2)
  })
})

describe("PRODUCTION_WRITE_CONFIRM stays confined to the three write jobs", () => {
  it("appears only in autodeploy-off, backup-create and safe-deploy", () => {
    for (const job of ["autodeploy-off", "backup-create", "safe-deploy"]) {
      expect(`${job}:${executableJob(job).includes("PRODUCTION_WRITE_CONFIRM: I_UNDERSTAND_THIS_CHANGES_PRODUCTION")}`).toBe(`${job}:true`)
    }
    // And exactly three assignments in the whole file - one per write job.
    const executable = workflow
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n")
    expect(executable.match(/PRODUCTION_WRITE_CONFIRM: I_UNDERSTAND_THIS_CHANGES_PRODUCTION/g) ?? []).toHaveLength(3)
  })

  it("backup deletion is still absent from the dropdown entirely", () => {
    expect(dropdownOptions()).not.toContain("prod:backup:prune:execute")
    expect(dropdownOptions()).toContain("prod:backup:prune")
  })
})

describe("only two dispatch inputs exist", () => {
  it("command and branch_ids, and nothing that could carry a flag to a script", () => {
    const inputs = workflow.slice(workflow.indexOf("    inputs:"), workflow.indexOf("# ----"))
    const names = [...inputs.matchAll(/^ {6}([a-z_]+):\n/gm)].map((m) => m[1])
    expect(names).toEqual(["command", "branch_ids"])
  })
})
