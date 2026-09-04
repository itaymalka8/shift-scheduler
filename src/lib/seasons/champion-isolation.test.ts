/**
 * Guards on what championship code must NOT do. These are source-level
 * assertions because the properties are about absent dependencies, which
 * cannot be observed from a return value.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

/**
 * Source with comments removed.
 *
 * These modules DOCUMENT what they must never do - champion.ts names
 * localeCompare and Team.userId in its header precisely to say they are
 * forbidden - so a naive grep would trip over the prose that states the
 * rule. Stripping comments first means the guards check the CODE, which is
 * both the correct target and the stricter one.
 */
function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}
const read = readCode

describe("a championship is never decided by an identifier or a name", () => {
  it("the resolver contains no name comparison and no locale-aware sort", () => {
    const source = read("lib", "seasons", "champion.ts")
    expect(source).not.toMatch(/localeCompare/)
    expect(source).not.toMatch(/teamName|\.name\b/)
  })

  it("the resolver never sorts or compares by teamId", () => {
    const source = read("lib", "seasons", "champion.ts")
    // teamId appears as data (a map key, a returned winner) but never inside
    // a comparison: no `a.teamId <`, no `.teamId.localeCompare`, no sort on it.
    expect(source).not.toMatch(/teamId\s*[<>]/)
    expect(source).not.toMatch(/teamId\.localeCompare/)
    expect(source).not.toMatch(/sort\([^)]*teamId/)
  })

  it("the resolver reaches no database and no clock - it can only be a function of its inputs", () => {
    const source = read("lib", "seasons", "champion.ts")
    expect(source).not.toMatch(/from "@\/lib\/prisma"/)
    expect(source).not.toMatch(/new Date\(|Date\.now\(/)
  })
})

describe("title attribution uses eras, never current ownership", () => {
  it("champions.ts never reads Team.userId", () => {
    const source = read("lib", "seasons", "champions.ts")
    expect(source).not.toMatch(/team\.userId|userId:\s*true/)
  })

  it("the ONLY thing it reads off Team is the display-name snapshot", () => {
    // This guard used to forbid every Team read outright. That was the right
    // shape while nothing needed one; it is now too broad, because the club
    // name snapshot legitimately reads Team - so it is tightened to its
    // actual intent instead of relaxed. Attribution still comes from eras
    // alone; a Team read is permitted only for `name`, and only by id.
    const source = read("lib", "seasons", "champions.ts")
    const reads = [...source.matchAll(/tx\.team\.(\w+)\(([^)]*)\)/g)]
    expect(reads).toHaveLength(1)
    expect(reads[0][1]).toBe("findUnique")
    expect(reads[0][2]).toBe("{ where: { id: teamId }, select: { name: true } }")
    // No client-level Team access at all, and no write of any kind.
    expect(source).not.toMatch(/prisma\.team\./)
    expect(source).not.toMatch(/tx\.team\.(update|create|upsert|delete)/)
  })

  it("the snapshot never becomes the champion's identity", () => {
    const source = read("lib", "seasons", "champions.ts")
    // teamId is what is resolved and what is written as the champion.
    expect(source).toMatch(/const teamId = division\.outcome\.teamId/)
    expect(source).toMatch(/teamId,/)
    // The name is only ever assigned, never compared or searched on.
    expect(source).not.toMatch(/clubNameAtDecision\s*===|clubNameAtDecision\s*!==/)
    expect(source).not.toMatch(/where:\s*\{[^}]*clubNameAtDecision/)
  })

  it("champions.ts resolves ownership through the shared era rule rather than a second copy of it", () => {
    const source = read("lib", "seasons", "champions.ts")
    expect(source).toContain('instantBelongsToEra')
    expect(source).toContain('from "@/lib/teams/era"')
    // No re-implementation of the half-open window.
    expect(source).not.toMatch(/startedAt\.getTime\(\)|endedAt\.getTime\(\)/)
  })

  it("attribution is dated from scheduledAt, never playedAt", () => {
    const source = read("lib", "seasons", "champions.ts")

    // playedAt IS read - as a readiness check, exactly as countsTowardRecord
    // reads it: a match whose live window has elapsed but which the
    // scheduler never simulated has no result to crown anyone with. What it
    // must never be is the attribution INSTANT, so the rule asserted here is
    // that decidedAt is only ever assigned from a scheduledAt.
    const assignments = [...source.matchAll(/decidedAt:\s*([^,\n]+)/g)].map((m) => m[1].trim())
    expect(assignments.length).toBeGreaterThan(0)
    for (const value of assignments) {
      expect(value).not.toMatch(/playedAt/)
    }
    expect(source).toContain("decider.scheduledAt")
    expect(source).not.toMatch(/decidedAt\s*=\s*[^=]*playedAt/)
  })

  it("a decider only settles a title once it is genuinely finished", () => {
    const source = read("lib", "seasons", "champions.ts")
    // Both halves of the gate: the live window has played out AND a result
    // was actually stored. Either alone would crown a champion from a match
    // still on screen, or from one that was never simulated.
    expect(source).toContain("isMatchFinished(decider.scheduledAt, now)")
    expect(source).toContain("decider.playedAt")
  })
})

describe("the league table is the league's", () => {
  it("computeStandings filters on stage", () => {
    expect(read("lib", "leagues", "standings.ts")).toContain('stage: "LEAGUE"')
  })

  it("every count compared against the V1 double round-robin shape is league-scoped", () => {
    for (const source of [
      read("lib", "production-ops", "checks.ts"),
      read("lib", "seasons", "next-season.ts"),
    ]) {
      expect(source).toContain('stage: "LEAGUE"')
    }
  })
})

describe("Phase 2B creates no decider", () => {
  it("nothing in the championship code writes a fixture", () => {
    for (const file of [
      ["lib", "seasons", "champion.ts"],
      ["lib", "seasons", "champions.ts"],
    ]) {
      const source = read(...file)
      expect(source).not.toMatch(/fixture\.create|fixture\.createMany|fixture\.update|fixture\.delete/)
    }
  })

  it("the orchestrator leaves the season ACTIVE when a division is still tied", () => {
    const source = read("lib", "seasons", "orchestrator.ts")
    // The fail-closed branch returns before the transaction that would
    // change status, so no `status: "OFFSEASON"` write can be reached.
    const failClosed = source.indexOf("if (!champions.fullyResolved)")
    const transition = source.indexOf('data: { status: "OFFSEASON", offseasonStage: "PLAYER_LIFECYCLE" }')
    expect(failClosed).toBeGreaterThan(-1)
    expect(transition).toBeGreaterThan(failClosed)
  })
})

describe("a pre-deploy gate must not assume its own branch's schema", () => {
  it("preflight probes for Fixture.stage instead of querying it blindly", () => {
    // prod:preflight runs against Production BEFORE the migration it ships
    // alongside is applied, so a bare `where: { stage: ... }` makes it fail
    // on the very deploy that introduces the column. It did exactly that
    // once; this guard is why it will not again.
    const source = readFileSync(join(SRC, "..", "scripts", "production", "preflight.ts"), "utf8")
    expect(source).toContain("information_schema.columns")
    expect(source).toContain("column_name = 'stage'")
    expect(source).not.toMatch(/prisma\.fixture\.count\(\{\s*where:\s*\{\s*stage:/)
  })

  it("post-deploy-check may assume it, because the migration has already run by then", () => {
    // render.yaml's buildCommand is `prisma migrate deploy && npm run build`,
    // so the schema is current before the new server starts and before this
    // check runs.
    const render = readFileSync(join(SRC, "..", "render.yaml"), "utf8")
    expect(render).toMatch(/prisma migrate deploy\s*&&\s*npm run build/)
  })
})
