import {
  buildTitleTable,
  leadersOf,
  resolveDivisionTitle,
  resolveHeadToHead,
  type TitleFixture,
} from "./champion"

/** A finished league match. Scores are what the engine stored; nothing here is about timing. */
const played = (home: string, away: string, hs: number, as: number): TitleFixture => ({
  homeTeamId: home,
  awayTeamId: away,
  homeScore: hs,
  awayScore: as,
})

/**
 * A pair of clubs, level on everything, plus the filler that puts them there.
 * Each returns fixtures where A and B finish equal on points, goal difference
 * and goals scored, so only the head-to-head criteria can separate them.
 */
function levelOnTheTable(headToHead: TitleFixture[]): { teams: string[]; fixtures: TitleFixture[] } {
  return {
    teams: ["A", "B", "Z"],
    fixtures: [
      ...headToHead,
      // Both beat Z by the same margin and scoreline, home and away, so
      // their overall points, GD and GF stay identical.
      played("A", "Z", 3, 1),
      played("Z", "A", 1, 3),
      played("B", "Z", 3, 1),
      played("Z", "B", 1, 3),
    ],
  }
}

describe("buildTitleTable", () => {
  it("counts 3 for a win, 1 each for a draw, and nothing for a loss", () => {
    const rows = buildTitleTable(["A", "B"], [played("A", "B", 2, 0), played("B", "A", 1, 1)])
    const a = rows.find((r) => r.teamId === "A")!
    const b = rows.find((r) => r.teamId === "B")!
    expect(a.points).toBe(4)
    expect(b.points).toBe(1)
    expect(a.played).toBe(2)
    expect(a.goalsFor).toBe(3)
    expect(a.goalsAgainst).toBe(1)
    expect(a.goalDiff).toBe(2)
  })

  it("skips a fixture involving a club outside the scope - this is what makes the mini-table a MINI table", () => {
    // C is not in scope, so A's 9-0 win over C must not inflate A's row.
    const rows = buildTitleTable(["A", "B"], [played("A", "B", 1, 0), played("A", "C", 9, 0)])
    const a = rows.find((r) => r.teamId === "A")!
    expect(a.played).toBe(1)
    expect(a.goalsFor).toBe(1)
  })

  it("ignores a fixture with no stored result", () => {
    const rows = buildTitleTable(["A", "B"], [{ homeTeamId: "A", awayTeamId: "B", homeScore: null, awayScore: null }])
    expect(rows.every((r) => r.played === 0)).toBe(true)
  })

  it("gives every club in scope a row, even one that has played nothing", () => {
    const rows = buildTitleTable(["A", "B", "C"], [played("A", "B", 1, 0)])
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.teamId === "C")!.played).toBe(0)
  })
})

describe("leadersOf", () => {
  it("returns the single club that is clear", () => {
    const rows = buildTitleTable(["A", "B"], [played("A", "B", 1, 0)])
    expect(leadersOf(rows).map((r) => r.teamId)).toEqual(["A"])
  })

  it("returns every club level on points, goal difference AND goals scored", () => {
    const rows = buildTitleTable(["A", "B", "C"], [played("A", "C", 2, 1), played("B", "C", 2, 1)])
    expect(leadersOf(rows).map((r) => r.teamId).sort()).toEqual(["A", "B"])
  })

  it("is empty for an empty table", () => {
    expect(leadersOf([])).toEqual([])
  })
})

describe("resolveDivisionTitle - the table alone", () => {
  it("crowns the club clear on points", () => {
    const outcome = resolveDivisionTitle(["A", "B"], [played("A", "B", 1, 0), played("B", "A", 0, 0)])
    expect(outcome).toEqual({ kind: "resolved", teamId: "A", via: "table" })
  })

  it("separates on goal difference when points are level", () => {
    // Both win once and lose once - 3 points each - but A's win was bigger.
    const outcome = resolveDivisionTitle(["A", "B"], [played("A", "B", 5, 0), played("B", "A", 1, 0)])
    expect(outcome).toEqual({ kind: "resolved", teamId: "A", via: "table" })
  })

  it("separates on goals scored when points and goal difference are level", () => {
    const outcome = resolveDivisionTitle(
      ["A", "B", "Z"],
      [played("A", "Z", 4, 2), played("Z", "A", 2, 4), played("B", "Z", 1, 0), played("Z", "B", 0, 1)]
    )
    // A and B: 6 points each, +4 each. A scored 8, B scored 2.
    expect(outcome).toEqual({ kind: "resolved", teamId: "A", via: "table" })
  })

  it("crowns nobody when no match has been played - a champion is never invented", () => {
    expect(resolveDivisionTitle(["A", "B"], [])).toEqual({ kind: "empty" })
  })

  it("crowns nobody when the division has no clubs", () => {
    expect(resolveDivisionTitle([], [played("A", "B", 1, 0)])).toEqual({ kind: "empty" })
  })

  it("crowns nobody when every fixture is still unplayed", () => {
    const outcome = resolveDivisionTitle(["A", "B"], [
      { homeTeamId: "A", awayTeamId: "B", homeScore: null, awayScore: null },
    ])
    expect(outcome).toEqual({ kind: "empty" })
  })
})

