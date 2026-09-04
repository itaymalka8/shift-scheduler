import {
  MAX_ROUND_ROBIN_ROUNDS,
  allResolved,
  buildPlayoffTable,
  playoffMatchOutcome,
  resolvePlayoffRound,
  roundRobinPairings,
  type PlayoffFixture,
} from "./playoff"

const m = (
  home: string,
  away: string,
  hs: number | null,
  as: number | null,
  hp: number | null = null,
  ap: number | null = null
): PlayoffFixture => ({
  homeTeamId: home,
  awayTeamId: away,
  homeScore: hs,
  awayScore: as,
  homeShootoutScore: hp,
  awayShootoutScore: ap,
})

const row = (rows: ReturnType<typeof buildPlayoffTable>, id: string) => rows.find((r) => r.teamId === id)!

describe("playoffMatchOutcome", () => {
  it("a 90-minute win is decided in ninety", () => {
    expect(playoffMatchOutcome(m("A", "B", 2, 1))).toEqual({
      kind: "decided", winnerTeamId: "A", loserTeamId: "B", inNinety: true,
    })
  })

  it("a shootout win is decided, but not in ninety", () => {
    expect(playoffMatchOutcome(m("A", "B", 1, 1, 5, 4))).toEqual({
      kind: "decided", winnerTeamId: "A", loserTeamId: "B", inNinety: false,
    })
  })

  it("FAILS CLOSED on a level 90 with no shootout - a playoff match cannot be drawn", () => {
    expect(playoffMatchOutcome(m("A", "B", 1, 1))).toEqual({ kind: "unresolved" })
  })

  it("FAILS CLOSED on a level shootout and on a half-written one", () => {
    expect(playoffMatchOutcome(m("A", "B", 0, 0, 4, 4))).toEqual({ kind: "unresolved" })
    expect(playoffMatchOutcome(m("A", "B", 0, 0, 4, null))).toEqual({ kind: "unresolved" })
  })

  it("FAILS CLOSED on an unplayed match", () => {
    expect(playoffMatchOutcome(m("A", "B", null, null))).toEqual({ kind: "unresolved" })
  })
})

describe("3 / 2 / 1 / 0 points", () => {
  // All four ways a playoff match can end, each asserting BOTH clubs and the
  // total. Stated as a table so the approved 3/2/1/0 rule is readable as one
  // block rather than inferred from test names.
  const CASES: { label: string; fixture: PlayoffFixture; home: number; away: number }[] = [
    { label: "90-minute HOME win (2-0)", fixture: m("HOME", "AWAY", 2, 0), home: 3, away: 0 },
    { label: "90-minute AWAY win (0-2)", fixture: m("HOME", "AWAY", 0, 2), home: 0, away: 3 },
    { label: "level 90, HOME wins the shootout (1-1, 5-4)", fixture: m("HOME", "AWAY", 1, 1, 5, 4), home: 2, away: 1 },
    { label: "level 90, AWAY wins the shootout (1-1, 4-5)", fixture: m("HOME", "AWAY", 1, 1, 4, 5), home: 1, away: 2 },
  ]

  for (const { label, fixture, home, away } of CASES) {
    it(`${label} -> HOME ${home}, AWAY ${away}`, () => {
      const t = buildPlayoffTable(["HOME", "AWAY"], [fixture])
      expect(row(t, "HOME").points).toBe(home)
      expect(row(t, "AWAY").points).toBe(away)
    })
  }

  it("EVERY completed match distributes exactly 3 table points - 3+0 or 2+1, never 3+1", () => {
    for (const { label, fixture } of CASES) {
      const t = buildPlayoffTable(["HOME", "AWAY"], [fixture])
      const total = row(t, "HOME").points + row(t, "AWAY").points
      const split = [row(t, "HOME").points, row(t, "AWAY").points].sort((a, b) => b - a)
      // Named in the assertion so a failure says WHICH case broke the rule.
      expect({ label, total }).toEqual({ label, total: 3 })
      expect({ label, split }).toEqual({ label, split: total === 3 && split[0] === 3 ? [3, 0] : [2, 1] })
    }
  })

  it("an unresolved match distributes NO points at all", () => {
    // The one legitimate exception to "3 points per match": a match that has
    // no usable result is not a completed match and contributes nothing.
    for (const fixture of [m("A", "B", 1, 1), m("A", "B", null, null), m("A", "B", 0, 0, 4, 4)]) {
      const t = buildPlayoffTable(["A", "B"], [fixture])
      expect(row(t, "A").points + row(t, "B").points).toBe(0)
      expect(row(t, "A").played + row(t, "B").played).toBe(0)
    }
  })

  it("a club drawing twice and winning both shootouts outranks one that won and lost", () => {
    // A: two level 90s, both shootouts won -> 2 + 2 = 4.
    // B: one 1-0 win and one 0-1 loss      -> 3 + 0 = 3.
    // This is exactly the ordering the 3/2/1/0 system is designed to produce,
    // and it is the clearest way it differs from plain 3/1/0.
    const table = buildPlayoffTable(
      ["A", "B", "C", "D"],
      [m("A", "C", 1, 1, 5, 4), m("A", "D", 1, 1, 3, 2), m("B", "C", 1, 0), m("B", "D", 0, 1)]
    )
    expect(row(table, "A").points).toBe(4)
    expect(row(table, "B").points).toBe(3)
    // And A got there without scoring more: goal difference is still 0.
    expect(row(table, "A").goalDiff).toBe(0)
  })
})

