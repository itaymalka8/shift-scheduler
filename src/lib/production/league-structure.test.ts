import { checkDivisionStructure, expectedFixtureCount } from "./league-structure"

describe("expectedFixtureCount", () => {
  it("computes double round robin (everyone plays everyone home and away)", () => {
    expect(expectedFixtureCount(20)).toBe(380)
    expect(expectedFixtureCount(2)).toBe(2)
  })

  it("is zero for zero or one team", () => {
    expect(expectedFixtureCount(0)).toBe(0)
    expect(expectedFixtureCount(1)).toBe(0)
  })
})

describe("checkDivisionStructure", () => {
  it("matches when fixture count equals the double round-robin expectation", () => {
    expect(checkDivisionStructure({ teamCount: 20, fixtureCount: 380 })).toEqual({
      teamCount: 20,
      fixtureCount: 380,
      expectedFixtures: 380,
      matches: true,
    })
  })

  it("flags a mismatch (missing or duplicated fixtures)", () => {
    expect(checkDivisionStructure({ teamCount: 20, fixtureCount: 379 }).matches).toBe(false)
    expect(checkDivisionStructure({ teamCount: 20, fixtureCount: 760 }).matches).toBe(false)
  })
})
