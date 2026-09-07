import { boardTop, rankEntries } from "./leaderboards"
import {
  MIN_APPEARANCES_FOR_RATING,
  PLAYER_BOARD_MAX_ROWS,
  PLAYER_BOARD_PLACES,
  bestAverageRating as bestAverageRatingBoard,
  buildPlayerCareers,
  buildPlayerHallOfFame,
  mostAppearances as mostAppearancesBoard,
  mostAssists as mostAssistsBoard,
  mostGoals as mostGoalsBoard,
  mostRecentClub,
  type HallOfFameClubRef,
  type HallOfFamePlayer,
  type PlayerMatchRecord,
} from "./players"
import { LOCALES, getTranslator, pluralise, type Locale } from "@/lib/i18n/translations"

const NOW = new Date("2026-09-04T12:00:00.000Z")

function player(playerId: string, lastName: string, over: Partial<HallOfFamePlayer> = {}): HallOfFamePlayer {
  return {
    playerId,
    firstName: "A",
    lastName,
    primaryPosition: "ST",
    nationality: "IL",
    careerStatus: "ACTIVE",
    ...over,
  }
}
function rec(over: Partial<PlayerMatchRecord> & { playerId: string }): PlayerMatchRecord {
  return { teamId: "t-alpha", goals: 0, assists: 0, rating: 6, minutesPlayed: 90, ...over }
}

/**
 * Each board returns a BoardCut - the rows that fit plus any shared place too
 * crowded to list. Most tests are about the ranking, so they read `.rows`
 * through these; the cutting itself has its own describe block.
 */
const mostGoals = (...args: Parameters<typeof mostGoalsBoard>) => mostGoalsBoard(...args).rows
const mostAssists = (...args: Parameters<typeof mostAssistsBoard>) => mostAssistsBoard(...args).rows
const mostAppearances = (...args: Parameters<typeof mostAppearancesBoard>) => mostAppearancesBoard(...args).rows
const bestAverageRating = (...args: Parameters<typeof bestAverageRatingBoard>) => bestAverageRatingBoard(...args).rows

const ALPHA: HallOfFameClubRef = { id: "t-alpha", name: "Alpha FC" }
const BETA: HallOfFameClubRef = { id: "t-beta", name: "Beta United" }
const CLUBS = new Map([ALPHA, BETA].map((c) => [c.id, c]))

/** n identical rows for one player, so a threshold can be crossed exactly. */
function appearances(playerId: string, n: number, over: Partial<PlayerMatchRecord> = {}): PlayerMatchRecord[] {
  return Array.from({ length: n }, () => rec({ playerId, ...over }))
}

