import {
  formatRating,
  groupByHistoricalTeam,
  isGoalkeeper,
  passAccuracy,
  ratingBand,
  shootingColumnsFor,
  sortPlayerStats,
  type PlayerMatchStatView,
} from "./player-stats-view"

const HOME = "team-home"
const AWAY = "team-away"

function stat(overrides: Partial<PlayerMatchStatView> = {}): PlayerMatchStatView {
  return {
    playerId: "p1",
    teamId: HOME,
    firstName: "Test",
    lastName: "Player",
    primaryPosition: "CM",
    shirtNumber: 8,
    minutesPlayed: 90,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passesAttempted: 0,
    passesCompleted: 0,
    keyPasses: 0,
    dribblesAttempted: 0,
    dribblesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    aerialDuelsWon: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    rating: 6,
    ...overrides,
  }
}

describe("passAccuracy", () => {
  it("is a rounded percentage of completed over attempted", () => {
    expect(passAccuracy({ passesAttempted: 40, passesCompleted: 34 })).toBe(85)
    expect(passAccuracy({ passesAttempted: 3, passesCompleted: 2 })).toBe(67)
  })

  it("returns null - never NaN - when the player attempted no passes", () => {
    // 0/0 is NaN in JS, which would render literally as "NaN%".
    expect(passAccuracy({ passesAttempted: 0, passesCompleted: 0 })).toBeNull()
    expect(Number.isNaN(passAccuracy({ passesAttempted: 0, passesCompleted: 0 }) as number)).toBe(false)
  })

  it("returns null rather than 0 for a player who did not pass", () => {
    // 0% would read as a terrible performance; the measurement simply does
    // not exist for a substitute who never touched the ball.
    expect(passAccuracy({ passesAttempted: 0, passesCompleted: 0 })).not.toBe(0)
  })

  it("handles a perfect record and a negative-guard input", () => {
    expect(passAccuracy({ passesAttempted: 10, passesCompleted: 10 })).toBe(100)
    expect(passAccuracy({ passesAttempted: -1, passesCompleted: 0 })).toBeNull()
  })
})

describe("formatRating", () => {
  it("always shows one decimal, so 7 and 7.04 read alike", () => {
    expect(formatRating(7)).toBe("7.0")
    expect(formatRating(7.04)).toBe("7.0")
    expect(formatRating(6.46)).toBe("6.5")
    expect(formatRating(6.75)).toBe("6.8")
    expect(formatRating(10)).toBe("10.0")
  })

  it("inherits toFixed's binary rounding, which is fine for a display value", () => {
    // 6.55 is not exactly representable in binary floating point - the
    // stored double is a hair below it - so toFixed yields "6.5", not
    // "6.6". Asserted rather than worked around: a rating is a display
    // value, a tenth either way carries no game meaning, and rounding it
    // "correctly" would mean writing arithmetic that could drift from
    // calculateMatchRating, which this phase must not touch.
    expect(formatRating(6.55)).toBe("6.5")
  })
})

describe("goalkeeper handling", () => {
  it("identifies a goalkeeper by primaryPosition", () => {
    expect(isGoalkeeper(stat({ primaryPosition: "GK" }))).toBe(true)
    expect(isGoalkeeper(stat({ primaryPosition: "CB" }))).toBe(false)
    expect(isGoalkeeper(stat({ primaryPosition: "ST" }))).toBe(false)
  })

  it("gives a keeper the saves column and everyone else the shots column", () => {
    // Mutually exclusive: an outfield player's saves is structurally 0, and
    // a keeper's shots are noise. Neither column becomes a run of zeroes.
    expect(shootingColumnsFor(stat({ primaryPosition: "GK" }))).toBe("saves")
    expect(shootingColumnsFor(stat({ primaryPosition: "LW" }))).toBe("shots")
  })
})

