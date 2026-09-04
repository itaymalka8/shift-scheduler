import {
  MIN_MATCHES_FOR_WIN_RATE,
  bestWinRate,
  buildHallOfFame,
  computeCareerRecords,
  longestTenures,
  mostChampionshipsByClub,
  mostChampionshipsByManager,
  mostClubsManaged,
  mostMatches,
  mostWins,
  rankEntries,
  type HallOfFameChampionship,
  type HallOfFameClub,
  type HallOfFameEra,
  type HallOfFameManager,
} from "./leaderboards"
import type { FixtureResult } from "@/lib/teams/era"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import { LOCALES, getTranslator, pluralise, type Locale } from "@/lib/i18n/translations"

const NOW = new Date("2026-09-04T12:00:00.000Z")
const DAY = 86_400_000
/** A kickoff whose live window has fully played out by NOW. */
function finishedAt(offsetDays: number): Date {
  return new Date(NOW.getTime() - offsetDays * DAY)
}

function manager(userId: string, name: string): HallOfFameManager {
  return { userId, name, image: null }
}
function club(id: string, name: string): HallOfFameClub {
  return {
    id,
    name,
    crestShape: null,
    crestPattern: null,
    crestIcon: null,
    crestColor: null,
    crestSecondaryColor: null,
    crestBorderColor: null,
    crestImageUrl: null,
  }
}
function era(over: Partial<HallOfFameEra> & { id: string; teamId: string; userId: string }): HallOfFameEra {
  return { startedAt: new Date("2026-01-01T00:00:00.000Z"), endedAt: null, ...over }
}
function fixture(over: Partial<FixtureResult> & { homeTeamId: string; awayTeamId: string; scheduledAt: Date }): FixtureResult {
  return { playedAt: over.scheduledAt, homeScore: 1, awayScore: 0, ...over }
}

const ANA = manager("u-ana", "Ana")
const BEN = manager("u-ben", "Ben")
const CAI = manager("u-cai", "Cai")
const MANAGERS = new Map([ANA, BEN, CAI].map((m) => [m.userId, m]))

const ALPHA = club("t-alpha", "Alpha FC")
const BETA = club("t-beta", "Beta United")
const GAMMA = club("t-gamma", "Gamma City")
const CLUBS = new Map([ALPHA, BETA, GAMMA].map((c) => [c.id, c]))

// ---------------------------------------------------------------------------
// CHAMPIONSHIPS - MANAGER
// ---------------------------------------------------------------------------

