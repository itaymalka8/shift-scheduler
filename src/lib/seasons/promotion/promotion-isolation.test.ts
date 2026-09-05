import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * SOURCE GUARDS FOR PROMOTION AND RELEGATION.
 *
 * Behavioural tests prove the code does the right thing today. These prove
 * the design cannot be quietly undone tomorrow - the membership mirror
 * cannot come back, the existence gate cannot be deleted, sporting merit
 * cannot start reading a club's name.
 *
 * Every guard here is written so that the mutation it names actually breaks
 * it. A guard whose regex still matches after the change proves nothing, and
 * this project has been bitten by exactly that before.
 */

const SRC = join(__dirname, "..", "..", "..")
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8")

/**
 * Source with every comment removed.
 *
 * The forbidden-input guards below must judge CODE, not prose. These modules
 * explain at length why they never read a club's name or call localeCompare,
 * and a guard that matched those explanations would fail on a correct file
 * and pass on a file whose comments were deleted - exactly backwards.
 */
const readCode = (...parts: string[]) =>
  read(...parts)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("CREATE_NEXT can never resurrect membership mirroring", () => {
  const nextSeason = read("lib", "seasons", "next-season.ts")

  it("next-season.ts writes no DivisionTeam row of any kind", () => {
    expect(nextSeason).not.toMatch(/divisionTeam\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/)
  })

  it("it does not read the OLD season's membership either", () => {
    // The mirror worked by selecting `teams` off season N's divisions. No
    // read, no copy.
    expect(nextSeason).not.toMatch(/ensureNextSeasonStructure/)
    expect(nextSeason).not.toMatch(/oldDivisions/)
  })

  it("the fixture builder refuses a division with no members", () => {
    expect(nextSeason).toContain("Refusing to schedule season")
    expect(nextSeason).toMatch(/_count\.teams === 0/)
  })

  it("exactly one module writes DivisionTeam for a next season", () => {
    const membership = read("lib", "seasons", "promotion", "membership.ts")
    expect(membership).toMatch(/tx\.divisionTeam\.createMany/)
    // ...and it writes them in ONE transaction, which is what makes a partial
    // membership corruption rather than a resumable state.
    expect(membership).toMatch(/prisma\.\$transaction/)
    expect(membership).toContain("a partial count is corruption")
  })

  it("the seeder is the only other DivisionTeam writer, and it seeds season 1", () => {
    const seed = read("lib", "leagues", "seed.ts")
    expect(seed).toMatch(/tx\.divisionTeam\.createMany/)
    expect(seed).toMatch(/data: teams\.map\(\(t\) => \(\{ divisionId, seasonId, teamId: t\.id \}\)\)/)
  })
})

describe("THE EXISTENCE GATE is inside the transition transaction", () => {
  const orchestrator = read("lib", "seasons", "orchestrator.ts")

  it("isSportingResolutionComplete is asserted before the OFFSEASON write", () => {
    const gate = orchestrator.indexOf("if (!(await isSportingResolutionComplete(seasonId, now))) return null")
    const write = orchestrator.indexOf('data: { status: "OFFSEASON", offseasonStage: "PLAYER_LIFECYCLE" }')
    expect(gate).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(gate)
  })

  it("it is asserted under the Season row lock, not before the transaction", () => {
    const lock = orchestrator.lastIndexOf("const locked = await lockSeason(tx, seasonId)")
    const gate = orchestrator.indexOf("if (!(await isSportingResolutionComplete(seasonId, now))) return null")
    expect(gate).toBeGreaterThan(lock)
  })

  it("BOTH gates are asserted, not just the readiness one", () => {
    // isSeasonReadyForOffseason asks "is every fixture that EXISTS finished".
    // On its own it would transition in the gap where the promotion bracket
    // has not been written yet.
    const window = orchestrator.slice(
      orchestrator.lastIndexOf("const locked = await lockSeason(tx, seasonId)"),
      orchestrator.indexOf('data: { status: "OFFSEASON", offseasonStage: "PLAYER_LIFECYCLE" }')
    )
    expect(window).toContain("isSeasonReadyForOffseason")
    expect(window).toContain("isSportingResolutionComplete")
  })
})

