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

/**
 * The player modules. Held apart from HALL_OF_FAME above because the
 * manager-only guards do not apply to them verbatim: player-queries.ts reads
 * prisma.team on purpose, for club NAMES, which the manager reader is forbidden
 * from doing because it would be asking the Team table who holds a club. The
 * guards that DO apply to both are run over EVERY_MODULE.
 */
const PLAYER_HALL_OF_FAME: [string, string[]][] = [
  ["players.ts", ["lib", "halloffame", "players.ts"]],
  ["player-queries.ts", ["lib", "halloffame", "player-queries.ts"]],
]

const EVERY_MODULE = [...HALL_OF_FAME, ...PLAYER_HALL_OF_FAME]

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
  for (const [label, path] of EVERY_MODULE) {
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


/**
 * PHASE 3G. The player boards answer a different question from the manager
 * boards, and can be wrong in ways the manager guards above cannot see: a
 * career attributed to a club the player has since left, a goal recounted from
 * MatchEvent, a retired player quietly filtered out.
 */
describe("a player's history is never attributed to their CURRENT club", () => {
  it("the pure layer is never handed Player.teamId at all", () => {
    const source = readCode("lib", "halloffame", "players.ts")
    // The record type carries teamId - the club of THAT match - and nothing
    // that could carry current ownership. `currentTeam`/`player.teamId` here
    // would be the whole bug.
    expect(source).not.toMatch(/currentTeam|currentClub/)
    expect(source).not.toMatch(/player\.teamId|\.player\.teamId/)
    expect(source).toContain("teamId: string")
  })

  it("the reader never selects Player.teamId, so it cannot leak into a career", () => {
    const source = readCode("lib", "halloffame", "player-queries.ts")
    const playerRead = source.slice(source.indexOf("prisma.player.findMany"))
    const select = playerRead.slice(playerRead.indexOf("select:"), playerRead.indexOf("})"))
    expect(select).toContain("firstName")
    expect(select).not.toContain("teamId")
  })

  it("historical club comes from the stats row's teamId", () => {
    const source = readCode("lib", "halloffame", "player-queries.ts")
    const statsRead = source.slice(source.indexOf("prisma.playerMatchStats.findMany"))
    expect(statsRead.slice(0, 600)).toContain("teamId: true")
  })
})

describe("a career is grouped by playerId and nothing else", () => {
  it("the aggregation keys on playerId alone", () => {
    const source = readCode("lib", "halloffame", "players.ts")
    // A composite key is how a transferred player silently becomes two people.
    expect(source).toContain("careers.get(record.playerId)")
    expect(source).not.toMatch(/`\$\{record\.playerId\}[^`]*\$\{record\.teamId\}/)
    expect(source).not.toMatch(/careers\.get\([^)]*teamId/)
  })

  it("appearances are counted, never DISTINCTed", () => {
    const source = readCode("lib", "halloffame", "players.ts")
    expect(source).toContain("career.appearances += 1")
    expect(source).not.toMatch(/distinct/i)
  })
})

