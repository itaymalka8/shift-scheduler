import { getTransferWindowDefinition, isWithinTransferWindow } from "./window"

// Aug 27, 2026 and Jan 8, 2026 are both real Thursdays (verified against a
// known anchor: Jan 1, 2026 is a Thursday) - not arbitrary picks, so these
// double as the winter/summer DST-offset assertions the product spec calls for.
//
// The window's own week runs Monday->Sunday, anchored on the nearest
// Thursday: Mon/Tue/Wed look forward to their upcoming Thursday, Fri/Sat/Sun
// look back at the Thursday whose window already opened.

describe("getTransferWindowDefinition", () => {
  it("1. winter (Jan 8, 2026 Thursday) resolves to the UTC+2 instant", () => {
    const window = getTransferWindowDefinition(new Date("2026-01-08T08:00:00.000Z"))
    expect(window.weekKey).toBe("2026-01-08")
    expect(window.opensAt.toISOString()).toBe("2026-01-07T22:00:00.000Z")
    expect(window.closesAt.toISOString()).toBe("2026-01-08T22:00:00.000Z")
  })

  it("2. summer (Aug 27, 2026 Thursday) resolves to the UTC+3 instant", () => {
    const window = getTransferWindowDefinition(new Date("2026-08-27T08:00:00.000Z"))
    expect(window.weekKey).toBe("2026-08-27")
    expect(window.opensAt.toISOString()).toBe("2026-08-26T21:00:00.000Z")
    expect(window.closesAt.toISOString()).toBe("2026-08-27T21:00:00.000Z")
  })

  it("Monday (Aug 31, 2026) resolves forward to its own upcoming Thursday", () => {
    const monday = getTransferWindowDefinition(new Date("2026-08-31T08:00:00.000Z"))
    expect(monday.weekKey).toBe("2026-09-03")
  })

  it("Tuesday (Sep 1, 2026) resolves forward to that same upcoming Thursday", () => {
    const tuesday = getTransferWindowDefinition(new Date("2026-09-01T08:00:00.000Z"))
    expect(tuesday.weekKey).toBe("2026-09-03")
  })

  it("Wednesday (Sep 2, 2026) resolves forward to that same upcoming Thursday", () => {
    const wednesday = getTransferWindowDefinition(new Date("2026-09-02T08:00:00.000Z"))
    expect(wednesday.weekKey).toBe("2026-09-03")
  })

  it("Friday after closing resolves back to the same Thursday (one day earlier)", () => {
    const friday = getTransferWindowDefinition(new Date("2026-08-28T08:00:00.000Z"))
    expect(friday.weekKey).toBe("2026-08-27")
  })

  it("Saturday after closing resolves back to the same Thursday (two days earlier)", () => {
    const saturday = getTransferWindowDefinition(new Date("2026-08-29T08:00:00.000Z"))
    expect(saturday.weekKey).toBe("2026-08-27")
  })

  it("Sunday, Aug 30, 2026 resolves back to Thursday, Aug 27, 2026 (three days earlier)", () => {
    const sunday = getTransferWindowDefinition(new Date("2026-08-30T08:00:00.000Z"))
    expect(sunday.weekKey).toBe("2026-08-27")
  })

  it("the following Monday (Sep 7, 2026) moves on to the next Thursday (Sep 10, 2026), not back to Sep 3", () => {
    const followingMonday = getTransferWindowDefinition(new Date("2026-09-07T08:00:00.000Z"))
    expect(followingMonday.weekKey).toBe("2026-09-10")
  })

  it("11. year boundary: Jan 1, 2027 (a Friday) resolves back to Dec 31, 2026's Thursday window", () => {
    const window = getTransferWindowDefinition(new Date("2027-01-01T08:00:00.000Z"))
    expect(window.weekKey).toBe("2026-12-31")
    expect(window.opensAt.toISOString()).toBe("2026-12-30T22:00:00.000Z")
    expect(window.closesAt.toISOString()).toBe("2026-12-31T22:00:00.000Z")
  })

  it("12. throws on an invalid Date instead of silently building a window", () => {
    expect(() => getTransferWindowDefinition(new Date("not-a-date"))).toThrow()
  })
})

describe("isWithinTransferWindow", () => {
  // A fixed, known window (the Aug 27, 2026 summer window from test 2)
  // reused for every boundary check below.
  const window = getTransferWindowDefinition(new Date("2026-08-27T08:00:00.000Z"))
  const ONE_HOUR = 60 * 60 * 1000

  it("3. a moment before opening returns false", () => {
    const justBefore = new Date(window.opensAt.getTime() - 1)
    expect(isWithinTransferWindow(window, justBefore)).toBe(false)
  })

  it("4. exactly opensAt returns true", () => {
    expect(isWithinTransferWindow(window, window.opensAt)).toBe(true)
  })

  it("5. during Thursday returns true", () => {
    const duringThursday = new Date(window.opensAt.getTime() + 12 * ONE_HOUR)
    expect(isWithinTransferWindow(window, duringThursday)).toBe(true)
  })

  it("6. one millisecond before closesAt returns true", () => {
    const justBeforeClose = new Date(window.closesAt.getTime() - 1)
    expect(isWithinTransferWindow(window, justBeforeClose)).toBe(true)
  })

  it("7. exactly closesAt returns false", () => {
    expect(isWithinTransferWindow(window, window.closesAt)).toBe(false)
  })

  it("8. Friday after closing returns false", () => {
    const afterClose = new Date(window.closesAt.getTime() + 12 * ONE_HOUR)
    expect(isWithinTransferWindow(window, afterClose)).toBe(false)
  })

  it("12. throws on an invalid Date instead of silently returning a boolean", () => {
    expect(() => isWithinTransferWindow(window, new Date("not-a-date"))).toThrow()
  })
})
