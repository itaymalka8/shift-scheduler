import {
  EMPTY_CAREER_TOTALS,
  SMALL_SAMPLE_APPEARANCES,
  buildPlayerCareer,
  computeCareerRates,
  computeCareerTotals,
  computeClubTotals,
  isSmallSample,
  type CareerMatchRecord,
  type DatedCareerMatchRecord,
} from "./career"

const DAY = 86_400_000
const START = new Date("2026-01-01T19:00:00.000Z")
const day = (n: number) => new Date(START.getTime() + n * DAY)

function rec(over: Partial<CareerMatchRecord> = {}): CareerMatchRecord {
  return {
    fixtureId: "f1",
    teamId: "t-alpha",
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
    ...over,
  }
}
function dated(n: number, over: Partial<DatedCareerMatchRecord> = {}): DatedCareerMatchRecord {
  return { ...rec(over), fixtureId: over.fixtureId ?? `f${n}`, kickoffAt: over.kickoffAt ?? day(n) }
}
/** n appearances for one club, so a career can be built at a chosen length. */
function spell(club: string, from: number, count: number, over: Partial<DatedCareerMatchRecord> = {}) {
  return Array.from({ length: count }, (_, i) => dated(from + i, { teamId: club, fixtureId: `${club}-${from + i}`, ...over }))
}

describe("computeCareerTotals", () => {
  it("returns an all-zero total, and a NULL average, for no appearances", () => {
    const totals = computeCareerTotals([])
    expect(totals).toEqual(EMPTY_CAREER_TOTALS)
    // Null, not 0.0 - a player with no games did not average zero.
    expect(totals.averageRating).toBeNull()
    expect(totals.appearances).toBe(0)
  })

  it("sums every counting stat across appearances", () => {
    const totals = computeCareerTotals([
      rec({
        minutesPlayed: 90, goals: 2, assists: 1, shots: 5, shotsOnTarget: 3,
        passesAttempted: 40, passesCompleted: 34, keyPasses: 2, dribblesAttempted: 6,
        dribblesCompleted: 4, tackles: 3, interceptions: 2, aerialDuelsWon: 1,
        fouls: 2, yellowCards: 1, redCards: 0, saves: 0, rating: 8,
      }),
      rec({
        minutesPlayed: 45, goals: 1, assists: 2, shots: 3, shotsOnTarget: 1,
        passesAttempted: 20, passesCompleted: 16, keyPasses: 1, dribblesAttempted: 2,
        dribblesCompleted: 1, tackles: 1, interceptions: 1, aerialDuelsWon: 2,
        fouls: 0, yellowCards: 0, redCards: 1, saves: 4, rating: 7,
      }),
    ])
    expect(totals.appearances).toBe(2)
    expect(totals.minutesPlayed).toBe(135)
    expect(totals.goals).toBe(3)
    expect(totals.assists).toBe(3)
    expect(totals.shots).toBe(8)
    expect(totals.shotsOnTarget).toBe(4)
    expect(totals.passesAttempted).toBe(60)
    expect(totals.passesCompleted).toBe(50)
    expect(totals.keyPasses).toBe(3)
    expect(totals.dribblesAttempted).toBe(8)
    expect(totals.dribblesCompleted).toBe(5)
    expect(totals.tackles).toBe(4)
    expect(totals.interceptions).toBe(3)
    expect(totals.aerialDuelsWon).toBe(3)
    expect(totals.fouls).toBe(2)
    expect(totals.yellowCards).toBe(1)
    expect(totals.redCards).toBe(1)
    expect(totals.saves).toBe(4)
    expect(totals.averageRating).toBe(7.5)
  })

  it("counts one row as one appearance, never de-duplicating", () => {
    // @@unique([fixtureId, playerId]) is what makes this safe: two rows are
    // two matches, so a DISTINCT would hide a duplicate the domain forbids.
    expect(computeCareerTotals(Array.from({ length: 7 }, () => rec())).appearances).toBe(7)
  })

  it("counts a zero-minute row as an appearance and keeps its rating", () => {
    // A stoppage-time cameo, not an unused substitute: the engine writes no
    // row at all for a player who never came on.
    const totals = computeCareerTotals([rec({ rating: 8, minutesPlayed: 90 }), rec({ rating: 6, minutesPlayed: 0 })])
    expect(totals.appearances).toBe(2)
    expect(totals.minutesPlayed).toBe(90)
    expect(totals.averageRating).toBe(7)
  })

  it("computes the average as ratingSum / appearances exactly, unrounded", () => {
    const totals = computeCareerTotals([rec({ rating: 7 }), rec({ rating: 8 }), rec({ rating: 6.4 })])
    expect(totals.averageRating).toBe(totals.ratingSum / totals.appearances)
    // Deliberately NOT rounded here: 7.133333... survives to the page.
    expect(totals.averageRating).toBeCloseTo(7.133333, 5)
    expect(totals.averageRating).not.toBe(7.13)
  })

  it("never mutates the records it was handed", () => {
    const records = [rec({ goals: 2 }), rec({ goals: 1 })]
    const snapshot = JSON.stringify(records)
    computeCareerTotals(records)
    expect(JSON.stringify(records)).toBe(snapshot)
  })
})