describe("resolveDivisionTitle - head to head", () => {
  it("criterion 4: head-to-head POINTS separate two clubs level on the table", () => {
    // A took 4 points off B (a win and a draw); B took 1. Matches against
    // clubs outside the tie are present and must be ignored.
    const { fixtures } = levelOnTheTable([played("A", "B", 2, 1), played("B", "A", 1, 1)])
    expect(resolveHeadToHead(["A", "B"], fixtures)).toEqual({ kind: "resolved", teamId: "A", via: "headToHead" })
  })

  it("criterion 5: head-to-head GOAL DIFFERENCE separates when head-to-head points are level", () => {
    // One win each, so 3 head-to-head points apiece - but A won 4-0 and B won 1-0.
    const fixtures = [played("A", "B", 4, 0), played("B", "A", 1, 0)]
    expect(resolveHeadToHead(["A", "B"], fixtures)).toEqual({ kind: "resolved", teamId: "A", via: "headToHead" })
  })

  it("criterion 6 CANNOT separate exactly two clubs - a proven property, not a gap in the code", () => {
    // Between two clubs, one side's goals for are the other's goals against.
    // So goalDiff(A) = GF(A) - GF(B). If criteria 4 and 5 are both level,
    // goalDiff(A) is 0, which forces GF(A) === GF(B) - criterion 6 is
    // mathematically incapable of separating a pair. Asserted over several
    // shapes so the property is checked, not just claimed.
    for (const fixtures of [
      [played("A", "B", 3, 3), played("B", "A", 1, 1)],
      [played("A", "B", 0, 0), played("B", "A", 4, 4)],
      [played("A", "B", 2, 1), played("B", "A", 2, 1)],
    ]) {
      const rows = buildTitleTable(["A", "B"], fixtures)
      const [a, b] = [rows[0], rows[1]]
      if (a.points === b.points && a.goalDiff === b.goalDiff) {
        expect(a.goalsFor).toBe(b.goalsFor)
        expect(resolveHeadToHead(["A", "B"], fixtures)).toEqual({ kind: "decider", tiedTeamIds: ["A", "B"] })
      }
    }
  })

  it("criterion 6 does separate in a three-club mini-table, where goals scored can differ", () => {
    // A, B, C level on head-to-head points and goal difference, but A has
    // scored more in those matches.
    const fixtures = [
      played("A", "B", 2, 2),
      played("B", "A", 2, 2),
      played("A", "C", 2, 2),
      played("C", "A", 2, 2),
      played("B", "C", 0, 0),
      played("C", "B", 0, 0),
    ]
    // A: 4 draws, 8 goals. B: 8 -> no. B: 2 draws vs A (4 goals) + 2 vs C (0) = 4.
    // C: 4 too. A leads on goals scored.
    expect(resolveHeadToHead(["A", "B", "C"], fixtures)).toEqual({
      kind: "resolved",
      teamId: "A",
      via: "headToHead",
    })
  })

  it("excludes matches against clubs outside the tie - only games between the tied teams count", () => {
    // B thrashed an outsider; A did not. That must not touch the mini-table.
    const fixtures = [played("A", "B", 1, 0), played("B", "A", 0, 0), played("B", "Z", 9, 0)]
    expect(resolveHeadToHead(["A", "B"], fixtures)).toEqual({ kind: "resolved", teamId: "A", via: "headToHead" })
  })

  it("returns the tied set - never a winner - when every criterion is exhausted", () => {
    const fixtures = [played("A", "B", 1, 1), played("B", "A", 1, 1)]
    expect(resolveHeadToHead(["A", "B"], fixtures)).toEqual({ kind: "decider", tiedTeamIds: ["A", "B"] })
  })
})

