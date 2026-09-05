import { decideBoundary, drawLadderPair, roundRobinPairs, roundRobinSize, type BoundaryFixture } from "./boundary"
import { MAX_ROUND_ROBIN_ROUNDS } from "../playoff"

/**
 * SETTLING A TIE ON THE FIELD.
 *
 * One mechanism, of which the two-club decider is the base case: a "round
 * robin" between two clubs is one match. What these tests pin is that it
 * always terminates, that a shootout is what makes it terminate, and that the
 * ladder is reached only after three rounds have proved the clubs genuinely
 * indistinguishable.
 */

const finished = () => true
const unfinished = () => false

function match(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  round: number,
  shootout?: [number, number]
): BoundaryFixture {
  return {
    homeTeamId: home,
    awayTeamId: away,
    homeScore,
    awayScore,
    homeShootoutScore: shootout?.[0] ?? null,
    awayShootoutScore: shootout?.[1] ?? null,
    boundaryRound: round,
    scheduledAt: new Date("2026-06-01T19:00:00.000Z"),
    playedAt: new Date("2026-06-01T19:00:00.000Z"),
  }
}

describe("the shape of a round", () => {
  it("a two-club round robin is one match", () => {
    expect(roundRobinSize(2)).toBe(1)
    expect(roundRobinPairs(["x", "y"])).toEqual([["x", "y"]])
  })

  it("a three-club round robin is three", () => {
    expect(roundRobinSize(3)).toBe(3)
    expect(roundRobinPairs(["x", "y", "z"])).toHaveLength(3)
  })

  it("lists every unordered pair exactly once", () => {
    const pairs = roundRobinPairs(["a", "b", "c", "d"])
    expect(pairs).toHaveLength(6)
    const keys = pairs.map(([h, a]) => [h, a].sort().join("-"))
    expect(new Set(keys).size).toBe(6)
  })
})

describe("EXACTLY TWO CLUBS - the base case", () => {
  it("asks for the one match", () => {
    const decision = decideBoundary(["x", "y"], [], finished, "seed")
    expect(decision).toEqual({ kind: "needRoundRobin", round: 1, teamIds: ["x", "y"] })
  })

  it("waits while it is unplayed", () => {
    const fixtures = [match("x", "y", 0, 0, 1)]
    expect(decideBoundary(["x", "y"], fixtures, unfinished, "seed")).toEqual({ kind: "waiting", round: 1 })
  })

  it("settles it in ninety minutes", () => {
    const decision = decideBoundary(["x", "y"], [match("x", "y", 2, 1, 1)], finished, "seed")
    expect(decision).toEqual({ kind: "settled", order: ["x", "y"] })
  })

  it("settles it on penalties when the ninety are level", () => {
    const decision = decideBoundary(["x", "y"], [match("x", "y", 1, 1, 1, [3, 4])], finished, "seed")
    expect(decision).toEqual({ kind: "settled", order: ["y", "x"] })
  })

  it("a level ninety with no shootout is unfinished business, never a draw", () => {
    // playoffMatchOutcome calls this UNRESOLVED - a boundary match cannot end
    // level, so that state means the data is incomplete. Fail closed.
    const decision = decideBoundary(["x", "y"], [match("x", "y", 1, 1, 1)], finished, "seed")
    expect(decision.kind).toBe("waiting")
  })
})

describe("THREE OR MORE CLUBS", () => {
  it("asks for a full round robin among them", () => {
    const decision = decideBoundary(["x", "y", "z"], [], finished, "seed")
    expect(decision).toEqual({ kind: "needRoundRobin", round: 1, teamIds: ["x", "y", "z"] })
  })

  it("orders them when one round separates everybody", () => {
    // x beats both, y beats z.
    const fixtures = [match("x", "y", 1, 0, 1), match("x", "z", 1, 0, 1), match("y", "z", 1, 0, 1)]
    expect(decideBoundary(["x", "y", "z"], fixtures, finished, "seed")).toEqual({
      kind: "settled",
      order: ["x", "y", "z"],
    })
  })

  it("plays another round when the round robin separated nobody", () => {
    // A perfect cycle: each club beats one and loses to one, 3 points each,
    // goal difference zero each, one goal scored each.
    const cycle = [match("x", "y", 1, 0, 1), match("y", "z", 1, 0, 1), match("z", "x", 1, 0, 1)]
    expect(decideBoundary(["x", "y", "z"], cycle, finished, "seed")).toEqual({
      kind: "needRoundRobin",
      round: 2,
      teamIds: ["x", "y", "z"],
    })
  })

  it("places the club a round DID separate and keeps the rest level", () => {
    // z loses both; x and y draw and go to penalties, which the playoff table
    // scores 2-1, so they are NOT level - a shootout always separates.
    const fixtures = [match("x", "y", 1, 1, 1, [4, 2]), match("x", "z", 1, 0, 1), match("y", "z", 1, 0, 1)]
    const decision = decideBoundary(["x", "y", "z"], fixtures, finished, "seed")
    expect(decision).toEqual({ kind: "settled", order: ["x", "y", "z"] })
  })
})

