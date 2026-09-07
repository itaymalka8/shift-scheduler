/**
 * THE STRICT FIRST BASELINE, tested against the contract rather than against
 * the implementation.
 *
 * NO DATABASE AND NO NETWORK. Every side effect is behind an injected
 * dependency, so each test states an exact world and asserts an exact verdict.
 * The point of a first baseline is that it refuses far more often than it
 * writes, so most of what follows is refusals.
 */
import { createHash } from "crypto"
import { readFileSync } from "fs"
import { join } from "path"
import {
  FIRST_BASELINE,
  FirstBaselineAbort,
  evaluateFirstBaselineGate,
  evaluateSecondBaselineVerification,
  orphanReferencePrefix,
  readOrphanFromRows,
  runFirstBaselineTransaction,
  type CatalogReading,
  type FirstBaselineReading,
  type FirstBaselineTxDeps,
  type InsertedRow,
  type OrphanReading,
  type SideEffectDigest,
} from "./first-baseline"

const TARGET = FIRST_BASELINE.targetCommit
const OTHER = "1111111111111111111111111111111111111111"
const ACTIVATION = new Date("2026-09-24T13:00:00.000Z")
const NOW = new Date("2026-09-07T09:00:00.000Z")

const goodCatalog = (): CatalogReading => ({
  tableExists: true,
  teamIdFkOnDeleteRestrict: true,
  uniqueTeamIdVersion: true,
  asOfIndex: true,
  updateTriggerEnabled: true,
  deleteTriggerEnabled: true,
  truncateTriggerEnabled: true,
})

const goodReading = (): FirstBaselineReading => ({
  canonicalHead: TARGET,
  web: { repo: FIRST_BASELINE.repo, branch: FIRST_BASELINE.branch, autoDeploy: "off", deployedCommit: TARGET },
  cron: {
    repo: FIRST_BASELINE.repo,
    branch: FIRST_BASELINE.branch,
    autoDeploy: "off",
    deployedCommit: TARGET,
    suspended: false,
    schedule: FIRST_BASELINE.cronSchedule,
  },
  migrationsApplied: 23,
  migrationsTotal: 23,
  migration23Applied: true,
  catalog: goodCatalog(),
  teamCount: 60,
  historyRows: 0,
  historyDistinctTeams: 0,
  now: NOW,
})

const gate = (mutate: (reading: FirstBaselineReading) => void = () => {}) => {
  const reading = goodReading()
  mutate(reading)
  return evaluateFirstBaselineGate(reading, FIRST_BASELINE, ACTIVATION)
}

const codes = (result: { refusals: { code: string }[] }) => result.refusals.map((r) => r.code)

