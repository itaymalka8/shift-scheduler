import { computeMovement, divisionKey, drawRelegatedIntoGroups, promotionBracketPairings, MovementError } from "./movement"
import type { FinalDivision, PlayoffResult } from "./movement"

/**
 * WHO GOES UP AND WHO GOES DOWN, tested as arithmetic.
 *
 * The invariant that matters most is the boring one: sixty clubs in, sixty
 * clubs out, twenty per division, every identity preserved. A movement that
 * loses a club is the one bug you cannot spot by looking at a league table -
 * it looks like a smaller league.
 */

const club = (prefix: string, n: number) => `${prefix}${String(n).padStart(2, "0")}`
const order = (prefix: string) => Array.from({ length: 20 }, (_, i) => club(prefix, i + 1))

function divisions(): FinalDivision[] {
  return [
    { divisionId: "d1", tier: 1, group: "", order: order("t") },
    { divisionId: "dA", tier: 2, group: "A", order: order("a") },
    { divisionId: "dB", tier: 2, group: "B", order: order("b") },
  ]
}

/** The bracket is A2 v B3 and B2 v A3; `winners` names who came through. */
function results(winners: [string, string]): PlayoffResult[] {
  return [
    { homeTeamId: "a02", awayTeamId: "b03", winnerTeamId: winners[0] },
    { homeTeamId: "b02", awayTeamId: "a03", winnerTeamId: winners[1] },
  ]
}

describe("the bracket the contract fixes", () => {
  it("pairs A2 with B3 and B2 with A3", () => {
    const [first, second] = promotionBracketPairings(divisions()[1], divisions()[2])
    expect(first).toMatchObject({ homeTeamId: "a02", awayTeamId: "b03" })
    expect(second).toMatchObject({ homeTeamId: "b02", awayTeamId: "a03" })
  })

  it("refuses a group too short to seed it", () => {
    const short: FinalDivision = { divisionId: "dA", tier: 2, group: "A", order: ["a01"] }
    expect(() => promotionBracketPairings(short, divisions()[2])).toThrow(MovementError)
  })
})

describe("ALL FOUR PROMOTION PLAYOFF OUTCOMES - vacancies are never assumed 2 and 2", () => {
  const cases: { winners: [string, string]; vacancies: { A: number; B: number }; label: string }[] = [
    { winners: ["a02", "b02"], vacancies: { A: 2, B: 2 }, label: "both home sides" },
    { winners: ["b03", "a03"], vacancies: { A: 2, B: 2 }, label: "both away sides" },
    { winners: ["a02", "a03"], vacancies: { A: 3, B: 1 }, label: "both from group A" },
    { winners: ["b03", "b02"], vacancies: { A: 1, B: 3 }, label: "both from group B" },
  ]

  for (const testCase of cases) {
    it(`${testCase.label}: vacancies ${testCase.vacancies.A}/${testCase.vacancies.B}, all divisions still 20`, () => {
      const plan = computeMovement({
        divisions: divisions(),
        playoffResults: results(testCase.winners),
        drawSeed: "IL-S1-T1RELEGATION-deadbeef",
      })
      expect(plan.vacanciesByGroup.get("A")).toBe(testCase.vacancies.A)
      expect(plan.vacanciesByGroup.get("B")).toBe(testCase.vacancies.B)
      expect(plan.byDivisionKey.get(divisionKey(1, ""))).toHaveLength(20)
      expect(plan.byDivisionKey.get(divisionKey(2, "A"))).toHaveLength(20)
      expect(plan.byDivisionKey.get(divisionKey(2, "B"))).toHaveLength(20)
      expect(plan.promoted.sort()).toEqual(["a01", "b01", ...testCase.winners].sort())
      expect(plan.relegated).toEqual(["t17", "t18", "t19", "t20"])
    })
  }
})

