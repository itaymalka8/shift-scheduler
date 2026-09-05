import {
  boundaryRanksFor,
  slotsAboveBoundary,
  straddlesBoundary,
  TIER1_LAST_SAFE_RANK,
  TIER2_PLAYOFF_HIGH_RANK,
  TIER2_PLAYOFF_LOW_RANK,
} from "./outcomes"

/**
 * WHEN A TIE IS WORTH A MATCH.
 *
 * The approved contract says a decider exists only when the tied clubs would
 * otherwise receive DIFFERENT sporting outcomes. These tests pin both halves
 * of that: the boundaries that matter, and the far larger set of ties that
 * correctly produce no fixture at all.
 */

describe("which ranks are outcome boundaries", () => {
  it("tier 1 defends only the relegation line", () => {
    expect(boundaryRanksFor({ divisionId: "d", tier: 1, group: "" })).toEqual([TIER1_LAST_SAFE_RANK])
  })

  it("a tier 2 group defends both playoff seeding lines", () => {
    expect(boundaryRanksFor({ divisionId: "d", tier: 2, group: "A" })).toEqual([
      TIER2_PLAYOFF_HIGH_RANK,
      TIER2_PLAYOFF_LOW_RANK,
    ])
  })

  it("RANK 1 IS NEVER A BOUNDARY HERE - the title machinery owns it", () => {
    // In a tier 2 group rank 1 is simultaneously the championship and
    // automatic promotion. ONE tie, ONE fixture. Listing it here would create
    // a second decider for the same two clubs.
    for (const tier of [1, 2]) {
      expect(boundaryRanksFor({ divisionId: "d", tier, group: "A" })).not.toContain(1)
    }
  })

  it("a tier with no defined outcomes defends nothing", () => {
    // No tier 3 exists, so nothing is relegated out of tier 2 and a tier
    // added later declares its own boundaries rather than inheriting one.
    expect(boundaryRanksFor({ divisionId: "d", tier: 3, group: "" })).toEqual([])
  })
})

describe("does a tied group straddle a boundary", () => {
  it("yes when it holds ranks on both sides", () => {
    expect(straddlesBoundary(16, 2, 16)).toBe(true) // 16th and 17th
    expect(straddlesBoundary(15, 3, 16)).toBe(true) // 15th, 16th, 17th
  })

  it("no when it sits entirely above", () => {
    expect(straddlesBoundary(14, 2, 16)).toBe(false) // 14th and 15th
    expect(straddlesBoundary(15, 2, 16)).toBe(false) // 15th and 16th
  })

  it("no when it sits entirely below - the case that must play nothing", () => {
    // Clubs tied for 17th, 18th, 19th and 20th all go down whatever happens
    // between them. Manufacturing an order would be a fixture with no
    // sporting purpose.
    expect(straddlesBoundary(17, 4, 16)).toBe(false)
    expect(straddlesBoundary(18, 2, 16)).toBe(false)
  })

  it("a single club never straddles anything", () => {
    expect(straddlesBoundary(16, 1, 16)).toBe(false)
    expect(straddlesBoundary(17, 1, 16)).toBe(false)
  })
})

describe("how many of a tied group take the upper side", () => {
  it("splits a two-club tie across the line one and one", () => {
    expect(slotsAboveBoundary(16, 2, 16)).toBe(1)
  })

  it("gives a three-club tie starting at 15 two safe places", () => {
    expect(slotsAboveBoundary(15, 3, 16)).toBe(2)
  })

  it("is zero for a group entirely below the line", () => {
    expect(slotsAboveBoundary(17, 4, 16)).toBe(0)
  })

  it("is the whole group for one entirely above it", () => {
    expect(slotsAboveBoundary(14, 2, 16)).toBe(2)
  })

  it("a tier 2 group tied across ranks 2 and 3 splits one and one", () => {
    expect(slotsAboveBoundary(2, 2, TIER2_PLAYOFF_HIGH_RANK)).toBe(1)
    // ...and the same group is also on the 3|4 line only if it reaches rank 4.
    expect(straddlesBoundary(2, 2, TIER2_PLAYOFF_LOW_RANK)).toBe(false)
    expect(straddlesBoundary(3, 2, TIER2_PLAYOFF_LOW_RANK)).toBe(true)
  })
})
