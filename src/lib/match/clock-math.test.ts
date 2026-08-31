import { clampForDisplay, computeClockOffsetMs, computeSimulatedSeconds, formatClockFromSeconds, MATCH_SIMULATED_SECONDS } from "./clock-math"

const KICKOFF = new Date("2026-08-31T19:00:00.000Z").getTime()
const REAL_MINUTE_MS = 60_000

describe("computeSimulatedSeconds", () => {
  it("is exactly 0 at kickoff", () => {
    expect(computeSimulatedSeconds(KICKOFF, KICKOFF)).toBe(0)
  })

  it("is 0 before kickoff (negative elapsed time)", () => {
    expect(computeSimulatedSeconds(KICKOFF, KICKOFF - 5000)).toBe(0)
  })

  it("after 1 real minute, reads 9:00 (540 simulated seconds)", () => {
    expect(computeSimulatedSeconds(KICKOFF, KICKOFF + REAL_MINUTE_MS)).toBe(540)
  })

  it("after 5 real minutes, reads 45:00 (2700 simulated seconds)", () => {
    expect(computeSimulatedSeconds(KICKOFF, KICKOFF + 5 * REAL_MINUTE_MS)).toBe(2700)
  })

  it("after exactly 10 real minutes, reads 90:00 (5400 simulated seconds)", () => {
    expect(computeSimulatedSeconds(KICKOFF, KICKOFF + 10 * REAL_MINUTE_MS)).toBe(MATCH_SIMULATED_SECONDS)
  })

  it("after more than 10 real minutes, stays clamped at 90:00", () => {
    expect(computeSimulatedSeconds(KICKOFF, KICKOFF + 25 * REAL_MINUTE_MS)).toBe(MATCH_SIMULATED_SECONDS)
  })

  it("never jumps backward across a poll re-sync, even across an integer-minute boundary", () => {
    // The exact regression this function exists to avoid: a client already
    // displaying 31:42 (1902 simulated seconds) must not snap back to
    // 31:00 (1860s) just because a fresh poll's *integer* `minute` field
    // reads 31 - this function never consults that field at all.
    const atDisplay3142 = KICKOFF + (1902 / 9) * 1000 // real elapsed ms that produces ~31:42
    const before = computeSimulatedSeconds(KICKOFF, atDisplay3142)
    expect(before).toBeCloseTo(1902, 0)

    // A moment later (next 250ms tick, or the next poll's re-sync) - time
    // only moved forward, so the clock must too.
    const after = computeSimulatedSeconds(KICKOFF, atDisplay3142 + 250)
    expect(after).toBeGreaterThan(before)
    expect(Math.floor(after)).not.toBe(1860) // must never truncate back to the floored minute=31 mark
  })
})

describe("formatClockFromSeconds", () => {
  it("formats kickoff as 00:00", () => {
    expect(formatClockFromSeconds(0)).toBe("00:00")
  })

  it("formats 540 seconds as 09:00", () => {
    expect(formatClockFromSeconds(540)).toBe("09:00")
  })

  it("formats 2700 seconds as 45:00", () => {
    expect(formatClockFromSeconds(2700)).toBe("45:00")
  })

  it("formats full time as 90:00, never rolling over", () => {
    expect(formatClockFromSeconds(MATCH_SIMULATED_SECONDS)).toBe("90:00")
    expect(formatClockFromSeconds(MATCH_SIMULATED_SECONDS + 500)).toBe("90:00")
  })

  it("formats 1902 seconds as 31:42", () => {
    expect(formatClockFromSeconds(1902)).toBe("31:42")
  })
})

describe("computeClockOffsetMs", () => {
  const SKEW_MS = 500 // the client's clock is 500ms behind the server's

  it("recovers the true clock skew under a 100ms round trip", () => {
    const requestStartedAt = 1_000_000
    const responseReceivedAt = requestStartedAt + 100
    // The server's instant, expressed on the client's clock, is the
    // request's true midpoint (50ms in) plus the skew.
    const serverNowMs = requestStartedAt + 50 + SKEW_MS
    expect(computeClockOffsetMs(requestStartedAt, responseReceivedAt, serverNowMs)).toBe(SKEW_MS)
  })

  it("recovers the same clock skew under a 1000ms round trip - the midpoint method is not degraded by a slow connection", () => {
    const requestStartedAt = 2_000_000
    const responseReceivedAt = requestStartedAt + 1000
    const serverNowMs = requestStartedAt + 500 + SKEW_MS
    expect(computeClockOffsetMs(requestStartedAt, responseReceivedAt, serverNowMs)).toBe(SKEW_MS)
  })

  it("two polls with very different latency (100ms vs 1000ms) still agree on the same recovered skew", () => {
    const fastPoll = computeClockOffsetMs(1_000_000, 1_000_100, 1_000_000 + 50 + SKEW_MS)
    const slowPoll = computeClockOffsetMs(5_000_000, 5_000_800, 5_000_000 + 400 + SKEW_MS)
    expect(fastPoll).toBe(SKEW_MS)
    expect(slowPoll).toBe(SKEW_MS)
  })

  it("a naive offset (server time minus raw receipt time, ignoring the request's start) would have been wrong by half the RTT - confirming the midpoint correction actually matters", () => {
    const requestStartedAt = 3_000_000
    const responseReceivedAt = requestStartedAt + 1000
    const serverNowMs = requestStartedAt + 500 + SKEW_MS
    const naiveOffset = serverNowMs - responseReceivedAt // what you'd get comparing against receipt time alone
    const correctedOffset = computeClockOffsetMs(requestStartedAt, responseReceivedAt, serverNowMs)
    expect(correctedOffset).toBe(SKEW_MS)
    expect(naiveOffset).not.toBe(SKEW_MS)
  })
})

describe("clampForDisplay", () => {
  it("scheduled is always exactly 0, regardless of the candidate", () => {
    expect(clampForDisplay(1234, 999, "scheduled")).toBe(0)
    expect(clampForDisplay(0, 0, "scheduled")).toBe(0)
  })

  it("finished is always exactly 90:00 (5400s), even if the last displayed value was lower", () => {
    expect(clampForDisplay(1234, 999, "finished")).toBe(MATCH_SIMULATED_SECONDS)
    expect(clampForDisplay(0, 0, "finished")).toBe(MATCH_SIMULATED_SECONDS)
  })

  it("live: a higher candidate advances the clock normally", () => {
    expect(clampForDisplay(1000, 900, "live")).toBe(1000)
  })

  it("live: the clock never moves backward - a lower candidate (e.g. from a clock-skew resync) is floored at the last displayed value", () => {
    expect(clampForDisplay(850, 900, "live")).toBe(900)
  })

  it("live: still clamps at 90:00 even if the candidate overshoots", () => {
    expect(clampForDisplay(6000, 5000, "live")).toBe(MATCH_SIMULATED_SECONDS)
  })

  it("live: after 10 real minutes' worth of candidates, stays exactly 90:00 and never exceeds it on subsequent ticks", () => {
    const atTenMinutes = clampForDisplay(MATCH_SIMULATED_SECONDS, 5000, "live")
    expect(atTenMinutes).toBe(MATCH_SIMULATED_SECONDS)
    const oneMoreTickLater = clampForDisplay(MATCH_SIMULATED_SECONDS + 200, atTenMinutes, "live")
    expect(oneMoreTickLater).toBe(MATCH_SIMULATED_SECONDS)
  })
})
