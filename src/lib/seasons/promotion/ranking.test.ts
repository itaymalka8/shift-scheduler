import { rankDivision, flattenRanking, tiedRungs, rungAtRank } from "./ranking"
import type { TitleFixture } from "../champion"

/**
 * The full division ranking, tested as arithmetic.
 *
 * Before Phase 3Q the only complete 1..20 order in this codebase was
 * computeStandings, whose final comparator is teamName.localeCompare - a
 * DISPLAY tiebreak that champion.ts explicitly forbids for sporting merit,
 * because a club's name is mutable and localeCompare depends on the runtime's
 * ICU default. Slicing promotion places off that order would have relegated a
 * club for being called what it is called. These tests pin the replacement.
 */

function win(homeTeamId: string, awayTeamId: string, homeScore: number, awayScore: number): TitleFixture {
  return { homeTeamId, awayTeamId, homeScore, awayScore }
}

describe("a division the table separates outright", () => {
  const fixtures = [win("a", "b", 3, 0), win("b", "c", 2, 0), win("c", "a", 1, 0)]

  it("orders by points, then goal difference, then goals scored", () => {
    // a: 3pts, +2 (3-1). b: 3pts, +(-1) (2-3). c: 3pts, -1... recompute:
    // a beat b 3-0, lost to c 0-1  -> 3pts, GF3 GA1, GD +2
    // b lost to a 0-3, beat c 2-0  -> 3pts, GF2 GA3, GD -1
    // c beat a 1-0, lost to b 0-2  -> 3pts, GF1 GA2, GD -1
    // b and c are level on points and GD; b has more goals scored.
    const rungs = rankDivision(["a", "b", "c"], fixtures)
    expect(flattenRanking(rungs)).toEqual(["a", "b", "c"])
    expect(tiedRungs(rungs)).toHaveLength(0)
  })

  it("does not depend on the order the clubs are supplied in", () => {
    const forwards = flattenRanking(rankDivision(["a", "b", "c"], fixtures))
    const backwards = flattenRanking(rankDivision(["c", "b", "a"], fixtures))
    expect(backwards).toEqual(forwards)
  })

  it("does not depend on the order the fixtures are supplied in", () => {
    const shuffled = [fixtures[2], fixtures[0], fixtures[1]]
    expect(flattenRanking(rankDivision(["a", "b", "c"], shuffled))).toEqual(
      flattenRanking(rankDivision(["a", "b", "c"], fixtures))
    )
  })
})

describe("head to head, and the remove-and-recompute rule", () => {
  it("separates two clubs level on every table criterion by their own results", () => {
    // Constructed so x and y are IDENTICAL on points (4), goal difference
    // (-1) and goals scored (1) across the whole table - so nothing but
    // head-to-head can separate them - while x took 4 points off y and y took
    // 1 off x.
    const fixtures = [
      win("x", "y", 1, 0), // x 3pts
      win("y", "x", 0, 0), // one each
      win("z", "x", 1, 0),
      win("x", "z", 0, 1),
      win("y", "z", 1, 0), // y 3pts
      win("z", "y", 1, 0),
    ]
    const rungs = rankDivision(["x", "y", "z"], fixtures)
    expect(rungs[0].teamIds).toEqual(["z"])
    expect(rungs[1].teamIds).toEqual(["x"])
    expect(rungs[1].via).toBe("headToHead")
    expect(rungs[2].teamIds).toEqual(["y"])
  })

  it("reports a group that survives every criterion as genuinely tied", () => {
    // p and q drew both meetings and have identical records everywhere.
    const fixtures = [win("p", "q", 1, 1), win("q", "p", 1, 1)]
    const rungs = rankDivision(["p", "q"], fixtures)
    expect(rungs).toHaveLength(1)
    expect(rungs[0].teamIds.sort()).toEqual(["p", "q"])
    expect(rungs[0].via).toBe("tied")
    expect(rungs[0].firstRank).toBe(1)
  })

  it("refuses to flatten a ranking that still holds a tie", () => {
    const rungs = rankDivision(["p", "q"], [win("p", "q", 1, 1), win("q", "p", 1, 1)])
    expect(() => flattenRanking(rungs)).toThrow(/unresolved tie/)
  })
})

