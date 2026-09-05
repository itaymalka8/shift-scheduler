/**
 * READ ONLY baseline for Phase 3L - match consequences and legal-XI
 * integrity. SELECTs only: it never writes, and it never simulates.
 *
 * WHY IT EXISTS: this is the state the new persisted player condition starts
 * from. Fitness has never moved, nobody has ever been injured or suspended,
 * and no lineup has ever been repaired - so every number here is the "before"
 * against which the first activated matchday can be read. It also answers the
 * one question that decides whether any fixture will be BLOCKED after the
 * deploy: how many clubs cannot field eleven eligible players today.
 *
 * IT RUNS ON BOTH SIDES OF THE MIGRATION, deliberately. A baseline that only
 * works once the change it is meant to baseline has shipped is not a
 * baseline. Player.injuryMatchesRemaining and Fixture.consequencesAppliedAt
 * are therefore probed in information_schema first and read through raw SQL
 * only when they are actually there; everything else - fitness, status,
 * careerStatus, lineup slots, eligibility - is available either way and is
 * reported either way.
 *
 * Run with: npm run prod:players:availability-audit
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { derivePlayerStatus } from "../../src/lib/players/availability"

function histogram(label: string, values: number[]): void {
  if (values.length === 0) {
    console.info(`  ${label}: none`)
    return
  }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  console.info(
    `  ${label}: n=${sorted.length} min=${sorted[0]} p25=${at(0.25)} median=${at(0.5)} p75=${at(0.75)} p95=${at(0.95)} max=${sorted[sorted.length - 1]}`
  )
}

async function main() {
  let handle: ReturnType<typeof createProductionClient>
  try {
    handle = createProductionClient()
  } catch (error) {
    if (error instanceof ProductionSafetyError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }
  const { prisma, target } = handle
  printProductionBanner("prod:players:availability-audit", target)

  try {
    // Does the Phase 3L migration exist here yet? Asked of the database
    // rather than assumed from the checked-out schema, because those two are
    // exactly what a pre-deploy baseline is run to compare.
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'Player' AND column_name = 'injuryMatchesRemaining')
          OR (table_name = 'Fixture' AND column_name = 'consequencesAppliedAt'))
    `
    const hasInjuryMatches = columns.some((c) => c.column_name === "injuryMatchesRemaining")
    const hasLedger = columns.some((c) => c.column_name === "consequencesAppliedAt")
    console.info(`Phase 3L columns present: injuryMatchesRemaining=${hasInjuryMatches} consequencesAppliedAt=${hasLedger}\n`)

    // Raw, so the generated client's expectation of the new column cannot
    // fail the whole read on a database that predates it.
    const rows = await prisma.$queryRawUnsafe<
      { id: string; teamId: string | null; fitness: number; status: string; injuryStatus: string | null; suspensionMatches: number; careerStatus: string; injuryMatchesRemaining: number }[]
    >(
      `SELECT "id", "teamId", "fitness", "status", "injuryStatus", "suspensionMatches", "careerStatus",
              ${hasInjuryMatches ? '"injuryMatchesRemaining"' : "0 AS \"injuryMatchesRemaining\""}
       FROM "Player"`
    )
    const players = rows

    console.info("--- 1. FITNESS ---")
    histogram("fitness", players.map((p) => p.fitness))
    const outOfRange = players.filter((p) => p.fitness < 1 || p.fitness > 100).length
    console.info(`  outside 1-100: ${outOfRange}`)

    console.info("\n--- 2. Player.status ---")
    const byStatus = new Map<string, number>()
    for (const p of players) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1)
    for (const [status, count] of [...byStatus].sort((a, b) => b[1] - a[1])) {
      console.info(`  ${status.padEnd(12)} ${String(count).padStart(5)}`)
    }

    console.info("\n--- 3. careerStatus ---")
    const byCareer = new Map<string, number>()
    for (const p of players) byCareer.set(p.careerStatus, (byCareer.get(p.careerStatus) ?? 0) + 1)
    for (const [status, count] of byCareer) console.info(`  ${status.padEnd(12)} ${String(count).padStart(5)}`)

    console.info("\n--- 4. injuryStatus ---")
    const byInjury = new Map<string, number>()
    for (const p of players) byInjury.set(p.injuryStatus ?? "(null)", (byInjury.get(p.injuryStatus ?? "(null)") ?? 0) + 1)
    for (const [status, count] of byInjury) console.info(`  ${status.padEnd(14)} ${String(count).padStart(5)}`)

    console.info("\n--- 5. injuryMatchesRemaining / suspensionMatches ---")
    console.info(`  injured (>0):   ${players.filter((p) => p.injuryMatchesRemaining > 0).length}`)
    console.info(`  suspended (>0): ${players.filter((p) => p.suspensionMatches > 0).length}`)

    console.info("\n--- 6. STATUS SYNCHRONISATION (the new invariant) ---")
    const desynced = players.filter((p) => p.status !== derivePlayerStatus(p))
    console.info(`  rows whose stored status disagrees with their counters: ${desynced.length}`)
    for (const p of desynced.slice(0, 5)) {
      console.info(`    ${p.id}: stored=${p.status} derived=${derivePlayerStatus(p)}`)
    }

    console.info("\n--- 7. LINEUPS AND ELIGIBILITY PER CLUB ---")
    const teams = await prisma.team.findMany({ select: { id: true, name: true, isBot: true } })
    const slotCounts = await prisma.lineupSlot.groupBy({ by: ["teamId"], _count: { _all: true } })
    const slotsByTeam = new Map(slotCounts.map((row) => [row.teamId, row._count._all]))

    const byTeam = new Map<string, typeof players>()
    for (const p of players) {
      if (!p.teamId) continue
      const bucket = byTeam.get(p.teamId)
      if (bucket) bucket.push(p)
      else byTeam.set(p.teamId, [p])
    }

    const shortLineups: string[] = []
    const shortActive: string[] = []
    const shortEligible: string[] = []
    const lineupSizes: number[] = []
    const eligibleSizes: number[] = []

    for (const team of teams) {
      const squad = byTeam.get(team.id) ?? []
      const slots = slotsByTeam.get(team.id) ?? 0
      const active = squad.filter((p) => p.careerStatus === "ACTIVE").length
      const eligible = squad.filter((p) => derivePlayerStatus(p) === "available").length
      lineupSizes.push(slots)
      eligibleSizes.push(eligible)
      const label = `${team.name} (${team.id}${team.isBot ? ", BOT" : ", HUMAN"})`
      if (slots < 11) shortLineups.push(`${label} slots=${slots}`)
      if (active < 11) shortActive.push(`${label} active=${active}`)
      if (eligible < 11) shortEligible.push(`${label} eligible=${eligible}`)
    }

    histogram("lineup slots per club", lineupSizes)
    histogram("eligible players per club", eligibleSizes)
    console.info(`\n  clubs with FEWER THAN 11 LINEUP SLOTS: ${shortLineups.length}`)
    for (const line of shortLineups.slice(0, 10)) console.info(`    ${line}`)
    console.info(`  clubs with FEWER THAN 11 ACTIVE players: ${shortActive.length}`)
    for (const line of shortActive.slice(0, 10)) console.info(`    ${line}`)
    console.info(`  clubs with FEWER THAN 11 ELIGIBLE players: ${shortEligible.length}`)
    for (const line of shortEligible.slice(0, 10)) console.info(`    ${line}`)

    console.info("\n--- 8. CONSEQUENCE LEDGER ---")
    const played = await prisma.fixture.count({ where: { playedAt: { not: null } } })
    console.info(`  played fixtures: ${played}`)
    if (!hasLedger) {
      console.info("  consequence ledger: column not present yet - this is the pre-migration baseline")
    } else {
      const [{ applied, outstanding }] = await prisma.$queryRaw<{ applied: bigint; outstanding: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE "consequencesAppliedAt" IS NOT NULL) AS applied,
               COUNT(*) FILTER (WHERE "playedAt" IS NOT NULL AND "consequencesAppliedAt" IS NULL) AS outstanding
        FROM "Fixture"
      `
      console.info(`  consequences applied: ${applied}`)
      console.info(`  outstanding (played, not yet applied): ${outstanding}`)
    }

    console.info("\nPLAYER AVAILABILITY AUDIT: REPORTED")
  } catch (error) {
    console.error("prod:players:availability-audit failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
