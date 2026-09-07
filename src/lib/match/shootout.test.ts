import {
  INITIAL_ROUNDS,
  MAX_SUDDEN_DEATH_ROUNDS,
  ShootoutError,
  isSettledEarly,
  runShootout,
  scoreChance,
  type ShootoutSide,
} from "./shootout"
import { buildShootoutSide, orderTakers, pickKeeper, type TakerCandidate } from "./shootout-takers"

const outfield = (id: string, penalties: number | null = 60): TakerCandidate => ({
  playerId: id,
  primaryPosition: "CM",
  penalties,
  penaltySaving: null,
})
const keeperOf = (id: string, penaltySaving: number | null = 60): TakerCandidate => ({
  playerId: id,
  primaryPosition: "GK",
  penalties: 20,
  penaltySaving,
})

function side(teamId: string, ids: string[], penalties = 60): ShootoutSide {
  return buildShootoutSide(
    teamId,
    [...ids.map((id) => outfield(id, penalties)), keeperOf(`${teamId}-gk`)],
    null
  )
}

describe("scoreChance", () => {
  it("favours the taker - a penalty is not a coin flip", () => {
    expect(scoreChance({ playerId: "p", penalties: 50 }, { playerId: "k", penaltySaving: 50 })).toBeGreaterThan(0.5)
  })

  it("moves with the taker's and the keeper's attributes, in the right directions", () => {
    const weakKeeper = scoreChance({ playerId: "p", penalties: 90 }, { playerId: "k", penaltySaving: 10 })
    const strongKeeper = scoreChance({ playerId: "p", penalties: 90 }, { playerId: "k", penaltySaving: 95 })
    expect(weakKeeper).toBeGreaterThan(strongKeeper)

    const goodTaker = scoreChance({ playerId: "p", penalties: 95 }, { playerId: "k", penaltySaving: 50 })
    const poorTaker = scoreChance({ playerId: "p", penalties: 10 }, { playerId: "k", penaltySaving: 50 })
    expect(goodTaker).toBeGreaterThan(poorTaker)
  })

  it("is clamped at both ends - no shootout is ever a foregone conclusion", () => {
    const best = scoreChance({ playerId: "p", penalties: 99 }, { playerId: "k", penaltySaving: 1 })
    const worst = scoreChance({ playerId: "p", penalties: 1 }, { playerId: "k", penaltySaving: 99 })
    expect(best).toBeLessThan(1)
    expect(worst).toBeGreaterThan(0)
    expect(best).toBeLessThanOrEqual(0.92)
    expect(worst).toBeGreaterThanOrEqual(0.45)
  })

  it("treats a missing attribute as neutral, not as zero", () => {
    const unknown = scoreChance({ playerId: "p", penalties: null }, { playerId: "k", penaltySaving: null })
    const fifty = scoreChance({ playerId: "p", penalties: 50 }, { playerId: "k", penaltySaving: 50 })
    expect(unknown).toBeCloseTo(fifty, 10)
  })

  it("no keeper on the pitch is not a free goal", () => {
    expect(scoreChance({ playerId: "p", penalties: 50 }, null)).toBeLessThan(1)
  })
})

describe("isSettledEarly", () => {
  it("stops the round once the outcome cannot change - 3-0 after three each", () => {
    expect(isSettledEarly(3, 0, 3, 3)).toBe(true)
  })

  it("keeps going while the trailing side can still catch up", () => {
    expect(isSettledEarly(2, 1, 2, 2)).toBe(false)
  })

  it("is symmetric", () => {
    expect(isSettledEarly(0, 3, 3, 3)).toBe(true)
  })

  it("is not settled at the start", () => {
    expect(isSettledEarly(0, 0, 0, 0)).toBe(false)
  })
})

