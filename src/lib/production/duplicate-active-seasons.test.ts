import { findDuplicateActiveSeasons } from "./duplicate-active-seasons"

describe("findDuplicateActiveSeasons", () => {
  it("returns nothing when every country has at most one active season", () => {
    expect(
      findDuplicateActiveSeasons([
        { countryCode: "IL", isActive: true },
        { countryCode: "IL", isActive: false },
        { countryCode: "FR", isActive: true },
      ])
    ).toEqual([])
  })

  it("flags a country with two active seasons", () => {
    expect(
      findDuplicateActiveSeasons([
        { countryCode: "IL", isActive: true },
        { countryCode: "IL", isActive: true },
      ])
    ).toEqual(["IL"])
  })

  it("ignores inactive seasons entirely", () => {
    expect(
      findDuplicateActiveSeasons([
        { countryCode: "IL", isActive: false },
        { countryCode: "IL", isActive: false },
        { countryCode: "IL", isActive: false },
      ])
    ).toEqual([])
  })

  it("only reports countries that are actually duplicated, not every country", () => {
    expect(
      findDuplicateActiveSeasons([
        { countryCode: "IL", isActive: true },
        { countryCode: "IL", isActive: true },
        { countryCode: "FR", isActive: true },
      ])
    ).toEqual(["IL"])
  })

  it("returns an empty array for an empty input", () => {
    expect(findDuplicateActiveSeasons([])).toEqual([])
  })
})