describe("isSeasonReadyForOffseason stays COMPETITION-AGNOSTIC on purpose", () => {
  const orchestrator = read("lib", "seasons", "orchestrator.ts")

  it("its fixture query filters by season and by nothing else", () => {
    const start = orchestrator.indexOf("export async function isSeasonReadyForOffseason")
    const body = orchestrator.slice(start, start + 600)
    expect(body).toContain("where: { division: { seasonId } }")
    // A stage filter here would let the season roll over a boundary decider
    // or a promotion playoff that has not been played.
    expect(body).not.toMatch(/stage:\s*"/)
  })
})

describe("SPORTING MERIT NEVER READS A NAME, AN ID OR A ROW ORDER", () => {
  const files = [
    ["lib", "seasons", "promotion", "ranking.ts"],
    ["lib", "seasons", "promotion", "movement.ts"],
    ["lib", "seasons", "promotion", "outcomes.ts"],
    ["lib", "seasons", "promotion", "boundary.ts"],
  ]

  it("no promotion module calls localeCompare", () => {
    for (const file of files) expect(readCode(...file)).not.toMatch(/localeCompare/)
  })

  it("no promotion module reads a club name, owner, balance or bot flag", () => {
    for (const file of files) {
      const source = readCode(...file)
      expect(source).not.toMatch(/\bteamName\b/)
      expect(source).not.toMatch(/\bisBot\b/)
      expect(source).not.toMatch(/\buserId\b/)
      expect(source).not.toMatch(/\bbalance\b/)
      expect(source).not.toMatch(/\bjoinedAt\b/)
    }
  })

  it("no promotion module uses Math.random or reads the wall clock", () => {
    for (const file of files) {
      const source = readCode(...file)
      expect(source).not.toMatch(/Math\.random/)
      expect(source).not.toMatch(/new Date\(\)/)
    }
  })

  it("promotion never ranks by computeStandings, whose last comparator is a name", () => {
    for (const file of [...files, ["lib", "seasons", "promotion", "resolution.ts"], ["lib", "seasons", "promotion", "membership.ts"]]) {
      expect(readCode(...file)).not.toMatch(/computeStandings/)
    }
  })
})

describe("the title machinery and the boundary machinery never overlap", () => {
  it("rank 1 is never a boundary rank", () => {
    const outcomes = read("lib", "seasons", "promotion", "outcomes.ts")
    // boundaryRanksFor returns the relegation line for tier 1 and the two
    // playoff seeding lines for tier 2. A literal 1 in either list would
    // create a second decider for a tie the title machinery already owns.
    expect(outcomes).toMatch(/return \[TIER1_LAST_SAFE_RANK\]/)
    expect(outcomes).toMatch(/return \[TIER2_PLAYOFF_HIGH_RANK, TIER2_PLAYOFF_LOW_RANK\]/)
    expect(outcomes).toMatch(/export const TIER2_PLAYOFF_HIGH_RANK = 2/)
  })

  it("champions.ts still excludes every non-league fixture from title resolution", () => {
    const champions = read("lib", "seasons", "champions.ts")
    expect(champions).toMatch(/where: \{ stage: "LEAGUE" \}/)
  })
})

describe("promotion never touches history", () => {
  const files = [
    ["lib", "seasons", "promotion", "membership.ts"],
    ["lib", "seasons", "promotion", "movement.ts"],
    ["lib", "seasons", "promotion", "resolution.ts"],
  ]

  it("no promotion module creates a Team", () => {
    for (const file of files) expect(read(...file)).not.toMatch(/team\.create/)
  })

  it("no promotion module touches TeamEra", () => {
    for (const file of files) {
      expect(read(...file)).not.toMatch(/teamEra/i)
      expect(read(...file)).not.toMatch(/closeEraAndOpenNext/)
    }
  })

  it("no promotion module updates or deletes a DivisionTeam row", () => {
    for (const file of files) {
      expect(read(...file)).not.toMatch(/divisionTeam\.(update|updateMany|delete|deleteMany)/)
    }
  })

  it("no promotion module rewrites a played fixture, an event or a stat", () => {
    for (const file of files) {
      const source = read(...file)
      expect(source).not.toMatch(/fixture\.(update|updateMany|delete|deleteMany)/)
      expect(source).not.toMatch(/matchEvent\./)
      expect(source).not.toMatch(/playerMatchStats\./)
      expect(source).not.toMatch(/seasonChampion\.(update|delete)/)
      expect(source).not.toMatch(/financialTransaction\./)
    }
  })

  it("the membership stage creates no fixture at all", () => {
    expect(read("lib", "seasons", "promotion", "membership.ts")).not.toMatch(/fixture\.create/)
  })
})

describe("the offseason order is PROMOTION_RELEGATION then CREATE_NEXT", () => {
  const orchestrator = read("lib", "seasons", "orchestrator.ts")

  it("replenishment advances into the membership stage", () => {
    expect(orchestrator).toMatch(
      /\{ status: "OFFSEASON", stage: "SQUAD_REPLENISHMENT" \},\s*\{ stage: "PROMOTION_RELEGATION" \}/
    )
  })

  it("the membership stage advances into CREATE_NEXT", () => {
    expect(orchestrator).toMatch(
      /\{ status: "OFFSEASON", stage: "PROMOTION_RELEGATION" \},\s*\{ stage: "CREATE_NEXT" \}/
    )
  })

  it("the membership branch is handled before the CREATE_NEXT branch", () => {
    const membership = orchestrator.indexOf('season.offseasonStage === "PROMOTION_RELEGATION"')
    const createNext = orchestrator.indexOf('season.offseasonStage === "CREATE_NEXT"')
    expect(membership).toBeGreaterThan(-1)
    expect(createNext).toBeGreaterThan(membership)
  })
})

describe("league structure verification counts LEAGUE only, per active season", () => {
  it("the contract module states both scopings", () => {
    const structure = read("lib", "production", "league-structure.ts")
    expect(structure).toMatch(/export const EXPECTED_LEAGUE_DIVISIONS = 3/)
    expect(structure).toMatch(/export const EXPECTED_LEAGUE_MEMBERSHIPS = 60/)
    expect(structure).toMatch(/export const EXPECTED_LEAGUE_FIXTURES = 1140/)
    // Non-LEAGUE fixtures are reported, never counted against the league.
    expect(structure).toMatch(/notes\.push/)
  })

  it("the ops preflight scopes every structural count to the active season", () => {
    const checks = read("lib", "production-ops", "checks.ts")
    expect(checks).toMatch(/prisma\.division\.count\(\{ where: seasonScope \}\)/)
    // Membership is counted through the RELATION, never through
    // DivisionTeam.seasonId: this gate runs before the deploy that adds that
    // column, and a verifier must not depend on what it is verifying.
    expect(checks).toMatch(/prisma\.divisionTeam\.count\(\{ where: \{ division: seasonScope \} \}\)/)
    expect(checks).toMatch(/stage: "LEAGUE", division: seasonScope/)
  })

  it("next-season completeness proves membership, not just 'more than zero'", () => {
    const nextSeason = read("lib", "seasons", "next-season.ts")
    expect(nextSeason).not.toMatch(/_count\.teams > 0/)
    expect(nextSeason).toMatch(/verifyNextSeasonMembership/)
    // ...and the members rule it enforces is a LEAGUE rule.
    expect(nextSeason).toMatch(/where: \{ stage: "LEAGUE" \}/)
  })
})

describe("current division is the ACTIVE season's, never the newest joinedAt", () => {
  it("the dashboard uses the shared authority", () => {
    const dashboard = read("app", "dashboard", "page.tsx")
    expect(dashboard).toMatch(/findCurrentMembership\(team\.id, team\.countryCode\)/)
    expect(dashboard).not.toMatch(/orderBy: \{ joinedAt: "desc" \}/)
  })

  it("the youth intake GET uses the shared authority", () => {
    const handler = read("app", "api", "youth", "intake", "get-handler.ts")
    expect(handler).toMatch(/findCurrentSeasonIdForTeam/)
    expect(handler).not.toMatch(/orderBy: \{ joinedAt: "desc" \}/)
  })

  it("the authority itself scopes by the active season", () => {
    const authority = read("lib", "leagues", "current-division.ts")
    expect(authority).toMatch(/season: \{ countryCode, isActive: true \}/)
    expect(readCode("lib", "leagues", "current-division.ts")).not.toMatch(/joinedAt/)
  })
})

describe("A PROMOTION PLAYOFF IS NEVER PRESENTED AS A LEAGUE MATCH", () => {
  const banner = read("app", "match", "[fixtureId]", "competition-banner.tsx")
  const bannerCode = readCode("app", "match", "[fixtureId]", "competition-banner.tsx")

  it("the banner names the competition from FixtureStage, not from the division", () => {
    // A PROMOTION_PLAYOFF fixture is stored on season N's TIER 1 Division even
    // though its four clubs are still tier 2 members. Reading divisionId as
    // "which competition" would tell a manager they were playing an ordinary
    // Ligat Ha'al league match.
    expect(banner).toMatch(/data\.stage === "PROMOTION_PLAYOFF"/)
    expect(banner).toMatch(/data\.stage === "BOUNDARY_DECIDER"/)
    expect(bannerCode).not.toMatch(/divisionId/)
  })

  it("it still renders nothing at all for a league match", () => {
    expect(banner).toMatch(/if \(data\.stage === "LEAGUE"\) return null/)
  })

  it("winning a promotion playoff is not described as winning a title", () => {
    expect(banner).toContain('t("match.promotion.wonBy"')
    expect(banner).toContain('t("match.boundary.wonBy"')
  })

  it("every new competition string exists in all three locales", () => {
    const translations = read("lib", "i18n", "translations.ts")
    for (const key of [
      "match.promotion.title",
      "match.promotion.wonBy",
      "match.boundary.title",
      "match.boundary.round",
      "match.boundary.wonBy",
    ]) {
      const occurrences = translations.split(`"${key}"`).length - 1
      expect(occurrences).toBe(3)
    }
  })

  it("the match API exposes the stage and the boundary metadata", () => {
    const route = read("app", "api", "matches", "[fixtureId]", "route.ts")
    expect(route).toMatch(/stage: fixture\.stage/)
    expect(route).toMatch(/boundaryRank: fixture\.boundaryRank/)
    expect(route).toMatch(/boundaryRound: fixture\.boundaryRound/)
  })

  it("competition.ts is still closed by construction", () => {
    // Neutral venue, no club finances and a shootout all come from "not the
    // league" rather than from a list, so both new stages inherited them with
    // no edit. A list here would be the bug.
    const competition = readCode("lib", "match", "competition.ts")
    expect(competition).toMatch(/return stage !== "LEAGUE"/)
    expect(competition).not.toMatch(/PROMOTION_PLAYOFF/)
  })

  it("consequence-service.ts has NO stage filter - playoff consequences apply", () => {
    // BD-7: a promotion playoff is a real competitive match. Fitness,
    // injuries and suspensions apply and may carry into the next season.
    const consequences = readCode("lib", "match", "consequence-service.ts")
    expect(consequences).not.toMatch(/stage:/)
  })
})