describe("runShootout", () => {
  it("always produces a winner and never a draw, across many seeds", () => {
    for (let i = 0; i < 300; i++) {
      const result = runShootout(side("H", ["h1", "h2", "h3", "h4", "h5"]), side("A", ["a1", "a2", "a3", "a4", "a5"]), `seed-${i}`)
      expect(result.homeScore).not.toBe(result.awayScore)
      expect(result.winner).toBe(result.homeScore > result.awayScore ? "home" : "away")
      expect(result.winnerTeamId).toBe(result.winner === "home" ? "H" : "A")
    }
  })

  it("is DETERMINISTIC - the same seed and the same players reproduce it exactly", () => {
    const run = () => runShootout(side("H", ["h1", "h2", "h3"]), side("A", ["a1", "a2", "a3"]), "fixed-seed")
    const first = run()
    const second = run()
    expect(second).toEqual(first)
    // Kick by kick, not just the score.
    expect(second.kicks).toEqual(first.kicks)
  })

  it("a different seed can produce a different result", () => {
    const results = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const r = runShootout(side("H", ["h1", "h2", "h3"]), side("A", ["a1", "a2", "a3"]), `s-${i}`)
      results.add(`${r.homeScore}-${r.awayScore}`)
    }
    expect(results.size).toBeGreaterThan(1)
  })

  it("takes at most five kicks each before sudden death", () => {
    for (let i = 0; i < 100; i++) {
      const r = runShootout(side("H", ["h1", "h2", "h3"]), side("A", ["a1", "a2", "a3"]), `r-${i}`)
      const initial = r.kicks.filter((k) => k.round <= INITIAL_ROUNDS)
      expect(initial.filter((k) => k.side === "home").length).toBeLessThanOrEqual(INITIAL_ROUNDS)
      expect(initial.filter((k) => k.side === "away").length).toBeLessThanOrEqual(INITIAL_ROUNDS)
    }
  })

  it("home kicks first, and the two sides alternate", () => {
    const r = runShootout(side("H", ["h1"]), side("A", ["a1"]), "alternating")
    expect(r.kicks[0].side).toBe("home")
    const initial = r.kicks.filter((k) => k.round <= INITIAL_ROUNDS)
    for (let i = 0; i < initial.length; i++) {
      expect(initial[i].side).toBe(i % 2 === 0 ? "home" : "away")
    }
  })

  it("terminates early rather than playing dead rubbers", () => {
    // Over many seeds at least some shootouts must end before ten kicks.
    let sawEarlyStop = false
    for (let i = 0; i < 200 && !sawEarlyStop; i++) {
      const r = runShootout(side("H", ["h1"], 99), side("A", ["a1"], 1), `early-${i}`)
      const initial = r.kicks.filter((k) => k.round <= INITIAL_ROUNDS)
      if (!r.suddenDeath && initial.length < INITIAL_ROUNDS * 2) sawEarlyStop = true
    }
    expect(sawEarlyStop).toBe(true)
  })

  it("goes to sudden death when the first five each are level, and both kick in every extra round", () => {
    let sawSuddenDeath = false
    for (let i = 0; i < 400 && !sawSuddenDeath; i++) {
      const r = runShootout(side("H", ["h1"]), side("A", ["a1"]), `sd-${i}`)
      if (!r.suddenDeath) continue
      sawSuddenDeath = true
      const extra = r.kicks.filter((k) => k.round > INITIAL_ROUNDS)
      // Every sudden-death round is a complete pair.
      expect(extra.length % 2).toBe(0)
      for (let j = 0; j < extra.length; j += 2) {
        expect(extra[j].side).toBe("home")
        expect(extra[j + 1].side).toBe("away")
        expect(extra[j].round).toBe(extra[j + 1].round)
      }
      // And the last pair is the decisive one: exactly one of them scored.
      const last = extra.slice(-2)
      expect(last[0].scored).not.toBe(last[1].scored)
    }
    expect(sawSuddenDeath).toBe(true)
  })

  it("cycles back through the takers when sudden death outlasts the list", () => {
    let checked = false
    for (let i = 0; i < 400 && !checked; i++) {
      const r = runShootout(side("H", ["h1", "h2"]), side("A", ["a1", "a2"]), `cycle-${i}`)
      const homeKicks = r.kicks.filter((k) => k.side === "home")
      if (homeKicks.length < 4) continue
      checked = true
      // Three takers were supplied (two outfield + the keeper), so the
      // fourth kick comes back round to the first taker.
      expect(homeKicks[3].playerId).toBe(homeKicks[0].playerId)
    }
    expect(checked).toBe(true)
  })

  it("the score always equals the kicks that were scored", () => {
    for (let i = 0; i < 100; i++) {
      const r = runShootout(side("H", ["h1", "h2"]), side("A", ["a1", "a2"]), `count-${i}`)
      expect(r.homeScore).toBe(r.kicks.filter((k) => k.side === "home" && k.scored).length)
      expect(r.awayScore).toBe(r.kicks.filter((k) => k.side === "away" && k.scored).length)
    }
  })

  it("FAILS CLOSED with no takers rather than inventing a champion", () => {
    const empty: ShootoutSide = { teamId: "H", takers: [], keeper: null }
    expect(() => runShootout(empty, side("A", ["a1"]), "seed")).toThrow(ShootoutError)
    expect(() => runShootout(side("H", ["h1"]), empty, "seed")).toThrow(/without takers/)
  })

  it("has a sudden-death ceiling so a bug cannot loop forever", () => {
    expect(MAX_SUDDEN_DEATH_ROUNDS).toBeGreaterThan(0)
    // Guaranteed-score against guaranteed-score still terminates, because a
    // round is only decisive when the two kicks differ - and the clamp means
    // neither is certain.
    const r = runShootout(side("H", ["h1"], 99), side("A", ["a1"], 99), "ceiling")
    expect(r.homeScore).not.toBe(r.awayScore)
  })
})

