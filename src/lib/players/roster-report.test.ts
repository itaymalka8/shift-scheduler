import { AGE_THRESHOLDS, summariseAges, summariseRosterShape } from "./roster-report"
import { MAX_ACTIVE_ROSTER_SIZE } from "./roster"

/**
 * The read-only summaries the production audit prints before a season roll.
 * They decide nothing, but they are what the decision to deploy is read
 * from, so a wrong percentile or a miscounted threshold is a wrong answer to
 * "how much replenishment will the first roll have to do".
 */

describe("summariseAges", () => {
  it("reports nothing for an empty league rather than guessing", () => {
    const summary = summariseAges([])
    expect(summary).toEqual({
      count: 0,
      min: null,
      p25: null,
      median: null,
      p75: null,
      p90: null,
      max: null,
      atOrAbove: [],
    })
  })

  it("orders the percentiles off the sorted ages, not the input order", () => {
    const ages = [40, 18, 30, 22, 35, 27, 19, 33, 25, 29]
    const summary = summariseAges(ages)
    expect(summary.count).toBe(10)
    expect(summary.min).toBe(18)
    expect(summary.max).toBe(40)
    expect(summary.p25).toBeLessThanOrEqual(summary.median!)
    expect(summary.median).toBeLessThanOrEqual(summary.p75!)
    expect(summary.p75).toBeLessThanOrEqual(summary.p90!)
  })

  it("counts every threshold the phase asked for, oldest last", () => {
    const summary = summariseAges([28, 31, 34, 36, 38, 41])
    expect(summary.atOrAbove.map((row) => row.age)).toEqual([...AGE_THRESHOLDS])
    const at = (age: number) => summary.atOrAbove.find((row) => row.age === age)!.players
    expect(at(30)).toBe(5)
    expect(at(34)).toBe(4)
    expect(at(35)).toBe(3)
    expect(at(36)).toBe(3)
    expect(at(37)).toBe(2)
    expect(at(38)).toBe(2)
    expect(at(39)).toBe(1)
    expect(at(40)).toBe(1)
  })

  it("reports each threshold's share of the squad to one decimal", () => {
    const summary = summariseAges([20, 20, 20, 35])
    expect(summary.atOrAbove.find((row) => row.age === 34)!.share).toBe(25)
  })

  it("is monotonic: no threshold can hold more players than a younger one", () => {
    const summary = summariseAges([19, 24, 29, 30, 33, 34, 35, 37, 39, 42])
    const counts = summary.atOrAbove.map((row) => row.players)
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index]).toBeLessThanOrEqual(counts[index - 1])
    }
  })
})

/** A squad of the given shape, as the report reads it: positions only. */
function squadOf(shape: Record<string, number>) {
  return Object.entries(shape).flatMap(([primaryPosition, n]) =>
    Array.from({ length: n }, () => ({ primaryPosition }))
  )
}

describe("summariseRosterShape", () => {
  const legal = squadOf({ GK: 2, CB: 4, CM: 4, ST: 2, RM: 2, LW: 2 }) // 16, every floor met
  const short = squadOf({ GK: 1, CB: 4, CM: 4, ST: 2 }) // 11, a keeper and five bodies short
  const full = squadOf({ GK: 2, CB: 8, CM: 8, ST: 4 }) // 22, on the cap and legal

  it("counts a club that already clears the floor as needing nothing", () => {
    const summary = summariseRosterShape([{ teamId: "a", label: "A", squad: legal }])
    expect(summary.clubsBelowFloor).toBe(0)
    expect(summary.clubsAtOrAboveFloor).toBe(1)
    expect(summary.playersThatWouldBeGenerated).toBe(0)
    expect(summary.unresolvable).toHaveLength(0)
  })

  it("reports the minimum additions for a club that is short", () => {
    const summary = summariseRosterShape([{ teamId: "b", label: "B", squad: short }])
    expect(summary.clubsBelowFloor).toBe(1)
    // Five to reach sixteen, which also covers the single missing keeper -
    // max, never sum.
    expect(summary.playersThatWouldBeGenerated).toBe(5)
    expect(summary.clubs[0].counts).toMatchObject({ total: 11, GK: 1, DF: 4, MF: 4, FW: 2 })
  })

  it("totals the generated players across the whole league", () => {
    const summary = summariseRosterShape([
      { teamId: "a", label: "A", squad: legal },
      { teamId: "b", label: "B", squad: short },
      { teamId: "c", label: "C", squad: short },
    ])
    expect(summary.clubs).toHaveLength(3)
    expect(summary.clubsBelowFloor).toBe(2)
    expect(summary.clubsAtOrAboveFloor).toBe(1)
    expect(summary.playersThatWouldBeGenerated).toBe(10)
  })

  it("names the clubs that could not reach the floor inside the cap", () => {
    // Twenty-two outfielders and no keeper: the floor wants two, and there is
    // no room for either.
    const keeperless = squadOf({ CB: 8, CM: 8, ST: 6 })
    const summary = summariseRosterShape([
      { teamId: "a", label: "A", squad: legal },
      { teamId: "x", label: "X (BOT)", squad: keeperless },
    ])
    expect(summary.unresolvable.map((club) => club.teamId)).toEqual(["x"])
    expect(summary.unresolvable[0].label).toBe("X (BOT)")
    expect(summary.unresolvable[0].counts.GK).toBe(0)
  })

  it("treats a legal club on the cap as resolvable, not as a problem", () => {
    const summary = summariseRosterShape([{ teamId: "f", label: "F", squad: full }])
    expect(summary.clubs[0].counts.total).toBe(MAX_ACTIVE_ROSTER_SIZE)
    expect(summary.clubs[0].needed).toBe(0)
    expect(summary.unresolvable).toHaveLength(0)
  })

  it("reports the cap it judged against, so the printed number is never a literal", () => {
    expect(summariseRosterShape([]).cap).toBe(MAX_ACTIVE_ROSTER_SIZE)
  })

  it("says nothing at all about an empty league", () => {
    const summary = summariseRosterShape([])
    expect(summary.clubs).toHaveLength(0)
    expect(summary.clubsBelowFloor).toBe(0)
    expect(summary.playersThatWouldBeGenerated).toBe(0)
  })
})