describe("buildPlayerCareers - a career is the sum of a player's rows", () => {
  it("sums goals, assists, minutes and ratings across every row", () => {
    const careers = buildPlayerCareers([
      rec({ playerId: "p1", goals: 2, assists: 1, rating: 8, minutesPlayed: 90 }),
      rec({ playerId: "p1", goals: 1, assists: 0, rating: 7, minutesPlayed: 45 }),
    ])
    const p1 = careers.get("p1")!
    expect(p1.appearances).toBe(2)
    expect(p1.goals).toBe(3)
    expect(p1.assists).toBe(1)
    expect(p1.minutesPlayed).toBe(135)
    expect(p1.ratingSum).toBe(15)
    expect(p1.averageRating).toBe(7.5)
  })

  it("counts one row as one appearance and never de-duplicates", () => {
    // The database's @@unique([fixtureId, playerId]) is what makes this safe:
    // two rows are two matches, so a DISTINCT here would hide, not fix.
    expect(buildPlayerCareers(appearances("p1", 5)).get("p1")!.appearances).toBe(5)
  })

  it("counts a zero-minute row as an appearance and keeps its rating", () => {
    // Production has 3 of these. They are stoppage-time substitutes, not
    // unused ones - the engine writes no row at all for a player who never
    // came on - and their 6.0 is the engine's own neutral rating for a cameo.
    const careers = buildPlayerCareers([
      rec({ playerId: "p1", rating: 8, minutesPlayed: 90 }),
      rec({ playerId: "p1", rating: 6, minutesPlayed: 0 }),
    ])
    const p1 = careers.get("p1")!
    expect(p1.appearances).toBe(2)
    expect(p1.minutesPlayed).toBe(90)
    expect(p1.averageRating).toBe(7)
  })

  it("gives a player who changed clubs ONE career, not two", () => {
    const careers = buildPlayerCareers([
      rec({ playerId: "p1", teamId: "t-alpha", goals: 3 }),
      rec({ playerId: "p1", teamId: "t-beta", goals: 4 }),
    ])
    expect(careers.size).toBe(1)
    const p1 = careers.get("p1")!
    expect(p1.goals).toBe(7)
    expect(p1.appearances).toBe(2)
    expect(p1.clubIds).toEqual(["t-alpha", "t-beta"])
    expect(p1.appearancesByClub.get("t-alpha")).toBe(1)
    expect(p1.appearancesByClub.get("t-beta")).toBe(1)
  })

  it("returns no career, and no NaN average, for no rows at all", () => {
    expect(buildPlayerCareers([]).size).toBe(0)
  })

  it("attributes a club by the row's teamId, never by anything current", () => {
    const careers = buildPlayerCareers([
      rec({ playerId: "p1", teamId: "t-alpha" }),
      rec({ playerId: "p1", teamId: "t-beta" }),
    ])
    // mostRecentClub is the LAST club they turned out for in the given order.
    expect(mostRecentClub(careers.get("p1")!)).toBe("t-beta")
  })
})

describe("mostGoals / mostAssists / mostAppearances", () => {
  const PLAYERS = new Map(
    [player("p1", "One"), player("p2", "Two"), player("p3", "Three")].map((p) => [p.playerId, p])
  )

  it("ranks by goals descending", () => {
    const careers = buildPlayerCareers([
      ...appearances("p1", 1, { goals: 3 }),
      ...appearances("p2", 1, { goals: 9 }),
      ...appearances("p3", 1, { goals: 5 }),
    ])
    const rows = mostGoals(careers, PLAYERS, CLUBS)
    expect(rows.map((r) => [r.entry.player.playerId, r.value, r.rank])).toEqual([
      ["p2", 9, 1],
      ["p3", 5, 2],
      ["p1", 3, 3],
    ])
  })

  it("gives tied scorers the SAME rank and skips the next (1,1,3 not 1,2,3)", () => {
    const careers = buildPlayerCareers([
      ...appearances("p1", 1, { goals: 10 }),
      ...appearances("p2", 1, { goals: 10 }),
      ...appearances("p3", 1, { goals: 8 }),
    ])
    expect(mostGoals(careers, PLAYERS, CLUBS).map((r) => r.rank)).toEqual([1, 1, 3])
  })

  it("omits players with no goals from the scoring board", () => {
    const careers = buildPlayerCareers([...appearances("p1", 1, { goals: 2 }), ...appearances("p2", 3)])
    const ids = mostGoals(careers, PLAYERS, CLUBS).map((r) => r.entry.player.playerId)
    expect(ids).toEqual(["p1"])
  })

  it("ranks assists from the assists column, independently of goals", () => {
    const careers = buildPlayerCareers([
      ...appearances("p1", 1, { goals: 9, assists: 0 }),
      ...appearances("p2", 1, { goals: 0, assists: 4 }),
    ])
    expect(mostAssists(careers, PLAYERS, CLUBS).map((r) => r.entry.player.playerId)).toEqual(["p2"])
  })

  it("ranks appearances by row count, including goalless ones", () => {
    const careers = buildPlayerCareers([...appearances("p1", 2), ...appearances("p2", 7)])
    expect(mostAppearances(careers, PLAYERS, CLUBS).map((r) => [r.entry.player.playerId, r.value])).toEqual([
      ["p2", 7],
      ["p1", 2],
    ])
  })

  it("orders a tie by immutable playerId, never by name", () => {
    // Both tied on 5. "Zed" sorts after "Ada" by name, but the ids decide the
    // technical display order, and neither is a tie-breaker: the rank is equal.
    const players = new Map(
      [player("p-a", "Zed"), player("p-b", "Ada")].map((p) => [p.playerId, p])
    )
    const careers = buildPlayerCareers([...appearances("p-a", 5), ...appearances("p-b", 5)])
    const rows = mostAppearances(careers, players, CLUBS)
    expect(rows.map((r) => r.rank)).toEqual([1, 1])
    expect(rows.map((r) => r.entry.player.playerId)).toEqual(["p-a", "p-b"])
  })

  it("skips a career whose player row is missing rather than rendering it anonymously", () => {
    const careers = buildPlayerCareers([...appearances("ghost", 3), ...appearances("p1", 1)])
    expect(mostAppearances(careers, PLAYERS, CLUBS).map((r) => r.entry.player.playerId)).toEqual(["p1"])
  })

  it("attributes the historical club from the row, and tolerates an unknown club id", () => {
    const careers = buildPlayerCareers([rec({ playerId: "p1", teamId: "t-beta" }), rec({ playerId: "p2", teamId: "t-gone" })])
    const byId = new Map(mostAppearances(careers, PLAYERS, CLUBS).map((r) => [r.entry.player.playerId, r.entry]))
    expect(byId.get("p1")!.historicalClub).toEqual(BETA)
    expect(byId.get("p2")!.historicalClub).toBeNull()
  })
})

