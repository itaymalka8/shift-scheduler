import { prisma } from "@/lib/prisma"
import { extractPlayerAttributes } from "@/lib/players/attributes"
import { isPlayerPosition, type PlayerPosition } from "@/lib/players/positions"
import { readTeamTactics } from "@/lib/players/tactics"
import { resolveFormationSlots } from "@/lib/players/formations"
import { calculateTeamTotalQuality } from "@/lib/players/quality"
import { ensureStadiumForTeam } from "@/lib/stadium/actions"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { calculateAttendance } from "@/lib/stadium/attendance"
import type { MatchSnapshot, SnapshotPlayer, SnapshotTeam } from "./snapshot"

function toPosition(value: string): PlayerPosition {
  return isPlayerPosition(value) ? value : "CM"
}

export async function buildTeamSnapshot(teamId: string): Promise<SnapshotTeam> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { players: true, lineupSlots: true },
  })

  const slots = resolveFormationSlots(team.formation, team.customFormation)
  const slotByPlayerId = new Map(team.lineupSlots.map((s) => [s.playerId, s.slotIndex]))

  const toSnapshotPlayer = (p: (typeof team.players)[number]): SnapshotPlayer => {
    const slotIndex = slotByPlayerId.get(p.id) ?? null
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      primaryPosition: toPosition(p.primaryPosition),
      secondaryPositions: p.secondaryPositions.filter(isPlayerPosition),
      slotIndex,
      assignedRole: slotIndex != null ? (slots[slotIndex]?.role ?? null) : null,
      attributes: extractPlayerAttributes(p),
      overall: p.overall,
      fitness: p.fitness,
    }
  }

  const available = team.players.filter((p) => p.status === "available")
  const starters = available.filter((p) => slotByPlayerId.has(p.id)).map(toSnapshotPlayer)
  const bench = available.filter((p) => !slotByPlayerId.has(p.id)).map(toSnapshotPlayer)

  return {
    teamId: team.id,
    name: team.name,
    starters,
    bench,
    formationSlots: slots,
    tactics: readTeamTactics(team),
    captainId: team.captainId,
    penaltyTakerId: team.penaltyTakerId,
    freeKickTakerId: team.freeKickTakerId,
    cornerTakerId: team.cornerTakerId,
  }
}

/**
 * Freezes both teams exactly as they stand at kickoff. Everything the
 * engine needs comes from here and nothing else, so a squad or tactics
 * change made after kickoff can never retroactively rewrite a match - and
 * because it's built server-side from the database, a client can never
 * inject its own ratings, lineup, or result.
 */
export interface SnapshotOptions {
  /** True only for a championship decider - see MatchSnapshot.neutralVenue. */
  neutralVenue?: boolean
}

export async function buildMatchSnapshot(
  fixtureId: string,
  seed: string,
  options: SnapshotOptions = {}
): Promise<MatchSnapshot> {
  const fixture = await prisma.fixture.findUniqueOrThrow({ where: { id: fixtureId } })
  const [home, away] = await Promise.all([
    buildTeamSnapshot(fixture.homeTeamId),
    buildTeamSnapshot(fixture.awayTeamId),
  ])

  const homeTeam = await prisma.team.findUniqueOrThrow({ where: { id: fixture.homeTeamId } })
  const stadium = await ensureStadiumForTeam(fixture.homeTeamId, homeTeam.name)
  const seats = toSeatCounts(stadium)
  const capacity = calculateStadiumCapacity(seats)

  const homePlayers = await prisma.player.findMany({ where: { teamId: fixture.homeTeamId } })
  const attendance = calculateAttendance(
    { isHome: true },
    { teamTotalQuality: calculateTeamTotalQuality(homePlayers) },
    { seats }
  )

  return {
    fixtureId,
    seed,
    home,
    away,
    attendance: attendance.total,
    stadiumCapacity: capacity,
    fanType: homeTeam.crowdStyle === "ultras" ? "ultras" : "calm",
    // Absent/false for every league fixture, so their snapshots - and
    // therefore their simulations - are unchanged.
    neutralVenue: options.neutralVenue ?? false,
  }
}