describe("the strict first baseline gate", () => {
  it("passes only when every single value matches the approved contract", () => {
    expect(gate()).toEqual({ ok: true, refusals: [] })
  })

  // --- THE GAP THE OLD COMMAND LEFT OPEN --------------------------------
  it("REFUSES equal Web and Cron commits that are not the approved target", () => {
    const result = gate((r) => {
      r.web!.deployedCommit = OTHER
      r.cron!.deployedCommit = OTHER
    })
    expect(result.ok).toBe(false)
    expect(codes(result)).toEqual(expect.arrayContaining(["WEB_COMMIT", "CRON_COMMIT"]))
    // ...and equality alone is NOT what saved it: the two agreed with each other.
    expect(codes(result)).not.toContain("WEB_CRON_DIVERGED")
  })

  it("REFUSES a wrong Web source", () => {
    expect(codes(gate((r) => (r.web!.repo = "https://github.com/itaymalka8/shift-scheduler")))).toContain("WEB_SOURCE")
  })

  it("REFUSES a wrong Cron source", () => {
    expect(codes(gate((r) => (r.cron!.repo = "https://github.com/itaymalka8/shift-scheduler")))).toContain("CRON_SOURCE")
  })

  it("REFUSES a wrong branch on either service", () => {
    expect(codes(gate((r) => (r.web!.branch = "main")))).toContain("WEB_BRANCH")
    expect(codes(gate((r) => (r.cron!.branch = "main")))).toContain("CRON_BRANCH")
  })

  it("REFUSES Auto Deploy ON", () => {
    expect(codes(gate((r) => (r.web!.autoDeploy = "on")))).toContain("WEB_AUTO_DEPLOY")
    expect(codes(gate((r) => (r.cron!.autoDeploy = "on")))).toContain("CRON_AUTO_DEPLOY")
  })

  it("REFUSES an UNREADABLE Auto Deploy exactly as it refuses ON", () => {
    expect(codes(gate((r) => (r.web!.autoDeploy = "unknown")))).toContain("WEB_AUTO_DEPLOY")
  })

  it("REFUSES a suspended Cron, and an unreadable suspended state", () => {
    expect(codes(gate((r) => (r.cron!.suspended = true)))).toContain("CRON_NOT_ACTIVE")
    expect(codes(gate((r) => (r.cron!.suspended = null)))).toContain("CRON_NOT_ACTIVE")
  })

  it("REFUSES a wrong Cron schedule", () => {
    expect(codes(gate((r) => (r.cron!.schedule = "*/5 * * * *")))).toContain("CRON_SCHEDULE")
    expect(codes(gate((r) => (r.cron!.schedule = null)))).toContain("CRON_SCHEDULE")
  })

  it("REFUSES a canonical head that does not match", () => {
    expect(codes(gate((r) => (r.canonicalHead = OTHER)))).toContain("CANONICAL_HEAD")
  })

  it("REFUSES a MALFORMED canonical head - short, empty, or unreadable", () => {
    for (const value of ["063342e", "", "not-a-sha", null]) {
      expect(codes(gate((r) => (r.canonicalHead = value)))).toContain("CANONICAL_HEAD")
    }
  })

  it("NEVER prefix-matches a commit", () => {
    // A prefix of the real target, and the real target with one extra char.
    expect(codes(gate((r) => (r.canonicalHead = TARGET.slice(0, 12))))).toContain("CANONICAL_HEAD")
    expect(codes(gate((r) => (r.web!.deployedCommit = TARGET.slice(0, 39))))).toContain("WEB_COMMIT")
    expect(codes(gate((r) => (r.cron!.deployedCommit = `${TARGET}0`)))).toContain("CRON_COMMIT")
  })

  it("REFUSES a migration count that is not 23 of 23", () => {
    expect(codes(gate((r) => (r.migrationsApplied = 22)))).toContain("MIGRATIONS")
    expect(codes(gate((r) => (r.migrationsTotal = 24)))).toContain("MIGRATIONS")
    expect(codes(gate((r) => (r.migrationsApplied = null)))).toContain("MIGRATIONS")
  })

  it("REFUSES a missing Migration 23", () => {
    expect(codes(gate((r) => (r.migration23Applied = false)))).toContain("MIGRATION_23")
    expect(codes(gate((r) => (r.migration23Applied = null)))).toContain("MIGRATION_23")
  })

  it("REFUSES each missing catalog component, one at a time", () => {
    const parts: [keyof CatalogReading, string][] = [
      ["tableExists", "CATALOG_TABLE"],
      ["teamIdFkOnDeleteRestrict", "CATALOG_FK_RESTRICT"],
      ["uniqueTeamIdVersion", "CATALOG_UNIQUE_TEAM_VERSION"],
      ["asOfIndex", "CATALOG_AS_OF_INDEX"],
      ["updateTriggerEnabled", "CATALOG_UPDATE_TRIGGER"],
      ["deleteTriggerEnabled", "CATALOG_DELETE_TRIGGER"],
      ["truncateTriggerEnabled", "CATALOG_TRUNCATE_TRIGGER"],
    ]
    for (const [field, code] of parts) {
      const result = gate((r) => (r.catalog![field] = false))
      expect(result.ok).toBe(false)
      expect(codes(result)).toContain(code)
    }
  })

  it("REFUSES a DISABLED protection trigger, which is not a protection", () => {
    // Disabled is reported as false by the reader, and false is refused.
    expect(codes(gate((r) => (r.catalog!.updateTriggerEnabled = false)))).toContain("CATALOG_UPDATE_TRIGGER")
    expect(codes(gate((r) => (r.catalog!.deleteTriggerEnabled = false)))).toContain("CATALOG_DELETE_TRIGGER")
    expect(codes(gate((r) => (r.catalog!.truncateTriggerEnabled = false)))).toContain("CATALOG_TRUNCATE_TRIGGER")
  })

  it("REFUSES an unreadable catalog outright", () => {
    expect(codes(gate((r) => (r.catalog = null)))).toContain("CATALOG_UNREADABLE")
  })

  it("REFUSES a club count that is not exactly 60", () => {
    for (const n of [59, 61, 0, null]) expect(codes(gate((r) => (r.teamCount = n)))).toContain("CLUB_COUNT")
  })

  it("REFUSES the FIRST baseline when even ONE TeamEconomicState row already exists", () => {
    const result = gate((r) => (r.historyRows = 1))
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain("HISTORY_NOT_EMPTY")
  })

  it("REFUSES when initial distinct coverage is greater than 0", () => {
    expect(codes(gate((r) => (r.historyDistinctTeams = 1)))).toContain("HISTORY_COVERAGE_NOT_ZERO")
  })

  it("REFUSES once the activation boundary is no longer in the future", () => {
    expect(codes(gate((r) => (r.now = new Date(ACTIVATION.getTime()))))).toContain("ACTIVATION_NOT_FUTURE")
    expect(codes(gate((r) => (r.now = new Date(ACTIVATION.getTime() + 1))))).toContain("ACTIVATION_NOT_FUTURE")
  })

  it("REFUSES an unreadable service exactly as it refuses a wrong one", () => {
    expect(codes(gate((r) => (r.web = null)))).toContain("WEB_UNREADABLE")
    expect(codes(gate((r) => (r.cron = null)))).toContain("CRON_UNREADABLE")
  })

  it("reports Web and Cron DIVERGED when they disagree with each other", () => {
    expect(codes(gate((r) => (r.cron!.deployedCommit = OTHER)))).toContain("WEB_CRON_DIVERGED")
  })
})