describe("a retired player is a full member of the hall of fame", () => {
  it("ranks a RETIRED player exactly like anyone else", () => {
    const players = new Map(
      [player("p-ret", "Gone", { careerStatus: "RETIRED" }), player("p-act", "Here")].map((p) => [p.playerId, p])
    )
    const careers = buildPlayerCareers([
      ...appearances("p-ret", 1, { goals: 12 }),
      ...appearances("p-act", 1, { goals: 4 }),
    ])
    const rows = mostGoals(careers, players, CLUBS)
    expect(rows[0].entry.player.playerId).toBe("p-ret")
    expect(rows[0].rank).toBe(1)
    // careerStatus labels the row; it never filters or demotes it.
    expect(rows[0].entry.player.careerStatus).toBe("RETIRED")
  })
})

describe("bestAverageRating and its threshold", () => {
  const PLAYERS = new Map(
    [player("p1", "One"), player("p2", "Two"), player("p3", "Three")].map((p) => [p.playerId, p])
  )

  it("states the threshold as a single explicit product constant", () => {
    expect(MIN_APPEARANCES_FOR_RATING).toBe(20)
  })

  it("excludes a player one appearance short, and admits them at exactly the threshold", () => {
    const short = buildPlayerCareers(appearances("p1", MIN_APPEARANCES_FOR_RATING - 1, { rating: 9 }))
    expect(bestAverageRating(short, PLAYERS, CLUBS)).toEqual([])

    const exact = buildPlayerCareers(appearances("p1", MIN_APPEARANCES_FOR_RATING, { rating: 9 }))
    expect(bestAverageRating(exact, PLAYERS, CLUBS).map((r) => r.entry.player.playerId)).toEqual(["p1"])
  })

  it("never ranks then hides: a brilliant cameo is not rank 1 and then dropped", () => {
    const careers = buildPlayerCareers([
      ...appearances("p1", 1, { rating: 10 }),
      ...appearances("p2", MIN_APPEARANCES_FOR_RATING, { rating: 7 }),
    ])
    const rows = bestAverageRating(careers, PLAYERS, CLUBS)
    expect(rows.map((r) => [r.entry.player.playerId, r.rank])).toEqual([["p2", 1]])
  })

  it("ranks on the unrounded mean, so two players who both display 7.45 are not tied", () => {
    // 7.44 and 7.46 both format to "7.45" at two decimals in some roundings;
    // more importantly their means differ, and the rank must see that.
    const careers = buildPlayerCareers([
      ...appearances("p1", MIN_APPEARANCES_FOR_RATING, { rating: 7.44 }),
      ...appearances("p2", MIN_APPEARANCES_FOR_RATING, { rating: 7.46 }),
    ])
    const rows = bestAverageRating(careers, PLAYERS, CLUBS)
    expect(rows.map((r) => r.entry.player.playerId)).toEqual(["p2", "p1"])
    expect(rows.map((r) => r.rank)).toEqual([1, 2])
  })

  it("gives genuinely equal means the same rank", () => {
    const careers = buildPlayerCareers([
      ...appearances("p1", MIN_APPEARANCES_FOR_RATING, { rating: 7 }),
      ...appearances("p2", MIN_APPEARANCES_FOR_RATING, { rating: 7 }),
      ...appearances("p3", MIN_APPEARANCES_FOR_RATING, { rating: 6 }),
    ])
    expect(bestAverageRating(careers, PLAYERS, CLUBS).map((r) => r.rank)).toEqual([1, 1, 3])
  })

  it("computes the mean as ratingSum / appearances exactly", () => {
    const careers = buildPlayerCareers([
      rec({ playerId: "p1", rating: 8 }),
      rec({ playerId: "p1", rating: 7 }),
      rec({ playerId: "p1", rating: 6 }),
    ])
    const p1 = careers.get("p1")!
    expect(p1.averageRating).toBe(p1.ratingSum / p1.appearances)
  })

  it("honours an explicitly supplied minimum, so the constant is testable both ways", () => {
    const careers = buildPlayerCareers(appearances("p1", 3, { rating: 9 }))
    expect(bestAverageRating(careers, PLAYERS, CLUBS, 3).map((r) => r.entry.player.playerId)).toEqual(["p1"])
    expect(bestAverageRating(careers, PLAYERS, CLUBS, 4)).toEqual([])
  })
})

