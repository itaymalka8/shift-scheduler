/**
 * Guards on what the Player Profile must NOT do.
 *
 * Source-level, because these are properties about ABSENT dependencies, and
 * no return value can show an absence. Every forbidden thing below produces a
 * plausible-looking wrong profile rather than an error - a career quietly
 * handed to whoever bought the player, a live score leaked, a goal counted
 * twice - which is the worst kind of bug on a page whose purpose is to be
 * believed.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { LOCALES, TRANSLATIONS, getTranslator, type Locale, type TranslationKey } from "@/lib/i18n/translations"
import { PLAYER_POSITIONS } from "./positions"

const SRC = join(__dirname, "..", "..")

/** Source with comments stripped - these files DOCUMENT the rules they follow. */
function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const CAREER = ["lib", "players", "career.ts"]
const READER = ["lib", "players", "profile.ts"]
const PAGE = ["app", "players", "[playerId]", "page.tsx"]
const EVERY_MODULE: [string, string[]][] = [
  ["career.ts", CAREER],
  ["profile.ts", READER],
  ["page.tsx", PAGE],
]

describe("current ownership never becomes career history", () => {
  it("the pure layer is never handed Player.teamId at all", () => {
    const source = readCode(...CAREER)
    // It receives a record's teamId - the club of THAT match - and nothing
    // that could carry current ownership.
    expect(source).not.toMatch(/currentTeam|currentClub|player\.teamId/)
    expect(source).toContain("teamId: string")
  })

  it("the reader reads Player.teamId exactly once, through the current-club relation", () => {
    const source = readCode(...READER)
    // Selecting the relation rather than the raw column keeps the intent
    // visible: this is the header's club, and it feeds nothing else.
    expect(source).toContain("team: { select: CLUB_SELECT }")
    expect(source).not.toMatch(/teamId:\s*true[\s\S]{0,200}CURRENT_PLAYER_SELECT/)
    // The historical read never asks Player for a club.
    const statsRead = source.slice(source.indexOf("prisma.playerMatchStats.findMany"))
    expect(statsRead.slice(0, 1200)).toContain("teamId: true")
    expect(statsRead.slice(0, 1200)).not.toContain("player:")
  })

  it("the reader never reads player.teamId - the current club arrives as a relation", () => {
    // Found by deliberately breaking it: `teamId: player.teamId ?? row.teamId`
    // in the record mapping passed every other guard here while quietly
    // handing a whole career to whoever owns the player today.
    const source = readCode(...READER)
    expect(source).not.toMatch(/\bplayer\.teamId\b/)
    expect(source).not.toMatch(/player\.team\?\.id/)
  })

  it("every historical record takes its club straight from the stats row", () => {
    const source = readCode(...READER)
    const mapping = source.slice(source.indexOf("const records: DatedCareerMatchRecord[]"))
    const head = mapping.slice(0, 400)
    // Exactly one club assignment, and it is the stats row's own column.
    // Nothing may be substituted between the row and the record.
    expect(head.match(/teamId:[^,\n]*/g)).toEqual(["teamId: row.teamId"])
  })

  it("career attribution keys on the stats row's teamId, never the player's", () => {
    const source = readCode(...CAREER)
    expect(source).toContain("byClub.get(r.teamId)")
    expect(source).toMatch(/records\b[\s\S]{0,200}r\.teamId/)
  })

  it("the page uses the current club ONLY in the header", () => {
    const source = readCode(...PAGE)
    // Exactly the header link and the free-agent fallback read it.
    const uses = source.match(/current\.currentClub/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    expect(uses.length).toBeLessThanOrEqual(4)
    // Club career rows come from the career aggregation, never from it.
    expect(source).toContain("clubs.map((row)")
    expect(source).not.toMatch(/clubs\.map[\s\S]{0,200}currentClub/)
  })
})

describe("identity is playerId and nothing else", () => {
  it("nothing joins, groups or looks up on a name or a shirt number", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/where:\s*\{[^}]*(firstName|lastName|shirtNumber)/)
      expect(source).not.toMatch(/(groupBy|get)\([^)]*(firstName|lastName)/)
    }
  })

  it("the reader looks a player up by id", () => {
    const source = readCode(...READER)
    expect(source).toContain("prisma.player.findUnique({ where: { id: playerId }")
  })

  it("the pure layer never sees a name at all", () => {
    const source = readCode(...CAREER)
    expect(source).not.toMatch(/firstName|lastName|nationality|shirtNumber/)
  })
})

