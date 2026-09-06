import { readFileSync } from "fs"
import { join } from "path"

/**
 * THE LINEARIZATION CONTRACT, asserted rather than described.
 *
 * effectiveAt is a timestamp, but the ORDER it participates in is established
 * by an advisory lock, not by the clock. PostgreSQL cannot tell a transaction
 * its own commit time - the value does not exist until the commit record is
 * written - so a column can only ever hold a pre-commit stamp, and a bare
 * pre-commit stamp admits a real disagreement:
 *
 *   a mutation stamps 12:59:59.950 and commits at 13:00:00.300;
 *   a settlement for 13:00:00.000 runs at 13:00:00.100, cannot see the
 *   uncommitted row, and settles WITHOUT it;
 *   a later replay of `latest <= T` FINDS it and reports the other answer.
 *
 * The ledger and the reconstruction would disagree, which is the single thing
 * the state-history table exists to prevent.
 *
 * goalx:economy:history removes it. Appenders take it SHARED, settlement reads
 * take it EXCLUSIVE, and both are mutually exclusive - so for any mutation M
 * and settlement S exactly one of two orders happens, and BOTH agree:
 *
 *   M FIRST  S blocks until M commits, then reads M's row and includes or
 *            excludes it purely by comparing effectiveAt to T. Replay applies
 *            the identical comparison to the identical row.
 *   S FIRST  M blocks at its shared acquire, so its clock_timestamp() - taken
 *            AFTER the lock - is evaluated only once S has committed. S ran at
 *            or after T, so M's stamp is strictly after T, and both exclude it.
 *
 * The behavioural half of this (two live transactions, both orders, against
 * real PostgreSQL) lives in scripts/proof/economy-proof.ts, which is the only
 * place two concurrent connections exist. What is asserted HERE is the
 * structure that proof depends on: that the lock is taken, in the right mode,
 * by the right side, before anything else - because a proof of two orders is
 * worthless if a later refactor quietly drops the acquire.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8")

/** Strips comments, so an assertion can never be satisfied by prose about it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

const STATE_HISTORY = read("src", "lib", "economy", "state-history.ts")
const ACTIVATION_LOCK = read("src", "lib", "economy", "activation-lock.ts")
const SETTLEMENT = read("src", "lib", "economy", "weekly-settlement.ts")
const SIMULATE = read("src", "lib", "match", "simulate.ts")

/** Every transaction that APPENDS economic history. */
const APPENDERS = [
  ["registration / initial squad", read("src", "lib", "players", "generate.ts")],
  ["league + bot seeding", read("src", "lib", "leagues", "seed.ts")],
  ["squad replenishment", read("src", "lib", "seasons", "squad-replenishment.ts")],
  ["youth promotion", read("src", "lib", "youth", "promote.ts")],
  ["transfer purchase", read("src", "lib", "transfers", "purchase.ts")],
  ["release", read("src", "lib", "transfers", "release.ts")],
  ["player development / retirement", read("src", "lib", "seasons", "player-lifecycle.ts")],
] as const