describe("buildPlayerHallOfFame", () => {
  const PLAYERS = new Map([player("p1", "One"), player("p2", "Two")].map((p) => [p.playerId, p]))

  it("returns every board from one set of facts and one instant", () => {
    const board = buildPlayerHallOfFame(
      {
        records: [
          ...appearances("p1", 2, { goals: 1, assists: 1 }),
          ...appearances("p2", 1, { goals: 3 }),
        ],
        players: PLAYERS,
        clubs: CLUBS,
      },
      NOW
    )
    expect(board.measuredAt).toBe(NOW)
    expect(board.minimumAppearancesForRating).toBe(MIN_APPEARANCES_FOR_RATING)
    expect(board.playersWithHistory).toBe(2)
    expect(board.mostAppearances.rows[0].entry.player.playerId).toBe("p1")
    expect(board.mostGoals.rows[0].entry.player.playerId).toBe("p2")
    expect(board.mostAssists.rows[0].entry.player.playerId).toBe("p1")
    // Nobody is near 20 appearances, so this board is legitimately empty.
    expect(board.bestAverageRating.rows).toEqual([])
  })

  it("returns empty boards, not an error, when nothing has been played", () => {
    const board = buildPlayerHallOfFame({ records: [], players: new Map(), clubs: new Map() }, NOW)
    expect(board.playersWithHistory).toBe(0)
    expect(board.mostAppearances.rows).toEqual([])
    expect(board.mostGoals.rows).toEqual([])
    expect(board.mostAssists.rows).toEqual([])
    expect(board.bestAverageRating.rows).toEqual([])
  })

  it("reproduces Production's shape today: 2 appearances each, and an empty rating board", () => {
    // prod:players:distribution, 2026-09-04: 844 players, appearances min=1
    // max=2, so >= 20 admits nobody. The empty state is the correct answer,
    // and this test fails the day that stops being true for the wrong reason.
    const records = [...appearances("p1", 2, { rating: 8.8 }), ...appearances("p2", 2, { rating: 4.45 })]
    const board = buildPlayerHallOfFame({ records, players: PLAYERS, clubs: CLUBS }, NOW)
    expect(board.mostAppearances.rows.map((r) => r.value)).toEqual([2, 2])
    expect(board.bestAverageRating.rows).toEqual([])
  })

  it("never mutates the records it was handed", () => {
    const records = appearances("p1", 3, { goals: 1 })
    const snapshot = JSON.stringify(records)
    buildPlayerHallOfFame({ records, players: PLAYERS, clubs: CLUBS }, NOW)
    expect(JSON.stringify(records)).toBe(snapshot)
  })
})