describe("the sixty clubs", () => {
  const plan = computeMovement({
    divisions: divisions(),
    playoffResults: results(["a02", "b02"]),
    drawSeed: "IL-S1-T1RELEGATION-deadbeef",
  })
  const placed = [...plan.byDivisionKey.values()].flat()

  it("are all still there, exactly once each", () => {
    expect(placed).toHaveLength(60)
    expect(new Set(placed).size).toBe(60)
  })

  it("are the SAME identities - no club is replaced because its tier changed", () => {
    const before = new Set(divisions().flatMap((d) => d.order))
    expect(new Set(placed)).toEqual(before)
  })

  it("put the promoted clubs in tier 1 and the relegated clubs in tier 2", () => {
    const tier1 = plan.byDivisionKey.get(divisionKey(1, ""))!
    for (const teamId of plan.promoted) expect(tier1).toContain(teamId)
    for (const teamId of plan.relegated) expect(tier1).not.toContain(teamId)
    const tier2 = [...(plan.byDivisionKey.get(divisionKey(2, "A")) ?? []), ...(plan.byDivisionKey.get(divisionKey(2, "B")) ?? [])]
    for (const teamId of plan.relegated) expect(tier2).toContain(teamId)
  })

  it("leave the 16 safe tier 1 clubs where they were", () => {
    const tier1 = plan.byDivisionKey.get(divisionKey(1, ""))!
    for (let i = 1; i <= 16; i++) expect(tier1).toContain(club("t", i))
  })
})

describe("THE RELEGATION DRAW", () => {
  const vacancies = new Map([
    ["A", 3],
    ["B", 1],
  ])

  it("is deterministic for a fixed seed", () => {
    const first = drawRelegatedIntoGroups(["t17", "t18", "t19", "t20"], vacancies, "seed-one")
    const second = drawRelegatedIntoGroups(["t17", "t18", "t19", "t20"], vacancies, "seed-one")
    expect(second).toEqual(first)
  })

  it("does not depend on the order the clubs are supplied in", () => {
    const forwards = drawRelegatedIntoGroups(["t17", "t18", "t19", "t20"], vacancies, "seed-one")
    const backwards = drawRelegatedIntoGroups(["t20", "t19", "t18", "t17"], vacancies, "seed-one")
    expect(backwards).toEqual(forwards)
  })

  it("fills exactly the vacancies each group has", () => {
    const assignment = drawRelegatedIntoGroups(["t17", "t18", "t19", "t20"], vacancies, "seed-one")
    expect(assignment.get("A")).toHaveLength(3)
    expect(assignment.get("B")).toHaveLength(1)
    expect([...(assignment.get("A") ?? []), ...(assignment.get("B") ?? [])].sort()).toEqual([
      "t17",
      "t18",
      "t19",
      "t20",
    ])
  })

  it("IS NOT ALPHABETICAL - the shuffle destroys id order", () => {
    // If the sort survived, group A would always be the first three ids. Over
    // a spread of seeds it must not be, or the "draw" is a ranking by name.
    const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`)
    const alphabetical = seeds.filter((seed) => {
      const a = drawRelegatedIntoGroups(["t17", "t18", "t19", "t20"], vacancies, seed).get("A") ?? []
      return a.join(",") === "t17,t18,t19"
    })
    expect(alphabetical.length).toBeLessThan(seeds.length)
  })

  it("gives every relegated club a chance of either group", () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `seed-${i}`)
    const inB = new Set<string>()
    for (const seed of seeds) {
      for (const teamId of drawRelegatedIntoGroups(["t17", "t18", "t19", "t20"], vacancies, seed).get("B") ?? []) {
        inB.add(teamId)
      }
    }
    expect(inB.size).toBe(4)
  })
})

describe("FAIL CLOSED", () => {
  it("refuses a league missing one of its three divisions", () => {
    expect(() =>
      computeMovement({ divisions: divisions().slice(0, 2), playoffResults: results(["a02", "b02"]), drawSeed: "s" })
    ).toThrow(/tier 1, tier 2 group A and tier 2 group B/)
  })

  it("refuses when a playoff result is missing", () => {
    expect(() =>
      computeMovement({ divisions: divisions(), playoffResults: [results(["a02", "b02"])[0]], drawSeed: "s" })
    ).toThrow(/No promotion playoff result/)
  })

  it("refuses a winner who did not play in the fixture", () => {
    const bogus: PlayoffResult[] = [
      { homeTeamId: "a02", awayTeamId: "b03", winnerTeamId: "a19" },
      { homeTeamId: "b02", awayTeamId: "a03", winnerTeamId: "b02" },
    ]
    expect(() => computeMovement({ divisions: divisions(), playoffResults: bogus, drawSeed: "s" })).toThrow(
      /did not play in its own fixture/
    )
  })

  it("refuses a tier 1 table that is too short to relegate four", () => {
    const short = divisions()
    short[0] = { ...short[0], order: order("t").slice(0, 18) }
    expect(() => computeMovement({ divisions: short, playoffResults: results(["a02", "b02"]), drawSeed: "s" })).toThrow(
      /must relegate 4 clubs/
    )
  })
})
