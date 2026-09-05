/**
 * Guards on what the Player Directory must NOT do.
 *
 * Source-level, because these are properties about ABSENT dependencies. Each
 * forbidden thing below produces a page that still renders - a directory that
 * quietly loads every player into the browser, one that identifies a profile
 * by name, one that issues a query per row - which is exactly why none of them
 * would be noticed without a test that looks.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { LOCALES, TRANSLATIONS, type Locale, type TranslationKey } from "@/lib/i18n/translations"
import { DIRECTORY_STATUSES } from "./directory"
import { PLAYER_POSITIONS } from "./positions"

const SRC = join(__dirname, "..", "..")

function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * One exported function's own body.
 *
 * These guards are about the shape of ONE reader's queries, not about what
 * else happens to live in the file - directory-queries.ts also holds the
 * Player Comparison's bounded selector search, which has its own reads and
 * its own guards. Slicing to the function keeps each guard asking the
 * question it actually means.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start + 1)
  const end = rest.indexOf("\nexport ")
  return end === -1 ? rest : rest.slice(0, end)
}

const PARAMS = ["lib", "players", "directory.ts"]
const READER = ["lib", "players", "directory-queries.ts"]
const PAGE = ["app", "players", "page.tsx"]
const EVERY_MODULE: [string, string[]][] = [
  ["directory.ts", PARAMS],
  ["directory-queries.ts", READER],
  ["page.tsx", PAGE],
]

describe("search happens in the database, never in the browser", () => {
  it("the term is escaped so LIKE wildcards are matched literally", () => {
    const source = readCode(...READER)
    // Prisma binds the term as a parameter - no injection - but does NOT
    // escape LIKE's own % and _, so an unescaped term is a correctness bug.
    expect(source).toContain("escapeLikeTerm(q)")
    expect(source).toContain("contains: term")
    expect(source).not.toMatch(/contains:\s*q\b/)
  })

  it("the reader filters with Prisma, not in memory", () => {
    const source = readCode(...READER)
    expect(source).toContain("mode: \"insensitive\"")
    // The three shapes of "load everything, then filter": no unbounded
    // findMany over players, no in-memory name matching, no client filter.
    expect(source).not.toMatch(/\.filter\([^)]*(firstName|lastName)/)
    expect(source).not.toMatch(/toLowerCase\(\)\.includes/)
  })

  it("the one player read is bounded by take and skip", () => {
    const page = functionBody(readCode(...READER), "loadPlayerDirectory")
    // Exactly one row-returning read of Player in the directory reader, and
    // it is paged.
    expect(page.match(/prisma\.player\.findMany/g)).toHaveLength(1)
    const read = page.slice(page.indexOf("prisma.player.findMany"))
    expect(read.slice(0, 400)).toContain("take: pageSize")
    expect(read.slice(0, 400)).toContain("skip: skipFor(")
  })

  it("the page is a server component and ships no player list to the client", () => {
    const source = readCode(...PAGE)
    expect(source).not.toContain('"use client"')
    expect(source).not.toMatch(/useState|useEffect|useMemo/)
  })

  it("the facet lists are grouped in SQL, never derived from a full table read", () => {
    const source = readCode(...READER)
    expect(source).toContain('groupBy({ by: ["nationality"]')
    expect(source).toContain('groupBy({ by: ["primaryPosition"]')
  })
})

describe("search text never reaches raw SQL", () => {
  for (const [label, path] of EVERY_MODULE) {
    it(`${label} issues no raw query at all`, () => {
      const source = readCode(...path)
      expect(source).not.toMatch(/\$queryRaw|\$executeRaw|Prisma\.sql|Prisma\.raw/)
    })
  }

  it("no SQL is assembled as a string anywhere", () => {
    const source = readCode(...READER)
    // Look for SQL inside a STRING LITERAL, not for the word anywhere -
    // identifiers like DIRECTORY_SELECT and buildDirectoryWhere legitimately
    // contain these words and matching them was the guard's own bug.
    const literals = [...source.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1])
    for (const literal of literals) {
      expect(literal).not.toMatch(/\b(select|insert|update|delete|where|ilike|like)\b\s/i)
    }
  })
})

describe("identity is Player.id, never a name", () => {
  it("the row link is built from the id", () => {
    expect(readCode(...PAGE)).toContain("href={`/players/${player.id}`}")
  })

  it("no directory module builds a link from a name, a shirt number or an index", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/\/players\/\$\{[^}]*(Name|name|shirt|index|idx)/)
      expect(source).not.toMatch(/slug/i)
    }
  })

  it("no filter or lookup keys on a name", () => {
    const source = readCode(...READER)
    // firstName/lastName appear only in the search clause and the select.
    expect(source).not.toMatch(/where:\s*\{\s*(firstName|lastName):\s*[a-z]/)
    expect(source).not.toMatch(/findUnique\([^)]*(firstName|lastName)/)
  })

  it("the order is total, so paging cannot repeat or skip a row", () => {
    const source = readCode(...READER)
    // Surname and first name are NOT unique here - Production draws 1320
    // players from 44 surnames - so the id tiebreak is what makes pages
    // disjoint.
    expect(source).toMatch(/DIRECTORY_ORDER[\s\S]{0,200}\{ id: "asc" \}/)
  })
})

describe("no query per row", () => {
  const source = () => readCode(...READER)

  it("clubs are read ONCE, bounded by club count and not by player count", () => {
    const facets = functionBody(source(), "loadDirectoryFacets")
    expect(facets.match(/prisma\.team\.findMany/g)).toHaveLength(1)
    // The directory page itself reads no club at all - it resolves every row
    // from the facet list already in memory.
    const page = functionBody(source(), "loadPlayerDirectory")
    expect(page).not.toContain("prisma.team.")
    expect(page).toContain("clubsById.get(row.teamId)")
  })

  it("the row select takes teamId, never a nested team relation", () => {
    // A relation select would make Prisma issue a second statement per page,
    // and an include per row would be an N+1.
    const select = source().slice(source().indexOf("const DIRECTORY_SELECT"))
    expect(select.slice(0, 400)).toContain("teamId: true")
    expect(select.slice(0, 400)).not.toContain("team:")
  })

  it("every query sits at a function body's top level, never inside a loop", () => {
    // Whole file: no reader in it may query from inside a loop.
    const lines = source().split("\n").filter((l) => l.includes("prisma."))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const indent = line.length - line.trimStart().length
      expect(indent).toBeLessThanOrEqual(4)
    }
    expect(source()).not.toMatch(/\.map\(\s*async/)
  })

  it("the facets are loaded once and passed in, never re-queried per page", () => {
    const loadPage = functionBody(source(), "loadPlayerDirectory")
    expect(loadPage).toContain("facets: DirectoryFacets")
    expect(loadPage).not.toContain("groupBy")
    expect(loadPage).not.toContain("prisma.team.")
  })
})

describe("the directory owns no history", () => {
  it("no directory module imports the Player Profile's career layer", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      // Running a career computation to build a directory row would be an
      // N+1 in disguise AND a second copy of career logic.
      expect(source).not.toMatch(/from "\.\/career"|players\/career/)
      expect(source).not.toMatch(/from "\.\/profile"|players\/profile/)
      expect(source).not.toMatch(/buildPlayerCareer|computeCareerTotals|loadPlayerProfile/)
    }
  })

  it("no directory module reads PlayerMatchStats", () => {
    for (const [, path] of EVERY_MODULE) {
      expect(readCode(...path)).not.toMatch(/playerMatchStats|PlayerMatchStats/)
    }
  })

  it("no directory module touches a fixture or a match", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/prisma\.fixture|isMatchFinished|MATCH_REAL_DURATION/)
    }
  })
})

describe("the directory writes nothing", () => {
  for (const [label, path] of EVERY_MODULE) {
    it(`${label} has no write path`, () => {
      const source = readCode(...path)
      expect(source).not.toMatch(/\.(update|create|upsert|delete|createMany|updateMany|deleteMany)\(/)
      expect(source).not.toMatch(/\$transaction/)
    })
  }
})

describe("privacy - only public sporting data leaves the database", () => {
  it("the row select names no user, auth or private field", () => {
    const source = readCode(...READER)
    for (const forbidden of ["email", "password", "userId", "user:", "session", "token", "hashed"]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it("the page renders no manager or account data", () => {
    const source = readCode(...PAGE)
    expect(source).not.toMatch(/email|password|session|getServerSession/)
  })

  it("the club select carries crest and name only", () => {
    const source = readCode(...READER)
    const select = source.slice(source.indexOf("const CLUB_SELECT"), source.indexOf("export interface DirectoryClub"))
    expect(select).not.toMatch(/userId|balance|user:/)
  })
})

describe("links from other surfaces use the canonical id", () => {
  it("the match stats row links by PlayerMatchStats.playerId", () => {
    const source = readCode("app", "match", "[fixtureId]", "player-stats.tsx")
    expect(source).toContain("href={`/players/${stat.playerId}`}")
    // never a name-based lookup in the client
    expect(source).not.toMatch(/find\([^)]*(firstName|lastName)/)
  })

  it("the squad links from the detail dialog, not from an interactive control", () => {
    const source = readCode("app", "squad", "squad-tactics-app.tsx")
    expect(source).toContain("href={`/players/${expandedPlayer.id}`}")
    // The list row and the pitch card stay controls: a Link wrapping either
    // would swallow the click that squad selection depends on.
    expect(source).not.toMatch(/<Link[^>]*>[\s\S]{0,200}PitchPlayerCard/)
    expect(source.match(/\/players\/\$\{/g)).toHaveLength(1)
  })

  it("a match event links only when the id resolved to a real player", () => {
    const source = readCode("app", "match", "[fixtureId]", "event-feed.tsx")
    // MatchEvent.playerId is a bare column with no foreign key, so an id that
    // names nobody must stay unlinked text rather than becoming a dead link.
    expect(source).toContain("event.playerId && event.playerName")
    expect(source).toContain("href={`/players/${event.playerId}`}")
    // and no id is ever inferred from a name
    expect(source).not.toMatch(/find\([^)]*(playerName|firstName|lastName)/)
  })

  it("the Hall of Fame still links players to the profile", () => {
    expect(readCode("app", "hall-of-fame", "page.tsx")).toContain("href: `/players/${entry.player.playerId}`")
  })
})

describe("every runtime-built translation key resolves in every locale", () => {
  const cases: [string, readonly string[]][] = [
    ["squad.position", PLAYER_POSITIONS],
    ["players.status", DIRECTORY_STATUSES],
  ]

  it.each(LOCALES as readonly Locale[])("%s translates every value in its OWN dictionary", (locale) => {
    const dictionary = TRANSLATIONS[locale]
    for (const [prefix, values] of cases) {
      for (const value of values) {
        expect(dictionary[`${prefix}.${value}` as TranslationKey]).toBeDefined()
      }
    }
  })

  it("the page builds only key families that exist", () => {
    const page = readCode(...PAGE)
    const dynamic = [...page.matchAll(/`([a-zA-Z.]+)\.\$\{/g)].map((m) => m[1])
    expect([...new Set(dynamic)].sort()).toEqual(["players.status", "squad.position"])
  })
})