describe("THE TERMINAL LADDER", () => {
  /** Three identical cycles - the clubs are provably indistinguishable. */
  function threeCycles(): BoundaryFixture[] {
    const rounds = [1, 2, 3]
    return rounds.flatMap((round) => [
      match("x", "y", 1, 0, round),
      match("y", "z", 1, 0, round),
      match("z", "x", 1, 0, round),
    ])
  }

  it("is reached only after the round robin cap", () => {
    expect(MAX_ROUND_ROBIN_ROUNDS).toBe(3)
    const decision = decideBoundary(["x", "y", "z"], threeCycles(), finished, "seed")
    expect(decision.kind).toBe("needLadderMatch")
    if (decision.kind === "needLadderMatch") {
      expect(decision.round).toBe(4)
      expect(decision.teamIds).toHaveLength(2)
    }
  })

  it("fixes exactly one position per match, so m clubs take m-1 matches", () => {
    const base = threeCycles()
    const round4 = decideBoundary(["x", "y", "z"], base, finished, "seed")
    if (round4.kind !== "needLadderMatch") throw new Error("expected a ladder match")
    const [h4, a4] = round4.teamIds
    const afterFour = [...base, match(h4, a4, 1, 0, 4)]

    const round5 = decideBoundary(["x", "y", "z"], afterFour, finished, "seed")
    expect(round5.kind).toBe("needLadderMatch")
    if (round5.kind !== "needLadderMatch") throw new Error("expected a ladder match")
    const [h5, a5] = round5.teamIds
    const afterFive = [...afterFour, match(h5, a5, 1, 0, 5)]

    const final = decideBoundary(["x", "y", "z"], afterFive, finished, "seed")
    expect(final.kind).toBe("settled")
    if (final.kind === "settled") {
      expect(final.order).toHaveLength(3)
      expect(new Set(final.order).size).toBe(3)
      expect(final.order[0]).toBe(h4)
    }
  })

  it("the winner takes the higher place", () => {
    const base = threeCycles()
    const round4 = decideBoundary(["x", "y", "z"], base, finished, "seed")
    if (round4.kind !== "needLadderMatch") throw new Error("expected a ladder match")
    const [home, away] = round4.teamIds
    // Give the AWAY side the win and check it comes out on top.
    const next = decideBoundary(["x", "y", "z"], [...base, match(home, away, 0, 1, 4)], finished, "seed")
    expect(next.kind).toBe("needLadderMatch")
    if (next.kind === "needLadderMatch") expect(next.teamIds).not.toContain(away)
  })
})

describe("THE LADDER DRAW", () => {
  it("is deterministic for a seed and a round", () => {
    expect(drawLadderPair(["x", "y", "z"], "seed", 4)).toEqual(drawLadderPair(["x", "y", "z"], "seed", 4))
  })

  it("does not depend on the order the clubs are supplied in", () => {
    expect(drawLadderPair(["z", "y", "x"], "seed", 4)).toEqual(drawLadderPair(["x", "y", "z"], "seed", 4))
  })

  it("consecutive ladder rounds do not draw from the same sequence", () => {
    const rounds = [4, 5, 6, 7].map((round) => drawLadderPair(["a", "b", "c", "d"], "seed", round).join("-"))
    expect(new Set(rounds).size).toBeGreaterThan(1)
  })

  it("gives every club a chance of playing, across seeds", () => {
    const drawn = new Set<string>()
    for (let i = 0; i < 60; i++) {
      for (const teamId of drawLadderPair(["a", "b", "c", "d"], `seed-${i}`, 4)) drawn.add(teamId)
    }
    expect(drawn.size).toBe(4)
  })

  it("refuses to pair fewer than two clubs", () => {
    expect(() => drawLadderPair(["a"], "seed", 4)).toThrow(/needs two clubs/)
  })
})

describe("FAIL CLOSED", () => {
  it("reports a round with the wrong number of fixtures rather than guessing", () => {
    const decision = decideBoundary(["x", "y", "z"], [match("x", "y", 1, 0, 1)], finished, "seed")
    expect(decision.kind).toBe("blocked")
  })

  it("a group of one is already settled", () => {
    expect(decideBoundary(["x"], [], finished, "seed")).toEqual({ kind: "settled", order: ["x"] })
  })
})