describe("a retired player is never filtered out", () => {
  it("neither module ever tests careerStatus to decide inclusion", () => {
    for (const [, path] of PLAYER_HALL_OF_FAME) {
      const source = readCode(...path)
      expect(source).not.toMatch(/careerStatus:\s*"?(ACTIVE|RETIRED)"?/)
      expect(source).not.toMatch(/careerStatus\s*===\s*"ACTIVE"/)
      expect(source).not.toMatch(/careerStatus:\s*\{/)
    }
  })

  it("the reader selects careerStatus only to label the row", () => {
    const source = readCode("lib", "halloffame", "player-queries.ts")
    expect(source).toContain("careerStatus: true")
    // and never as a where clause on the player read
    const playerRead = source.slice(source.indexOf("prisma.player.findMany"))
    const where = playerRead.slice(playerRead.indexOf("where:"), playerRead.indexOf("select:"))
    expect(where).not.toContain("careerStatus")
  })
})

describe("goals and ratings have exactly one source", () => {
  it("no player board is ever recounted from MatchEvent", () => {
    for (const [, path] of PLAYER_HALL_OF_FAME) {
      const source = readCode(...path)
      expect(source).not.toMatch(/matchEvent|MatchEvent/)
      expect(source).not.toMatch(/type:\s*"GOAL"/)
    }
  })

  it("the rating is read, never recomputed", () => {
    for (const [, path] of PLAYER_HALL_OF_FAME) {
      const source = readCode(...path)
      expect(source).not.toMatch(/calculateMatchRating/)
    }
  })

  it("the average rating is never persisted or cached", () => {
    for (const [, path] of PLAYER_HALL_OF_FAME) {
      const source = readCode(...path)
      expect(source).not.toMatch(/averageRating:\s*\{?\s*(set|increment)/)
      expect(source).not.toMatch(/unstable_cache|revalidate|cache\(/)
    }
  })
})

describe("the player pure layer is pure", () => {
  it("players.ts reaches no database and no clock", () => {
    const source = readCode("lib", "halloffame", "players.ts")
    expect(source).not.toMatch(/from "@\/lib\/prisma"/)
    expect(source).not.toMatch(/new Date\(|Date\.now\(/)
  })

  it("the threshold is one exported constant, stated once", () => {
    const source = readCode("lib", "halloffame", "players.ts")
    expect(source.match(/MIN_APPEARANCES_FOR_RATING = /g)).toHaveLength(1)
    // and the page states it to the reader rather than hard-coding a number
    const page = readCode("app", "hall-of-fame", "page.tsx")
    expect(page).toContain("players.minimumAppearancesForRating")
    expect(page).not.toMatch(/min:\s*"20"/)
  })
})

describe("the player boards cannot see a live match", () => {
  it("the stats read is gated on the fixture's live window, in SQL", () => {
    const source = readCode("lib", "halloffame", "player-queries.ts")
    expect(source).toContain("MATCH_REAL_DURATION_MINUTES")
    expect(source).toContain("playedAt: { not: null }")
    expect(source).toContain("lte: liveWindowCutoff")
    // Filtering after the fetch would still have pulled a live match into memory.
    expect(source).not.toMatch(/\.filter\([^)]*playedAt/)
  })
})

describe("no N+1 player board", () => {
  const source = () => readCode("lib", "halloffame", "player-queries.ts")

  it("THREE queries for every player board, whatever the number of players", () => {
    expect(source().match(/prisma\.\w+\.findMany/g)).toHaveLength(3)
    expect(source().match(/prisma\.playerMatchStats\.findMany/g)).toHaveLength(1)
    expect(source().match(/prisma\.player\.findMany/g)).toHaveLength(1)
    expect(source().match(/prisma\.team\.findMany/g)).toHaveLength(1)
  })

  it("identity and club reads are IN (...) over the ids the first query returned", () => {
    const code = source()
    expect(code).toContain("id: { in: playerIds }")
    expect(code).toContain("id: { in: teamIds }")
  })

  it("no query sits inside a loop or a map", () => {
    const code = source()
    expect(code).not.toMatch(/for\s*\([\s\S]{0,300}await prisma\./)
    expect(code).not.toMatch(/\.map\(\s*async[\s\S]{0,200}prisma\./)
  })
})

describe("no player board is unbounded", () => {
  it("every player board is cut to a fixed number of places", () => {
    const source = readCode("lib", "halloffame", "players.ts")
    // 844 players already have history in Production; an uncapped board is a
    // page of hundreds of rows.
    expect(source.match(/boardTop\(/g)).toHaveLength(4)
    expect(source.match(/PLAYER_BOARD_PLACES = /g)).toHaveLength(1)
    // Places alone are not a bound - a shared place can be any width - so a
    // row budget is required alongside them.
    expect(source.match(/PLAYER_BOARD_MAX_ROWS = /g)).toHaveLength(1)
    expect(source.match(/PLAYER_BOARD_MAX_ROWS\b/g)).toHaveLength(5)
  })

  it("the cut is by rank, so it can never split a tie", () => {
    const source = readCode("lib", "halloffame", "leaderboards.ts")
    const fn = source.slice(source.indexOf("export function boardTop"))
    const body = fn.slice(0, fn.indexOf("\n}"))
    // Groups are taken whole: the loop walks equal ranks, and a group that
    // does not fit is DESCRIBED rather than cut into.
    expect(body).toContain("ranked[end].rank === rank")
    expect(body).toContain("rows.length + group.length <= maxRows")
    expect(body).toContain("players: group.length")
    // The only slice is the whole group; there is no slice(0, n) truncation.
    expect(body.match(/\.slice\(/g)).toHaveLength(1)
    expect(body).toContain("ranked.slice(i, end)")
  })

  it("the cap is applied AFTER ranking, so a rank is a rank either way", () => {
    const source = readCode("lib", "halloffame", "players.ts")
    // boardTop wraps rankEntries, never the other way round.
    expect(source).not.toMatch(/rankEntries\([\s\S]{0,80}boardTop\(/)
    expect(source).toMatch(/boardTop\(\s*rankEntries\(/)
  })
})

describe("the page renders the player boards it was given", () => {
  const page = () => readCode("app", "hall-of-fame", "page.tsx")

  it("renders every player board", () => {
    for (const board of ["players.mostGoals", "players.mostAssists", "players.mostAppearances", "players.bestAverageRating"]) {
      expect(page()).toContain(board)
    }
  })

  it("measures both read models from ONE instant", () => {
    const code = page()
    expect(code.match(/const now = new Date\(\)/g)).toHaveLength(1)
    expect(code).toContain("loadHallOfFame(now)")
    expect(code).toContain("loadPlayerHallOfFame(now)")
  })

  it("formats the rating for display only, after the rank is decided", () => {
    const code = page()
    expect(code).toContain("ratings.format(row.value)")
    // Rounding BEFORE the rank would invent ties; the pure layer ranks the mean.
    expect(code).not.toMatch(/toFixed\(2\)[\s\S]{0,80}sort/)
  })
})
