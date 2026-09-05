import {
  DEFAULT_DIRECTORY_STATUS,
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_STATUSES,
  EMPTY_DIRECTORY_PARAMS,
  MAX_SEARCH_LENGTH,
  computePageWindow,
  directoryHref,
  escapeLikeTerm,
  hasActiveFilters,
  isDirectoryStatus,
  parseDirectoryParams,
  skipFor,
} from "./directory"

const KNOWN = {
  positions: ["GK", "CB", "ST"],
  clubIds: ["t-alpha", "t-beta"],
  nationalities: ["IL", "BR"],
}
const parse = (sp: Record<string, string | string[] | undefined>) => parseDirectoryParams(sp, KNOWN)

describe("parseDirectoryParams - malformed input is ignored, never fatal", () => {
  it("returns the defaults for an empty query string", () => {
    expect(parse({})).toEqual(EMPTY_DIRECTORY_PARAMS)
  })

  it("trims the search term", () => {
    expect(parse({ q: "   Cohen   " }).q).toBe("Cohen")
    expect(parse({ q: "   " }).q).toBe("")
  })

  it("caps an absurdly long search rather than rejecting it", () => {
    // A pasted paragraph returns an empty result, not an error, and no
    // unbounded string ever reaches the database.
    const long = "a".repeat(500)
    expect(parse({ q: long }).q).toHaveLength(MAX_SEARCH_LENGTH)
  })

  it("keeps a filter value that really exists", () => {
    const params = parse({ position: "GK", club: "t-beta", nationality: "BR" })
    expect([params.position, params.club, params.nationality]).toEqual(["GK", "t-beta", "BR"])
  })

  it("DROPS a filter value that does not exist, rather than querying for it", () => {
    // Echoing an arbitrary string back as a selected option is how a page
    // starts rendering someone else's input.
    const params = parse({ position: "WIZARD", club: "'; DROP TABLE", nationality: "ZZ" })
    expect([params.position, params.club, params.nationality]).toEqual([null, null, null])
  })

  it("falls back to the default status for an unknown one", () => {
    expect(parse({ status: "banned" }).status).toBe(DEFAULT_DIRECTORY_STATUS)
    expect(parse({ status: "retired" }).status).toBe("retired")
  })

  it("takes the first value when a parameter is repeated", () => {
    expect(parse({ q: ["one", "two"] }).q).toBe("one")
    expect(parse({ position: ["GK", "ST"] }).position).toBe("GK")
  })

  it("accepts only a plain positive integer page", () => {
    expect(parse({ page: "3" }).page).toBe(3)
    for (const bad of ["0", "-1", "2.5", "+2", "1e3", " 2", "2 ", "abc", "", "999999999999999999999"]) {
      expect(parse({ page: bad }).page).toBe(1)
    }
  })

  it("accepts a page far past the end - the reader decides what that means", () => {
    expect(parse({ page: "9999" }).page).toBe(9999)
  })
})

describe("status axis", () => {
  it("offers exactly four views", () => {
    expect(DIRECTORY_STATUSES).toEqual(["all", "active", "retired", "free"])
  })

  it("defaults to ALL, so a retiring player is never silently hidden", () => {
    // Production has 0 retired players today, which makes "all" and "active"
    // identical - and makes a default of "active" a change that would start
    // hiding people later with nobody seeing it happen.
    expect(DEFAULT_DIRECTORY_STATUS).toBe("all")
  })

  it("recognises its own values and nothing else", () => {
    for (const s of DIRECTORY_STATUSES) expect(isDirectoryStatus(s)).toBe(true)
    for (const s of ["", "ACTIVE", "Retired", null, undefined, "everyone"]) expect(isDirectoryStatus(s)).toBe(false)
  })
})

describe("hasActiveFilters", () => {
  it("is false for the untouched directory", () => {
    expect(hasActiveFilters(EMPTY_DIRECTORY_PARAMS)).toBe(false)
  })

  it("is true for each filter on its own", () => {
    expect(hasActiveFilters({ ...EMPTY_DIRECTORY_PARAMS, q: "x" })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_DIRECTORY_PARAMS, position: "GK" })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_DIRECTORY_PARAMS, club: "t-alpha" })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_DIRECTORY_PARAMS, nationality: "IL" })).toBe(true)
    expect(hasActiveFilters({ ...EMPTY_DIRECTORY_PARAMS, status: "retired" })).toBe(true)
  })

  it("does NOT count paging as a filter", () => {
    expect(hasActiveFilters({ ...EMPTY_DIRECTORY_PARAMS, page: 7 })).toBe(false)
  })
})

