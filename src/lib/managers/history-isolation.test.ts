/**
 * Guards on what the historical readers must NOT do.
 *
 * Source-level, because these are properties about ABSENT dependencies -
 * which cannot be observed from a return value, and which a future
 * contributor is most likely to reintroduce by reaching for the obvious
 * shortcut. Every one of the forbidden things below produces a
 * plausible-looking wrong answer rather than an error.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Source with comments stripped - these modules DOCUMENT the rules they follow. */
function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const HISTORICAL_READERS: [string, string[]][] = [
  ["career.ts", ["lib", "managers", "career.ts"]],
  ["profile.ts", ["lib", "managers", "profile.ts"]],
  ["trophies.ts", ["lib", "managers", "trophies.ts"]],
  ["clubs/history.ts", ["lib", "clubs", "history.ts"]],
  ["championship.ts", ["lib", "trophies", "championship.ts"]],
]

describe("historical readers never use current ownership", () => {
  for (const [label, path] of HISTORICAL_READERS) {
    it(`${label} never reads Team.userId or Team.isBot`, () => {
      const source = readCode(...path)
      // The classic shortcut: prisma.team.findUnique({ where: { userId } }).
      expect(source).not.toMatch(/where:\s*\{\s*userId\s*\}/)
      expect(source).not.toMatch(/team\.userId|\.isBot/)
      expect(source).not.toMatch(/isBot:\s*(true|false)/)
    })
  }

  it("the career reader enters through TeamEra", () => {
    const source = readCode("lib", "managers", "profile.ts")
    expect(source).toContain("prisma.teamEra.findMany")
    expect(source).toMatch(/where:\s*\{\s*userId,\s*type:\s*"HUMAN"\s*\}/)
  })

  it("the manager cabinet enters through SeasonChampion, filtered by the ERA", () => {
    const source = readCode("lib", "managers", "trophies.ts")
    expect(source).toContain("prisma.seasonChampion.findMany")
    expect(source).toContain('teamEra: { is: { type: "HUMAN", userId } }')
  })

  it("the club cabinet enters through SeasonChampion, filtered by teamId", () => {
    const source = readCode("lib", "clubs", "history.ts")
    expect(source).toContain("prisma.seasonChampion.findMany")
    expect(source).toContain("where: { teamId }")
  })
})

describe("historical readers never recompute a result", () => {
  for (const [label, path] of HISTORICAL_READERS) {
    it(`${label} never calls computeStandings and never sorts by name`, () => {
      const source = readCode(...path)
      expect(source).not.toContain("computeStandings")
      expect(source).not.toContain("localeCompare")
      // A cabinet must not derive a winner - SeasonChampion already says.
      expect(source).not.toContain("resolveDivisionTitle")
      expect(source).not.toContain("buildTitleTable")
    })
  }
})

describe("the historical club name is the snapshot", () => {
  it("championship.ts prefers clubNameAtDecision and flags the fallback", () => {
    const source = readCode("lib", "trophies", "championship.ts")
    // The snapshot first, the current name only as a stated fallback.
    expect(source).toContain("clubNameAtDecision ?? row.team.name")
    expect(source).toContain("clubNameIsHistorical: row.clubNameAtDecision !== null")
  })

  it("no reader silently substitutes the current club name for the snapshot", () => {
    for (const [, path] of HISTORICAL_READERS) {
      const source = readCode(...path)
      // team.name may only appear as the guarded fallback above.
      const uses = [...source.matchAll(/team\.name/g)]
      const guarded = [...source.matchAll(/clubNameAtDecision \?\? row\.team\.name/g)]
      expect(uses.length).toBe(guarded.length)
    }
  })

  it("nothing writes the snapshot back", () => {
    for (const [, path] of HISTORICAL_READERS) {
      const source = readCode(...path)
      expect(source).not.toMatch(/seasonChampion\.(update|create|upsert|delete)/)
      expect(source).not.toMatch(/team\.(update|create|upsert|delete)\(/)
      expect(source).not.toMatch(/teamEra\.(update|create|upsert|delete)/)
    }
  })
})

describe("the career layer is pure", () => {
  it("career.ts reaches no database and no clock", () => {
    const source = readCode("lib", "managers", "career.ts")
    expect(source).not.toMatch(/from "@\/lib\/prisma"/)
    expect(source).not.toMatch(/new Date\(|Date\.now\(/)
  })

  it("it reuses the canonical attribution rule rather than re-implementing it", () => {
    const source = readCode("lib", "managers", "career.ts")
    expect(source).toContain("computeManagerRecord")
    expect(source).toContain('from "@/lib/teams/era"')
    // No second copy of the half-open window.
    expect(source).not.toMatch(/startedAt\.getTime\(\)\s*<=|endedAt\.getTime\(\)\s*>/)
  })

  it("win percentage is derived, never stored", () => {
    const source = readCode("lib", "managers", "career.ts")
    expect(source).toContain("record.wins / record.matches")
    expect(source).not.toMatch(/winPercentage:\s*\d/)
  })
})

describe("the profile reader cannot see a live match", () => {
  it("the fixture read is bounded by the live-window cutoff, in SQL", () => {
    const source = readCode("lib", "managers", "profile.ts")
    expect(source).toContain("MATCH_REAL_DURATION_MINUTES")
    expect(source).toContain("scheduledAt: { gte: earliest, lte: liveWindowCutoff }")
    expect(source).toContain("playedAt: { not: null }")
  })

  it("it never decides finishedness from playedAt alone", () => {
    const source = readCode("lib", "managers", "profile.ts")
    // playedAt is a readiness check beside the clock rule, never instead of it.
    expect(source).not.toMatch(/if\s*\(\s*\w*\.?playedAt\s*\)\s*\{[\s\S]{0,120}record/)
  })

  it("ONE fixture query, and it takes the WHOLE era list", () => {
    const source = readCode("lib", "managers", "profile.ts")
    expect(source.match(/prisma\.fixture\.findMany/g)).toHaveLength(1)

    // Structural, not textual proximity: the single query lives inside
    // loadCareerFixtures, which is handed every era at once and queries by
    // `teamId IN (...)`. A per-era read would have to pass one era instead.
    const fn = source.slice(source.indexOf("async function loadCareerFixtures"))
    expect(fn).toContain("prisma.fixture.findMany")
    expect(fn).toContain("homeTeamId: { in: teamIds }")
    expect(fn).toContain("awayTeamId: { in: teamIds }")

    // And it is called once, on the era list, before any per-era work.
    expect(source).toContain("await loadCareerFixtures(eras, now)")
    expect(source.match(/loadCareerFixtures\(/g)).toHaveLength(2)
  })
})
