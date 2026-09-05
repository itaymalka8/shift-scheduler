/**
 * What a title decider must NOT do to the rest of the game: no money, no
 * league table, no spoilers, and no change to how a league match behaves.
 *
 * Source-level where the property is about an absent dependency or a
 * structural guarantee, because neither can be observed from a return value.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

/** Source with comments stripped - these files DOCUMENT the rules they follow. */
function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

describe("financial isolation", () => {
  const simulate = readCode("lib", "match", "simulate.ts")

  it("every money-writing call sits behind the neutral-venue guard", () => {
    // The four league-economics effects: gate revenue, hosting expense,
    // away travel, fan fine. None may fire for a neutral championship match.
    expect(simulate).toContain("const neutralMoney = hasNeutralFinances(fixture.stage)")
    expect(simulate).toMatch(/if \(!neutralMoney\) \{[\s\S]*?matchRevenue[\s\S]*?matchExpense[\s\S]*?\}/)
  })

  it("travel and the fan fine are zeroed for a decider, so their own > 0 guards skip them", () => {
    expect(simulate).toContain("const awayTravelCost = neutralMoney ? 0 :")
    expect(simulate).toContain("fanIncident && !neutralMoney")
    // Those two writes are guarded by amount > 0 already.
    expect(simulate).toContain("if (awayTravelCost > 0)")
    expect(simulate).toContain("if (fine > 0)")
  })

  it("a decider records ZERO rather than a zero-valued ledger row", () => {
    // A zero row would still appear in a club's finances as a match-day
    // entry that earned nothing, which tells a worse story than silence.
    const guarded = simulate.slice(simulate.indexOf("if (!neutralMoney)"))
    expect(guarded).toContain("createFinancialTransaction")
  })

  it("normal league economics are unchanged - the calls are the same, only conditional", () => {
    for (const marker of [
      "calculateMatchStadiumRevenue",
      "calculateHomeMatchExpenses",
      "calculateAwayTravelCost",
      "fanIncidentFine",
    ]) {
      expect(simulate).toContain(marker)
    }
  })
})

describe("neutral venue is decided by stage, not by anything mutable", () => {
  const simulate = readCode("lib", "match", "simulate.ts")

  it("comes from Fixture.stage, asked through the one named helper", () => {
    // Phase 2C keyed all three behaviours off a bare equality with
    // TITLE_DECIDER, which the Phase 2D audit called the single riskiest line
    // in the feature: add a stage and forget to widen it, and a championship
    // playoff match silently gets home advantage and league gate money. The
    // question is now asked once, by name, in src/lib/match/competition.ts.
    expect(simulate).toContain("isNeutralVenue(fixture.stage)")
    expect(simulate).toContain("canGoToShootout(fixture.stage)")
    expect(simulate).toContain("hasNeutralFinances(fixture.stage)")
    // And the old brittle form is gone.
    expect(simulate).not.toMatch(/fixture\.stage === "TITLE_DECIDER"/)
  })

  it("is handed to the snapshot rather than re-derived inside the engine", () => {
    // The fourth argument is the match's own transaction - the snapshot is
    // read under the same locks its legality was judged under. neutralVenue
    // is still handed in, still from the stage, still not re-derived.
    expect(simulate).toContain("buildMatchSnapshot(fixtureId, seed, { neutralVenue }, tx)")
  })

  it("the helper is CLOSED BY CONSTRUCTION - a future stage is neutral by default", () => {
    const competition = readCode("lib", "match", "competition.ts")
    // "anything that is not the league", never a list of the stages that
    // happen to exist today.
    expect(competition).toContain('stage !== "LEAGUE"')
    expect(competition).not.toMatch(/stage === "TITLE_DECIDER"/)
    expect(competition).not.toMatch(/stage === "TITLE_PLAYOFF"/)
  })

  it("the engine gates BOTH halves of home advantage on it", () => {
    const engine = readCode("lib", "match", "engine", "engine.ts")
    expect(engine).toContain("side.isHome && !snapshot.neutralVenue")
    // And nothing else re-applies home advantage elsewhere.
    expect(engine.match(/config\.homeAdvantage/g) ?? []).toHaveLength(1)
    // The call site, not the import line - there is exactly one place the
    // crowd can influence a match, and it is inside the gate above.
    expect(engine.match(/calculateCrowdEffect\(/g) ?? []).toHaveLength(1)
  })
})

describe("the shootout cannot leak", () => {
  const route = readCode("app", "api", "matches", "[fixtureId]", "route.ts")

  it("shootout columns are selected ONLY inside the finished-only branch", () => {
    const finishedBranch = route.slice(route.indexOf("if (finished)"))
    expect(finishedBranch).toContain("homeShootoutScore: true")
    // The base query, which every request runs, must not mention them.
    const baseQuery = route.slice(0, route.indexOf("if (finished)"))
    expect(baseQuery).not.toContain("homeShootoutScore")
    expect(baseQuery).not.toContain("awayShootoutScore")
  })

  it("the not-kicked-off response carries an explicit null shootout", () => {
    expect(route).toMatch(/if \(!kickedOff\)[\s\S]*?shootout: null/)
  })

  it("stage and neutralVenue ARE public - they are known before kickoff", () => {
    const baseQuery = route.slice(0, route.indexOf("if (finished)"))
    expect(baseQuery).toContain("stage: true")
  })
})

describe("the league table and its counts stay the league's", () => {
  it("computeStandings still filters on stage", () => {
    expect(readCode("lib", "leagues", "standings.ts")).toContain('stage: "LEAGUE"')
  })

  it("the decider scheduler reads league fixtures only", () => {
    expect(readCode("lib", "seasons", "deciders.ts").match(/stage: "LEAGUE"/g) ?? []).toHaveLength(2)
  })

  it("champion resolution excludes the decider from the head-to-head table", () => {
    expect(readCode("lib", "seasons", "champions.ts")).toContain('where: { stage: "LEAGUE" }')
  })
})

describe("the shootout is a function of its seed and nothing else", () => {
  const shootout = readCode("lib", "match", "shootout.ts")

  it("reaches no database and no clock", () => {
    expect(shootout).not.toMatch(/from "@\/lib\/prisma"/)
    expect(shootout).not.toMatch(/new Date\(|Date\.now\(/)
  })

  it("uses no random source but the seeded one", () => {
    expect(shootout).not.toMatch(/Math\.random/)
    expect(shootout).toContain("new SeededRandom(seed)")
  })

  it("takes no player name and no club ownership", () => {
    for (const file of [
      ["lib", "match", "shootout.ts"],
      ["lib", "match", "shootout-takers.ts"],
    ]) {
      const source = readCode(...file)
      expect(source).not.toMatch(/firstName|lastName|localeCompare/)
      expect(source).not.toMatch(/userId/)
    }
  })
})