// ---------------------------------------------------------------------------
// THE TRANSACTION
// ---------------------------------------------------------------------------

interface World {
  teamIds: string[]
  rows: InsertedRow[]
  calls: string[]
  digest: SideEffectDigest
  digestAfter?: SideEffectDigest
  orphan: OrphanReading
  orphanAfter?: OrphanReading
  failAtTeam?: string
  /** A concurrent SHARED appender, allowed to try to sneak a row in at this point. */
  sharedAppenderAt?: string
}

const flatDigest = (): SideEffectDigest => ({
  teamBalanceSum: 1_000,
  teamBalanceDigest: "balances",
  playerSalarySum: 2_000,
  playerOwnershipDigest: "ownership",
  playerCareerStatusDigest: "careers",
  fixtureDigest: "fixtures",
  financialTransactionCount: 276,
  financialTransactionNet: 213_629,
  financialTransactionDigest: "ledger",
  sponsorSettlementCount: 0,
  maintenanceSettlementCount: 0,
  repricingMarkerDigest: "wages",
  seasonDigest: "seasons",
})

const goodOrphan = (): OrphanReading => ({
  fixtureId: FIRST_BASELINE.orphanFixtureId,
  transactionCount: FIRST_BASELINE.orphanTransactionCount,
  net: FIRST_BASELINE.orphanNet,
})

function makeWorld(overrides: Partial<World> = {}): World {
  return {
    teamIds: Array.from({ length: 60 }, (_, i) => `club-${String(i + 1).padStart(2, "0")}`),
    rows: [],
    calls: [],
    digest: flatDigest(),
    orphan: goodOrphan(),
    ...overrides,
  }
}

function makeDeps(): FirstBaselineTxDeps<World> {
  let digestReads = 0
  let orphanReads = 0
  return {
    acquireActivationExclusive: async (w) => void w.calls.push("activation:exclusive"),
    acquireEconomyExclusive: async (w) => void w.calls.push("economy:exclusive"),
    lockTeamRoster: async (w, teamId) => {
      w.calls.push(`roster:${teamId}`)
      return true
    },
    append: async (w, input) => {
      if (w.failAtTeam === input.teamId) throw new Error("simulated mid-run failure")
      w.calls.push(`append:${input.teamId}`)
      const row: InsertedRow = { teamId: input.teamId, version: 1, reason: input.reason, effectiveAt: NOW }
      w.rows.push(row)
      // A concurrent SHARED appender can only be admitted where the fake lets
      // it in - and the barrier is what makes that "nowhere" in the real system.
      if (w.sharedAppenderAt === input.teamId) {
        const held = w.calls.includes("economy:exclusive")
        if (!held) w.rows.push({ teamId: input.teamId, version: 2, reason: "registration", effectiveAt: NOW })
        w.calls.push(held ? "shared-appender:BLOCKED" : "shared-appender:ADMITTED")
      }
      return row
    },
    readTeamIdsAscending: async (w) => [...w.teamIds],
    countHistoryRows: async (w) => w.rows.length,
    countDistinctHistoryTeams: async (w) => new Set(w.rows.map((r) => r.teamId)).size,
    readAllHistoryRows: async (w) => [...w.rows],
    readSideEffectDigest: async (w) => (digestReads++ === 0 ? w.digest : (w.digestAfter ?? w.digest)),
    readOrphan: async (w) => (orphanReads++ === 0 ? w.orphan : (w.orphanAfter ?? w.orphan)),
    now: () => NOW,
  }
}

const run = (world: World) => runFirstBaselineTransaction(world, makeDeps(), FIRST_BASELINE, ACTIVATION)

