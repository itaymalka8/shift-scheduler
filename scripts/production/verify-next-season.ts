/**
 * READ ONLY verification that a season roll left the league in a state the
 * next season can actually be played from. SELECTs only - it never
 * replenishes, never repairs a lineup, never advances a stage.
 *
 * IT ASKS THE SAME QUESTION THE ORCHESTRATOR'S GATE ASKS, through the same
 * verdict: judgeTeamRoster in src/lib/seasons/roster-invariant.ts. Only the
 * READ differs, and it has to - the gate reads through the app's own client,
 * this reads through the read-only production client, and those can never be
 * the same object. Everything downstream of the read is shared, so a club this
 * script calls ready and the gate calls unready is impossible.
 *
 * It runs before the first roll too, and says so plainly: on a league that has
 * never rolled, every club correctly reports "no SquadReplenishment ledger
 * row", which is the right answer, not a failure of the deploy.
 *
 * Run with: npm run prod:season:next-verify
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { countRoster } from "../../src/lib/players/roster-floor"
import { validateLineup, isSelectable, type LineupStarter } from "../../src/lib/players/availability"
import { FORMATIONS, DEFAULT_FORMATION, isFormationId, resolveFormationSlots } from "../../src/lib/players/formations"
import { judgeTeamRoster, type RosterInvariantFailure } from "../../src/lib/seasons/roster-invariant"

function slotCountFor(team: { formation: string | null; customFormation: unknown }): number {
  const slots = resolveFormationSlots(team.formation, team.customFormation)
  if (slots.length > 0) return slots.length
  return FORMATIONS[isFormationId(team.formation) ? team.formation : DEFAULT_FORMATION].length
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
  printProductionBanner("prod:season:next-verify", target)

  try {
    // ------------------------------------------------------------------
    // 1. The seasons themselves.
    // ------------------------------------------------------------------
    const seasons = await prisma.season.findMany({
      orderBy: { number: "asc" },
      select: { id: true, number: true, countryCode: true, status: true, offseasonStage: true },
    })
    console.info("--- 1. SEASONS ---")
    for (const season of seasons) {
      console.info(`  season ${season.number} (${season.countryCode}): status=${season.status} stage=${season.offseasonStage}`)
    }
    const active = seasons.filter((season) => season.status === "ACTIVE")
    console.info(`  ACTIVE seasons: ${active.length}`)
    if (active.length !== 1) {
      console.info("  NOTE: exactly one ACTIVE season is the healthy shape; anything else is for a human to look at")
    }

    const current = active[0] ?? seasons.at(-1)
    if (!current) {
      console.info("\nNEXT SEASON VERIFICATION: no seasons exist yet - nothing to verify")
      return
    }
    console.info(`\n  judging season ${current.number} (${current.id})`)

    // ------------------------------------------------------------------
    // 2. The clubs in that season, and the ledger for it.
    // ------------------------------------------------------------------
    const memberships = await prisma.divisionTeam.findMany({
      where: { division: { seasonId: current.id } },
      select: { teamId: true },
      orderBy: { teamId: "asc" },
    })
    const teamIds = [...new Set(memberships.map((row) => row.teamId))]

    // The ledger table only exists after the Phase 3N migration; read it
    // defensively so this script is usable on both sides of the deploy.
    const ledgerTable = await prisma.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'SquadReplenishment'
      ) AS present
    `
    const hasLedger = ledgerTable[0]?.present === true
    const ledger = new Set<string>()
    const ledgerRows: { teamId: string; ownedBefore: number; generated: number; ownedAfter: number; floorAtRun: number }[] = []
    if (hasLedger) {
      const rows = await prisma.$queryRawUnsafe<typeof ledgerRows>(
        `SELECT "teamId", "ownedBefore", "generated", "ownedAfter", "floorAtRun"
         FROM "SquadReplenishment" WHERE "seasonId" = $1`,
        current.id
      )
      for (const row of rows) {
        ledger.add(row.teamId)
        ledgerRows.push(row)
      }
    }

    console.info("\n--- 2. THE REPLENISHMENT LEDGER ---")
    if (!hasLedger) {
      console.info("  the SquadReplenishment table does not exist here yet - pre-migration database")
    } else {
      console.info(`  clubs in the season: ${teamIds.length}`)
      console.info(`  ledger rows for it:  ${ledgerRows.length}`)
      const badArithmetic = ledgerRows.filter((row) => row.ownedBefore + row.generated !== row.ownedAfter)
      console.info(`  rows whose arithmetic does not balance: ${badArithmetic.length}`)
      for (const row of badArithmetic.slice(0, 5)) {
        console.info(`    ${row.teamId}: ${row.ownedBefore} + ${row.generated} != ${row.ownedAfter}`)
      }
      const generated = ledgerRows.reduce((sum, row) => sum + row.generated, 0)
      console.info(`  players generated across the season: ${generated}`)
    }

    // ------------------------------------------------------------------
    // 3. Every club, judged by the shared verdict.
    // ------------------------------------------------------------------
    const players = await prisma.player.findMany({
      where: { teamId: { in: teamIds } },
      select: {
        id: true,
        teamId: true,
        primaryPosition: true,
        secondaryPositions: true,
        overall: true,
        fitness: true,
        careerStatus: true,
        injuryMatchesRemaining: true,
        suspensionMatches: true,
      },
    })
    const teams = await prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, name: true, isBot: true, formation: true, customFormation: true },
    })
    const slots = await prisma.lineupSlot.findMany({
      where: { teamId: { in: teamIds } },
      select: { teamId: true, slotIndex: true, playerId: true },
    })

    const squadOf = new Map<string, typeof players>()
    for (const player of players) {
      if (!player.teamId) continue
      const bucket = squadOf.get(player.teamId)
      if (bucket) bucket.push(player)
      else squadOf.set(player.teamId, [player])
    }
    const byId = new Map(players.map((player) => [player.id, player]))
    const slotsOf = new Map<string, typeof slots>()
    for (const slot of slots) {
      const bucket = slotsOf.get(slot.teamId)
      if (bucket) bucket.push(slot)
      else slotsOf.set(slot.teamId, [slot])
    }

    const failures: RosterInvariantFailure[] = []
    const totals: number[] = []
    const keepers: number[] = []
    for (const team of teams) {
      const squad = (squadOf.get(team.id) ?? []).filter((player) => player.careerStatus === "ACTIVE")
      const counts = countRoster(squad)
      totals.push(counts.total)
      keepers.push(counts.GK)

      const slotCount = slotCountFor(team)
      const starters: LineupStarter[] = (slotsOf.get(team.id) ?? []).flatMap((slot) => {
        const player = byId.get(slot.playerId)
        return player
          ? [
              {
                playerId: player.id,
                teamId: player.teamId,
                slotIndex: slot.slotIndex,
                careerStatus: player.careerStatus,
                injuryMatchesRemaining: player.injuryMatchesRemaining,
                suspensionMatches: player.suspensionMatches,
              },
            ]
          : []
      })
      const legality = validateLineup(team.id, slotCount, starters)

      const failure = judgeTeamRoster({
        teamId: team.id,
        replenished: ledger.has(team.id),
        counts,
        lineup: {
          legal: legality.legal,
          starters: starters.length,
          slotCount,
          problems: legality.problems,
        },
      })
      if (failure) failures.push(failure)
    }

    const labelOf = new Map(teams.map((team) => [team.id, `${team.name} (${team.id}${team.isBot ? ", BOT" : ", HUMAN"})`]))
    console.info("\n--- 3. EVERY CLUB, JUDGED BY THE GATE'S OWN VERDICT ---")
    console.info(`  clubs checked: ${teams.length}`)
    console.info(`  clubs ready:   ${teams.length - failures.length}`)
    console.info(`  clubs NOT ready: ${failures.length}`)
    for (const failure of failures.slice(0, 20)) {
      console.info(`    ${labelOf.get(failure.teamId) ?? failure.teamId}: ${failure.reason}`)
    }
    if (failures.length > 20) console.info(`    ... and ${failures.length - 20} more`)

    const range = (values: number[]) =>
      values.length === 0 ? "none" : `min=${Math.min(...values)} max=${Math.max(...values)}`
    console.info(`  ACTIVE owned players per club: ${range(totals)}`)
    console.info(`  goalkeepers per club:          ${range(keepers)}`)

    // ------------------------------------------------------------------
    // 4. Is there anything to play? A season with no fixtures is not ready
    //    however healthy its squads are.
    // ------------------------------------------------------------------
    const fixtures = await prisma.fixture.count({ where: { division: { seasonId: current.id } } })
    const eligiblePlayers = players.filter((player) => isSelectable(player)).length
    console.info("\n--- 4. THE SEASON ITSELF ---")
    console.info(`  fixtures in season ${current.number}: ${fixtures}`)
    console.info(`  selectable players across its clubs: ${eligiblePlayers}`)

    const ready = failures.length === 0 && fixtures > 0 && active.length === 1
    console.info(`\nNEXT SEASON VERIFICATION: ${ready ? "READY" : "NOT READY"}`)
    if (!ready) process.exitCode = 1
  } catch (error) {
    console.error("prod:season:next-verify failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
