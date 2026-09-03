/**
 * PART H's guarantee, asserted rather than promised: TeamEra is ATTRIBUTION
 * METADATA laid over history, not a replacement for fixture ownership.
 *
 * The club's own record - its league table, its results, its match events,
 * its player stats - must be computed exactly as it was before eras existed.
 * A future change that "helpfully" filtered standings by era would silently
 * wipe a club's league points at the moment a human took it over, which is
 * precisely the bug the design forbids. These are source-level guards
 * because the property is about what those modules DO NOT depend on, and
 * that cannot be observed from their return values.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..")

// Modules that compute the club's own history. The seed is deliberately
// absent: it is the one place allowed to open an era (see its own test
// below), because a club is born owned by someone.
const MUST_NOT_KNOW_ABOUT_ERAS = [
  ["leagues/standings.ts", "the league table"],
  ["match/simulate.ts", "the match engine"],
] as const

describe("TeamEra never leaks into the club's own history", () => {
  it.each(MUST_NOT_KNOW_ABOUT_ERAS)(
    "%s does not consult TeamEra - %s must be identical before and after a takeover",
    (file) => {
      const source = readFileSync(join(SRC, "lib", file), "utf8")
      expect(source).not.toMatch(/teamEra|TeamEra|from "\.\.\/teams\//)
    }
  )

  it("the seed is the one place allowed to open eras, and only BOT ones", () => {
    const source = readFileSync(join(SRC, "lib", "leagues", "seed.ts"), "utf8")
    expect(source).toContain("teamEra.createMany")
    // It may open a bot era; it must never close one or open a human era -
    // seeding is not a takeover.
    expect(source).not.toContain("teamEra.update")
    expect(source).not.toContain('type: "HUMAN"')
  })

  it("no era code deletes fixtures, events or player stats", () => {
    for (const file of ["era.ts", "eras.ts", "manager-record.ts", "backfill-eras.ts"]) {
      const source = readFileSync(join(__dirname, file), "utf8")
      expect(source).not.toMatch(/\b(deleteMany|delete\(|updateMany)\b/)
      expect(source).not.toMatch(/fixture\.(update|delete)/)
    }
  })
})