describe("the strict first baseline transaction", () => {
  it("takes the EXCLUSIVE economy barrier before ANY roster lock", async () => {
    const world = makeWorld()
    await run(world)
    const economy = world.calls.indexOf("economy:exclusive")
    const firstRoster = world.calls.findIndex((call) => call.startsWith("roster:"))
    expect(economy).toBeGreaterThanOrEqual(0)
    expect(firstRoster).toBeGreaterThan(economy)
  })

  it("takes the activation barrier FIRST - the project's documented global first lock", async () => {
    const world = makeWorld()
    await run(world)
    expect(world.calls[0]).toBe("activation:exclusive")
    expect(world.calls[1]).toBe("economy:exclusive")
  })

  it("processes all 60 clubs in deterministic ascending id order", async () => {
    const world = makeWorld()
    const outcome = await run(world)
    expect(outcome.inserted.map((row) => row.teamId)).toEqual([...world.teamIds].sort())
    const appended = world.calls.filter((c) => c.startsWith("append:")).map((c) => c.slice("append:".length))
    expect(appended).toEqual([...world.teamIds].sort())
  })

  it("writes exactly 60 rows on the happy path, one per club, none skipped", async () => {
    const outcome = await run(makeWorld())
    expect(outcome.inserted).toHaveLength(60)
    expect(outcome.finalRows).toBe(60)
    expect(outcome.distinctCovered).toBe(60)
    expect(new Set(outcome.inserted.map((r) => r.teamId)).size).toBe(60)
  })

  it("every row is version 1, reason baseline, and strictly before activation", async () => {
    const outcome = await run(makeWorld())
    for (const row of outcome.inserted) {
      expect(row.version).toBe(1)
      expect(row.reason).toBe("baseline")
      expect(row.effectiveAt.getTime()).toBeLessThan(ACTIVATION.getTime())
    }
  })

  it("REFUSES inside the transaction when history is not empty, even if the outside gate passed", async () => {
    const world = makeWorld({ rows: [{ teamId: "club-01", version: 1, reason: "registration", effectiveAt: NOW }] })
    await expect(run(world)).rejects.toThrow(/HISTORY_NOT_EMPTY_IN_TX/)
    // Nothing was appended: the refusal happened before the first roster lock.
    expect(world.calls.some((c) => c.startsWith("roster:"))).toBe(false)
  })

  it("REFUSES inside the transaction when the club count is not exactly 60", async () => {
    await expect(run(makeWorld({ teamIds: ["club-01"] }))).rejects.toThrow(/CLUB_COUNT_IN_TX/)
  })

  it("REFUSES inside the transaction once activation is no longer in the future", async () => {
    const world = makeWorld()
    const deps = { ...makeDeps(), now: () => new Date(ACTIVATION.getTime() + 1) }
    await expect(runFirstBaselineTransaction(world, deps, FIRST_BASELINE, ACTIVATION)).rejects.toThrow(/ACTIVATION_NOT_FUTURE_IN_TX/)
  })

  it("a simulated mid-run failure throws, so the whole transaction rolls back", async () => {
    const world = makeWorld({ failAtTeam: "club-30" })
    await expect(run(world)).rejects.toThrow(/simulated mid-run failure/)
    // The fake has no commit, so what it holds is what a rollback would discard -
    // the point is that the runner never returns a partial success.
    expect(world.rows.length).toBeLessThan(60)
  })

  it("NO 1-through-59 row outcome is reachable: any short count throws rather than returning", async () => {
    for (const teamIds of [[], Array.from({ length: 59 }, (_, i) => `club-${i}`), Array.from({ length: 1 }, (_, i) => `club-${i}`)]) {
      await expect(run(makeWorld({ teamIds }))).rejects.toBeInstanceOf(FirstBaselineAbort)
    }
  })

  it("a concurrent SHARED appender cannot interleave once the exclusive barrier is held", async () => {
    const world = makeWorld({ sharedAppenderAt: "club-30" })
    const outcome = await run(world)
    expect(world.calls).toContain("shared-appender:BLOCKED")
    expect(world.calls).not.toContain("shared-appender:ADMITTED")
    expect(outcome.finalRows).toBe(60)
  })

  it("REFUSES when a forbidden side-effect digest moved", async () => {
    const moved = { ...flatDigest(), teamBalanceSum: 999 }
    await expect(run(makeWorld({ digestAfter: moved }))).rejects.toThrow(/SIDE_EFFECT_DRIFT/)
  })

  it("names WHICH forbidden measurement moved", async () => {
    const moved = { ...flatDigest(), playerOwnershipDigest: "changed" }
    await expect(run(makeWorld({ digestAfter: moved }))).rejects.toThrow(/playerOwnershipDigest/)
  })

  it("REFUSES when the historical orphan changed during the transaction", async () => {
    const changed: OrphanReading = { ...goodOrphan(), transactionCount: 2 }
    await expect(run(makeWorld({ orphanAfter: changed }))).rejects.toThrow(/ORPHAN_CHANGED/)
  })

  it("REFUSES when the orphan is not the acknowledged historical truth", async () => {
    const wrong: OrphanReading = { fixtureId: FIRST_BASELINE.orphanFixtureId, transactionCount: 3, net: 1 }
    await expect(run(makeWorld({ orphan: wrong }))).rejects.toThrow(/ORPHAN_NOT_HISTORICAL_TRUTH/)
  })

  it("leaves the orphan exactly as found on the happy path - never deleted, reversed or balanced", async () => {
    const outcome = await run(makeWorld())
    expect(outcome.orphanBefore).toEqual(outcome.orphanAfter)
    expect(outcome.orphanAfter).toEqual({
      fixtureId: "cmtedbpib0001ya9jpzjzevb5",
      transactionCount: 3,
      net: 213629,
    })
  })

  it("REFUSES a duplicate club row", async () => {
    const world = makeWorld({ teamIds: Array.from({ length: 60 }, (_, i) => `club-${String(i + 1).padStart(2, "0")}`) })
    const deps = makeDeps()
    const original = deps.append
    deps.append = async (w, input) => {
      const row = await original(w, input)
      if (input.teamId === "club-05") w.rows.push({ ...row, version: 2, reason: "baseline" })
      return row
    }
    await expect(runFirstBaselineTransaction(world, deps, FIRST_BASELINE, ACTIVATION)).rejects.toBeInstanceOf(FirstBaselineAbort)
  })

  it("REFUSES a row whose version is not 1", async () => {
    const world = makeWorld()
    const deps = makeDeps()
    deps.append = async (w, input) => {
      const row: InsertedRow = { teamId: input.teamId, version: input.teamId === "club-07" ? 2 : 1, reason: "baseline", effectiveAt: NOW }
      w.rows.push(row)
      return row
    }
    await expect(runFirstBaselineTransaction(world, deps, FIRST_BASELINE, ACTIVATION)).rejects.toThrow(/VERSION_NOT_1/)
  })

  it("REFUSES a row whose reason is not baseline", async () => {
    const world = makeWorld()
    const deps = makeDeps()
    deps.append = async (w, input) => {
      const row: InsertedRow = { teamId: input.teamId, version: 1, reason: input.teamId === "club-07" ? "registration" : "baseline", effectiveAt: NOW }
      w.rows.push(row)
      return row
    }
    await expect(runFirstBaselineTransaction(world, deps, FIRST_BASELINE, ACTIVATION)).rejects.toThrow(/REASON_NOT_BASELINE/)
  })

  it("REFUSES a row stamped at or after activation", async () => {
    const world = makeWorld()
    const deps = makeDeps()
    deps.append = async (w, input) => {
      const row: InsertedRow = {
        teamId: input.teamId,
        version: 1,
        reason: "baseline",
        effectiveAt: input.teamId === "club-07" ? new Date(ACTIVATION.getTime()) : NOW,
      }
      w.rows.push(row)
      return row
    }
    await expect(runFirstBaselineTransaction(world, deps, FIRST_BASELINE, ACTIVATION)).rejects.toThrow(/EFFECTIVE_AT_NOT_BEFORE_ACTIVATION/)
  })

  it("REFUSES when a club could not be locked", async () => {
    const world = makeWorld()
    const deps = makeDeps()
    deps.lockTeamRoster = async (_w, teamId) => teamId !== "club-42"
    await expect(runFirstBaselineTransaction(world, deps, FIRST_BASELINE, ACTIVATION)).rejects.toThrow(/TEAM_VANISHED/)
  })
})

