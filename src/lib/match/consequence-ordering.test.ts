/**
 * PHASE 3L.1 - MATCH CONSEQUENCE ORDERING AND CONCURRENCY.
 *
 * Two properties are being defended here, and both are invisible in normal
 * operation because fixtures are normally days apart:
 *
 *   CAUSAL ORDER - a fixture may not be simulated while an earlier,
 *   publicly-finished fixture of either club still owes its consequences.
 *   Cron downtime is what makes this reachable, and a wrong result is written
 *   into a league table permanently.
 *
 *   NO MUTATION WINDOW - the XI that is judged legal must be the XI that is
 *   simulated. Previously legality was proved in a transaction that
 *   COMMITTED, and the squad was read afterwards.
 *
 * The behavioural proof of both runs against real PostgreSQL. These are the
 * structural guards: they fail the moment the shape that makes the behaviour
 * possible is edited away.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { compareFixtureChronology } from "./consequence-service"

const SRC = join(__dirname, "..", "..")

function readCode(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * The file WITHOUT its imports.
 *
 * Every ordering assertion below is about the order of CALLS, and an import
 * line contains the same identifier. Phase 3L shipped a guard that stayed
 * green while the code it guarded was deleted, for exactly this reason:
 * indexOf found the import. Ordering is asserted against the body only.
 */
function readBody(...parts: string[]): string {
  const source = readCode(...parts)
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+"[^"]+"$/gm)]
  if (imports.length === 0) return source
  const last = imports[imports.length - 1]
  return source.slice((last.index ?? 0) + last[0].length)
}

const SIMULATE = ["lib", "match", "simulate.ts"]
const SERVICE = ["lib", "match", "consequence-service.ts"]
const PREFLIGHT = ["lib", "match", "lineup-preflight.ts"]
const LOCKS = ["lib", "players", "locks.ts"]
const CRON = ["..", "scripts", "process-scheduled-jobs.ts"]