describe("90-minute goals only", () => {
  it("a shootout never touches goals for, against or difference", () => {
    const t = buildPlayoffTable(["A", "B"], [m("A", "B", 1, 1, 5, 4)])
    expect(row(t, "A")).toMatchObject({ goalsFor: 1, goalsAgainst: 1, goalDiff: 0 })
    expect(row(t, "B")).toMatchObject({ goalsFor: 1, goalsAgainst: 1, goalDiff: 0 })
  })

  it("a lopsided shootout still leaves both goal differences at zero", () => {
    const t = buildPlayoffTable(["A", "B"], [m("A", "B", 2, 2, 9, 0)])
    expect(row(t, "A").goalDiff).toBe(0)
    expect(row(t, "B").goalDiff).toBe(0)
  })

  it("90-minute goals are counted normally", () => {
    const t = buildPlayoffTable(["A", "B"], [m("A", "B", 3, 1)])
    expect(row(t, "A")).toMatchObject({ goalsFor: 3, goalsAgainst: 1, goalDiff: 2 })
  })

  it("skips a fixture involving a club outside the scope - the mini-table stays mini", () => {
    const t = buildPlayoffTable(["A", "B"], [m("A", "B", 1, 0), m("A", "C", 9, 0)])
    expect(row(t, "A").played).toBe(1)
    expect(row(t, "A").goalsFor).toBe(1)
  })
})

