import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { DEFAULT_FORMATION, isFormationId, resolveFormationSlots, CUSTOM_FORMATION_ID } from "@/lib/players/formations"
import { computeRecommendedLineup } from "@/lib/players/recommend"
import { calculateTeamTotalQuality, calculateSquadMarketValue } from "@/lib/players/quality"
import { extractPlayerAttributes } from "@/lib/players/attributes"
import { SquadTacticsApp } from "./squad-tactics-app"

export default async function SquadPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  const formationSlots = resolveFormationSlots(team.formation, team.customFormation)
  // Self-heal: an unrecognized formation (and no valid custom layout) falls
  // back to the default rather than leaving the team on an invalid one.
  const formationIsValid = isFormationId(team.formation) || team.formation === CUSTOM_FORMATION_ID
  const formation = formationIsValid ? (team.formation as string) : DEFAULT_FORMATION
  if (team.formation !== formation) {
    await prisma.team.update({ where: { id: team.id }, data: { formation, customFormation: Prisma.DbNull } })
  }

  let lineupSlots = await prisma.lineupSlot.findMany({ where: { teamId: team.id } })
  const players = await prisma.player.findMany({ where: { teamId: team.id }, orderBy: { overall: "desc" } })

  // Self-heal: a team should never land on an empty pitch.
  if (lineupSlots.length === 0 && players.length > 0) {
    const assignments = computeRecommendedLineup(
      formationSlots,
      players.map((p) => ({
        id: p.id,
        primaryPosition: p.primaryPosition,
        secondaryPositions: p.secondaryPositions,
        overall: p.overall,
        fitness: p.fitness,
        status: p.status,
      }))
    )
    await prisma.lineupSlot.createMany({
      data: assignments.map((a) => ({ teamId: team.id, playerId: a.playerId, slotIndex: a.slotIndex })),
    })
    lineupSlots = await prisma.lineupSlot.findMany({ where: { teamId: team.id } })
  }

  const teamTotalQuality = calculateTeamTotalQuality(players)
  const squadMarketValue = calculateSquadMarketValue(players)
  const totalWeeklyPlayerSalaries = players.reduce((sum, p) => sum + p.weeklySalary, 0)

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <SquadTacticsApp
          players={players.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            primaryPosition: p.primaryPosition,
            secondaryPositions: p.secondaryPositions,
            age: p.age,
            overall: p.overall,
            potential: p.potential,
            fitness: p.fitness,
            status: p.status as "available" | "injured" | "suspended" | "unavailable",
            marketValue: p.marketValue,
            weeklySalary: p.weeklySalary,
            preferredFoot: p.preferredFoot as "left" | "right" | "both",
            nationality: p.nationality,
            shirtNumber: p.shirtNumber,
            attributes: extractPlayerAttributes(p),
          }))}
          initialAssignments={lineupSlots.map((s) => ({ slotIndex: s.slotIndex, playerId: s.playerId }))}
          initialFormation={formation}
          initialCustomFormation={
            formation === CUSTOM_FORMATION_ID ? (team.customFormation as { x: number; y: number }[] | null) : null
          }
          initialMentality={team.mentality ?? "balanced"}
          initialTempo={team.tempo ?? "normal"}
          initialPressing={team.pressing ?? "normal"}
          initialWidth={team.width ?? "balanced"}
          initialAttackingStyle={team.attackingStyle ?? "shortPassing"}
          initialDefensiveLine={team.defensiveLine ?? "normal"}
          initialOffsideTrap={team.offsideTrap ?? false}
          initialCreativeFreedom={team.creativeFreedom ?? "balanced"}
          initialDribbleFrequency={team.dribbleFrequency ?? "balanced"}
          initialPassingType={team.passingType ?? "mixed"}
          initialAttackDirection={team.attackDirection ?? "balanced"}
          initialFullbackOverlaps={team.fullbackOverlaps ?? "normal"}
          initialCaptainId={team.captainId}
          initialPenaltyTakerId={team.penaltyTakerId}
          initialFreeKickTakerId={team.freeKickTakerId}
          initialCornerTakerId={team.cornerTakerId}
          accentColor={team.crestColor ?? "#3B2F7A"}
          teamTotalQuality={teamTotalQuality}
          squadMarketValue={squadMarketValue}
          totalWeeklyPlayerSalaries={totalWeeklyPlayerSalaries}
        />
      </main>
    </div>
  )
}