const at = (source: string, needle: string) => {
  const index = source.indexOf(needle)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

describe("chronology is a TOTAL order, so overlapping backlogs cannot disagree", () => {
  const d = (iso: string) => new Date(iso)

  it("orders by kickoff first", () => {
    const monday = { id: "z", scheduledAt: d("2026-09-07T19:00:00Z") }
    const wednesday = { id: "a", scheduledAt: d("2026-09-09T19:00:00Z") }
    expect(compareFixtureChronology(monday, wednesday)).toBeLessThan(0)
    expect(compareFixtureChronology(wednesday, monday)).toBeGreaterThan(0)
  })

  it("falls back to the immutable id, and only on an exact tie", () => {
    const a = { id: "aaa", scheduledAt: d("2026-09-07T19:00:00Z") }
    const b = { id: "bbb", scheduledAt: d("2026-09-07T19:00:00Z") }
    expect(compareFixtureChronology(a, b)).toBeLessThan(0)
    expect(compareFixtureChronology(b, a)).toBeGreaterThan(0)
    expect(compareFixtureChronology(a, { ...a })).toBe(0)
  })

  it("is deterministic whatever order the database returns", () => {
    const fixtures = [
      { id: "f3", scheduledAt: d("2026-09-09T19:00:00Z") },
      { id: "f1", scheduledAt: d("2026-09-07T19:00:00Z") },
      { id: "f2", scheduledAt: d("2026-09-07T19:00:00Z") },
      { id: "f4", scheduledAt: d("2026-09-12T19:00:00Z") },
    ]
    const expected = ["f1", "f2", "f3", "f4"]
    for (const shuffled of [
      [...fixtures],
      [...fixtures].reverse(),
      [fixtures[2], fixtures[0], fixtures[3], fixtures[1]],
    ]) {
      expect([...shuffled].sort(compareFixtureChronology).map((f) => f.id)).toEqual(expected)
    }
  })

  it("every club's own fixtures are a subsequence of the one global order", () => {
    // The cross-club question: club A plays f1 and f3, club B plays f2 and f3.
    // One global ranking must give both clubs a consistent view.
    const all = [
      { id: "f1", scheduledAt: d("2026-09-07T19:00:00Z"), clubs: ["A", "C"] },
      { id: "f2", scheduledAt: d("2026-09-07T19:00:00Z"), clubs: ["B", "D"] },
      { id: "f3", scheduledAt: d("2026-09-09T19:00:00Z"), clubs: ["A", "B"] },
    ].sort(compareFixtureChronology)
    const forClub = (club: string) => all.filter((f) => f.clubs.includes(club)).map((f) => f.id)
    expect(forClub("A")).toEqual(["f1", "f3"])
    expect(forClub("B")).toEqual(["f2", "f3"])
    // f3 is last for both. No pair of clubs can derive opposite orders.
  })
})

describe("CAUSAL ORDER: the past is settled before a club takes the field", () => {
  it("simulate settles prior consequences before it does anything else", () => {
    const source = readBody(...SIMULATE)
    const settle = at(source, "settlePriorConsequences(fixtureId, teamIds, fixture.scheduledAt)")
    expect(settle).toBeLessThan(at(source, "prisma.$transaction"))
    expect(settle).toBeLessThan(at(source, "buildMatchSnapshot(fixtureId, seed, { neutralVenue }, tx)"))
    expect(settle).toBeLessThan(at(source, "simulateMatch(snapshot)"))
  })

  it("an unsettled prior fixture FAILS CLOSED rather than simulating", () => {
    const source = readCode(...SIMULATE)
    expect(source).toContain('throw new MatchPreflightError(\n      "PRIOR_CONSEQUENCES_PENDING"')
    // The refusal is a preflight error, so processDueFixtures reports it as a
    // blocked fixture instead of killing the whole matchday.
    expect(source).toContain("error instanceof MatchPreflightError")
  })

  it("the prerequisite is per fixture, so no batch size can bypass it", () => {
    const service = readCode(...SERVICE)
    // The settlement looks at THIS fixture's clubs and THIS fixture's prior
    // matches - it takes no `take:` and is not the batched cron query.
    const settle = service.slice(at(service, "export async function settlePriorConsequences"))
    expect(settle).not.toContain("batchSize")
    expect(settle).not.toContain("DEFAULT_CONSEQUENCE_BATCH")
    expect(settle).toContain("applyFixtureConsequences")
  })

  it("the prerequisite excludes the fixture itself and looks strictly backwards", () => {
    const service = readCode(...SERVICE)
    const finder = service.slice(at(service, "export async function findOutstandingPriorConsequences"))
    expect(finder).toContain("id: { not: fixtureId }")
    expect(finder).toContain("scheduledAt: { lt: scheduledAt }")
    expect(finder).toContain("{ scheduledAt: scheduledAt, id: { lt: fixtureId } }")
    expect(finder).toContain('orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]')
  })

  it("ANTI SPOILER OUTRANKS IT: a prior match still on screen is never activated early", () => {
    const service = readCode(...SERVICE)
    const settle = service.slice(at(service, "export async function settlePriorConsequences"))
    expect(settle).toContain("if (!prior.publiclyFinished) continue")
    expect(settle).toContain("blockedByPublicFinish")
  })

  it("a backlog of fixtures is PLAYED in chronological order too", () => {
    const source = readCode(...SIMULATE)
    const due = source.slice(at(source, "const due = await prisma.fixture.findMany"))
    expect(due).toContain('orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]')
  })

  it("a backlog of consequences is ACTIVATED in chronological order", () => {
    const service = readCode(...SERVICE)
    const activator = service.slice(at(service, "export async function activateDueMatchConsequences"))
    expect(activator).toContain('orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]')
    expect(activator).toContain("sort(compareFixtureChronology)")
    expect(activator).toContain("for (const fixture of ordered)")
  })

  it("the cron brackets the matchday with activation, before and after", () => {
    const cron = readBody(...CRON)
    const first = cron.indexOf("activateDueMatchConsequences")
    const process = at(cron, "processDueFixtures()")
    const second = cron.indexOf("activateDueMatchConsequences", first + 1)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(process)
    expect(second).toBeGreaterThan(process)
  })
})

describe("NO MUTATION WINDOW: the XI judged is the XI simulated", () => {
  it("legality, snapshot and simulation share ONE transaction", () => {
    const source = readBody(...SIMULATE)
    // Exactly one transaction in the simulate path. Two is the old shape -
    // one that proved legality and COMMITTED, and one that wrote the match.
    expect(source.match(/prisma\.\$transaction/g)).toHaveLength(1)
    const txStart = at(source, "prisma.$transaction")
    for (const step of [
      "assertFixtureLineupsLegal(tx, fixtureId, teamIds)",
      "buildMatchSnapshot(fixtureId, seed, { neutralVenue }, tx)",
      "simulateMatch(snapshot)",
      "tx.fixture.update",
    ]) {
      expect(at(source, step)).toBeGreaterThan(txStart)
    }
  })

  it("the snapshot is read through the transaction, not the global client", () => {
    const source = readCode(...SIMULATE)
    expect(source).toContain("buildMatchSnapshot(fixtureId, seed, { neutralVenue }, tx)")
    const snapshot = readCode("lib", "match", "engine", "build-snapshot.ts")
    expect(snapshot).toContain("db: SnapshotReader = prisma")
    expect(snapshot).toContain("await db.team.findUniqueOrThrow")
    expect(snapshot).toContain("buildTeamSnapshot(fixture.homeTeamId, db)")
  })

  it("both squads are locked BEFORE legality is judged", () => {
    const source = readBody(...SIMULATE)
    const squads = at(source, "lockTeamSquads(tx, teamIds)")
    expect(squads).toBeGreaterThan(at(source, "prisma.$transaction"))
    expect(squads).toBeLessThan(at(source, "assertFixtureLineupsLegal(tx, fixtureId, teamIds)"))
    expect(squads).toBeLessThan(at(source, "buildMatchSnapshot(fixtureId, seed, { neutralVenue }, tx)"))
  })

  it("the fixture row is still the first thing locked", () => {
    const source = readBody(...SIMULATE)
    expect(at(source, 'FROM "Fixture" WHERE "id" = ')).toBeLessThan(at(source, "lockTeamSquads(tx, teamIds)"))
    expect(source).toContain("FOR UPDATE")
  })
})

describe("LOCK ORDER: Fixture -> Player -> Team -> LineupSlot", () => {
  it("the match takes Team after Player and before any lineup write", () => {
    const source = readBody(...SIMULATE)
    const players = at(source, "lockTeamSquads(tx, teamIds)")
    const teams = at(source, "lockTeamRosters(tx, teamIds)")
    const lineup = at(source, "assertFixtureLineupsLegal(tx, fixtureId, teamIds)")
    expect(players).toBeLessThan(teams)
    expect(teams).toBeLessThan(lineup)
  })

  it("the squad lock is taken in one statement, in ascending player id", () => {
    const source = readCode(...LOCKS)
    expect(source).toContain("export async function lockTeamSquads")
    expect(source).toContain('ORDER BY "id" FOR UPDATE')
    expect(source).toContain("[...new Set(teamIds)].sort()")
  })

  it("every club-pair operation sorts its clubs, so two of them cannot invert", () => {
    expect(readCode(...PREFLIGHT)).toContain("const ordered = [...new Set(teamIds)].sort()")
    const service = readCode(...SERVICE)
    expect(service).toContain("[fixture.homeTeamId, fixture.awayTeamId].sort()")
    expect(service).toContain('orderBy: { id: "asc" }')
  })

  it("the repair still never writes LineupSlot before its caller holds the clubs", () => {
    // preflight is only ever reached from inside the match transaction, which
    // has already taken Player and Team. A direct call would be the bug.
    const source = readBody(...SIMULATE)
    expect(at(source, "lockTeamRosters(tx, teamIds)")).toBeLessThan(at(source, "assertFixtureLineupsLegal(tx, fixtureId, teamIds)"))
  })
})
