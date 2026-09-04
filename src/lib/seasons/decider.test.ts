import {
  DECIDER_MIN_LEAD_HOURS,
  computeDeciderSchedule,
  deciderWinnerTeamId,
  technicalHomeAway,
} from "./decider"
import { computeMatchdayDate } from "@/lib/match/schedule"

/** Season 1's real anchor shape: a Monday 19:00 kickoff. */
const SEASON_START = computeMatchdayDate(new Date("2026-08-31T19:00:00.000Z"), 1)
const LAST_MATCHDAY = 38

describe("technicalHomeAway", () => {
  it("gives the lower lexical teamId the home role", () => {
    expect(technicalHomeAway(["zzz", "aaa"])).toEqual({ homeTeamId: "aaa", awayTeamId: "zzz" })
  })

  it("is order-independent - the same two clubs always get the same roles", () => {
    expect(technicalHomeAway(["b", "a"])).toEqual(technicalHomeAway(["a", "b"]))
  })

  it("refuses anything but exactly two clubs - one fixture cannot settle a three-way tie", () => {
    expect(() => technicalHomeAway(["a"])).toThrow(/exactly two/)
    expect(() => technicalHomeAway(["a", "b", "c"])).toThrow(/exactly two/)
  })
})

describe("computeDeciderSchedule", () => {
  it("takes the next slot in the league's own Mon/Wed/Sat cadence", () => {
    // A long way before the deadline, so the lead-time floor is not involved.
    const now = new Date(SEASON_START.getTime())
    const { scheduledAt, matchday } = computeDeciderSchedule(SEASON_START, LAST_MATCHDAY, now)
    expect(matchday).toBe(LAST_MATCHDAY + 1)
    expect(scheduledAt).toEqual(computeMatchdayDate(SEASON_START, LAST_MATCHDAY + 1))
  })

  it("kicks off at the same hour every other match does", () => {
    const now = new Date(SEASON_START.getTime())
    const { scheduledAt } = computeDeciderSchedule(SEASON_START, LAST_MATCHDAY, now)
    const anyMatchday = computeMatchdayDate(SEASON_START, 7)
    expect(scheduledAt.getHours()).toBe(anyMatchday.getHours())
  })

  it("is DETERMINISTIC - two runners computing it separately agree", () => {
    const now = new Date("2026-11-25T19:30:00.000Z")
    const a = computeDeciderSchedule(SEASON_START, LAST_MATCHDAY, now)
    const b = computeDeciderSchedule(SEASON_START, LAST_MATCHDAY, now)
    expect(a).toEqual(b)
  })

  it("never schedules in the past, however late the orchestrator runs", () => {
    // A month after the season should have ended - an outage.
    const now = new Date(computeMatchdayDate(SEASON_START, LAST_MATCHDAY).getTime() + 30 * 86_400_000)
    const { scheduledAt } = computeDeciderSchedule(SEASON_START, LAST_MATCHDAY, now)
    expect(scheduledAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it("always leaves managers at least the lead time to prepare", () => {
    for (const offsetHours of [0, 1, 5, 23, 25, 100, 500]) {
      const now = new Date(computeMatchdayDate(SEASON_START, LAST_MATCHDAY).getTime() + offsetHours * 3600_000)
      const { scheduledAt } = computeDeciderSchedule(SEASON_START, LAST_MATCHDAY, now)
      const leadMs = scheduledAt.getTime() - now.getTime()
      expect(leadMs).toBeGreaterThanOrEqual(DECIDER_MIN_LEAD_HOURS * 3600_000)
    }
  })

  it("steps forward slot by slot rather than jumping an arbitrary distance", () => {
    // Just inside the lead deadline for matchday 39, so it must take 40.
    const slot39 = computeMatchdayDate(SEASON_START, LAST_MATCHDAY + 1)
    const now = new Date(slot39.getTime() - 1 * 3600_000)
    const { matchday } = computeDeciderSchedule(SEASON_START, LAST_MATCHDAY, now)
    expect(matchday).toBeGreaterThan(LAST_MATCHDAY + 1)
  })
})

describe("deciderWinnerTeamId", () => {
  const base = { homeTeamId: "H", awayTeamId: "A", homeShootoutScore: null, awayShootoutScore: null }

  it("the 90-minute winner takes it, with no shootout involved", () => {
    expect(deciderWinnerTeamId({ ...base, homeScore: 2, awayScore: 1 })).toBe("H")
    expect(deciderWinnerTeamId({ ...base, homeScore: 0, awayScore: 3 })).toBe("A")
  })

  it("a draw is settled by the shootout", () => {
    expect(deciderWinnerTeamId({ ...base, homeScore: 1, awayScore: 1, homeShootoutScore: 5, awayShootoutScore: 4 })).toBe("H")
    expect(deciderWinnerTeamId({ ...base, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 3 })).toBe("A")
  })

  it("FAILS CLOSED on a draw with no shootout - no champion rather than a guess", () => {
    expect(deciderWinnerTeamId({ ...base, homeScore: 1, awayScore: 1 })).toBeNull()
  })

  it("FAILS CLOSED on an impossible level shootout", () => {
    expect(deciderWinnerTeamId({ ...base, homeScore: 0, awayScore: 0, homeShootoutScore: 4, awayShootoutScore: 4 })).toBeNull()
  })

  it("FAILS CLOSED on a half-written shootout", () => {
    expect(deciderWinnerTeamId({ ...base, homeScore: 1, awayScore: 1, homeShootoutScore: 5, awayShootoutScore: null })).toBeNull()
  })

  it("FAILS CLOSED before the match has a score at all", () => {
    expect(deciderWinnerTeamId({ ...base, homeScore: null, awayScore: null })).toBeNull()
  })

  it("ignores a shootout score when the 90 minutes already settled it", () => {
    // Should never be stored (the CHECK forbids a shootout on a non-draw in
    // practice), but the rule is stated here rather than assumed.
    expect(
      deciderWinnerTeamId({ ...base, homeScore: 3, awayScore: 0, homeShootoutScore: 1, awayShootoutScore: 9 })
    ).toBe("H")
  })
})
