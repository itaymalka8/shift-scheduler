import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isFormationId, isTacticStyle } from "@/lib/players/formations"

const STARTING_XI_SIZE = 11

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) {
    return NextResponse.json({ error: "NO_TEAM" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const formation = body?.formation
  const tacticStyle = body?.tacticStyle
  const slots = body?.slots

  if (!isFormationId(formation) || !isTacticStyle(tacticStyle) || !Array.isArray(slots)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }
  if (slots.length !== STARTING_XI_SIZE) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  const rawIds: unknown[] = slots.map((s: { playerId: unknown }) => s?.playerId)
  if (rawIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }
  const playerIds = rawIds as string[]
  if (new Set(playerIds).size !== STARTING_XI_SIZE) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  const players = await prisma.player.findMany({ where: { id: { in: playerIds }, teamId: team.id } })
  if (players.length !== STARTING_XI_SIZE) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.lineupSlot.deleteMany({ where: { teamId: team.id } })
    await tx.lineupSlot.createMany({
      data: slots.map((s: { playerId: string; x: number; y: number }) => ({
        teamId: team.id,
        playerId: s.playerId,
        x: clamp(Number(s.x) || 0, 0, 100),
        y: clamp(Number(s.y) || 0, 0, 100),
      })),
    })
    await tx.team.update({ where: { id: team.id }, data: { formation, tacticStyle } })
  })

  return NextResponse.json({ ok: true })
}