describe("resolvePlayoffRound", () => {
  it("crowns the club that leads on points", () => {
    const fixtures = [m("A", "B", 2, 0), m("A", "C", 1, 0), m("B", "C", 1, 1, 4, 3)]
    expect(resolvePlayoffRound(["A", "B", "C"], fixtures)).toEqual({
      kind: "resolved", teamId: "A", via: "table",
    })
  })

  it("refuses to rank a round that is not complete", () => {
    const fixtures = [m("A", "B", 2, 0), m("A", "C", null, null), m("B", "C", 1, 0)]
    expect(resolvePlayoffRound(["A", "B", "C"], fixtures)).toEqual({ kind: "empty" })
  })

  it("refuses to rank a round containing a level match with no shootout", () => {
    const fixtures = [m("A", "B", 1, 1), m("A", "C", 1, 0), m("B", "C", 1, 0)]
    expect(resolvePlayoffRound(["A", "B", "C"], fixtures)).toEqual({ kind: "empty" })
  })

  it("THREE CLUBS EACH WINNING ONE MATCH goes to another round", () => {
    // A beat B, B beat C, C beat A - all 1-0. Three points each, GD 0 each,
    // GF 1 each. Head-to-head is the same table, so nothing can separate them.
    const fixtures = [m("A", "B", 1, 0), m("B", "C", 1, 0), m("C", "A", 1, 0)]
    expect(resolvePlayoffRound(["A", "B", "C"], fixtures)).toEqual({
      kind: "decider", tiedTeamIds: ["A", "B", "C"],
    })
  })

  it("ALL MATCHES DECIDED ON PENALTIES in a perfect cycle goes to another round", () => {
    // Every 90 minutes level, so every goal difference is 0. A beat B, B beat
    // C, C beat A on penalties: 3 points each (2 + 1).
    const fixtures = [m("A", "B", 1, 1, 5, 4), m("B", "C", 1, 1, 5, 4), m("C", "A", 1, 1, 5, 4)]
    const table = buildPlayoffTable(["A", "B", "C"], fixtures)
    expect(table.every((r) => r.points === 3 && r.goalDiff === 0)).toBe(true)
    expect(resolvePlayoffRound(["A", "B", "C"], fixtures)).toEqual({
      kind: "decider", tiedTeamIds: ["A", "B", "C"],
    })
  })

  it("separates on 90-minute goal difference when points are level", () => {
    const fixtures = [m("A", "B", 3, 0), m("B", "C", 3, 0), m("C", "A", 3, 0)]
    // All 3 points, all GD 0... so it does NOT separate. Use asymmetric scores:
    const asymmetric = [m("A", "B", 5, 0), m("B", "C", 1, 0), m("C", "A", 1, 0)]
    const t = buildPlayoffTable(["A", "B", "C"], asymmetric)
    expect(row(t, "A").goalDiff).toBe(4)
    expect(resolvePlayoffRound(["A", "B", "C"], asymmetric)).toEqual({
      kind: "resolved", teamId: "A", via: "table",
    })
    expect(resolvePlayoffRound(["A", "B", "C"], fixtures).kind).toBe("decider")
  })

  it("REMOVE AND RECOMPUTE: a club out of contention does not decide it", () => {
    // A and B level at the top, C behind. The three-way head-to-head is the
    // whole table and separates nothing, so the recursion must drop C and
    // settle A vs B on their own match.
    const fixtures = [m("A", "C", 1, 0), m("B", "C", 1, 0), m("A", "B", 2, 0)]
    const three = buildPlayoffTable(["A", "B", "C"], fixtures)
    expect(row(three, "C").points).toBe(0)
    expect(resolvePlayoffRound(["A", "B", "C"], fixtures)).toEqual({
      kind: "resolved", teamId: "A", via: "table",
    })
  })
})

describe("roundRobinPairings", () => {
  it.each([
    [3, 3],
    [4, 6],
    [5, 10],
  ])("produces every unordered pair exactly once for %i clubs (%i matches)", (n, expected) => {
    const teams = Array.from({ length: n }, (_, i) => `t${i}`)
    const pairs = roundRobinPairings(teams)
    expect(pairs).toHaveLength(expected)
    const seen = new Set(pairs.map((p) => [p.homeTeamId, p.awayTeamId].sort().join("|")))
    expect(seen.size).toBe(expected)
  })

  it("never puts a club in two fixtures of the same slot", () => {
    for (const n of [3, 4, 5, 6]) {
      const teams = Array.from({ length: n }, (_, i) => `t${i}`)
      const bySlot = new Map<number, string[]>()
      for (const p of roundRobinPairings(teams)) {
        const list = bySlot.get(p.slot) ?? []
        list.push(p.homeTeamId, p.awayTeamId)
        bySlot.set(p.slot, list)
      }
      for (const clubs of bySlot.values()) {
        expect(new Set(clubs).size).toBe(clubs.length)
      }
    }
  })

  it("alternates technical home and away across slots - presentation only", () => {
    const pairs = roundRobinPairings(["a", "b", "c", "d"])
    const slots = new Set(pairs.map((p) => p.slot))
    expect(slots.size).toBeGreaterThan(1)
  })

  it("is empty for fewer than two clubs", () => {
    expect(roundRobinPairings(["only"])).toEqual([])
    expect(roundRobinPairings([])).toEqual([])
  })
})

describe("guards", () => {
  it("the round-robin cap is three", () => {
    expect(MAX_ROUND_ROBIN_ROUNDS).toBe(3)
  })

  it("allResolved is false while any match lacks a usable result", () => {
    expect(allResolved([m("A", "B", 1, 0), m("A", "C", 1, 1)])).toBe(false)
    expect(allResolved([m("A", "B", 1, 0), m("A", "C", 1, 1, 3, 2)])).toBe(true)
  })
})