describe("directoryHref - only what differs from the default", () => {
  it("is the bare route with nothing set", () => {
    expect(directoryHref(EMPTY_DIRECTORY_PARAMS)).toBe("/players")
  })

  it("omits page 1 and the default status", () => {
    expect(directoryHref({ ...EMPTY_DIRECTORY_PARAMS, page: 1, status: "all" })).toBe("/players")
  })

  it("carries exactly the state that differs", () => {
    expect(directoryHref({ q: "Cohen", position: "ST", page: 3 })).toBe("/players?q=Cohen&position=ST&page=3")
    expect(directoryHref({ status: "retired" })).toBe("/players?status=retired")
  })

  it("encodes a term that would otherwise break the URL", () => {
    expect(directoryHref({ q: "a b&c=d" })).toBe("/players?q=a+b%26c%3Dd")
  })

  it("round-trips back through the parser", () => {
    const original = { ...EMPTY_DIRECTORY_PARAMS, q: "Levi", position: "CB", club: "t-alpha", status: "retired" as const, page: 4 }
    const href = directoryHref(original)
    const parsedBack = parse(Object.fromEntries(new URLSearchParams(href.split("?")[1])))
    expect(parsedBack).toEqual({ ...original, nationality: null })
  })
})

describe("computePageWindow", () => {
  it("uses the app's existing page size", () => {
    // 25 is DEFAULT_LIMIT in the transfer market feed - the directory does
    // not introduce a second page size.
    expect(DIRECTORY_PAGE_SIZE).toBe(25)
  })

  it("describes a full first page", () => {
    expect(computePageWindow(1320, 1)).toEqual({
      page: 1, totalPages: 53, hasPrevious: false, hasNext: true, from: 1, to: 25,
    })
  })

  it("describes a middle page", () => {
    const w = computePageWindow(1320, 3)
    expect([w.from, w.to, w.hasPrevious, w.hasNext]).toEqual([51, 75, true, true])
  })

  it("describes a partial last page", () => {
    const w = computePageWindow(1320, 53)
    expect([w.from, w.to, w.hasNext]).toEqual([1301, 1320, false])
  })

  it("reports page 1 of 1 for an empty result, never page 1 of 0", () => {
    expect(computePageWindow(0, 1)).toEqual({
      page: 1, totalPages: 1, hasPrevious: false, hasNext: false, from: 0, to: 0,
    })
  })

  it("treats a page past the end as empty, not as an error", () => {
    const w = computePageWindow(30, 99)
    expect(w.totalPages).toBe(2)
    expect([w.from, w.to]).toEqual([0, 0])
    expect(w.hasNext).toBe(false)
    // and it still reports the page that was asked for, so the UI can offer
    // a way back rather than lying about where the reader is.
    expect(w.page).toBe(99)
  })

  it("handles a result smaller than one page", () => {
    expect(computePageWindow(3, 1)).toMatchObject({ totalPages: 1, from: 1, to: 3, hasNext: false })
  })

  it("handles exactly one full page", () => {
    expect(computePageWindow(25, 1)).toMatchObject({ totalPages: 1, from: 1, to: 25, hasNext: false })
  })

  it("handles one row over a page boundary", () => {
    expect(computePageWindow(26, 2)).toMatchObject({ totalPages: 2, from: 26, to: 26, hasNext: false })
  })
})

describe("skipFor", () => {
  it("skips nothing on page 1", () => {
    expect(skipFor(1)).toBe(0)
  })

  it("skips whole pages", () => {
    expect(skipFor(2)).toBe(25)
    expect(skipFor(53)).toBe(1300)
  })

  it("never goes negative", () => {
    expect(skipFor(0)).toBe(0)
    expect(skipFor(-5)).toBe(0)
  })
})

describe("escapeLikeTerm - a search term means exactly what was typed", () => {
  it("escapes LIKE's wildcards", () => {
    // Measured against PostgreSQL 16 before this existed: contains("%")
    // matched all 50 seeded players, and contains("C_hen") matched "Cohen".
    expect(escapeLikeTerm("%")).toBe("\\%")
    expect(escapeLikeTerm("_")).toBe("\\_")
    expect(escapeLikeTerm("C_hen")).toBe("C\\_hen")
    expect(escapeLikeTerm("50%")).toBe("50\\%")
  })

  it("escapes the escape character FIRST, so escapes are not double-escaped", () => {
    expect(escapeLikeTerm("\\")).toBe("\\\\")
    expect(escapeLikeTerm("\\%")).toBe("\\\\\\%")
  })

  it("leaves an ordinary name completely alone", () => {
    for (const name of ["Cohen", "David", "כהן", "O'Brien", "Müller", "silva"]) {
      expect(escapeLikeTerm(name)).toBe(name)
    }
  })

  it("leaves SQL metacharacters alone - they are not LIKE metacharacters", () => {
    // Quotes and semicolons are handled by parameterization, not by this.
    expect(escapeLikeTerm("'; DROP TABLE x; --")).toBe("'; DROP TABLE x; --")
  })

  it("is idempotent in effect for a term with nothing to escape", () => {
    expect(escapeLikeTerm(escapeLikeTerm("Levi"))).toBe("Levi")
  })
})