describe("PlayerMatchStats is the only source of a career figure", () => {
  it("no module recounts goals or assists from MatchEvent", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/matchEvent|MatchEvent/)
      expect(source).not.toMatch(/type:\s*"(GOAL|ASSIST)"/)
    }
  })

  it("no module recomputes a rating", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/calculateMatchRating|calculatePlayerOverall/)
    }
  })

  it("current attributes never enter a historical figure", () => {
    const career = readCode(...CAREER)
    // The pure layer has no attribute in its vocabulary, so it cannot.
    expect(career).not.toMatch(/\boverall\b|\bpotential\b|\bfitness\b|attributes/)
  })

  it("the page reads overall and potential only inside the current-ability block", () => {
    const source = readCode(...PAGE)
    const ability = source.slice(source.indexOf('t("playerProfile.currentAbility")'))
    expect(ability).toContain("current.overall")
    expect(ability).toContain("current.potential")
    // and career figures never mention them
    expect(source).not.toMatch(/career\.totals[\s\S]{0,80}overall/)
  })
})

describe("public eligibility is the finished rule, never playedAt alone", () => {
  it("the read is gated on the live window, in SQL", () => {
    const source = readCode(...READER)
    expect(source).toContain("MATCH_REAL_DURATION_MINUTES")
    expect(source).toContain("playedAt: { not: null }")
    expect(source).toContain("lte: liveWindowCutoff")
  })

  it("playedAt is never the whole test on its own", () => {
    const source = readCode(...READER)
    // Every occurrence sits beside the scheduledAt cutoff in the same filter.
    const where = source.slice(source.indexOf("prisma.playerMatchStats.findMany"))
    const gate = where.slice(where.indexOf("fixture:"), where.indexOf("select:"))
    expect(gate).toContain("playedAt")
    expect(gate).toContain("liveWindowCutoff")
  })

  it("a live match is never fetched and then filtered out afterwards", () => {
    const source = readCode(...READER)
    expect(source).not.toMatch(/\.filter\([^)]*playedAt/)
    expect(source).not.toMatch(/\.filter\([^)]*isMatchFinished/)
  })

  it("a stored score becomes a displayed one only through revealFinalScore", () => {
    const source = readCode(...READER)
    expect(source).toContain("revealFinalScore")
    // No other path from the raw columns to the view model.
    expect(source).not.toMatch(/score:\s*\{\s*for:\s*f\.homeScore/)
  })

  it("the page never reaches for a raw score column", () => {
    const source = readCode(...PAGE)
    expect(source).not.toMatch(/homeScore|awayScore/)
  })
})

describe("the pure layer is pure", () => {
  it("career.ts reaches no database and no clock", () => {
    const source = readCode(...CAREER)
    expect(source).not.toMatch(/from "@\/lib\/prisma"/)
    expect(source).not.toMatch(/new Date\(|Date\.now\(/)
  })

  it("the reader takes now as a parameter, so one instant measures the page", () => {
    const source = readCode(...READER)
    expect(source).toContain("now: Date = new Date()")
    expect(readCode(...PAGE).match(/const now = new Date\(\)/g)).toHaveLength(1)
  })
})

describe("the profile writes nothing", () => {
  for (const [label, path] of EVERY_MODULE) {
    it(`${label} has no write path`, () => {
      const source = readCode(...path)
      expect(source).not.toMatch(/\.(update|create|upsert|delete|createMany|updateMany|deleteMany)\(/)
      expect(source).not.toMatch(/\$executeRaw|\$transaction/)
    })
  }

  it("no summary, snapshot or cache table is introduced", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/playerCareerStats|PlayerCareerStats/i)
      expect(source).not.toMatch(/playerClubSpell|PlayerSpell|PlayerEra/i)
      expect(source).not.toMatch(/teamNameAtMatch|nameAtMatch/)
      expect(source).not.toMatch(/unstable_cache|revalidate\s*[:=]/)
    }
  })
})

describe("no N+1", () => {
  const source = () => readCode(...READER)

  it("THREE reads for the whole profile, whatever the number of appearances", () => {
    expect(source().match(/prisma\.\w+\.find(Many|Unique)/g)).toHaveLength(4)
    // findUnique(player) + findMany(stats) + findMany(teams), plus the tiny
    // name-only read generateMetadata uses, which is its own request.
    expect(source().match(/prisma\.player\.findUnique/g)).toHaveLength(2)
    expect(source().match(/prisma\.playerMatchStats\.findMany/g)).toHaveLength(1)
    expect(source().match(/prisma\.team\.findMany/g)).toHaveLength(1)
  })

  it("clubs are fetched with one IN over the ids the stats named", () => {
    expect(source()).toContain("id: { in: [...clubIds] }")
    // Opponents come from the same read, not a second one per match.
    expect(source()).toContain("clubIds.add(row.fixture.homeTeamId)")
    expect(source()).toContain("clubIds.add(row.fixture.awayTeamId)")
  })

  it("every query sits at the function body's top level, never nested in a loop", () => {
    // Indentation is the check, because it is what a loop actually does to a
    // statement: a query inside `for`/`while`/`.map` is indented past the
    // function body. Matching on proximity to the word "for" would flag the
    // legitimate shape here - a loop that collects ids, then ONE query over
    // all of them - which is the opposite of the bug.
    const lines = source()
      .split("\n")
      .filter((line) => line.includes("await prisma."))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      const indent = line.length - line.trimStart().length
      expect(indent).toBe(2)
      expect(line.trimStart()).toMatch(/^(const|return) /)
    }
  })

  it("no query is issued from inside a map or a Promise.all fan-out", () => {
    const code = source()
    expect(code).not.toMatch(/\.map\(\s*async/)
    expect(code).not.toMatch(/Promise\.all\([\s\S]{0,300}prisma\./)
  })

  it("the fixture comes with the stats row rather than being read per appearance", () => {
    expect(source()).not.toMatch(/prisma\.fixture\./)
    expect(source()).toContain("fixture: {")
  })
})

describe("the route answers 404, not 500, for an id that names nobody", () => {
  it("the reader returns null and the page calls notFound", () => {
    expect(readCode(...READER)).toContain("if (!player) return null")
    const page = readCode(...PAGE)
    expect(page).toContain("notFound()")
    expect(page).toContain("if (!profile) notFound()")
  })

  it("a player with no history is NOT a 404", () => {
    const source = readCode(...READER)
    // An empty career still returns a profile - Production has 476 of these.
    expect(source).toContain("if (rows.length === 0)")
    expect(source).toMatch(/rows\.length === 0[\s\S]{0,200}return \{ current/)
  })
})

describe("the Hall of Fame links to the profile", () => {
  it("player rows address the route by playerId", () => {
    const board = readCode("app", "hall-of-fame", "page.tsx")
    expect(board).toContain("href: `/players/${entry.player.playerId}`")
  })

  it("the board does not duplicate career detail", () => {
    const board = readCode("app", "hall-of-fame", "page.tsx")
    expect(board).not.toMatch(/buildPlayerCareer|computeCareerTotals|computeClubTotals/)
  })
})

describe("clubs and matches link where they should", () => {
  it("club rows link to the club page and matches to Match Center", () => {
    const page = readCode(...PAGE)
    expect(page).toContain("href={`/clubs/${row.club.id}`}")
    expect(page).toContain("href={`/match/${appearance.fixtureId}`}")
  })

  it("no second match viewer is built", () => {
    const page = readCode(...PAGE)
    expect(page).not.toMatch(/MatchCenter|LiveMatch|<canvas/)
  })
})

describe("localization reuses what already exists", () => {
  it("positions come from the established squad.position map", () => {
    const page = readCode(...PAGE)
    expect(page).toContain("squad.position.")
    // No second map of position names.
    expect(page).not.toMatch(/const POSITIONS|positionLabel\s*=\s*\{/)
  })

  it("no user-visible string is hard-coded in the page", () => {
    const page = readCode(...PAGE)
    // Every rendered label goes through t(...); the only bare literals are
    // separators and the em dash for an absent value.
    const literals = page.match(/>\s*[A-Za-z]{3,}[^<{]*</g) ?? []
    expect(literals).toEqual([])
  })
})

/**
 * The profile builds three translation keys AT RUNTIME from stored column
 * values - position, squad status and preferred foot. A key the dictionary
 * does not have renders as the key itself, which the type system cannot catch
 * because the string is assembled rather than written. Found exactly that way:
 * `squad.status.available`, the Player.status DEFAULT, had no translation and
 * rendered raw on every profile of a fit player.
 */
describe("every runtime-built translation key resolves in every locale", () => {
  const cases: [string, string[]][] = [
    ["squad.position", PLAYER_POSITIONS],
    // Player.status's default plus the availability values the lifecycle sets.
    ["squad.status", ["available", "injured", "suspended"]],
    ["squad.foot", ["left", "right", "both"]],
  ]

  it.each(LOCALES as readonly Locale[])("%s translates every value in its OWN dictionary", (locale) => {
    // Read the dictionary directly rather than through getTranslator, which
    // falls back to Hebrew. That fallback hides the second half of this bug:
    // a key missing only from English renders HEBREW on an English page,
    // which a translator that falls back can never report.
    const dictionary = TRANSLATIONS[locale]
    const t = getTranslator(locale)
    for (const [prefix, values] of cases) {
      for (const value of values) {
        const key = `${prefix}.${value}` as TranslationKey
        expect(dictionary[key]).toBeDefined()
        // And a present key is never the key itself.
        expect(t(key)).not.toBe(key)
      }
    }
  })

  it("the page builds exactly these three key families and no others", () => {
    const page = readCode(...PAGE)
    const dynamic = [...page.matchAll(/`([a-zA-Z.]+)\.\$\{/g)].map((m) => m[1])
    expect([...new Set(dynamic)].sort()).toEqual(["squad.foot", "squad.position", "squad.status"])
  })
})
