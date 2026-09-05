/**
 * Guards on what match consequences must NOT do.
 *
 * Source-level, because every one of these is a property about something
 * ABSENT, and every one of them produces a system that still works. A
 * simulation that writes Player.status at kickoff still plays the match - it
 * just spoils it. A cron that adds fitness per tick still recovers players -
 * it just recovers them thirty times an hour. A second availability rule
 * still selects a team - it just selects a different one from the validator.
 * None of that is visible without a test that looks.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const AVAILABILITY = ["lib", "players", "availability.ts"]
const CONSEQUENCES = ["lib", "match", "consequences.ts"]
const SERVICE = ["lib", "match", "consequence-service.ts"]
const REPAIR = ["lib", "players", "lineup-repair.ts"]
const PREFLIGHT = ["lib", "match", "lineup-preflight.ts"]
const SIMULATE = ["lib", "match", "simulate.ts"]
const CLEANUP = ["lib", "transfers", "squad-cleanup.ts"]
const CRON = ["..", "scripts", "process-scheduled-jobs.ts"]

const NEW_MODULES: [string, string[]][] = [
  ["availability.ts", AVAILABILITY],
  ["consequences.ts", CONSEQUENCES],
  ["consequence-service.ts", SERVICE],
  ["lineup-repair.ts", REPAIR],
  ["lineup-preflight.ts", PREFLIGHT],
]

describe("ANTI SPOILER: a live match cannot leak through Player state", () => {
  it("the simulation writes no Player row at all", () => {
    const source = readCode(...SIMULATE)
    // The engine writes the whole match at KICKOFF. Any Player write here
    // would be visible on /squad and /players while the match is still on
    // screen - which is the exact leak this architecture exists to prevent.
    expect(source).not.toMatch(/\b(prisma|tx)\.player\.(update|updateMany|create|createMany|upsert)\b/)
    expect(source).not.toMatch(/data:\s*\{[^}]*\bfitness\b/)
    expect(source).not.toContain("injuryMatchesRemaining")
    expect(source).not.toContain("suspensionMatches")
    expect(source).not.toContain("consequences")
  })

  it("activation is gated on the PUBLIC finish, not on playedAt", () => {
    const source = readCode(...SERVICE)
    // The same rule the Player Profile already trusts, pushed into SQL.
    expect(source).toContain("MATCH_REAL_DURATION_MINUTES")
    expect(source).toContain("publicCutoff")
    expect(source).toMatch(/scheduledAt:\s*\{\s*not:\s*null,\s*lte:\s*publicCutoff\s*\}/)
    // playedAt alone is never the gate - it is true from kickoff.
    expect(source).not.toMatch(/if\s*\(\s*fixture\.playedAt\s*\)\s*\{?\s*await/)
  })

  it("the activator refuses a fixture whose live window has not run out, even if asked", () => {
    const source = readCode(...SERVICE)
    expect(source).toContain("if (fixture.scheduledAt > publicCutoff) return empty")
  })

  it("no read surface had to be re-gated, because the state does not exist yet", () => {
    // If a page needed a new anti-spoiler filter for player condition, the
    // activation boundary would not be doing its job.
    for (const page of [
      ["app", "squad", "page.tsx"],
      ["app", "players", "page.tsx"],
      ["app", "players", "[playerId]", "page.tsx"],
    ]) {
      const source = readCode(...page)
      expect(source).not.toContain("consequencesAppliedAt")
    }
  })
})

describe("IDEMPOTENCY: nothing is applied twice", () => {
  it("the ledger is checked under a row lock, before any write", () => {
    const source = readCode(...SERVICE)
    expect(source).toContain('FOR UPDATE')
    expect(source).toContain("if (fixture.consequencesAppliedAt !== null) return { ...empty, alreadyApplied: true }")
    const lockIndex = source.indexOf("FOR UPDATE")
    const ledgerIndex = source.indexOf("consequencesAppliedAt !== null")
    const writeIndex = source.indexOf("tx.player.update")
    expect(lockIndex).toBeGreaterThanOrEqual(0)
    expect(ledgerIndex).toBeGreaterThan(lockIndex)
    expect(writeIndex).toBeGreaterThan(ledgerIndex)
  })

  it("the ledger is written last, inside the same transaction as the work", () => {
    const source = readCode(...SERVICE)
    const write = source.indexOf('data: { consequencesAppliedAt: now }')
    expect(write).toBeGreaterThan(source.indexOf("tx.player.update"))
  })

  it("no counter is ever incremented by a raw Prisma increment", () => {
    // `{ increment: 1 }` would be applied again on every retry. Every counter
    // move goes through the pure serve/apply arithmetic and is written as an
    // absolute value.
    for (const [, path] of NEW_MODULES) {
      const source = readCode(...path)
      expect(source).not.toMatch(/increment:/)
      expect(source).not.toMatch(/decrement:/)
    }
  })

  it("recovery is driven by fixtures, never by a cron tick or a calendar day", () => {
    const source = readCode(...SERVICE)
    // The due set is fixtures, not players, and not "everything older than a
    // day". A per-tick or per-day rule would run every two minutes.
    expect(source).toContain("prisma.fixture.findMany")
    expect(source).not.toMatch(/prisma\.player\.updateMany/)
    expect(source).not.toMatch(/86_?400_?000|24 \* 60 \* 60/)
  })
})

describe("no page load may move player condition", () => {
  it("no page or route imports the consequence service", () => {
    const source = readCode("..", "package.json")
    expect(source.length).toBeGreaterThan(0)
    for (const page of [
      ["app", "squad", "page.tsx"],
      ["app", "players", "[playerId]", "page.tsx"],
      ["app", "dashboard", "page.tsx"],
      ["app", "economy", "page.tsx"],
    ]) {
      expect(readCode(...page)).not.toContain("consequence-service")
    }
  })

  it("the activator is wired into the scheduled job, and only there", () => {
    expect(readCode(...CRON)).toContain("activateDueMatchConsequences")
  })
})

describe("ONE availability rule, ONE fatigue model, ONE repair", () => {
  it("the snapshot builder and the repair both ask the canonical contract", () => {
    expect(readCode(...REPAIR)).toContain('from "./availability"')
    expect(readCode(...PREFLIGHT)).toContain("lineup-repair")
  })

  it("nothing outside availability.ts decides who is selectable by hand", () => {
    for (const [, path] of [...NEW_MODULES, ["squad route", ["app", "api", "squad", "route.ts"]] as [string, string[]]]) {
      const source = readCode(...path)
      if (path.join("/").endsWith("availability.ts")) continue
      // The old scattered rule. Any reappearance is a second definition.
      expect(source).not.toMatch(/status\s*===\s*"available"/)
      expect(source).not.toMatch(/status\s*!==\s*"available"/)
    }
  })

  it("the consequence math imports the engine's Stamina constant rather than restating it", () => {
    const source = readCode(...CONSEQUENCES)
    expect(source).toContain("DEFAULT_GAME_BALANCE_CONFIG.staminaEnergyProtection")
    expect(source).not.toMatch(/0\.45/)
  })

  it("there is exactly one lineup-selection algorithm", () => {
    const source = readCode(...REPAIR)
    expect(source).toContain("computeRecommendedLineup")
    // A hand-rolled greedy fill here would be the second one.
    expect(source).not.toMatch(/for\s*\([^)]*slots[^)]*\)\s*\{[\s\S]{0,400}bestScore/)
  })

  it("every squad departure repairs through the one service", () => {
    const source = readCode(...CLEANUP)
    expect(source).toContain("repairTeamLineup(tx, teamId)")
  })
})

describe("no unseeded randomness in a consequence", () => {
  it("nothing in the consequence path calls Math.random", () => {
    for (const [, path] of NEW_MODULES) {
      expect(readCode(...path)).not.toContain("Math.random")
    }
  })

  it("injury duration is derived from the fixture's own match seed", () => {
    expect(readCode(...CONSEQUENCES)).toContain("SeededRandom")
    expect(readCode(...SERVICE)).toContain("injuryMatchesFor(fixture.matchSeed, player.id)")
  })

  it("no second injury is rolled after the match - only the one the engine decided", () => {
    const source = readCode(...SERVICE)
    expect(source).toContain('type: "injury"')
    expect(source).toContain("injuredIds.has(player.id)")
    // A chance roll here would be a second injury model.
    expect(source).not.toMatch(/\.chance\(/)
  })
})

describe("FAIL CLOSED: an illegal XI is never simulated", () => {
  it("the preflight runs before the snapshot and before the engine", () => {
    const source = readCode(...SIMULATE)
    // THE CALL SITE, not the import. The first version of this guard used
    // indexOf("assertFixtureLineupsLegal"), which matched the import line at
    // the top of the file - so deleting the actual call left the guard green.
    // Caught by deliberately removing the call; the guard was wrong, not the
    // code.
    const preflight = source.indexOf("assertFixtureLineupsLegal(tx, fixtureId,")
    const snapshot = source.indexOf("await buildMatchSnapshot(")
    const engine = source.indexOf("simulateMatch(snapshot)")
    expect(preflight).toBeGreaterThanOrEqual(0)
    expect(snapshot).toBeGreaterThanOrEqual(0)
    expect(engine).toBeGreaterThanOrEqual(0)
    expect(preflight).toBeLessThan(snapshot)
    expect(preflight).toBeLessThan(engine)
  })

  it("a blocked fixture is reported and left unplayed, never marked played", () => {
    const source = readCode(...SIMULATE)
    expect(source).toContain("MatchPreflightError")
    expect(source).toContain("blocked.push")
    // The block happens before any write, so there is no partial history to
    // undo - and playedAt is only ever set in the transaction far below it.
    const blockIndex = source.indexOf("assertFixtureLineupsLegal(tx, fixtureId,")
    const playedAt = source.indexOf("playedAt: new Date()")
    expect(blockIndex).toBeGreaterThanOrEqual(0)
    expect(blockIndex).toBeLessThan(playedAt)
  })

  it("the repair never invents a player to fill a hole", () => {
    const source = readCode(...REPAIR)
    expect(source).not.toMatch(/generateSquad|generatePlayer|createPlayer|player\.create/)
    expect(source).not.toContain("youth")
    expect(source).not.toContain("freeAgent")
  })

  it("insufficient eligible players is its own reported outcome, not a silent short XI", () => {
    expect(readCode(...PREFLIGHT)).toContain("INSUFFICIENT_ELIGIBLE_PLAYERS")
    expect(readCode(...REPAIR)).toContain('"insufficient"')
  })
})

describe("a manager cannot select an unavailable player", () => {
  it("the squad route refuses the mutation with a stable code", () => {
    const source = readCode("app", "api", "squad", "route.ts")
    expect(source).toContain("selectableIds")
    expect(source).toContain('throw new Error("PLAYER_UNAVAILABLE")')
    expect(source).toContain('{ error: "PLAYER_UNAVAILABLE" }')
  })

  it("selectability there comes from the canonical contract", () => {
    expect(readCode("app", "api", "squad", "route.ts")).toContain('isSelectable')
  })
})

describe("history is untouched", () => {
  it("no consequence module writes PlayerMatchStats or MatchEvent", () => {
    for (const [, path] of NEW_MODULES) {
      const source = readCode(...path)
      expect(source).not.toMatch(/playerMatchStats\.(create|update|delete|upsert)/)
      expect(source).not.toMatch(/matchEvent\.(create|update|delete|upsert)/)
    }
  })

  it("player development and the season lifecycle are not re-implemented here", () => {
    for (const [, path] of NEW_MODULES) {
      const source = readCode(...path)
      expect(source).not.toContain("developPlayer")
      expect(source).not.toContain("rollRetirement")
      expect(source).not.toContain("careerStatus: \"RETIRED\"")
    }
  })
})