describe("THE ECONOMY HISTORY LOCK: both modes, both sides", () => {
  it("every appender actually CALLS the append, not merely imports it", () => {
    // Deliberately a CALL check rather than an identifier check. The negative
    // mutation suite caught the weaker version: replacing the call with
    // `void appendTeamEconomicState` left the identifier in the file, so an
    // assertion that only looked for the name passed while a release stopped
    // recording that the club's wage bill had fallen.
    for (const [name, source] of APPENDERS) {
      const calls = code(source).match(/\bappendTeamEconomicState\(\s*(tx|db)\b/g) ?? []
      expect(`${name}: ${calls.length > 0}`).toBe(`${name}: true`)
    }
  })

  it("appenders take the lock SHARED, never exclusive", () => {
    expect(code(STATE_HISTORY)).toContain("pg_advisory_xact_lock_shared(hashtext(")
    for (const [name, source] of APPENDERS) {
      const shared = code(source).match(/\bacquireEconomyHistoryShared\(\s*(tx|db)\b/g) ?? []
      expect(`${name}: ${shared.length > 0}`).toBe(`${name}: true`)
      expect(`${name}: ${code(source).includes("acquireEconomyHistoryExclusive(")}`).toBe(`${name}: false`)
    }
  })

  it("settlement reads take the lock EXCLUSIVE", () => {
    // The two transactions that price an instant from history: the weekly
    // sponsor settlement, and a fixture's own simulation.
    expect(code(SETTLEMENT)).toMatch(/await acquireEconomyHistoryExclusive\(tx\)/)
    expect(code(SIMULATE)).toMatch(/await acquireEconomyHistoryExclusive\(tx\)/)
  })

  it("one key, so shared and exclusive actually exclude each other", () => {
    // Two different key strings would compile, pass every unit test, and
    // silently provide no mutual exclusion at all.
    const keys = code(STATE_HISTORY).match(/"goalx:economy:history"/g) ?? []
    expect(keys).toHaveLength(1)
    expect(code(STATE_HISTORY)).toContain("const ECONOMY_HISTORY_LOCK =")
  })

  it("effectiveAt comes from the DATABASE clock, never the application's", () => {
    const append = code(STATE_HISTORY).slice(code(STATE_HISTORY).indexOf("export async function appendTeamEconomicState"))
    expect(append).toContain("clock_timestamp() AT TIME ZONE 'UTC'")
    // A second clock in a second process is not an ordering authority, and this
    // project has already removed page and process clocks from every economic
    // decision.
    expect(append).not.toContain("new Date()")
  })

  it("the ONLY caller-supplied instant is the activation crossing", () => {
    // effectiveAt may be passed in exactly one place - the repricing rows,
    // which carry the settlement instant itself. A second domain-dated writer
    // would be a caller choosing when its own change took effect.
    const callers = code(STATE_HISTORY).match(/effectiveAt: instant/g) ?? []
    expect(callers).toHaveLength(1)
    for (const [name, source] of APPENDERS) {
      expect(`${name}: ${/appendTeamEconomicState\([^)]*effectiveAt/.test(code(source))}`).toBe(`${name}: false`)
    }
  })
})

describe("THE ACTIVATION LOCK: no mixed salary state", () => {
  it("every salary writer holds it SHARED", () => {
    // A salary writer is any transaction that decides which curve a wage is
    // priced on. Miss one and that path can commit a legacy-priced player into
    // an already-calibrated league.
    const SALARY_WRITERS = [
      ["registration / initial squad", read("src", "lib", "players", "generate.ts")],
      ["league + bot seeding", read("src", "lib", "leagues", "seed.ts")],
      ["squad replenishment", read("src", "lib", "seasons", "squad-replenishment.ts")],
      ["youth promotion", read("src", "lib", "youth", "promote.ts")],
      ["player development / retirement", read("src", "lib", "seasons", "player-lifecycle.ts")],
    ] as const
    for (const [name, source] of SALARY_WRITERS) {
      // A call, not a mention - see the appender check above for why.
      const calls = code(source).match(/\bacquirePhase3RActivationShared\(\s*(tx|db)\b/g) ?? []
      expect(`${name}: ${calls.length > 0}`).toBe(`${name}: true`)
    }
  })

  it("the repricing transaction holds it EXCLUSIVE", () => {
    expect(code(SETTLEMENT)).toMatch(/await acquirePhase3RActivationExclusive\(tx\)/)
  })

  it("repricing stays inside the transaction that writes the marker", () => {
    // The marker - the activation week's sponsor row - is durable evidence
    // that the crossing happened, and it is only evidence because repricing
    // commits with it. Split them and the marker starts lying.
    const sponsorWeek = code(SETTLEMENT).slice(
      code(SETTLEMENT).indexOf("export async function settleSponsorWeek"),
      code(SETTLEMENT).indexOf("export async function settleMaintenanceWeek")
    )
    expect(sponsorWeek).toContain("repriceLeagueSalaries(tx, instant)")
    expect(sponsorWeek).toContain("createFinancialTransaction(tx, {")
  })

  it("one key here too", () => {
    const keys = code(ACTIVATION_LOCK).match(/"goalx:phase3r:activation"/g) ?? []
    expect(keys).toHaveLength(1)
  })
})

describe("LOCK ORDER: advisory locks precede every row lock", () => {
  /**
   * Activation repricing holds both advisory locks and THEN takes Player row
   * locks through updateMany. A transaction that grabbed a Player or Team row
   * before asking for an advisory lock would wait on repricing while repricing
   * waited on it - a real 40P01 between the crossing and an ordinary transfer.
   */
  const ROW_LOCKS = ["lockPlayerRow(", "lockTeamRoster(", "lockTeamRosters("]

  it.each(APPENDERS.map(([name, source]) => [name, source]))(
    "%s asks for its advisory locks before any row lock",
    (_name, source) => {
      const body = code(source as string)
      const advisory = Math.min(
        ...["acquirePhase3RActivationShared(", "acquireEconomyHistoryShared("]
          .map((needle) => body.indexOf(needle))
          .filter((index) => index >= 0)
      )
      expect(Number.isFinite(advisory)).toBe(true)

      for (const needle of ROW_LOCKS) {
        const rowLock = body.indexOf(needle)
        if (rowLock >= 0) expect(rowLock).toBeGreaterThan(advisory)
      }
    }
  )

  it("the settlement takes activation before economy history, consistently", () => {
    const body = code(SETTLEMENT)
    expect(body.indexOf("acquirePhase3RActivationExclusive(tx)")).toBeLessThan(
      body.indexOf("acquireEconomyHistoryExclusive(tx)")
    )
  })
})

describe("THE AS-OF READ: history only, and it fails closed", () => {
  it("reads one table and never joins Player", () => {
    const query = code(STATE_HISTORY).slice(
      code(STATE_HISTORY).indexOf("export async function economicStatesAsOf"),
      code(STATE_HISTORY).indexOf("export async function economicStateAsOf")
    )
    expect(query).toContain('FROM "TeamEconomicState"')
    expect(query).not.toContain('"Player"')
    expect(query).toContain('s."effectiveAt" <= ')
  })

  it("orders totally, so a same-timestamp tie is resolved by version", () => {
    const query = code(STATE_HISTORY)
    expect(query).toContain('ORDER BY s."teamId", s."effectiveAt" DESC, s."version" DESC')
    expect(query).toContain('DISTINCT ON (s."teamId")')
  })

  it("throws rather than substituting current state", () => {
    const body = code(STATE_HISTORY)
    expect(body).toContain("throw new EconomicStateUnavailableError(missing, instant)")
    // No default, no zero row, no coalesce to "whatever we can find now".
    expect(body).not.toMatch(/weeklyPayroll:\s*0\s*,\s*attendanceQuality:\s*ATTENDANCE_QUALITY_FLOOR/)
  })

  it("the sponsor settlement prices from history, not from live wages", () => {
    const sponsorWeek = code(SETTLEMENT).slice(
      code(SETTLEMENT).indexOf("export async function settleSponsorWeek"),
      code(SETTLEMENT).indexOf("export async function settleMaintenanceWeek")
    )
    expect(sponsorWeek).toContain("economicStatesAsOf(tx, eligibleIds, instant)")
    expect(sponsorWeek).not.toContain("weeklySalary: true")
  })

  it("a fixture prices its crowd at KICKOFF, from history", () => {
    const snapshot = code(read("src", "lib", "match", "engine", "build-snapshot.ts"))
    expect(snapshot).toContain("readLeagueNeutralQualityAsOf(db, division.seasonId, economicInstant)")
    expect(snapshot).toContain("economicStateAsOf(db, fixture.homeTeamId, economicInstant)")
    // The instant is the fixture's own, never `now`.
    expect(snapshot).toContain("const economicInstant = fixture.scheduledAt ?? fixture.createdAt")
  })
})

describe("THE FIXTURE SEED IS COMMITTED BEFORE THE MATCH", () => {
  const SEED = read("src", "lib", "match", "fixture-seed.ts")

  it("writes conditionally, which is what makes it idempotent and race-free", () => {
    // Without `AND "matchSeed" IS NULL` the loser of the race overwrites the
    // winner's seed and the two workers simulate different matches.
    expect(code(SEED)).toContain('WHERE "id" = ')
    expect(code(SEED)).toContain('AND "matchSeed" IS NULL')
  })

  it("reads the committed value back rather than trusting its own candidate", () => {
    expect(code(SEED)).toContain("findUnique({ where: { id: fixtureId }, select: { matchSeed: true } })")
  })

  it("simulation no longer invents a seed of its own", () => {
    // The defect: matchSeed was persisted only with the score, so a rolled-back
    // attempt left it null and the retry drew a NEW seed - a replayed fixture
    // produced a different crowd and a different result.
    expect(code(SIMULATE)).not.toContain("generateMatchSeed()")
    expect(code(SIMULATE)).toContain("ensureFixtureSeed(fixtureId, fixture.matchSeed)")
  })
})
