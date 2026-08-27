import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isFormationId } from "@/lib/players/formations"
import { isMentality, isTempo, isPressing, isWidth } from "@/lib/players/tactics"
import { computeRecommendedLineup } from "@/lib/players/recommend"

async function getOwnTeam(userId: string) {
  return prisma.team.findUnique({ where: { userId } })
}

async function loadCandidates(teamId: string) {
  const players = await prisma.player.findMany({ where: { teamId } })
  return players.map((p) => ({
    id: p.id,
    position: p.position,
    rating: p.rating,
    fitness: p.fitness,
    availability: p.availability,
  }))
}

async function currentState(teamId: string) {
  const [team, slots] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId } }),
    prisma.lineupSlot.findMany({ where: { teamId } }),
  ])
  return {
    formation: team?.formation ?? null,
    mentality: team?.mentality ?? null,
    tempo: team?.tempo ?? null,
    pressing: team?.pressing ?? null,
    width: team?.width ?? null,
    captainId: team?.captainId ?? null,
    penaltyTakerId: team?.penaltyTakerId ?? null,
    freeKickTakerId: team?.freeKickTakerId ?? null,
    cornerTakerId: team?.cornerTakerId ?? null,
    assignments: slots.map((s) => ({ slotIndex: s.slotIndex, playerId: s.playerId })),
  }
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const team = await getOwnTeam(session.user.id)
  if (!team) {
    return NextResponse.json({ error: "NO_TEAM" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  const playerIds = new Set((await prisma.player.findMany({ where: { teamId: team.id }, select: { id: true } })).map((p) => p.id))

  function isOwnPlayerOrNull(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && playerIds.has(value))
  }

  try {
    await prisma.$transaction(async (tx) => {
    // Formation change: re-derive the whole lineup, preferring current starters.
    if (body.formation !== undefined) {
      if (!isFormationId(body.formation)) throw new Error("VALIDATION_ERROR")
      const existingSlots = await tx.lineupSlot.findMany({ where: { teamId: team.id } })
      const preferredIds = new Set(existingSlots.map((s) => s.playerId))
      const candidates = await loadCandidates(team.id)
      const assignments = computeRecommendedLineup(body.formation, candidates, preferredIds)

      await tx.lineupSlot.deleteMany({ where: { teamId: team.id } })
      await tx.lineupSlot.createMany({
        data: assignments.map((a) => ({ teamId: team.id, playerId: a.playerId, slotIndex: a.slotIndex })),
      })
      await tx.team.update({ where: { id: team.id }, data: { formation: body.formation } })
    }

    // Individual slot assignments (bench<->pitch), independent of a formation change.
    if (Array.isArray(body.assignments)) {
      for (const entry of body.assignments) {
        const slotIndex = Number(entry?.slotIndex)
        const playerId = entry?.playerId
        if (!Number.isInteger(slotIndex)) throw new Error("VALIDATION_ERROR")
        if (!isOwnPlayerOrNull(playerId)) throw new Error("VALIDATION_ERROR")

        await tx.lineupSlot.deleteMany({ where: { teamId: team.id, slotIndex } })
        if (playerId) {
          await tx.lineupSlot.deleteMany({ where: { teamId: team.id, playerId } })
          await tx.lineupSlot.create({ data: { teamId: team.id, playerId, slotIndex } })
        }
      }
    }

    const tacticsUpdate: Record<string, string> = {}
    if (body.mentality !== undefined) {
      if (!isMentality(body.mentality)) throw new Error("VALIDATION_ERROR")
      tacticsUpdate.mentality = body.mentality
    }
    if (body.tempo !== undefined) {
      if (!isTempo(body.tempo)) throw new Error("VALIDATION_ERROR")
      tacticsUpdate.tempo = body.tempo
    }
    if (body.pressing !== undefined) {
      if (!isPressing(body.pressing)) throw new Error("VALIDATION_ERROR")
      tacticsUpdate.pressing = body.pressing
    }
    if (body.width !== undefined) {
      if (!isWidth(body.width)) throw new Error("VALIDATION_ERROR")
      tacticsUpdate.width = body.width
    }

    const rolesUpdate: Record<string, string | null> = {}
    for (const field of ["captainId", "penaltyTakerId", "freeKickTakerId", "cornerTakerId"] as const) {
      if (body[field] !== undefined) {
        if (!isOwnPlayerOrNull(body[field])) throw new Error("VALIDATION_ERROR")
        rolesUpdate[field] = body[field]
      }
    }

    if (Object.keys(tacticsUpdate).length > 0 || Object.keys(rolesUpdate).length > 0) {
      await tx.team.update({ where: { id: team.id }, data: { ...tacticsUpdate, ...rolesUpdate } })
    }
    })
  } catch (err) {
    if (err instanceof Error && err.message === "VALIDATION_ERROR") {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
    }
    throw err
  }

  return NextResponse.json(await currentState(team.id))
}
