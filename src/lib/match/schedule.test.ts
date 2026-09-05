import {
  getSeasonStartMonday,
  getNextSeasonStartMonday,
  computeMatchdayDate,
  NEXT_SEASON_MIN_LEAD_HOURS,
} from "./schedule"

const HOUR_MS = 3600_000

describe("getNextSeasonStartMonday", () => {
  it("never returns a kickoff that has already passed, even on a Monday after kickoff time", () => {
    // The exact case getSeasonStartMonday gets wrong on its own: a Monday
    // at 20:00 makes it return that same day's 19:00, an hour in the past.
    const mondayEvening = new Date("2026-01-05T20:00:00")
    expect(mondayEvening.getDay()).toBe(1)
    expect(getSeasonStartMonday(mondayEvening).getTime()).toBeLessThan(mondayEvening.getTime())

    const next = getNextSeasonStartMonday(mondayEvening)
    expect(next.getTime()).toBeGreaterThan(mondayEvening.getTime())
  })

  it("always leaves at least the configured lead time before the first kickoff", () => {
    // Every hour across a full fortnight - no starting instant may produce a
    // kickoff inside the lead window.
    const start = new Date("2026-03-01T00:00:00")
    for (let hour = 0; hour < 24 * 14; hour++) {
      const reference = new Date(start.getTime() + hour * HOUR_MS)
      const kickoff = getNextSeasonStartMonday(reference)
      const leadMs = kickoff.getTime() - reference.getTime()
      expect(leadMs).toBeGreaterThanOrEqual(NEXT_SEASON_MIN_LEAD_HOURS * HOUR_MS)
      expect(kickoff.getDay()).toBe(1)
      expect(kickoff.getHours()).toBe(19)
    }
  })

  it("honours a custom lead time", () => {
    const reference = new Date("2026-01-06T10:00:00") // Tuesday
    const kickoff = getNextSeasonStartMonday(reference, 24 * 9)
    expect(kickoff.getTime() - reference.getTime()).toBeGreaterThanOrEqual(24 * 9 * HOUR_MS)
    expect(kickoff.getDay()).toBe(1)
  })

  it("produces a 38-matchday schedule whose every kickoff is in the future", () => {
    const reference = new Date("2026-01-05T20:00:00")
    const startMonday = getNextSeasonStartMonday(reference)
    for (let matchday = 1; matchday <= 38; matchday++) {
      expect(computeMatchdayDate(startMonday, matchday).getTime()).toBeGreaterThan(reference.getTime())
    }
    // Mon/Wed/Sat cadence is unchanged.
    expect(computeMatchdayDate(startMonday, 1).getDay()).toBe(1)
    expect(computeMatchdayDate(startMonday, 2).getDay()).toBe(3)
    expect(computeMatchdayDate(startMonday, 3).getDay()).toBe(6)
  })
})