describe("counted nouns in every locale", () => {
  const NUMBERS: number[] = [0, 1, 2, 3, 11, 20, 100]

  it.each(LOCALES as readonly Locale[])("%s never renders a bare category name or a missing key", (locale) => {
    const t = getTranslator(locale)
    for (const key of ["hof.goals", "hof.assists", "hof.appearances"]) {
      for (const n of NUMBERS) {
        const text = pluralise(locale, t, key, n, String(n))
        expect(text).not.toBe(key)
        expect(text).not.toContain("{n}")
        expect(text.startsWith("hof.")).toBe(false)
      }
    }
  })

  it("uses English's singular for 1 and plural for everything else", () => {
    const t = getTranslator("en")
    expect(pluralise("en", t, "hof.goals", 1, "1")).toBe("1 goal")
    expect(pluralise("en", t, "hof.goals", 2, "2")).toBe("2 goals")
    expect(pluralise("en", t, "hof.appearances", 1, "1")).toBe("1 appearance")
    expect(pluralise("en", t, "hof.appearances", 20, "20")).toBe("20 appearances")
  })

  it("uses Hebrew's dual for 2", () => {
    const t = getTranslator("he")
    expect(pluralise("he", t, "hof.goals", 2, "2")).toBe("שני שערים")
    expect(pluralise("he", t, "hof.appearances", 2, "2")).toBe("שתי הופעות")
  })

  it("uses Arabic's own categories, including the ones Hebrew has no form for", () => {
    const t = getTranslator("ar")
    // ar selects zero/one/two/few/many/other; each must resolve to real text.
    const categories = new Set(NUMBERS.map((n) => new Intl.PluralRules("ar").select(n)))
    expect(categories.size).toBeGreaterThan(3)
    expect(pluralise("ar", t, "hof.goals", 1, "1")).toBe("هدف واحد")
    expect(pluralise("ar", t, "hof.goals", 2, "2")).toBe("هدفان")
    expect(pluralise("ar", t, "hof.goals", 0, "0")).toBe("بلا أهداف")
  })
})

describe("a board is a top ten, cut on rank so a tie is never split", () => {
  const PLAYERS = new Map(
    Array.from({ length: 30 }, (_, i) => player(`p${String(i).padStart(2, "0")}`, `N${i}`)).map((p) => [
      p.playerId,
      p,
    ])
  )

  it("shows ten places, not thirty, when every value is distinct", () => {
    const careers = buildPlayerCareers(
      Array.from({ length: 30 }, (_, i) => rec({ playerId: `p${String(i).padStart(2, "0")}`, goals: 30 - i }))
    )
    const rows = mostGoals(careers, PLAYERS, CLUBS)
    expect(rows).toHaveLength(PLAYER_BOARD_PLACES)
    expect(rows[rows.length - 1].rank).toBe(10)
  })

  it("shows everyone sharing tenth, so the board can be longer than ten", () => {
    // Nine distinct values, then four players tied on the tenth.
    const records = [
      ...Array.from({ length: 9 }, (_, i) => rec({ playerId: `p${String(i).padStart(2, "0")}`, goals: 100 - i })),
      ...["p20", "p21", "p22", "p23"].map((id) => rec({ playerId: id, goals: 5 })),
      rec({ playerId: "p29", goals: 1 }),
    ]
    const rows = mostGoals(buildPlayerCareers(records), PLAYERS, CLUBS)
    expect(rows).toHaveLength(13)
    expect(rows.slice(9).map((r) => r.rank)).toEqual([10, 10, 10, 10])
    // and the player below the tie is cut, because rank 14 > 10
    expect(rows.some((r) => r.entry.player.playerId === "p29")).toBe(false)
  })

  it("cuts a tie that would ITSELF overflow the board only at the rank boundary", () => {
    // Twelve players tied on top: all rank 1, so all twelve are shown.
    const records = Array.from({ length: 12 }, (_, i) =>
      rec({ playerId: `p${String(i).padStart(2, "0")}`, goals: 7 })
    )
    const rows = mostGoals(buildPlayerCareers(records), PLAYERS, CLUBS)
    expect(rows).toHaveLength(12)
    expect(new Set(rows.map((r) => r.rank))).toEqual(new Set([1]))
  })

  it("caps every board, and reports the number of places", () => {
    const records = Array.from({ length: 30 }, (_, i) =>
      Array.from({ length: MIN_APPEARANCES_FOR_RATING }, () =>
        rec({ playerId: `p${String(i).padStart(2, "0")}`, goals: 30 - i, assists: 30 - i, rating: 5 + i / 10 })
      )
    ).flat()
    const board = buildPlayerHallOfFame({ records, players: PLAYERS, clubs: CLUBS }, NOW)
    expect(board.places).toBe(PLAYER_BOARD_PLACES)
    expect(board.mostGoals.rows).toHaveLength(10)
    expect(board.mostAssists.rows).toHaveLength(10)
    // All 30 have the SAME 20 appearances, so 1st place is a group of 30 -
    // wider than the row budget, so it is summarised rather than truncated.
    expect(board.mostAppearances.rows).toEqual([])
    expect(board.mostAppearances.shared).toEqual([{ rank: 1, value: MIN_APPEARANCES_FOR_RATING, players: 30 }])
    expect(PLAYER_BOARD_MAX_ROWS).toBe(25)
    expect(board.bestAverageRating.rows).toHaveLength(10)
    // playersWithHistory still counts EVERYONE - the cap is display, not truth.
    expect(board.playersWithHistory).toBe(30)
  })
})

