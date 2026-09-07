import { computeLiveScore, computeLiveStats, filterRevealedEvents, type LiveEventInput } from "./live-view"

const HOME = "team-home"
const AWAY = "team-away"

// A fixture whose full 90 minutes are already simulated and sitting in the
// DB (this is how the engine actually works - see simulate.ts), including
// events strictly after the minute the live clock has reached. Every
// assertion below checks that those future events never leak into the
// derived live view.
const ALL_EVENTS_WITH_MINUTE = [
  { minute: 10, type: "shot", outcome: "off_target", teamId: HOME },
  { minute: 22, type: "goal", outcome: "goal", teamId: HOME }, // revealed by minute 30
  { minute: 28, type: "corner", outcome: null, teamId: AWAY },
  { minute: 30, type: "yellowCard", outcome: null, teamId: AWAY }, // exactly at the boundary - must be included
  // Everything below is strictly in the future relative to minute 30 and
  // must never appear in a minute-30 live response.
  { minute: 45, type: "penalty", outcome: "scored", teamId: AWAY },
  { minute: 60, type: "redCard", outcome: null, teamId: HOME },
  { minute: 78, type: "goal", outcome: "goal", teamId: HOME },
]

describe("filterRevealedEvents", () => {
  it("keeps events up to and including the current minute, drops everything after", () => {
    const revealed = filterRevealedEvents(ALL_EVENTS_WITH_MINUTE, 30)
    expect(revealed.map((e) => e.minute)).toEqual([10, 22, 28, 30])
  })

  it("reveals nothing before kickoff (minute 0)", () => {
    expect(filterRevealedEvents(ALL_EVENTS_WITH_MINUTE, 0)).toEqual([])
  })

  it("reveals everything once the match is finished (minute 90)", () => {
    expect(filterRevealedEvents(ALL_EVENTS_WITH_MINUTE, 90)).toHaveLength(ALL_EVENTS_WITH_MINUTE.length)
  })
})

describe("computeLiveScore - the anti-spoiler contract", () => {
  it("at minute 30, reflects only the one goal that has actually happened (1-0), not the eventual 2-1", () => {
    const revealed = filterRevealedEvents(ALL_EVENTS_WITH_MINUTE, 30)
    expect(computeLiveScore(revealed, HOME, AWAY)).toEqual({ home: 1, away: 0 })
  })

  it("at minute 45, includes the scored penalty (1-1)", () => {
    const revealed = filterRevealedEvents(ALL_EVENTS_WITH_MINUTE, 45)
    expect(computeLiveScore(revealed, HOME, AWAY)).toEqual({ home: 1, away: 1 })
  })

  it("a missed penalty never counts as a goal", () => {
    const events: LiveEventInput[] = [{ type: "penalty", outcome: "missed", teamId: HOME }]
    expect(computeLiveScore(events, HOME, AWAY)).toEqual({ home: 0, away: 0 })
  })

  it("at full time (minute 90), matches the final 2-1 - proving the live path and the final result agree once every event is legitimately revealed", () => {
    const revealed = filterRevealedEvents(ALL_EVENTS_WITH_MINUTE, 90)
    expect(computeLiveScore(revealed, HOME, AWAY)).toEqual({ home: 2, away: 1 })
  })
})

describe("computeLiveStats", () => {
  it("a shot event (off-target) contributes nothing - Shots is not reconstructable with full accuracy, so it is not tracked live at all", () => {
    const events: LiveEventInput[] = [{ type: "shot", outcome: "off_target", teamId: HOME }]
    const { home, away } = computeLiveStats(events, HOME, AWAY)
    expect(home).not.toHaveProperty("shots")
    expect(away).not.toHaveProperty("shots")
  })

  it("a save event contributes nothing to live stats (same reason as shot)", () => {
    const events: LiveEventInput[] = [{ type: "save", outcome: "saved", teamId: AWAY }]
    const { home, away } = computeLiveStats(events, HOME, AWAY)
    expect(home.goals).toBe(0)
    expect(away.goals).toBe(0)
  })

  it("a goal counts only as a goal for the scoring team - never as a shot", () => {
    const events: LiveEventInput[] = [{ type: "goal", outcome: "goal", teamId: HOME }]
    const { home } = computeLiveStats(events, HOME, AWAY)
    expect(home).toMatchObject({ goals: 1 })
    expect(home).not.toHaveProperty("shots")
  })

  it("a missed penalty counts neither as a shot nor a goal", () => {
    const events: LiveEventInput[] = [{ type: "penalty", outcome: "missed", teamId: AWAY }]
    const { away } = computeLiveStats(events, HOME, AWAY)
    expect(away).toMatchObject({ goals: 0 })
    expect(away).not.toHaveProperty("shots")
  })

  it("a scored penalty counts as a goal", () => {
    const events: LiveEventInput[] = [{ type: "penalty", outcome: "scored", teamId: AWAY }]
    const { away } = computeLiveStats(events, HOME, AWAY)
    expect(away.goals).toBe(1)
  })

  it("never exposes Shots, Shots on Target, or possession live - all three are only trustworthy once the match is finished", () => {
    const { home } = computeLiveStats([], HOME, AWAY)
    expect(home).not.toHaveProperty("shots")
    expect(home).not.toHaveProperty("shotsOnTarget")
    expect(home).not.toHaveProperty("possessionPercent")
  })

  it("at minute 30 of the fixture, stats reflect only revealed events (one corner, one yellow), not the future red card", () => {
    const revealed = filterRevealedEvents(ALL_EVENTS_WITH_MINUTE, 30)
    const { home, away } = computeLiveStats(revealed, HOME, AWAY)
    expect(away.corners).toBe(1)
    expect(away.yellowCards).toBe(1)
    expect(home.redCards).toBe(0) // the minute-60 red card must not have leaked
  })
})
