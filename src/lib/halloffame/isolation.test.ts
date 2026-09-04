/**
 * Guards on what the Hall of Fame must NOT do.
 *
 * Source-level, because these are properties about ABSENT dependencies, which
 * no return value can show. Every forbidden thing below produces a
 * plausible-looking wrong leaderboard rather than an error - the worst kind of
 * bug for a page whose whole purpose is to be trusted.
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

const HALL_OF_FAME: [string, string[]][] = [
  ["leaderboards.ts", ["lib", "halloffame", "leaderboards.ts"]],
  ["queries.ts", ["lib", "halloffame", "queries.ts"]],
  ["page.tsx", ["app", "hall-of-fame", "page.tsx"]],
]

describe("the Hall of Fame never uses current ownership", () => {
  for (const [label, path] of HALL_OF_FAME) {
    it(`${label} never reads Team.userId or Team.isBot`, () => {
      const source = readCode(...path)
      expect(source).not.toMatch(/where:\s*\{\s*userId\s*\}/)
      expect(source).not.toMatch(/team\.userId|\.isBot/)
      expect(source).not.toMatch(/isBot:\s*(true|false)/)
      // The other shape of the same mistake: asking the Team table who holds a club.
      expect(source).not.toMatch(/prisma\.team\.|tx\.team\./)
    })
  }

  it("the reader enters through TeamEra, filtered to HUMAN", () => {
    const source = readCode("lib", "halloffame", "queries.ts")
    expect(source).toContain("prisma.teamEra.findMany")
    expect(source).toContain('where: { type: "HUMAN", userId: { not: null } }')
  })

  it("championships are read whole, and never pre-filtered by era type in SQL", () => {
    const source = readCode("lib", "halloffame", "queries.ts")
    expect(source).toContain("prisma.seasonChampion.findMany")
    // A `where` on the championship read would silently decide credit in SQL,
    // where neither championship board can be tested against it.
    const call = source.slice(source.indexOf("prisma.seasonChampion.findMany"))
    expect(call.slice(0, 200)).not.toContain("where:")
  })
})

describe("the Hall of Fame never recomputes a sporting result", () => {
  for (const [label, path] of HALL_OF_FAME) {
    it(`${label} never derives a winner or a table`, () => {
      const source = readCode(...path)
      expect(source).not.toContain("computeStandings")
      expect(source).not.toContain("resolveDivisionTitle")
      expect(source).not.toContain("buildTitleTable")
    })
  }

  it("it reuses the canonical attribution rule rather than re-implementing it", () => {
    const source = readCode("lib", "halloffame", "leaderboards.ts")
    expect(source).toContain("computeManagerRecord")
    expect(source).toContain('from "@/lib/teams/era"')
    expect(source).toContain("sumRecords")
    expect(source).toContain("winPercentage")
    // No second copy of the half-open window.
    expect(source).not.toMatch(/startedAt\.getTime\(\)\s*<=|scheduledAt[\s\S]{0,40}endedAt/)
  })
})

describe("no new source of truth", () => {
  for (const [label, path] of HALL_OF_FAME) {
    it(`${label} touches no summary, trophy or achievement table`, () => {
      const source = readCode(...path)
      expect(source).not.toMatch(/managerCareerStats|ManagerCareerStats/)
      expect(source).not.toMatch(/prisma\.trophy|model Trophy/)
      expect(source).not.toMatch(/prisma\.achievement|Achievement/)
      expect(source).not.toMatch(/hallOfFame(Entry|Cache|Row)\./)
    })

    it(`${label} writes nothing`, () => {
      const source = readCode(...path)
      expect(source).not.toMatch(/\.(update|create|upsert|delete|createMany|updateMany|deleteMany)\(/)
      expect(source).not.toMatch(/\$executeRaw|\$transaction/)
    })
  }
})

describe("no name or locale collation decides a sporting rank", () => {
  it("localeCompare appears ONLY as the technical display order inside a tie", () => {
    const source = readCode("lib", "halloffame", "leaderboards.ts")
    const uses = [...source.matchAll(/localeCompare/g)]
    expect(uses).toHaveLength(1)

    // And that one use lives in rankEntries, comparing displayKey - never a name.
    const fn = source.slice(source.indexOf("export function rankEntries"))
    expect(fn.slice(0, 600)).toContain("displayKey(a).localeCompare(displayKey(b))")
    expect(source).not.toMatch(/name.*localeCompare|localeCompare.*\.name/)
  })

  it("every displayKey passed to rankEntries is an immutable id", () => {
    const source = readCode("lib", "halloffame", "leaderboards.ts")
    const keys = [...source.matchAll(/\(e\) => e\.([A-Za-z.]+)\s*\n?\s*\)/g)].map((m) => m[1])
    // manager.userId, club.id, eraId - ids only. A `.name` here would be a bug.
    for (const key of keys) expect(key).toMatch(/(^|\.)(id|userId|eraId)$/)
    expect(keys.length).toBeGreaterThanOrEqual(6)
  })

  it("the page never re-sorts a leaderboard it was given", () => {
    const source = readCode("app", "hall-of-fame", "page.tsx")
    expect(source).not.toContain("localeCompare")
    expect(source).not.toMatch(/\.sort\(/)
  })

  it("the page renders the rank it was given, never an array index", () => {
    const source = readCode("app", "hall-of-fame", "page.tsx")
    expect(source).toContain("row.rank")
    // `(entry, i) => ... i + 1` as a rank is the mistake this forbids.
    expect(source).not.toMatch(/\{\s*(i|index|idx)\s*\+\s*1\s*\}/)
  })
})

describe("the pure layer is pure", () => {
  it("leaderboards.ts reaches no database and no clock", () => {
    const source = readCode("lib", "halloffame", "leaderboards.ts")
    expect(source).not.toMatch(/from "@\/lib\/prisma"/)
    expect(source).not.toMatch(/new Date\(|Date\.now\(/)
  })

  it("every leaderboard takes now as a parameter, so one instant measures the page", () => {
    const source = readCode("lib", "halloffame", "leaderboards.ts")
    expect(source).toContain("now: Date")
    expect(source).toContain("era.endedAt ?? now")
  })
})

describe("the Hall of Fame cannot see a live match", () => {
  it("the fixture read is bounded by the live-window cutoff, in SQL", () => {
    const source = readCode("lib", "halloffame", "queries.ts")
    expect(source).toContain("MATCH_REAL_DURATION_MINUTES")
    expect(source).toContain("scheduledAt: { gte: earliest, lte: liveWindowCutoff }")
    expect(source).toContain("playedAt: { not: null }")
  })

  it("it never decides finishedness from playedAt alone", () => {
    const source = readCode("lib", "halloffame", "queries.ts")
    expect(source).not.toMatch(/if\s*\(\s*\w*\.?playedAt\s*\)\s*\{[\s\S]{0,120}record/)
  })
})

describe("no N+1 leaderboard", () => {
  const source = () => readCode("lib", "halloffame", "queries.ts")

  it("THREE queries for the whole board, whatever the number of managers", () => {
    expect(source().match(/prisma\.\w+\.findMany/g)).toHaveLength(3)
    expect(source().match(/prisma\.teamEra\.findMany/g)).toHaveLength(1)
    expect(source().match(/prisma\.seasonChampion\.findMany/g)).toHaveLength(1)
    expect(source().match(/prisma\.fixture\.findMany/g)).toHaveLength(1)
  })

  it("the fixture query takes the WHOLE era list and filters by teamId IN (...)", () => {
    const fn = source().slice(source().indexOf("async function loadCareerFixtures"))
    expect(fn).toContain("prisma.fixture.findMany")
    expect(fn).toContain("homeTeamId: { in: teamIds }")
    expect(fn).toContain("awayTeamId: { in: teamIds }")
    // Called once, on the era list - a per-manager read would pass one manager.
    expect(source()).toContain("await loadCareerFixtures(humanEras, now)")
    expect(source().match(/loadCareerFixtures\(/g)).toHaveLength(2)
  })

  it("no query sits inside a loop or a map", () => {
    const code = source()
    expect(code).not.toMatch(/for\s*\([\s\S]{0,300}await prisma\./)
    expect(code).not.toMatch(/\.map\(\s*async[\s\S]{0,200}prisma\./)
    expect(code).not.toContain("Promise.all(")
  })
})