describe("shootout takers", () => {
  it("puts the club's DESIGNATED penalty taker first, whatever their attribute", () => {
    const order = orderTakers([outfield("weak", 20), outfield("strong", 95)], "weak")
    expect(order[0].playerId).toBe("weak")
  })

  it("otherwise orders by the penalties attribute, best first", () => {
    const order = orderTakers([outfield("mid", 60), outfield("best", 90), outfield("worst", 30)], null)
    expect(order.map((p) => p.playerId)).toEqual(["best", "mid", "worst"])
  })

  it("breaks an exact attribute tie by id - technical only, and stable", () => {
    const order = orderTakers([outfield("zzz", 70), outfield("aaa", 70)], null)
    expect(order.map((p) => p.playerId)).toEqual(["aaa", "zzz"])
    // Stable under a reversed input, which is the whole point.
    const reversed = orderTakers([outfield("aaa", 70), outfield("zzz", 70)], null)
    expect(reversed.map((p) => p.playerId)).toEqual(["aaa", "zzz"])
  })

  it("takes no player name as input - the candidate shape carries ids and attributes only", () => {
    const candidate = outfield("p")
    expect(Object.keys(candidate).sort()).toEqual(["penalties", "penaltySaving", "playerId", "primaryPosition"])
  })

  it("includes the goalkeeper as a possible taker - they sort where their attribute puts them", () => {
    const order = orderTakers([keeperOf("gk"), outfield("out", 80)], null)
    expect(order.map((p) => p.playerId)).toEqual(["out", "gk"])
    expect(order).toHaveLength(2)
  })

  it("picks the goalkeeper still on the pitch to face the kicks", () => {
    expect(pickKeeper([outfield("a"), keeperOf("gk", 70)])?.playerId).toBe("gk")
  })

  it("returns no keeper when none is left on the pitch", () => {
    expect(pickKeeper([outfield("a"), outfield("b")])).toBeNull()
  })
})