describe("boardTop", () => {
  const ranked = () =>
    rankEntries(
      [
        { id: "a", v: 5 },
        { id: "b", v: 4 },
        { id: "c", v: 4 },
        { id: "d", v: 1 },
      ],
      (e) => e.v,
      (e) => e.id
    )

  it("keeps whole rank groups up to the number of places", () => {
    expect(boardTop(ranked(), 2, 50).rows.map((r) => r.entry.id)).toEqual(["a", "b", "c"])
    expect(boardTop(ranked(), 1, 50).rows.map((r) => r.entry.id)).toEqual(["a"])
    expect(boardTop(ranked(), 0, 50).rows).toEqual([])
  })

  it("summarises a group that would not fit, rather than truncating it", () => {
    // Budget of 2: "a" fits, the pair on 4 does not, so it is described.
    const cut = boardTop(ranked(), 10, 2)
    expect(cut.rows.map((r) => r.entry.id)).toEqual(["a"])
    // and everything BELOW it is summarised too - 4th place shown in full
    // under a hidden 2nd would misrepresent the board.
    expect(cut.shared).toEqual([
      { rank: 2, value: 4, players: 2 },
      { rank: 4, value: 1, players: 1 },
    ])
  })

  it("summarises the FIRST group when even that does not fit", () => {
    // The shape Production is in today: everybody on the same figure.
    const crowd = rankEntries(
      Array.from({ length: 844 }, (_, i) => ({ id: `p${i}`, v: 2 })),
      (e) => e.v,
      (e) => e.id
    )
    const cut = boardTop(crowd, 10, 25)
    expect(cut.rows).toEqual([])
    expect(cut.shared).toEqual([{ rank: 1, value: 2, players: 844 }])
  })

  it("never shows a later place in full beneath a summarised one", () => {
    const rows = rankEntries(
      [
        ...Array.from({ length: 5 }, (_, i) => ({ id: `top${i}`, v: 9 })),
        { id: "solo", v: 3 },
      ],
      (e) => e.v,
      (e) => e.id
    )
    const cut = boardTop(rows, 10, 3)
    expect(cut.rows).toEqual([])
    expect(cut.shared.map((p) => [p.rank, p.players])).toEqual([
      [1, 5],
      [6, 1],
    ])
  })

  it("shows everything when it all fits", () => {
    const cut = boardTop(ranked(), 10, 50)
    expect(cut.rows).toHaveLength(4)
    expect(cut.shared).toEqual([])
  })
})
