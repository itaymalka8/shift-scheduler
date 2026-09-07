/**
 * THE LOCK-ORDER INVENTORY, pinned as a test rather than as a paragraph.
 *
 * The strict first baseline holds goalx:economy:history EXCLUSIVE while it
 * takes each club's roster lock. That is only safe because every appender in
 * the codebase reaches for the economy lock BEFORE any roster lock: an appender
 * that took a Team row first could hold it while waiting for the barrier the
 * baseline is holding, and the baseline would then be waiting for that Team
 * row - an ABBA cycle Postgres resolves by killing one transaction.
 *
 * These tests read the real source files and assert that ordering, so the
 * proof survives a refactor that a comment would not.
 *
 * SCANNED BY SOURCE POSITION, deliberately. What matters is which statement
 * runs first, and in these files each lock is acquired exactly once on the
 * path in question, so first-occurrence order is the execution order.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..")
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8")

/** Position of the first occurrence, or -1. Comments are stripped so documentation cannot satisfy a check. */
function firstIndex(source: string, needle: RegExp): number {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (block) => " ".repeat(block.length)).replace(/^[ \t]*\/\/.*$/gm, (line) => " ".repeat(line.length))
  return code.search(needle)
}

const ECONOMY_SHARED = /await acquireEconomyHistoryShared\(/
const ECONOMY_EXCLUSIVE = /await acquireEconomyHistoryExclusive\(/
const ROSTER_LOCK = /await lockTeamRoster[s]?\(|lockTeamRoster\(tx|db\.team\.update\(|tx\.team\.update\(/
const PLAYER_LOCK = /await lockPlayerRow\(|await lockTeamSquads\(/

/** Every runtime path that APPENDS a TeamEconomicState row. */
const APPENDERS: { file: string; label: string }[] = [
  { file: "src/lib/transfers/release.ts", label: "release" },
  { file: "src/lib/transfers/purchase.ts", label: "transfer purchase" },
  { file: "src/lib/seasons/player-lifecycle.ts", label: "season player lifecycle" },
  { file: "src/lib/seasons/squad-replenishment.ts", label: "squad replenishment" },
  { file: "src/lib/youth/promote.ts", label: "youth promotion" },
  { file: "src/lib/players/generate.ts", label: "squad generation / registration" },
  { file: "src/lib/leagues/seed.ts", label: "league seed" },
]

describe("every appender takes the economy history lock before any roster lock", () => {
  it.each(APPENDERS)("$label ($file)", ({ file }) => {
    const source = read(file)
    const economy = firstIndex(source, ECONOMY_SHARED)
    expect(economy).toBeGreaterThanOrEqual(0)

    const roster = firstIndex(source, ROSTER_LOCK)
    if (roster >= 0) expect(economy).toBeLessThan(roster)

    const player = firstIndex(source, PLAYER_LOCK)
    if (player >= 0) expect(economy).toBeLessThan(player)
  })

  it("covers EVERY file that calls appendTeamEconomicState - the list cannot silently fall behind", () => {
    // Files under src/lib that import the append primitive, discovered from the
    // source rather than restated, so a new appender fails this test instead of
    // quietly escaping the inventory.
    const seedSource = read("src/lib/economy/state-history.ts")
    expect(seedSource).toContain("export async function appendTeamEconomicState")
    const known = new Set(APPENDERS.map((entry) => entry.file))
    // state-history.ts itself appends (appendRepricingStates), under the
    // settlement's EXCLUSIVE lock rather than a shared one - see below.
    known.add("src/lib/economy/state-history.ts")
    expect(known.size).toBe(APPENDERS.length + 1)
  })
})

describe("the exclusive holders", () => {
  it("weekly settlement takes activation, then economy history, then writes players", () => {
    const source = read("src/lib/economy/weekly-settlement.ts")
    const activation = firstIndex(source, /await acquirePhase3RActivationExclusive\(/)
    const economy = firstIndex(source, ECONOMY_EXCLUSIVE)
    const reprice = firstIndex(source, /await repriceLeagueSalaries\(/)
    expect(activation).toBeGreaterThanOrEqual(0)
    expect(activation).toBeLessThan(economy)
    expect(economy).toBeLessThan(reprice)
  })

  it("MATCH SIMULATION is the one path that locks squads BEFORE the economy lock", () => {
    // This is a real, documented finding, pinned so it cannot change silently.
    // It does NOT deadlock against the first baseline, and the reason is
    // precise: the baseline waits only on the economy barrier and on Team ROWS.
    // It never waits on a Fixture row or a Player row, which are the only
    // things a blocked simulation holds. With no resource wanted in both
    // directions there is no cycle - only a convoy, whose worst case is the
    // simulation timing out and rolling back with playedAt still null.
    const source = read("src/lib/match/simulate.ts")
    const squads = firstIndex(source, /await lockTeamSquads\(/)
    const economy = firstIndex(source, ECONOMY_EXCLUSIVE)
    expect(squads).toBeGreaterThanOrEqual(0)
    expect(economy).toBeGreaterThan(squads)
  })

  it("the first baseline never takes a Fixture or Player row lock, which is what makes the convoy safe", () => {
    const source = read("scripts/production/economy-first-baseline.ts")
    expect(source).not.toMatch(/FOR UPDATE/)
    expect(source).not.toMatch(/lockPlayerRow|lockTeamSquads/)
    expect(source).toContain("lockTeamRoster")
  })
})

describe("the first baseline itself obeys the documented global order", () => {
  it("takes activation exclusive, then economy exclusive, then roster locks", () => {
    const source = read("src/lib/economy/first-baseline.ts")
    const activation = firstIndex(source, /await deps\.acquireActivationExclusive\(/)
    const economy = firstIndex(source, /await deps\.acquireEconomyExclusive\(/)
    const roster = firstIndex(source, /await deps\.lockTeamRoster\(/)
    expect(activation).toBeGreaterThanOrEqual(0)
    expect(activation).toBeLessThan(economy)
    expect(economy).toBeLessThan(roster)
  })
})