describe("three-club ties - remove and recompute", () => {
  it("crowns the club that leads the three-way mini-table", () => {
    const fixtures = [
      played("A", "B", 2, 0),
      played("B", "A", 0, 0),
      played("A", "C", 1, 0),
      played("C", "A", 0, 0),
      played("B", "C", 0, 0),
      played("C", "B", 0, 0),
    ]
    expect(resolveHeadToHead(["A", "B", "C"], fixtures)).toEqual({
      kind: "resolved",
      teamId: "A",
      via: "headToHead",
    })
  })

  it("REMOVES the separated club and RECOMPUTES over only those still level", () => {
    // The scenario the rule exists for. A, B and C are tied on the full
    // table. In the three-way mini-table C finishes far behind (2 points to
    // their 7) and is out of contention - but A and B are still EXACTLY
    // level there, because the differing margins in their wins over C
    // cancel out their differing results against each other.
    //
    // A frozen three-way mini-table therefore separates nobody at the top
    // and would send A and B to a decider they do not need. Recomputing
    // over just {A, B} - which is what "head to head" means - uses only
    // A v B, where A won 3-0 and lost 0-1, and settles it on goal
    // difference. C, which is not competing for anything, decides nothing.
    const fixtures = [
      played("A", "B", 3, 0),
      played("B", "A", 1, 0),
      played("A", "C", 1, 0),
      played("C", "A", 2, 2),
      played("B", "C", 5, 0),
      played("C", "B", 0, 0),
    ]

    // The premise, asserted rather than assumed: A and B really are level in
    // the three-way mini-table, and C really is behind.
    const threeWay = buildTitleTable(["A", "B", "C"], fixtures)
    const row = (id: string) => threeWay.find((r) => r.teamId === id)!
    expect([row("A").points, row("A").goalDiff, row("A").goalsFor]).toEqual([7, 3, 6])
    expect([row("B").points, row("B").goalDiff, row("B").goalsFor]).toEqual([7, 3, 6])
    expect(row("C").points).toBe(2)

    // The frozen-table answer, computed explicitly so the test says what is
    // being rejected and not only what is expected: two leaders, no winner.
    const frozenLeaders = leadersOf(threeWay).map((r) => r.teamId).sort()
    expect(frozenLeaders).toEqual(["A", "B"])

    // The rule's answer: recompute over {A, B} alone, and A is champion.
    expect(resolveHeadToHead(["A", "B", "C"], fixtures)).toEqual({
      kind: "resolved",
      teamId: "A",
      via: "headToHead",
    })
  })

  it("recomputes down to a single club when the smaller mini-table does separate", () => {
    // A, B, C tied. C drops out of the mini-table; among A and B alone,
    // A won the head-to-head.
    const fixtures = [
      played("A", "C", 3, 0),
      played("C", "A", 0, 3),
      played("B", "C", 3, 0),
      played("C", "B", 0, 3),
      played("A", "B", 1, 0),
      played("B", "A", 0, 0),
    ]
    expect(resolveHeadToHead(["A", "B", "C"], fixtures)).toEqual({
      kind: "resolved",
      teamId: "A",
      via: "headToHead",
    })
  })

  it("terminates on a total four-way tie instead of recursing forever", () => {
    const teams = ["A", "B", "C", "D"]
    const fixtures: TitleFixture[] = []
    for (const home of teams) for (const away of teams) if (home !== away) fixtures.push(played(home, away, 1, 1))
    const outcome = resolveHeadToHead(teams, fixtures)
    expect(outcome.kind).toBe("decider")
    expect(outcome.kind === "decider" && outcome.tiedTeamIds.sort()).toEqual(teams)
  })
})

describe("what must never decide a championship", () => {
  it("does not use lexical team id order - the alphabetically-first club is not made champion", () => {
    const fixtures = [played("aaa", "zzz", 1, 1), played("zzz", "aaa", 1, 1)]
    const outcome = resolveDivisionTitle(["aaa", "zzz"], fixtures)
    expect(outcome.kind).toBe("decider")
    expect(outcome).not.toEqual({ kind: "resolved", teamId: "aaa", via: "headToHead" })
  })

  it("is symmetric under a change of team id - renaming the ids cannot change the answer", () => {
    const original = resolveDivisionTitle(
      ["alpha", "omega"],
      [played("alpha", "omega", 2, 0), played("omega", "alpha", 0, 0)]
    )
    const renamed = resolveDivisionTitle(
      ["zzz-alpha", "aaa-omega"],
      [played("zzz-alpha", "aaa-omega", 2, 0), played("aaa-omega", "zzz-alpha", 0, 0)]
    )
    expect(original).toEqual({ kind: "resolved", teamId: "alpha", via: "table" })
    // The same club wins, even though it is now last alphabetically.
    expect(renamed).toEqual({ kind: "resolved", teamId: "zzz-alpha", via: "table" })
  })

  it("takes no club name as input at all - the resolver's inputs carry ids and scores only", () => {
    const fixture: TitleFixture = played("A", "B", 1, 0)
    expect(Object.keys(fixture).sort()).toEqual(["awayScore", "awayTeamId", "homeScore", "homeTeamId"])
  })

  it("is order-independent - shuffling the fixture list cannot change the champion", () => {
    const fixtures = [
      played("A", "B", 2, 1),
      played("B", "A", 0, 0),
      played("A", "C", 1, 0),
      played("C", "B", 3, 0),
    ]
    const forwards = resolveDivisionTitle(["A", "B", "C"], fixtures)
    const backwards = resolveDivisionTitle(["C", "B", "A"], [...fixtures].reverse())
    expect(backwards).toEqual(forwards)
  })
})
