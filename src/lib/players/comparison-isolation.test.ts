/**
 * Guards on what Player Comparison must NOT do.
 *
 * Source-level, because every one of these is a property about something
 * ABSENT. A comparison that quietly re-derives a rating, that attributes an
 * old goal to a player's current club, or that totals its own row highlights
 * into a verdict still renders perfectly - which is exactly why none of them
 * would be noticed without a test that looks for them.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CAREER_METRIC_GROUPS, ABILITY_METRICS } from "./comparison"

const SRC = join(__dirname, "..", "..")

function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const PURE = ["lib", "players", "comparison.ts"]
const READER = ["lib", "players", "comparison-queries.ts"]
const PAGE = ["app", "players", "compare", "page.tsx"]
const EVERY_MODULE: [string, string[]][] = [
  ["comparison.ts", PURE],
  ["comparison-queries.ts", READER],
  ["compare/page.tsx", PAGE],
]

describe("history comes from the Phase 3H reader, and nowhere else", () => {
  it("the reader loads careers through loadPlayerProfile rather than its own pipeline", () => {
    const source = readCode(...READER)
    expect(source).toContain("loadPlayerProfile")
    // The profile's own reads - if these appeared here the eligibility rule
    // would have been restated, which is how two pages start disagreeing.
    expect(source).not.toContain("prisma.playerMatchStats")
    expect(source).not.toContain("prisma.fixture")
  })

  it("no comparison module re-implements the anti-spoiler cutoff", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toContain("MATCH_REAL_DURATION_MINUTES")
      expect(source).not.toContain("isMatchFinished")
      expect(source).not.toContain("playedAt")
      expect(source).not.toContain("scheduledAt")
    }
  })

  it("no comparison module reads MatchEvent as career truth", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/prisma\.matchEvent|MatchEvent/)
    }
  })

  it("no rating is ever recomputed", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toContain("calculateMatchRating")
      expect(source).not.toContain("calculatePlayerOverall")
    }
  })

  it("the derived rates are the profile's own, not a second formula", () => {
    const source = readCode(...PURE)
    // Read straight off career.rates. A division appearing here would be a
    // restated formula, and the two would drift.
    expect(source).toContain("c.rates.goalsPer90")
    expect(source).toContain("c.rates.shotAccuracy")
    expect(source).toContain("c.rates.passAccuracy")
    expect(source).not.toMatch(/\*\s*90/)
    expect(source).not.toMatch(/totals\.goals\s*\//)
  })
})

describe("current club never becomes historical attribution", () => {
  it("the pure layer is never given a current club at all", () => {
    const source = readCode(...PURE)
    expect(source).not.toContain("teamId")
    expect(source).not.toContain("currentClub")
  })

  it("the reader names no club field of its own", () => {
    const source = readCode(...READER)
    expect(source).not.toContain("teamId")
  })

  it("the page's career club list comes from the profile's club aggregation", () => {
    const source = readCode(...PAGE)
    expect(source).toContain("<ClubColumn clubs={a.profile.clubs}")
    expect(source).toContain("<ClubColumn clubs={b.profile.clubs}")
    // The component that renders a career's clubs never sees the current one.
    // Sliced to its own body, so a mention in the NEXT function cannot pass
    // for a mention in this one - a proximity match did exactly that.
    const body = source.slice(source.indexOf("function ClubColumn"))
    const own = body.slice(0, body.indexOf("\nfunction ", 1))
    expect(own).toContain("row.career.totals")
    expect(own).not.toContain("currentClub")
    expect(own).not.toContain("teamId:")
  })
})

describe("identity is Player.id, never a name", () => {
  it("every link and every selection is built from an id", () => {
    const source = readCode(...PAGE)
    expect(source).toContain("selectHref(params, slot, player.id)")
    expect(source).toContain("href={`/players/${current.playerId}`}")
    expect(source).not.toMatch(/\/players\/\$\{[^}]*(Name|name|shirt|index|idx)/)
  })

  it("no module looks a player up by name", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/findUnique\([^)]*(firstName|lastName)/)
      expect(source).not.toMatch(/where:\s*\{\s*(firstName|lastName)/)
    }
  })

  it("the slot panel shows club, position and nationality, so two identical names stay tellable apart", () => {
    const source = readCode(...PAGE)
    const panel = source.slice(source.indexOf("function SlotPanel"))
    expect(panel).toContain("clubLabel(t, current)")
    expect(panel).toContain("position(t, current.primaryPosition)")
    expect(panel).toContain("current.nationality")
  })
})

describe("there is no winner", () => {
  it("no module computes a score, a total or a weight", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/\b(comparisonScore|overallScore|totalScore|winner|verdict|betterPlayer)\b/i)
      expect(source).not.toMatch(/weight(s|ed)?\s*[:=]/i)
    }
  })

  it("the per-row mark is never counted", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      // A tally of favoured rows would be a winner by another name.
      expect(source).not.toMatch(/favoured[\s\S]{0,40}(reduce|\+\+|\+=|length\s*>)/)
      expect(source).not.toMatch(/filter\([^)]*favoured/)
    }
  })

  it("localeCompare is never used as a sporting judgement", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toContain("localeCompare")
    }
  })

  it("the direction of every metric is written down, never inferred", () => {
    for (const metric of [...CAREER_METRIC_GROUPS.flatMap((g) => g.metrics), ...ABILITY_METRICS]) {
      expect(typeof metric.direction).toBe("string")
    }
    const source = readCode(...PURE)
    // No rule that derives a direction from a name, which is how "more cards
    // is better" gets shipped.
    // An ASSIGNMENT to direction (never a comparison - `direction ===` is how
    // favouredSide reads the contract, and matching that was this guard's own
    // first bug).
    expect(source).not.toMatch(/direction\s*=[^=]/)
    expect(source).not.toMatch(/includes\(["'](goals|cards)/)
  })
})

describe("read-only, everywhere", () => {
  it("no comparison module writes to the database", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/)
      expect(source).not.toContain("$transaction")
      expect(source).not.toContain("$executeRaw")
    }
  })

  it("no module issues a raw query", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/\$queryRaw|\$executeRaw|Prisma\.sql|Prisma\.raw/)
    }
  })

  it("no SQL is assembled as a string", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      const literals = [...source.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1])
      for (const literal of literals) {
        expect(literal).not.toMatch(/\b(select|insert|update|delete|where|ilike|like)\b\s/i)
      }
    }
  })
})

describe("nothing private is read, and nothing unbounded is fetched", () => {
  it("no module touches a User, an email or an account", () => {
    for (const [, path] of EVERY_MODULE) {
      const source = readCode(...path)
      expect(source).not.toMatch(/prisma\.user|prisma\.account|prisma\.session/)
      expect(source).not.toMatch(/\bemail\b|passwordHash|managerId|\bownerId\b/i)
    }
  })

  it("the reader's own Player read is bounded to the two ids asked for", () => {
    const source = readCode(...READER)
    expect(source.match(/prisma\.player\.findMany/g)).toHaveLength(1)
    const read = source.slice(source.indexOf("prisma.player.findMany"))
    expect(read.slice(0, 200)).toContain("where: { id: { in: ids } }")
  })

  it("the selector search is bounded by take", () => {
    const source = readCode("lib", "players", "directory-queries.ts")
    const search = source.slice(source.indexOf("export async function searchPlayersForSelection"))
    expect(search).toContain("take: limit")
    // An empty term returns nothing rather than the head of the whole table.
    expect(search).toContain('if (q.trim() === "") return []')
  })

  it("the page is a server component and ships no player list to the browser", () => {
    const source = readCode(...PAGE)
    expect(source).not.toContain('"use client"')
    expect(source).not.toMatch(/useState|useEffect|useMemo|onChange=/)
  })
})

describe("the query count does not grow with a career", () => {
  it("the reader awaits exactly once, and never inside a loop", () => {
    const source = readCode(...READER)
    // ONE await in the whole file - the Promise.all - so there is no shape in
    // which a second read could be issued per appearance, per club or per
    // stat. An indentation rule was tried first and flagged the CORRECT code:
    // the two profile loads legitimately sit indented inside Promise.all.
    expect(source.match(/\bawait\b/g)).toHaveLength(1)
    expect(source.match(/loadPlayerProfile\(/g)).toHaveLength(2)
    expect(source).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\.forEach\(/)
  })

  it("the two profile loads and the attribute read are issued together", () => {
    const source = readCode(...READER)
    expect(source).toContain("await Promise.all([")
    expect(source).not.toMatch(/for\s*\([\s\S]{0,200}loadPlayerProfile/)
    expect(source).not.toMatch(/map\([\s\S]{0,120}await/)
  })

  it("the page issues no Prisma call of its own", () => {
    const source = readCode(...PAGE)
    expect(source).not.toContain("prisma.")
    expect(source).not.toContain("@/lib/prisma")
  })

  it("the page loads a career exactly once per side", () => {
    const source = readCode(...PAGE)
    expect(source.match(/loadComparison\(/g)).toHaveLength(1)
    expect(source).not.toContain("loadPlayerProfile")
  })

  it("the same player on both sides is dropped BEFORE the read, not after", () => {
    const source = readCode(...PAGE)
    expect(source).toContain("loadComparison(params.a, same ? null : params.b, now)")
  })
})

describe("null is never quietly turned into zero", () => {
  it("the pure layer refuses to compare when either side is absent", () => {
    const source = readCode(...PURE)
    expect(source).toContain("if (a === null || b === null) return null")
    // The two shapes that would silently invent a zero.
    expect(source).not.toMatch(/\?\?\s*0\b/)
    expect(source).not.toMatch(/\|\|\s*0\b/)
  })

  it("the page renders a dash for an absent value", () => {
    const source = readCode(...PAGE)
    expect(source).toContain('if (value === null) return "—"')
  })
})
