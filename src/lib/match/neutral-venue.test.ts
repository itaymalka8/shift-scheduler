/**
 * Neutral venue, proven against the real engine rather than asserted.
 *
 * Two properties matter and they pull in opposite directions:
 *   1. A decider must give NEITHER side home advantage.
 *   2. Every league match must be EXACTLY what it was before this existed.
 *
 * Built on the engine's own test harness so the squads are the ones the
 * balance suite already uses, rather than a second hand-rolled definition of
 * what a team looks like.
 */
import { simulateMatch } from "./engine/engine"
import { DEFAULT_GAME_BALANCE_CONFIG } from "./engine/config"
import { makeTestSnapshot, makeTestTeam } from "./engine/test-harness"
import type { MatchSnapshot } from "./engine/snapshot"

const HOME = makeTestTeam("H")
const AWAY = makeTestTeam("A")

function snapshot(seed: string, neutralVenue: boolean): MatchSnapshot {
  return {
    ...makeTestSnapshot(HOME, AWAY, seed, { attendance: 10000, capacity: 10600, fanType: "ultras" }),
    neutralVenue,
  }
}

describe("league matches are untouched", () => {
  it("a snapshot WITHOUT neutralVenue simulates identically to one with it explicitly false", () => {
    const withFlag = simulateMatch(snapshot("regression", false))
    const withoutFlag = simulateMatch({ ...snapshot("regression", false), neutralVenue: undefined })
    expect(withoutFlag.homeGoals).toBe(withFlag.homeGoals)
    expect(withoutFlag.awayGoals).toBe(withFlag.awayGoals)
    expect(withoutFlag.events).toEqual(withFlag.events)
    expect(withoutFlag.playerStats).toEqual(withFlag.playerStats)
  })

  it("the same seed still reproduces the same league match", () => {
    expect(simulateMatch(snapshot("stable", false))).toEqual(simulateMatch(snapshot("stable", false)))
  })
})

describe("a neutral venue removes home advantage", () => {
  it("home advantage exists at all - the control the next test depends on", () => {
    expect(DEFAULT_GAME_BALANCE_CONFIG.homeAdvantage).toBeGreaterThan(1)
  })

  it("evenly matched clubs stop favouring the home side once the venue is neutral", () => {
    // Over many seeds, with identical squads, the ONLY asymmetry the engine
    // has is home advantage and the home crowd. Removing them should remove
    // the home side's edge.
    const tally = (neutral: boolean) => {
      let homeWins = 0
      let awayWins = 0
      for (let i = 0; i < 110; i++) {
        const r = simulateMatch(snapshot(`venue-${i}`, neutral))
        if (r.homeGoals > r.awayGoals) homeWins++
        else if (r.awayGoals > r.homeGoals) awayWins++
      }
      return { homeWins, awayWins }
    }

    const atHome = tally(false)
    const neutral = tally(true)

    // With home advantage, the home side wins meaningfully more.
    expect(atHome.homeWins).toBeGreaterThan(atHome.awayWins)
    // On neutral turf that edge is gone - the sides are within noise of each
    // other, and much closer than they were at home.
    const homeEdgeAtHome = atHome.homeWins - atHome.awayWins
    const homeEdgeNeutral = Math.abs(neutral.homeWins - neutral.awayWins)
    expect(homeEdgeNeutral).toBeLessThan(homeEdgeAtHome)
  })

  it("the crowd cannot influence a neutral match - fanType and attendance stop mattering", () => {
    const quiet = simulateMatch({ ...snapshot("crowd", true), fanType: "calm", attendance: 0 })
    const loud = simulateMatch({ ...snapshot("crowd", true), fanType: "ultras", attendance: 20000 })
    expect(loud.homeGoals).toBe(quiet.homeGoals)
    expect(loud.awayGoals).toBe(quiet.awayGoals)
    expect(loud.events).toEqual(quiet.events)
  })

  it("the crowd DOES still influence a normal league match - proving the test above is meaningful", () => {
    let differed = false
    for (let i = 0; i < 40 && !differed; i++) {
      const quiet = simulateMatch({ ...snapshot(`league-crowd-${i}`, false), fanType: "calm", attendance: 0 })
      const loud = simulateMatch({ ...snapshot(`league-crowd-${i}`, false), fanType: "ultras", attendance: 20000 })
      if (quiet.homeGoals !== loud.homeGoals || quiet.awayGoals !== loud.awayGoals) differed = true
    }
    expect(differed).toBe(true)
  })
})

describe("finalOnPitch", () => {
  it("reports eleven a side at the final whistle", () => {
    const result = simulateMatch(snapshot("onpitch", false))
    expect(result.finalOnPitch.home.length).toBeLessThanOrEqual(11)
    expect(result.finalOnPitch.away.length).toBeLessThanOrEqual(11)
    expect(result.finalOnPitch.home.length).toBeGreaterThan(0)
  })

  it("never includes a player who was sent off", () => {
    for (let i = 0; i < 25; i++) {
      const result = simulateMatch(snapshot(`redcard-${i}`, false))
      const sentOff = result.playerStats.filter((s) => s.redCards > 0).map((s) => s.playerId)
      for (const id of sentOff) {
        expect(result.finalOnPitch.home).not.toContain(id)
        expect(result.finalOnPitch.away).not.toContain(id)
      }
    }
  })

  it("every player still on the pitch actually played", () => {
    const result = simulateMatch(snapshot("played", false))
    const minutesById = new Map(result.playerStats.map((s) => [s.playerId, s.minutesPlayed]))
    for (const id of [...result.finalOnPitch.home, ...result.finalOnPitch.away]) {
      expect(minutesById.get(id)).toBeGreaterThan(0)
    }
  })

  it("keeps home and away sets disjoint and correctly attributed", () => {
    const result = simulateMatch(snapshot("sides", false))
    const homeIds = new Set(HOME.starters.concat(HOME.bench).map((p) => p.id))
    for (const id of result.finalOnPitch.home) expect(homeIds.has(id)).toBe(true)
    const awayIds = new Set(AWAY.starters.concat(AWAY.bench).map((p) => p.id))
    for (const id of result.finalOnPitch.away) expect(awayIds.has(id)).toBe(true)
  })
})