// ---------------------------------------------------------------------------
// THE RUNNER SCRIPT'S SHAPE
// ---------------------------------------------------------------------------

const script = readFileSync(join(process.cwd(), "scripts/production/economy-first-baseline.ts"), "utf8")
/** Comments document what the code must NOT do, so they are stripped before scanning for it. */
const code = script.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("the first-baseline runner script's shape", () => {
  it("is a SEPARATE command from the idempotent baseline, not a flag on it", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> }
    expect(pkg.scripts["prod:economy:first-baseline"]).toBe("tsx scripts/production/economy-first-baseline.ts")
    expect(pkg.scripts["prod:economy:baseline"]).toBe("tsx scripts/production/economy-baseline.ts")
    expect(pkg.scripts["prod:economy:first-baseline"]).not.toBe(pkg.scripts["prod:economy:baseline"])
  })

  it("uses the canonical appendTeamEconomicState and introduces NO direct INSERT", () => {
    expect(code).toContain("appendTeamEconomicState")
    expect(code).not.toMatch(/INSERT\s+INTO\s+"TeamEconomicState"/i)
    expect(code).not.toMatch(/teamEconomicState\.create/)
  })

  it("NEVER supplies a caller effectiveAt - the database clock stays the ordering authority", () => {
    // The append input is written as `{ teamId, reason }`; a supplied stamp
    // would have to appear alongside that `reason`. A type annotation naming
    // the column when READING rows back is not a supplied value, so the check
    // is scoped to the input shape rather than to the word.
    expect(code).not.toMatch(/reason:\s*"baseline"[^}]*effectiveAt/)
    expect(code).toMatch(/append:\s*\(client, input\) => appendTeamEconomicState\(client, input\)/)
    const moduleSource = readFileSync(join(process.cwd(), "src/lib/economy/first-baseline.ts"), "utf8")
    expect(moduleSource).toContain('deps.append(tx, { teamId, reason: "baseline" })')
    expect(moduleSource).not.toMatch(/deps\.append\(tx, \{[^}]*effectiveAt/)
  })

  it("takes the two barriers and never invents a second locking system", () => {
    expect(code).toContain("acquirePhase3RActivationExclusive")
    expect(code).toContain("acquireEconomyHistoryExclusive")
    expect(code).not.toContain("acquireEconomyHistoryShared")
    expect(code).not.toMatch(/pg_advisory/)
  })

  it("writes inside exactly ONE transaction", () => {
    expect((code.match(/prisma\.\$transaction\(/g) ?? []).length).toBe(1)
  })

  it("has NO automatic retry of the baseline", () => {
    expect(code).not.toMatch(/withSerializableRetry|for\s*\(let attempt|retry\(/i)
  })

  it("has NO automatic second baseline and no chained command", () => {
    expect(code).not.toMatch(/runFirstBaselineTransaction[\s\S]{0,4000}runFirstBaselineTransaction/)
    expect(code).not.toContain("evaluateSecondBaselineVerification")
    expect(code).not.toMatch(/execFileSync|spawn|exec\(/)
  })

  it("creates NO Neon backup and touches NO Render configuration", () => {
    expect(code).not.toMatch(/createBackupBranch|NEON_API_KEY|neon-ops/)
    expect(code).not.toMatch(/updateServiceSource|createDeploy|suspendCron|resumeCron|setWebServiceEnvVar/)
  })

  it("requires PRODUCTION_WRITE_CONFIRM before any write", () => {
    expect(code).toContain("assertProductionWriteConfirmed")
    expect(code).toMatch(/if \(!confirmed\)/)
  })

  it("reads the canonical head through the authenticated shared reader, never a bare git read", () => {
    expect(code).toContain("readCanonicalHead")
    expect(code).not.toMatch(/ls-remote/)
  })

  it("logs no row contents - only counts, sums and digests", () => {
    expect(code).toContain("createHash")
    expect(code).toMatch(/digestRows/)
  })
})

// ---------------------------------------------------------------------------
// THE HISTORICAL ORPHAN'S IDENTITY - REGRESSION
// ---------------------------------------------------------------------------

/**
 * A DEFECT THAT REACHED THIS REPO. An earlier draft of readOrphan queried
 * `WHERE "fixtureId" = ...` on FinancialTransaction. That column does not
 * exist: the table is id, teamId, type, amount, description, referenceId,
 * createdAt. The query would have thrown inside the baseline transaction and
 * rolled the whole thing back - so it could never have written anything wrong,
 * and could never have succeeded either. These tests read the REAL Prisma
 * schema so the same class of mistake fails here rather than in Production.
 */
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")

/** The declared scalar fields of one model, read out of schema.prisma. */
function modelFields(model: string): string[] {
  const start = schema.indexOf(`model ${model} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const block = schema.slice(start, schema.indexOf("\n}", start))
  return block
    .split("\n")
    .slice(1)
    .map((line) => /^\s{2}(\w+)\s/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name))
}

describe("readOrphan matches the canonical FinancialTransaction schema", () => {
  it("FinancialTransaction has NO fixtureId column - the premise of the defect", () => {
    const fields = modelFields("FinancialTransaction")
    expect(fields).toEqual(expect.arrayContaining(["id", "teamId", "type", "amount", "description", "referenceId", "createdAt"]))
    expect(fields).not.toContain("fixtureId")
  })

  it("the runner NEVER queries a fixtureId column on FinancialTransaction", () => {
    expect(code).not.toMatch(/"fixtureId"/)
    expect(code).not.toMatch(/fixtureId\s*=/)
  })

  it("every column readOrphan's query names really exists on the model", () => {
    const fields = new Set(modelFields("FinancialTransaction"))
    const orphanQuery = code.slice(code.indexOf("async function readOrphan"))
    const named = [...orphanQuery.slice(0, orphanQuery.indexOf("readOrphanFromRows")).matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"/g)].map((m) => m[1])
    const columns = named.filter((name) => name !== "FinancialTransaction")
    expect(columns.length).toBeGreaterThan(0)
    for (const column of columns) expect(fields).toContain(column)
  })

  it("uses a parameterised LITERAL PREFIX, never a broad substring search", () => {
    // Scoped to readOrphan. The catalog reader legitimately uses ILIKE against
    // pg_indexes.indexdef, which is a different question about a different table.
    const start = code.indexOf("async function readOrphan")
    const orphanFn = code.slice(start, code.indexOf("\n}", start))
    expect(orphanFn).toMatch(/starts_with\("referenceId", \$\{prefix\}\)/)
    for (const broad of ["ILIKE", "LIKE", "strpos(", "POSITION(", "SIMILAR TO", "~"]) {
      expect(orphanFn).not.toContain(broad)
    }
  })

  it("the prefix carries the trailing underscore, so a longer fixture id cannot be folded in", () => {
    expect(orphanReferencePrefix("cmtedbpib0001ya9jpzjzevb5")).toBe("MATCH_cmtedbpib0001ya9jpzjzevb5_")
    const rows = [
      { referenceId: "MATCH_cmtedbpib0001ya9jpzjzevb5X_HOME_REVENUE", amount: 999 },
      { referenceId: "MATCH_cmtedbpib0001ya9jpzjzevb5_HOME_REVENUE", amount: 1 },
    ]
    expect(readOrphanFromRows("cmtedbpib0001ya9jpzjzevb5", rows).transactionCount).toBe(1)
  })
})

describe("the canonical MATCH_ prefix semantics over the real historical rows", () => {
  /** The three rows Production actually holds for the acknowledged orphan. */
  const HISTORICAL = [
    { referenceId: "MATCH_cmtedbpib0001ya9jpzjzevb5_HOME_REVENUE", amount: 262410 },
    { referenceId: "MATCH_cmtedbpib0001ya9jpzjzevb5_HOME_EXPENSE", amount: -38781 },
    { referenceId: "MATCH_cmtedbpib0001ya9jpzjzevb5_AWAY_TRAVEL", amount: -10000 },
  ]

  it("exactly the three historical rows produce count 3 and net 213629", () => {
    expect(readOrphanFromRows(FIRST_BASELINE.orphanFixtureId, HISTORICAL)).toEqual({
      fixtureId: "cmtedbpib0001ya9jpzjzevb5",
      transactionCount: 3,
      net: 213629,
    })
  })

  it("ignores other clubs' and other fixtures' ledger rows entirely", () => {
    const noise = [
      ...HISTORICAL,
      { referenceId: "MATCH_someotherfixture_HOME_REVENUE", amount: 500_000 },
      { referenceId: "PAYROLL_2026_W35_CLUB_123", amount: -9_000 },
      { referenceId: "SPONSOR_2026_W35_CLUB_123", amount: 4_000 },
    ]
    expect(readOrphanFromRows(FIRST_BASELINE.orphanFixtureId, noise)).toEqual({
      fixtureId: "cmtedbpib0001ya9jpzjzevb5",
      transactionCount: 3,
      net: 213629,
    })
  })

  it("an UNEXPECTED FOURTH MATCH_ row is DETECTED, not hidden", () => {
    const withFourth = [...HISTORICAL, { referenceId: "MATCH_cmtedbpib0001ya9jpzjzevb5_FAN_INCIDENT", amount: -5_000 }]
    const reading = readOrphanFromRows(FIRST_BASELINE.orphanFixtureId, withFourth)
    expect(reading.transactionCount).toBe(4)
    expect(reading.net).toBe(208_629)
  })

  it("that unexpected fourth row makes the historical truth gate FAIL the whole transaction", async () => {
    const withFourth = [...HISTORICAL, { referenceId: "MATCH_cmtedbpib0001ya9jpzjzevb5_FAN_INCIDENT", amount: -5_000 }]
    const drifted = readOrphanFromRows(FIRST_BASELINE.orphanFixtureId, withFourth)
    await expect(run(makeWorld({ orphan: drifted }))).rejects.toThrow(/ORPHAN_NOT_HISTORICAL_TRUTH/)
  })

  it("a MISSING historical row fails the gate just as loudly", async () => {
    const missing = readOrphanFromRows(FIRST_BASELINE.orphanFixtureId, HISTORICAL.slice(0, 2))
    await expect(run(makeWorld({ orphan: missing }))).rejects.toThrow(/ORPHAN_NOT_HISTORICAL_TRUTH/)
  })
})

// ---------------------------------------------------------------------------
// THE FIXTURE DIGEST ACTUALLY WATCHES THE SCORE - REGRESSION
// ---------------------------------------------------------------------------

/**
 * The digest is only a proof if it MOVES when the thing it watches moves. The
 * defect that failed Workflow C was a fixture query naming columns that do not
 * exist; the repair names homeScore/awayScore instead, and these two tests
 * prove the repaired shape is score-sensitive in both directions rather than
 * merely compiling.
 *
 * The digest function itself lives in the runner (it needs the database), so
 * what is exercised here is the exact row-to-tuple shape the runner builds -
 * asserted against the runner's source in first-baseline-sql-contract.test.ts -
 * over the same sha256-of-JSON reduction.
 */
const fixtureRowsToDigest = (rows: readonly { id: string; playedAt: Date | null; homeScore: number | null; awayScore: number | null }[]) =>
  createHash("sha256")
    .update(JSON.stringify(rows.map((row) => [row.id, row.playedAt?.toISOString() ?? null, row.homeScore, row.awayScore])))
    .digest("hex")

describe("the fixture digest is sensitive to the result", () => {
  const played = new Date("2026-09-05T19:00:00.000Z")
  const baseline = [{ id: "fx-1", playedAt: played, homeScore: 2, awayScore: 1 }]

  it("CHANGES when homeScore changes", () => {
    const moved = [{ ...baseline[0], homeScore: 3 }]
    expect(fixtureRowsToDigest(moved)).not.toBe(fixtureRowsToDigest(baseline))
  })

  it("CHANGES when awayScore changes", () => {
    const moved = [{ ...baseline[0], awayScore: 0 }]
    expect(fixtureRowsToDigest(moved)).not.toBe(fixtureRowsToDigest(baseline))
  })

  it("CHANGES when a fixture becomes played", () => {
    const unplayed = [{ ...baseline[0], playedAt: null, homeScore: null, awayScore: null }]
    expect(fixtureRowsToDigest(unplayed)).not.toBe(fixtureRowsToDigest(baseline))
  })

  it("is STABLE when nothing moved - otherwise every run would look like drift", () => {
    expect(fixtureRowsToDigest(baseline)).toBe(fixtureRowsToDigest([{ id: "fx-1", playedAt: played, homeScore: 2, awayScore: 1 }]))
  })

  it("a moved fixture digest FAILS the whole first baseline", async () => {
    const moved = { ...flatDigest(), fixtureDigest: "a-different-hash" }
    await expect(run(makeWorld({ digestAfter: moved }))).rejects.toThrow(/SIDE_EFFECT_DRIFT/)
    await expect(run(makeWorld({ digestAfter: moved }))).rejects.toThrow(/fixtureDigest/)
  })
})

describe("the second baseline is a separate, read-only decision", () => {
  it("passes only on 0 new rows with full coverage", () => {
    expect(evaluateSecondBaselineVerification({ historyRows: 60, historyDistinctTeams: 60, teamCount: 60, rowsWritten: 0 })).toEqual({
      ok: true,
      refusals: [],
    })
  })

  it("FAILS if the second run wrote anything at all", () => {
    const result = evaluateSecondBaselineVerification({ historyRows: 61, historyDistinctTeams: 60, teamCount: 60, rowsWritten: 1 })
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain("SECOND_BASELINE_WROTE_ROWS")
  })

  it("FAILS on incomplete coverage", () => {
    const result = evaluateSecondBaselineVerification({ historyRows: 59, historyDistinctTeams: 59, teamCount: 60, rowsWritten: 0 })
    expect(codes(result)).toEqual(expect.arrayContaining(["HISTORY_ROWS", "HISTORY_COVERAGE"]))
  })

  it("is a pure predicate - there is no second WRITE path exported from this module", () => {
    const moduleSource = readFileSync(join(process.cwd(), "src/lib/economy/first-baseline.ts"), "utf8")
    expect((moduleSource.match(/export async function run/g) ?? []).length).toBe(1)
  })
})