describe("computeClubTotals - history is attributed by the row's teamId", () => {
  it("splits a transfer into two clubs and keeps ONE continuous career", () => {
    // Club A 10 appearances, transfer, Club B 5. The brief's exact case.
    const records = [...spell("A", 0, 10, { goals: 1 }), ...spell("B", 20, 5, { goals: 2 })]
    const career = buildPlayerCareer(records)

    expect(career.totals.appearances).toBe(15)
    expect(career.totals.goals).toBe(10 * 1 + 5 * 2)

    const byClub = new Map(career.clubs.map((c) => [c.teamId, c]))
    expect(byClub.get("A")!.totals.appearances).toBe(10)
    expect(byClub.get("B")!.totals.appearances).toBe(5)
    expect(byClub.get("A")!.totals.goals).toBe(10)
    expect(byClub.get("B")!.totals.goals).toBe(10)
  })

  it("aggregates a return to a former club into ONE row for that club", () => {
    // A, then B, then A again. The player has one career and A has one row
    // holding every appearance they ever made there - splitting on the gap
    // would be inferring a spell from silence.
    const records = [...spell("A", 0, 3), ...spell("B", 10, 2), ...spell("A", 20, 4)]
    const clubs = computeClubTotals(records)
    expect(clubs).toHaveLength(2)
    const byClub = new Map(clubs.map((c) => [c.teamId, c]))
    expect(byClub.get("A")!.totals.appearances).toBe(7)
    expect(byClub.get("B")!.totals.appearances).toBe(2)
  })

  it("bounds each club by the FIRST and LAST time they actually played for it", () => {
    const records = [...spell("A", 0, 3), ...spell("B", 10, 2), ...spell("A", 20, 4)]
    const byClub = new Map(computeClubTotals(records).map((c) => [c.teamId, c]))
    // A spans the whole thing, because they really did play for A on both dates.
    expect(byClub.get("A")!.firstAppearanceAt).toEqual(day(0))
    expect(byClub.get("A")!.lastAppearanceAt).toEqual(day(23))
    expect(byClub.get("B")!.firstAppearanceAt).toEqual(day(10))
    expect(byClub.get("B")!.lastAppearanceAt).toEqual(day(11))
  })

  it("orders clubs by real participation - most recent last appearance first", () => {
    const records = [...spell("A", 0, 3), ...spell("B", 10, 2), ...spell("C", 30, 1)]
    expect(computeClubTotals(records).map((c) => c.teamId)).toEqual(["C", "B", "A"])
  })

  it("breaks an exact date tie by immutable teamId, never by name", () => {
    const records = [dated(5, { teamId: "z-club", fixtureId: "f-z" }), dated(5, { teamId: "a-club", fixtureId: "f-a" })]
    expect(computeClubTotals(records).map((c) => c.teamId)).toEqual(["a-club", "z-club"])
  })

  it("gives a single-appearance club equal first and last dates", () => {
    const [club] = computeClubTotals(spell("A", 4, 1))
    expect(club.firstAppearanceAt).toEqual(club.lastAppearanceAt)
    expect(club.totals.appearances).toBe(1)
  })

  it("returns no clubs for no records", () => {
    expect(computeClubTotals([])).toEqual([])
  })
})

