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

/**
 * The delete semantics are the whole point of an ownership record: history
 * that a single DELETE can erase is not history. These read the migration
 * SQL directly, because the property lives in the schema rather than in any
 * function's behaviour, and because the original SET NULL looked harmless
 * in review - it was only wrong in combination with a CHECK constraint
 * written elsewhere in the same file.
 */
describe("history retention - TeamEra delete semantics", () => {
  const MIGRATION = readFileSync(
    join(__dirname, "..", "..", "..", "prisma", "migrations", "20260903174500_add_team_era", "migration.sql"),
    "utf8"
  )
  const fk = (name: string) => MIGRATION.match(new RegExp(`ADD CONSTRAINT "${name}"[^;]*;`))?.[0] ?? ""

  it("deleting a Team cannot take its ownership history with it", () => {
    expect(fk("TeamEra_teamId_fkey")).toContain("ON DELETE RESTRICT")
    expect(fk("TeamEra_teamId_fkey")).not.toContain("ON DELETE CASCADE")
  })

  it("deleting a manager cannot detach them from the matches they managed", () => {
    expect(fk("TeamEra_userId_fkey")).toContain("ON DELETE RESTRICT")
    // SET NULL was the original choice and is the specific mistake this
    // guards against: it would produce a HUMAN era with no manager.
    expect(fk("TeamEra_userId_fkey")).not.toContain("ON DELETE SET NULL")
  })

  it("the CHECK that makes SET NULL incoherent is still in force - it was not weakened to allow deletion", () => {
    expect(MIGRATION).toContain('"TeamEra_user_matches_type_check"')
    expect(MIGRATION).toMatch(/"type" = 'HUMAN' AND "userId" IS NOT NULL/)
  })

  it("season references stay SET NULL - they are annotations, not the era boundary", () => {
    for (const name of ["TeamEra_startedSeasonId_fkey", "TeamEra_endedSeasonId_fkey"]) {
      expect(fk(name)).toContain("ON DELETE SET NULL")
    }
    // The boundary itself is not nullable, so it cannot be lost this way.
    expect(MIGRATION).toContain('"startedAt" TIMESTAMP(3) NOT NULL')
  })
})