describe("placing a club removes it from contention, never from history", () => {
  it("does not delete the champion's results from everybody else's record", () => {
    // THE BUG THIS PINS: buildTitleTable only counts a fixture when BOTH its
    // clubs are in scope, so rebuilding the table over "the clubs still to be
    // placed" would silently erase every match against an already-placed
    // club. Fourth place would then be decided by a table that never
    // happened.
    //
    // Here mid and low finish level on points, and only their records against
    // the placed club separate them. Erase those and the order flips.
    const fixtures = [
      win("top", "mid", 3, 0),
      win("mid", "top", 0, 1),
      win("low", "top", 1, 0),
      win("top", "low", 2, 1),
      win("mid", "low", 1, 0),
      win("low", "mid", 0, 0),
    ]
    // Full table: top 9pts (+4); mid 4pts (-3); low 4pts (-1).
    // mid and low are level on points and LOW's goal difference is better, so
    // the correct answer is top, low, mid.
    //
    // Rebuilding the table over {mid, low} alone would count only their two
    // meetings - mid won one and drew one - and put MID second. The two
    // answers disagree, which is what makes this test able to fail.
    const rungs = rankDivision(["top", "mid", "low"], fixtures)
    expect(rungs[0].teamIds).toEqual(["top"])
    expect(rungs[1].teamIds).toEqual(["low"])
    expect(rungs[2].teamIds).toEqual(["mid"])
  })
})

describe("THE FORBIDDEN INPUTS - proved absent, not asserted", () => {
  const fixtures = [win("p", "q", 1, 1), win("q", "p", 1, 1), win("p", "r", 5, 0), win("q", "r", 5, 0)]

  it("renaming every club changes nothing", () => {
    // If a club name or localeCompare could reach the ranking, remapping ids
    // to names in a different alphabetical order would move somebody.
    const original = rankDivision(["p", "q", "r"], fixtures)
    const remapped = rankDivision(
      ["zzz", "aaa", "mmm"],
      fixtures.map((f) => ({
        ...f,
        homeTeamId: { p: "zzz", q: "aaa", r: "mmm" }[f.homeTeamId] as string,
        awayTeamId: { p: "zzz", q: "aaa", r: "mmm" }[f.awayTeamId] as string,
      }))
    )
    const shape = (rungs: ReturnType<typeof rankDivision>) => rungs.map((rung) => rung.teamIds.length)
    expect(shape(remapped)).toEqual(shape(original))
    // p and q are still tied for the top under their new ids, in a mapping
    // whose alphabetical order is the reverse of the old one.
    expect(remapped[0].teamIds.sort()).toEqual(["aaa", "zzz"])
  })

  it("a tie is a tie however the ids sort", () => {
    const rungs = rankDivision(["p", "q", "r"], fixtures)
    expect(rungs[0].teamIds.sort()).toEqual(["p", "q"])
    expect(rungs[0].via).toBe("tied")
    expect(rungs[1].teamIds).toEqual(["r"])
    expect(rungs[1].firstRank).toBe(3)
  })
})

describe("rungAtRank", () => {
  const rungs = rankDivision(["p", "q", "r"], [win("p", "q", 1, 1), win("q", "p", 1, 1), win("p", "r", 5, 0), win("q", "r", 5, 0)])

  it("finds the tied rung from either of the ranks it spans", () => {
    expect(rungAtRank(rungs, 1)).toBe(rungAtRank(rungs, 2))
    expect(rungAtRank(rungs, 1)?.teamIds).toHaveLength(2)
  })

  it("finds the club below it at its own rank", () => {
    expect(rungAtRank(rungs, 3)?.teamIds).toEqual(["r"])
  })

  it("returns null past the end of the table", () => {
    expect(rungAtRank(rungs, 4)).toBeNull()
  })
})

describe("a division nobody has played in", () => {
  it("returns every club as one tied rung rather than inventing an order", () => {
    const rungs = rankDivision(["a", "b", "c"], [])
    expect(rungs).toHaveLength(1)
    expect(rungs[0].teamIds).toHaveLength(3)
    expect(rungs[0].via).toBe("tied")
  })
})
