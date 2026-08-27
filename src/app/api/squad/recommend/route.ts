import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_FORMATION, isFormationId } from "@/lib/players/formations"
import { computeRecommendedLineup } from "@/lib/players/recommend"

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) {
    return NextResponse.json({ error: "NO_TEAM" }, { status: 404 })
  }

  const formation = isFormationId(team.formation) ? team.formation : DEFAULT_FORMATION
  const players = await prisma.player.findMany({ where: { teamId: team.id } })
  const candidates = players.map((p) => ({
    id: p.id,
    position: p.position,
    rating: p.rating,
    fitness: p.fitness,
    availability: p.availability,
  }))

  const assignments = computeRecommendedLineup(formation, candidates)

  await prisma.$transaction([
    prisma.lineupSlot.deleteMany({ where: { teamId: team.id } }),
    prisma.lineupSlot.createMany({
      data: assignments.map((a) => ({ teamId: team.id, playerId: a.playerId, slotIndex: a.slotIndex })),
    }),
  ])

  return NextResponse.json({ formation, assignments })
}