describe("most championships by manager", () => {
  const anaEra = era({ id: "e-ana", teamId: ALPHA.id, userId: ANA.userId })
  const benEra = era({ id: "e-ben", teamId: BETA.id, userId: BEN.userId })

  it("EXCLUDES a BOT championship - its era is not a human one", () => {
    const champs: HallOfFameChampionship[] = [
      { teamId: ALPHA.id, teamEraId: "e-ana" },
      { teamId: ALPHA.id, teamEraId: "e-bot-era" }, // a bot won this one
    ]
    const board = mostChampionshipsByManager(champs, [anaEra], MANAGERS)
    expect(board).toHaveLength(1)
    expect(board[0].entry.manager.userId).toBe(ANA.userId)
    expect(board[0].value).toBe(1)
  })

  it("excludes a championship with no era at all", () => {
    const board = mostChampionshipsByManager([{ teamId: ALPHA.id, teamEraId: null }], [anaEra], MANAGERS)
    expect(board).toHaveLength(0)
  })

  it("counts a human championship exactly once", () => {
    const board = mostChampionshipsByManager([{ teamId: ALPHA.id, teamEraId: "e-ana" }], [anaEra], MANAGERS)
    expect(board[0].value).toBe(1)
  })

  it("counts multiple titles for one manager, across separate eras", () => {
    const anaSecond = era({ id: "e-ana-2", teamId: BETA.id, userId: ANA.userId })
    const champs: HallOfFameChampionship[] = [
      { teamId: ALPHA.id, teamEraId: "e-ana" },
      { teamId: ALPHA.id, teamEraId: "e-ana" },
      { teamId: BETA.id, teamEraId: "e-ana-2" },
    ]
    const board = mostChampionshipsByManager(champs, [anaEra, anaSecond], MANAGERS)
    expect(board).toHaveLength(1)
    expect(board[0].value).toBe(3)
  })

  it("A MANAGER WHO LEAVES KEEPS THE TITLE - the era is closed, the credit is not", () => {
    const closed = era({ id: "e-ana", teamId: ALPHA.id, userId: ANA.userId, endedAt: new Date("2026-06-01T00:00:00.000Z") })
    const board = mostChampionshipsByManager([{ teamId: ALPHA.id, teamEraId: "e-ana" }], [closed], MANAGERS)
    expect(board[0].entry.manager.userId).toBe(ANA.userId)
    expect(board[0].value).toBe(1)
  })

  it("A FUTURE MANAGER DOES NOT INHERIT THE TITLE won before their era", () => {
    const anaClosed = era({ id: "e-ana", teamId: ALPHA.id, userId: ANA.userId, endedAt: new Date("2026-06-01T00:00:00.000Z") })
    // Ben takes the same club over afterwards.
    const benAtAlpha = era({ id: "e-ben-alpha", teamId: ALPHA.id, userId: BEN.userId, startedAt: new Date("2026-06-01T00:00:00.000Z") })
    const board = mostChampionshipsByManager([{ teamId: ALPHA.id, teamEraId: "e-ana" }], [anaClosed, benAtAlpha], MANAGERS)
    expect(board.map((r) => r.entry.manager.userId)).toEqual([ANA.userId])
  })

  it("omits managers with no titles rather than listing them at zero", () => {
    const board = mostChampionshipsByManager([{ teamId: ALPHA.id, teamEraId: "e-ana" }], [anaEra, benEra], MANAGERS)
    expect(board.map((r) => r.entry.manager.userId)).toEqual([ANA.userId])
  })

  it("is EMPTY when no championship has ever been decided - the production shape", () => {
    expect(mostChampionshipsByManager([], [anaEra, benEra], MANAGERS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// CHAMPIONSHIPS - CLUB
// ---------------------------------------------------------------------------

describe("most championships by club", () => {
  it("INCLUDES a BOT championship - the club won it whoever was in charge", () => {
    const champs: HallOfFameChampionship[] = [
      { teamId: ALPHA.id, teamEraId: "e-bot-era" },
      { teamId: ALPHA.id, teamEraId: "e-ana" },
    ]
    const board = mostChampionshipsByClub(champs, CLUBS)
    expect(board).toHaveLength(1)
    expect(board[0].entry.club.id).toBe(ALPHA.id)
    expect(board[0].value).toBe(2)
  })

  it("counts a title with no era at all - the club still won it", () => {
    expect(mostChampionshipsByClub([{ teamId: ALPHA.id, teamEraId: null }], CLUBS)[0].value).toBe(1)
  })

  it("ranks clubs by title count", () => {
    const champs: HallOfFameChampionship[] = [
      { teamId: ALPHA.id, teamEraId: null },
      { teamId: ALPHA.id, teamEraId: null },
      { teamId: BETA.id, teamEraId: null },
    ]
    const board = mostChampionshipsByClub(champs, CLUBS)
    expect(board.map((r) => [r.entry.club.id, r.value])).toEqual([
      [ALPHA.id, 2],
      [BETA.id, 1],
    ])
  })

  it("is EMPTY with zero SeasonChampion rows", () => {
    expect(mostChampionshipsByClub([], CLUBS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WINS AND MATCHES
// ---------------------------------------------------------------------------

describe("wins and matches", () => {
  it("SUMS A MANAGER'S SEPARATE ERAS", () => {
    const first = era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100), endedAt: finishedAt(50) })
    const second = era({ id: "e2", teamId: BETA.id, userId: ANA.userId, startedAt: finishedAt(40) })
    const fixtures = [
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(90), homeScore: 2, awayScore: 0 }),
      fixture({ homeTeamId: BETA.id, awayTeamId: "x", scheduledAt: finishedAt(30), homeScore: 3, awayScore: 1 }),
    ]
    const records = computeCareerRecords([first, second], fixtures, NOW)
    expect(records.get(ANA.userId)).toMatchObject({ matches: 2, wins: 2 })
  })

  it("A MANAGER RETURNING TO THE SAME CLUB DOES NOT ABSORB THE BOT GAP", () => {
    const first = era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100), endedAt: finishedAt(70) })
    const second = era({ id: "e2", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(30) })
    const fixtures = [
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(90), homeScore: 1, awayScore: 0 }),
      // Played by the BOT, in the gap between the two spells.
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(50), homeScore: 9, awayScore: 0 }),
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(20), homeScore: 1, awayScore: 0 }),
    ]
    const records = computeCareerRecords([first, second], fixtures, NOW)
    expect(records.get(ANA.userId)).toMatchObject({ matches: 2, wins: 2, goalsFor: 2 })

    // The shortcut this guards against: one window from first start to last end.
    const merged = computeCareerRecords(
      [era({ id: "merged", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100) })],
      fixtures,
      NOW
    )
    expect(merged.get(ANA.userId)!.matches).toBe(3)
    expect(merged.get(ANA.userId)!.goalsFor).toBe(11)
  })

  it("W + D + L === matches for every manager on the board", () => {
    const fixtures = [
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(90), homeScore: 2, awayScore: 0 }),
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(80), homeScore: 1, awayScore: 1 }),
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(70), homeScore: 0, awayScore: 3 }),
    ]
    const records = computeCareerRecords([era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100) })], fixtures, NOW)
    for (const entry of mostMatches(records, MANAGERS)) {
      const r = entry.entry.record
      expect(r.wins + r.draws + r.losses).toBe(r.matches)
      expect(r.matches).toBe(3)
    }
  })

  it("A LIVE FIXTURE IS EXCLUDED - its stored score is already there and must not count", () => {
    const justKickedOff = new Date(NOW.getTime() - (MATCH_REAL_DURATION_MINUTES - 1) * 60_000)
    const fixtures = [
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(10), homeScore: 1, awayScore: 0 }),
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: justKickedOff, homeScore: 5, awayScore: 0 }),
    ]
    const records = computeCareerRecords([era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100) })], fixtures, NOW)
    expect(records.get(ANA.userId)).toMatchObject({ matches: 1, wins: 1, goalsFor: 1 })
  })

  it("ranks wins and matches independently off the same records", () => {
    const fixtures = [
      // Ana: 1 win from 1. Ben: 1 win from 3.
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(90), homeScore: 1, awayScore: 0 }),
      fixture({ homeTeamId: BETA.id, awayTeamId: "x", scheduledAt: finishedAt(90), homeScore: 1, awayScore: 0 }),
      fixture({ homeTeamId: BETA.id, awayTeamId: "x", scheduledAt: finishedAt(80), homeScore: 0, awayScore: 1 }),
      fixture({ homeTeamId: BETA.id, awayTeamId: "x", scheduledAt: finishedAt(70), homeScore: 0, awayScore: 1 }),
    ]
    const records = computeCareerRecords(
      [
        era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100) }),
        era({ id: "e2", teamId: BETA.id, userId: BEN.userId, startedAt: finishedAt(100) }),
      ],
      fixtures,
      NOW
    )
    expect(mostWins(records, MANAGERS).map((r) => [r.rank, r.entry.manager.userId, r.value])).toEqual([
      [1, ANA.userId, 1],
      [1, BEN.userId, 1],
    ])
    expect(mostMatches(records, MANAGERS).map((r) => [r.rank, r.entry.manager.userId, r.value])).toEqual([
      [1, BEN.userId, 3],
      [2, ANA.userId, 1],
    ])
  })

  it("a manager who has completed no match is on no performance board", () => {
    const records = computeCareerRecords([era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100) })], [], NOW)
    expect(mostWins(records, MANAGERS)).toEqual([])
    expect(mostMatches(records, MANAGERS)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WIN PERCENTAGE
// ---------------------------------------------------------------------------

describe("best win percentage", () => {
  /** n finished fixtures for `teamId`, the first `wins` of them won. */
  function season(teamId: string, n: number, wins: number): FixtureResult[] {
    return Array.from({ length: n }, (_, i) =>
      fixture({
        homeTeamId: teamId,
        awayTeamId: "x",
        scheduledAt: finishedAt(200 - i),
        homeScore: i < wins ? 1 : 0,
        awayScore: i < wins ? 0 : 1,
      })
    )
  }
  const anaEra = era({ id: "e-ana", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(300) })
  const benEra = era({ id: "e-ben", teamId: BETA.id, userId: BEN.userId, startedAt: finishedAt(300) })

  it("EXCLUDES 37 matches", () => {
    const records = computeCareerRecords([anaEra], season(ALPHA.id, 37, 37), NOW)
    expect(records.get(ANA.userId)!.matches).toBe(37)
    expect(bestWinRate(records, MANAGERS)).toEqual([])
  })

  it("INCLUDES exactly 38 matches", () => {
    const records = computeCareerRecords([anaEra], season(ALPHA.id, 38, 19), NOW)
    const board = bestWinRate(records, MANAGERS)
    expect(board).toHaveLength(1)
    expect(board[0].entry.record.matches).toBe(38)
    expect(board[0].value).toBeCloseTo(0.5, 10)
  })

  it("DOES NOT RANK A 1-MATCH 100% MANAGER ABOVE AN ESTABLISHED ONE - they are not on the board", () => {
    const records = computeCareerRecords([anaEra, benEra], [...season(ALPHA.id, 1, 1), ...season(BETA.id, 38, 30)], NOW)
    const board = bestWinRate(records, MANAGERS)
    expect(board.map((r) => r.entry.manager.userId)).toEqual([BEN.userId])
  })

  it("a zero-match manager has no win percentage ranking", () => {
    const records = computeCareerRecords([anaEra], [], NOW)
    expect(bestWinRate(records, MANAGERS)).toEqual([])
  })

  it("the threshold is 38 and is exported for the UI to state", () => {
    expect(MIN_MATCHES_FOR_WIN_RATE).toBe(38)
  })

  it("the percentage is computed, never carried on the record", () => {
    const records = computeCareerRecords([anaEra], season(ALPHA.id, 40, 10), NOW)
    const board = bestWinRate(records, MANAGERS)
    expect(board[0].value).toBeCloseTo(0.25, 10)
    expect(board[0].entry.record).not.toHaveProperty("winRate")
  })
})

// ---------------------------------------------------------------------------
// TENURE
// ---------------------------------------------------------------------------

describe("longest single club tenure", () => {
  it("uses ONE shared now for every open era", () => {
    const a = era({ id: "e-a", teamId: ALPHA.id, userId: ANA.userId, startedAt: new Date(NOW.getTime() - 100 * DAY) })
    const b = era({ id: "e-b", teamId: BETA.id, userId: BEN.userId, startedAt: new Date(NOW.getTime() - 100 * DAY) })
    const board = longestTenures([a, b], MANAGERS, CLUBS, NOW)
    // Identical starts measured from one instant produce identical durations,
    // which is only true if the clock was not read twice.
    expect(board[0].value).toBe(board[1].value)
    expect(board[0].rank).toBe(1)
    expect(board[1].rank).toBe(1)
    expect(board[0].value).toBe(100 * DAY)
  })

  it("measures an open era to now and a closed era to its end", () => {
    const open = era({ id: "e-open", teamId: ALPHA.id, userId: ANA.userId, startedAt: new Date(NOW.getTime() - 10 * DAY) })
    const closed = era({
      id: "e-closed",
      teamId: BETA.id,
      userId: BEN.userId,
      startedAt: new Date(NOW.getTime() - 100 * DAY),
      endedAt: new Date(NOW.getTime() - 95 * DAY),
    })
    const board = longestTenures([open, closed], MANAGERS, CLUBS, NOW)
    expect(board.map((r) => [r.entry.eraId, r.value / DAY, r.entry.ongoing])).toEqual([
      ["e-open", 10, true],
      ["e-closed", 5, false],
    ])
  })

  it("DOES NOT MERGE TWO SPELLS AT THE SAME CLUB - each is its own entry", () => {
    const first = era({
      id: "e-1",
      teamId: ALPHA.id,
      userId: ANA.userId,
      startedAt: new Date(NOW.getTime() - 100 * DAY),
      endedAt: new Date(NOW.getTime() - 80 * DAY),
    })
    const second = era({ id: "e-2", teamId: ALPHA.id, userId: ANA.userId, startedAt: new Date(NOW.getTime() - 30 * DAY) })
    const board = longestTenures([first, second], MANAGERS, CLUBS, NOW)
    expect(board).toHaveLength(2)
    expect(board.map((r) => r.value / DAY)).toEqual([30, 20])
    // Merged would have been 100 days. Nothing on the board claims that.
    expect(board.every((r) => r.value / DAY < 100)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CLUBS MANAGED
// ---------------------------------------------------------------------------

describe("most clubs managed", () => {
  it("counts DISTINCT teamId", () => {
    const eras = [
      era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId }),
      era({ id: "e2", teamId: BETA.id, userId: ANA.userId }),
      era({ id: "e3", teamId: GAMMA.id, userId: ANA.userId }),
    ]
    expect(mostClubsManaged(eras, MANAGERS)[0].value).toBe(3)
  })

  it("TWO SPELLS AT ONE CLUB COUNT AS ONE CLUB", () => {
    const eras = [
      era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, endedAt: new Date("2026-03-01T00:00:00.000Z") }),
      era({ id: "e2", teamId: ALPHA.id, userId: ANA.userId, startedAt: new Date("2026-05-01T00:00:00.000Z") }),
    ]
    const board = mostClubsManaged(eras, MANAGERS)
    expect(board).toHaveLength(1)
    expect(board[0].value).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// TIES
// ---------------------------------------------------------------------------

describe("tie ranking semantics", () => {
  it("10, 10, 8 ranks as 1, 1, 3 - never 1, 2, 3", () => {
    const items = [
      { id: "c", n: 8 },
      { id: "a", n: 10 },
      { id: "b", n: 10 },
    ]
    expect(rankEntries(items, (i) => i.n, (i) => i.id).map((r) => r.rank)).toEqual([1, 1, 3])
  })

  it("TWO TIED CHAMPIONSHIP MANAGERS SHARE RANK 1", () => {
    const eras = [
      era({ id: "e-ana", teamId: ALPHA.id, userId: ANA.userId }),
      era({ id: "e-ben", teamId: BETA.id, userId: BEN.userId }),
    ]
    const champs: HallOfFameChampionship[] = [
      { teamId: ALPHA.id, teamEraId: "e-ana" },
      { teamId: BETA.id, teamEraId: "e-ben" },
    ]
    expect(mostChampionshipsByManager(champs, eras, MANAGERS).map((r) => r.rank)).toEqual([1, 1])
  })

  it("TWO TIED WIN MANAGERS SHARE RANK 1", () => {
    const fixtures = [
      fixture({ homeTeamId: ALPHA.id, awayTeamId: "x", scheduledAt: finishedAt(90), homeScore: 1, awayScore: 0 }),
      fixture({ homeTeamId: BETA.id, awayTeamId: "x", scheduledAt: finishedAt(90), homeScore: 1, awayScore: 0 }),
    ]
    const records = computeCareerRecords(
      [
        era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(100) }),
        era({ id: "e2", teamId: BETA.id, userId: BEN.userId, startedAt: finishedAt(100) }),
      ],
      fixtures,
      NOW
    )
    expect(mostWins(records, MANAGERS).map((r) => r.rank)).toEqual([1, 1])
  })

  it("TECHNICAL ORDERING INSIDE A TIE DOES NOT CHANGE A SPORTING RANK", () => {
    const forwards = [
      { id: "a", n: 5 },
      { id: "z", n: 5 },
    ]
    const backwards = [...forwards].reverse()
    const a = rankEntries(forwards, (i) => i.n, (i) => i.id)
    const b = rankEntries(backwards, (i) => i.n, (i) => i.id)
    // Same display order both ways round, and the same rank for both.
    expect(a.map((r) => r.entry.id)).toEqual(b.map((r) => r.entry.id))
    expect(a.map((r) => r.rank)).toEqual([1, 1])
    expect(b.map((r) => r.rank)).toEqual([1, 1])
  })

  it("the input order of the rows never changes any rank", () => {
    const items = [
      { id: "a", n: 3 },
      { id: "b", n: 9 },
      { id: "c", n: 3 },
    ]
    const shuffled = [items[1], items[2], items[0]]
    const byId = (rs: { rank: number; entry: { id: string } }[]) => Object.fromEntries(rs.map((r) => [r.entry.id, r.rank]))
    expect(byId(rankEntries(items, (i) => i.n, (i) => i.id))).toEqual(byId(rankEntries(shuffled, (i) => i.n, (i) => i.id)))
  })

  it("a rank is never the array index", () => {
    const items = [
      { id: "a", n: 5 },
      { id: "b", n: 5 },
      { id: "c", n: 5 },
    ]
    const ranked = rankEntries(items, (i) => i.n, (i) => i.id)
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1])
  })
})

// ---------------------------------------------------------------------------
// THE WHOLE BOARD
// ---------------------------------------------------------------------------

describe("buildHallOfFame", () => {
  it("builds every board from ONE instant, and survives the production shape", () => {
    // Production today: human managers, zero championships.
    const eras = [
      era({ id: "e1", teamId: ALPHA.id, userId: ANA.userId, startedAt: finishedAt(10) }),
      era({ id: "e2", teamId: BETA.id, userId: BEN.userId, startedAt: finishedAt(10) }),
      era({ id: "e3", teamId: GAMMA.id, userId: CAI.userId, startedAt: finishedAt(10) }),
    ]
    const board = buildHallOfFame(
      { humanEras: eras, championships: [], fixtures: [], managers: MANAGERS, clubs: CLUBS },
      NOW
    )
    expect(board.measuredAt).toBe(NOW)
    expect(board.managerChampionships).toEqual([])
    expect(board.clubChampionships).toEqual([])
    expect(board.mostWins).toEqual([])
    expect(board.mostMatches).toEqual([])
    expect(board.bestWinRate).toEqual([])
    expect(board.mostClubsManaged).toHaveLength(3)
    expect(board.longestTenures).toHaveLength(3)
    expect(board.minimumMatchesForWinRate).toBe(38)
  })

  it("survives having no managers and no history at all", () => {
    const board = buildHallOfFame(
      { humanEras: [], championships: [], fixtures: [], managers: new Map(), clubs: new Map() },
      NOW
    )
    expect(board.mostClubsManaged).toEqual([])
    expect(board.longestTenures).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// COUNTED NOUNS
// ---------------------------------------------------------------------------

describe("counted nouns read correctly in each language", () => {
  const cases: [string, number, string][] = [
    // English: a dedicated singular, never "1 titles".
    ["en", 1, "1 title"],
    ["en", 2, "2 titles"],
    ["en", 0, "0 titles"],
    ["en", 38, "38 titles"],
    // Hebrew has a DUAL - two is its own form.
    ["he", 1, "אליפות אחת"],
    ["he", 2, "שתי אליפויות"],
    ["he", 5, "5 אליפויות"],
    // Arabic has six categories; one and two have their own words.
    ["ar", 1, "بطولة واحدة"],
    ["ar", 2, "بطولتان"],
    ["ar", 3, "3 بطولات"],
    ["ar", 11, "11 بطولات"],
  ]

  it.each(cases)("%s / %i -> %s", (locale, n, expected) => {
    const l = locale as Locale
    expect(pluralise(l, getTranslator(l), "hof.titles", n, String(n))).toBe(expected)
  })

  it("falls back to `.other` for a category a locale has no key for", () => {
    // English uses only one/other, so 'two' resolves through the fallback.
    expect(pluralise("en", getTranslator("en"), "hof.days", 2, "2")).toBe("2 days")
  })

  it("every unit the page counts has a full set of keys in all three locales", () => {
    for (const locale of LOCALES) {
      const t = getTranslator(locale)
      for (const unit of ["hof.titles", "hof.wins", "hof.matches", "hof.clubs", "hof.days"]) {
        for (const n of [0, 1, 2, 3, 11, 100]) {
          const rendered = pluralise(locale, t, unit, n, String(n))
          // A missing key would surface as the raw key text.
          expect(rendered).not.toContain(unit)
          expect(rendered).not.toContain("{n}")
        }
      }
    }
  })
})