describe("computeCareerRates - derived, never stored, and safe at zero", () => {
  it("returns null for every rate with no appearances", () => {
    const rates = computeCareerRates(computeCareerTotals([]))
    expect(rates).toEqual({
      goalsPerAppearance: null,
      assistsPerAppearance: null,
      goalsPer90: null,
      assistsPer90: null,
      shotAccuracy: null,
      passAccuracy: null,
    })
  })

  it("returns null, not 0, for a player who never shot or never passed", () => {
    // "No shots attempted" and "0% accuracy" are different facts.
    const rates = computeCareerRates(computeCareerTotals([rec({ shots: 0, passesAttempted: 0 })]))
    expect(rates.shotAccuracy).toBeNull()
    expect(rates.passAccuracy).toBeNull()
  })

  it("survives a career of only zero-minute cameos without dividing by zero", () => {
    const rates = computeCareerRates(computeCareerTotals([rec({ minutesPlayed: 0, goals: 0 }), rec({ minutesPlayed: 0 })]))
    expect(rates.goalsPer90).toBeNull()
    expect(rates.assistsPer90).toBeNull()
    // Per APPEARANCE still works - they did appear, twice.
    expect(rates.goalsPerAppearance).toBe(0)
  })

  it("computes per-appearance and per-90 from the right denominators", () => {
    const totals = computeCareerTotals([
      rec({ minutesPlayed: 90, goals: 2, assists: 1 }),
      rec({ minutesPlayed: 45, goals: 0, assists: 1 }),
    ])
    expect(computeCareerRates(totals).goalsPerAppearance).toBe(1)
    // Per 90 MINUTES PLAYED (135), not per 90 of two matches.
    expect(computeCareerRates(totals).goalsPer90).toBeCloseTo((2 * 90) / 135, 10)
    expect(computeCareerRates(totals).assistsPer90).toBeCloseTo((2 * 90) / 135, 10)
  })

  it("computes accuracy as a 0..1 share", () => {
    const totals = computeCareerTotals([rec({ shots: 4, shotsOnTarget: 3, passesAttempted: 50, passesCompleted: 40 })])
    expect(computeCareerRates(totals).shotAccuracy).toBe(0.75)
    expect(computeCareerRates(totals).passAccuracy).toBe(0.8)
  })
})

describe("small sample is a label, never a filter", () => {
  it("is not the Hall of Fame threshold", () => {
    // The leaderboard's 20 decides who may be RANKED. This decides nothing -
    // a profile shows a career average after one appearance, because it is
    // that player's real average.
    expect(SMALL_SAMPLE_APPEARANCES).toBe(5)
    expect(SMALL_SAMPLE_APPEARANCES).toBeLessThan(20)
  })

  it("flags a short career and not an empty or a long one", () => {
    expect(isSmallSample(computeCareerTotals([]))).toBe(false)
    expect(isSmallSample(computeCareerTotals([rec()]))).toBe(true)
    expect(isSmallSample(computeCareerTotals(Array.from({ length: 4 }, () => rec())))).toBe(true)
    expect(isSmallSample(computeCareerTotals(Array.from({ length: 5 }, () => rec())))).toBe(false)
  })

  it("still reports an average rating for a one-appearance career", () => {
    const career = buildPlayerCareer([dated(0, { rating: 9.4 })])
    expect(career.totals.averageRating).toBe(9.4)
    expect(career.smallSample).toBe(true)
  })
})

describe("buildPlayerCareer", () => {
  it("assembles totals, rates and clubs from one set of records", () => {
    const career = buildPlayerCareer([...spell("A", 0, 2, { goals: 1 }), ...spell("B", 5, 1, { goals: 3 })])
    expect(career.totals.appearances).toBe(3)
    expect(career.totals.goals).toBe(5)
    expect(career.clubsRepresented).toBe(2)
    expect(career.rates.goalsPerAppearance).toBeCloseTo(5 / 3, 10)
  })

  it("returns an empty but valid career for a player who never played", () => {
    const career = buildPlayerCareer([])
    expect(career.totals.appearances).toBe(0)
    expect(career.totals.averageRating).toBeNull()
    expect(career.clubs).toEqual([])
    expect(career.clubsRepresented).toBe(0)
    expect(career.smallSample).toBe(false)
  })
})