describe("sortPlayerStats - best performance first", () => {
  it("orders by rating descending", () => {
    const sorted = sortPlayerStats([
      stat({ playerId: "low", rating: 5.9 }),
      stat({ playerId: "high", rating: 8.7 }),
      stat({ playerId: "mid", rating: 7.1 }),
    ])
    expect(sorted.map((s) => s.playerId)).toEqual(["high", "mid", "low"])
  })

  it("breaks a rating tie by goals, then by minutes played", () => {
    const sorted = sortPlayerStats([
      stat({ playerId: "sub", rating: 7, goals: 1, minutesPlayed: 20 }),
      stat({ playerId: "starter", rating: 7, goals: 1, minutesPlayed: 90 }),
      stat({ playerId: "scorer", rating: 7, goals: 2, minutesPlayed: 10 }),
    ])
    expect(sorted.map((s) => s.playerId)).toEqual(["scorer", "starter", "sub"])
  })

  it("is total and stable - identical rows never swap between renders", () => {
    const rows = [stat({ playerId: "b" }), stat({ playerId: "a" }), stat({ playerId: "c" })]
    expect(sortPlayerStats(rows).map((s) => s.playerId)).toEqual(["a", "b", "c"])
    expect(sortPlayerStats(rows).map((s) => s.playerId)).toEqual(sortPlayerStats(rows).map((s) => s.playerId))
  })

  it("does not mutate its input", () => {
    const rows = [stat({ playerId: "b", rating: 6 }), stat({ playerId: "a", rating: 9 })]
    const before = rows.map((s) => s.playerId)
    sortPlayerStats(rows)
    expect(rows.map((s) => s.playerId)).toEqual(before)
  })
})

describe("groupByHistoricalTeam - attribution must survive a transfer", () => {
  it("groups by the row's historical teamId, NOT by the player's current club", () => {
    // THE INVARIANT. This player turned out for the HOME side that day and
    // has since been transferred to AWAY. PlayerMatchStats.teamId is the
    // snapshot of who he played for; Player.teamId is who owns him now.
    // Grouping by the latter would hand his past performance to the club
    // that bought him afterwards.
    const transferred = stat({ playerId: "transferred", teamId: HOME, rating: 8 })
    const currentTeamIdAfterTransfer = AWAY
    expect(transferred.teamId).not.toBe(currentTeamIdAfterTransfer)

    const { home, away } = groupByHistoricalTeam([transferred], HOME, AWAY)

    expect(home.map((s) => s.playerId)).toEqual(["transferred"])
    expect(away).toEqual([])
  })

  it("splits a full match into the two sides that played it", () => {
    const rows = [
      stat({ playerId: "h1", teamId: HOME, rating: 7 }),
      stat({ playerId: "a1", teamId: AWAY, rating: 8 }),
      stat({ playerId: "h2", teamId: HOME, rating: 9 }),
    ]
    const { home, away } = groupByHistoricalTeam(rows, HOME, AWAY)
    expect(home.map((s) => s.playerId)).toEqual(["h2", "h1"])
    expect(away.map((s) => s.playerId)).toEqual(["a1"])
  })

  it("sorts each side independently, best first", () => {
    const rows = [
      stat({ playerId: "h-low", teamId: HOME, rating: 6 }),
      stat({ playerId: "h-high", teamId: HOME, rating: 9 }),
      stat({ playerId: "a-low", teamId: AWAY, rating: 5 }),
      stat({ playerId: "a-high", teamId: AWAY, rating: 8 }),
    ]
    const { home, away } = groupByHistoricalTeam(rows, HOME, AWAY)
    expect(home.map((s) => s.playerId)).toEqual(["h-high", "h-low"])
    expect(away.map((s) => s.playerId)).toEqual(["a-high", "a-low"])
  })

  it("drops a row belonging to neither side rather than guessing one", () => {
    const rows = [stat({ playerId: "stranger", teamId: "team-other" }), stat({ playerId: "h1", teamId: HOME })]
    const { home, away } = groupByHistoricalTeam(rows, HOME, AWAY)
    expect(home.map((s) => s.playerId)).toEqual(["h1"])
    expect(away).toEqual([])
  })

  it("returns empty sides for a match with no rows - never fabricated players", () => {
    expect(groupByHistoricalTeam([], HOME, AWAY)).toEqual({ home: [], away: [] })
  })
})

describe("ratingBand - display only", () => {
  it("bands a rating for colour, with no game meaning", () => {
    expect(ratingBand(9.2)).toBe("excellent")
    expect(ratingBand(8)).toBe("excellent")
    expect(ratingBand(7.4)).toBe("good")
    expect(ratingBand(6)).toBe("average")
    expect(ratingBand(5.2)).toBe("poor")
  })
})
