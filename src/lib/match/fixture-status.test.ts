import {
  belongsInResults,
  belongsInUpcoming,
  getFixtureListStatus,
  revealFinalScore,
  revealedMinuteCap,
} from "./fixture-status"
import { MATCH_REAL_DURATION_MINUTES } from "./timing"

const KICKOFF = new Date("2026-09-05T19:00:00.000Z")
const minutesAfterKickoff = (minutes: number) => new Date(KICKOFF.getTime() + minutes * 60_000)

// The live window is 10 real minutes (see timing.ts) - asserted here so
// these fixtures stop being meaningful if that constant ever moves.
const AFTER_FULL_TIME = minutesAfterKickoff(MATCH_REAL_DURATION_MINUTES + 1)

describe("getFixtureListStatus", () => {
  it("a fixture whose kickoff is still ahead is scheduled", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: null }
    expect(getFixtureListStatus(fixture, minutesAfterKickoff(-30))).toBe("scheduled")
  })

  it("a simulated fixture mid-live-window is live, not finished", () => {
    // The engine writes the whole result at kickoff, so playedAt is already
    // set while the viewer is only two real minutes into the match.
    const fixture = { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0) }
    expect(getFixtureListStatus(fixture, minutesAfterKickoff(2))).toBe("live")
  })

  it("a simulated fixture past its live window is finished", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0) }
    expect(getFixtureListStatus(fixture, AFTER_FULL_TIME)).toBe("finished")
  })

  it("a past fixture that was never simulated is awaitingProcessing, never finished", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: null }
    expect(getFixtureListStatus(fixture, AFTER_FULL_TIME)).toBe("awaitingProcessing")
  })

  it("an unscheduled fixture is scheduled (it cannot have kicked off)", () => {
    expect(getFixtureListStatus({ scheduledAt: null, playedAt: null }, AFTER_FULL_TIME)).toBe("scheduled")
  })
})

describe("tab routing", () => {
  it("a future fixture is classified as Upcoming and not as a Result", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: null }
    const now = minutesAfterKickoff(-30)
    expect(belongsInUpcoming(fixture, now)).toBe(true)
    expect(belongsInResults(fixture, now)).toBe(false)
  })

  it("a live, already-simulated fixture is NOT classified as a Result", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0) }
    const now = minutesAfterKickoff(3)
    expect(belongsInResults(fixture, now)).toBe(false)
    expect(belongsInUpcoming(fixture, now)).toBe(true)
  })

  it("a finished fixture is classified as a Result and not as Upcoming", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0) }
    expect(belongsInResults(fixture, AFTER_FULL_TIME)).toBe(true)
    expect(belongsInUpcoming(fixture, AFTER_FULL_TIME)).toBe(false)
  })

  it("a past unsimulated fixture sits in Results (chronologically past) but is not Upcoming", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: null }
    expect(belongsInResults(fixture, AFTER_FULL_TIME)).toBe(true)
    expect(belongsInUpcoming(fixture, AFTER_FULL_TIME)).toBe(false)
  })

  it("every fixture lands in exactly one of the two tabs, in every state", () => {
    const cases = [
      { fixture: { scheduledAt: KICKOFF, playedAt: null }, now: minutesAfterKickoff(-1) },
      { fixture: { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0) }, now: minutesAfterKickoff(1) },
      { fixture: { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0) }, now: AFTER_FULL_TIME },
      { fixture: { scheduledAt: KICKOFF, playedAt: null }, now: AFTER_FULL_TIME },
      { fixture: { scheduledAt: null, playedAt: null }, now: AFTER_FULL_TIME },
    ]
    for (const { fixture, now } of cases) {
      expect([belongsInUpcoming(fixture, now), belongsInResults(fixture, now)].filter(Boolean)).toHaveLength(1)
    }
  })
})

describe("revealFinalScore - the anti-spoiler gate for any list", () => {
  it("refuses to reveal a stored score while the live window is still running", () => {
    // playedAt != null AND homeScore/awayScore already in the database: this
    // is the exact shape that would leak a final score into a calendar if
    // playedAt were treated as "the match is over".
    const fixture = { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0), homeScore: 3, awayScore: 1 }
    expect(revealFinalScore(fixture, minutesAfterKickoff(1))).toBeNull()
    expect(revealFinalScore(fixture, minutesAfterKickoff(9))).toBeNull()
  })

  it("reveals the score once the live window has played out", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0), homeScore: 3, awayScore: 1 }
    expect(revealFinalScore(fixture, AFTER_FULL_TIME)).toEqual({ home: 3, away: 1 })
  })

  it("reveals nothing for a future fixture", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: null, homeScore: null, awayScore: null }
    expect(revealFinalScore(fixture, minutesAfterKickoff(-30))).toBeNull()
  })

  it("never invents 0:0 for a past fixture that was never simulated", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: null, homeScore: null, awayScore: null }
    expect(revealFinalScore(fixture, AFTER_FULL_TIME)).toBeNull()
  })

  it("refuses a half-written result (playedAt set, scores still null) rather than rendering nulls", () => {
    const fixture = { scheduledAt: KICKOFF, playedAt: minutesAfterKickoff(0), homeScore: null, awayScore: null }
    expect(revealFinalScore(fixture, AFTER_FULL_TIME)).toBeNull()
  })
})

describe("revealedMinuteCap - how much of a match may be shown", () => {
  it("is 0 before kickoff, so a future match can expose no events at all", () => {
    expect(revealedMinuteCap(KICKOFF, minutesAfterKickoff(-1))).toBe(0)
  })

  it("tracks the live clock while the match is running", () => {
    // 1 real minute = 9 simulated minutes.
    expect(revealedMinuteCap(KICKOFF, minutesAfterKickoff(1))).toBe(9)
    expect(revealedMinuteCap(KICKOFF, minutesAfterKickoff(5))).toBe(45)
  })

  it("is the full 90 once the window has played out, which is what archive mode reads", () => {
    expect(revealedMinuteCap(KICKOFF, AFTER_FULL_TIME)).toBe(90)
    expect(revealedMinuteCap(KICKOFF, minutesAfterKickoff(60 * 24 * 400))).toBe(90)
  })
})
