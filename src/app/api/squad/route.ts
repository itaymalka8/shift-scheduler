import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { FORMATIONS, isFormationId, CUSTOM_FORMATION_ID, parseCustomFormation, type FormationSlot } from "@/lib/players/formations"
import {
  isMentality,
  isTempo,
  isPressing,
  isWidth,
  isAttackingStyle,
  isDefensiveLine,
  isCreativeFreedom,
  isDribbleFrequency,
  isPassingType,
  isAttackDirection,
  isFullbackOverlaps,
} from "@/lib/players/tactics"
import { computeRecommendedLineup } from "@/lib/players/recommend"
import { isSelectable } from "@/lib/players/availability"

async function getOwnTeam(userId: string) {
  return prisma.team.findUnique({ where: { userId } })
}

async function loadCandidates(teamId: string) {
  const players = await prisma.player.findMany({ where: { teamId } })
  return players.map((p) => ({
    id: p.id,
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    overall: p.overall,
    fitness: p.fitness,
    status: p.status,
  }))
}

async function currentState(teamId: string) {
  const [team, slots] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId } }),
    prisma.lineupSlot.findMany({ where: { teamId } }),
  ])
  return {
    formation: team?.formation ?? null,
    customFormation: team?.customFormation ?? null,
    mentality: team?.mentality ?? null,
    tempo: team?.tempo ?? null,
    pressing: team?.pressing ?? null,
    width: team?.width ?? null,
    attackingStyle: team?.attackingStyle ?? null,
    defensiveLine: team?.defensiveLine ?? null,
    offsideTrap: team?.offsideTrap ?? false,
    creativeFreedom: team?.creativeFreedom ?? null,
    dribbleFrequency: team?.dribbleFrequency ?? null,
    passingType: team?.passingType ?? null,
    attackDirection: team?.attackDirection ?? null,
    fullbackOverlaps: team?.fullbackOverlaps ?? null,
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

  const ownedPlayers = await prisma.player.findMany({
    where: { teamId: team.id },
    select: { id: true, careerStatus: true, injuryMatchesRemaining: true, suspensionMatches: true },
  })
  const playerIds = new Set(ownedPlayers.map((p) => p.id))
  // WHO MAY ACTUALLY BE PICKED, from the canonical contract - not a local
  // reading of `status`. A manager must not be able to put an injured or
  // suspended player into a starting slot and have the pre-match repair
  // quietly undo it later; the mutation is refused at the door instead.
  const selectableIds = new Set(ownedPlayers.filter(isSelectable).map((p) => p.id))

  function isOwnPlayerOrNull(value: unknown): value is string | null {
    return value === null || (typeof value === "string" && playerIds.has(value))
  }

  try {
    await prisma.$transaction(async (tx) => {
    // Formation change: re-derive the whole lineup, preferring current starters.
    if (body.formation !== undefined) {
      let slots: FormationSlot[]
      if (body.formation === CUSTOM_FORMATION_ID) {
        const parsed = parseCustomFormation(body.customFormation)
        if (!parsed) throw new Error("VALIDATION_ERROR")
        slots = parsed
      } else {
        const formationId = body.formation
        if (!isFormationId(formationId)) throw new Error("VALIDATION_ERROR")
        slots = [...FORMATIONS[formationId]]
      }

      const existingSlots = await tx.lineupSlot.findMany({ where: { teamId: team.id } })
      const preferredIds = new Set(existingSlots.map((s) => s.playerId))
      const candidates = await loadCandidates(team.id)
      const assignments = computeRecommendedLineup(slots, candidates, preferredIds)

      await tx.lineupSlot.deleteMany({ where: { teamId: team.id } })
      await tx.lineupSlot.createMany({
        data: assignments.map((a) => ({ teamId: team.id, playerId: a.playerId, slotIndex: a.slotIndex })),
      })
      await tx.team.update({
        where: { id: team.id },
        data: {
          formation: body.formation,
          customFormation:
            body.formation === CUSTOM_FORMATION_ID
              ? (body.customFormation as Prisma.InputJsonValue)
              : Prisma.DbNull,
        },
      })
    }

    // Individual slot assignments (bench<->pitch), independent of a formation change.
    if (Array.isArray(body.assignments)) {
      for (const entry of body.assignments) {
        const slotIndex = Number(entry?.slotIndex)
        const playerId = entry?.playerId
        if (!Number.isInteger(slotIndex)) throw new Error("VALIDATION_ERROR")
        if (!isOwnPlayerOrNull(playerId)) throw new Error("VALIDATION_ERROR")
        // A stable, separate code: this is not malformed input, it is a
        // legal request the squad rules refuse, and the UI should say which.
        if (playerId && !selectableIds.has(playerId)) throw new Error("PLAYER_UNAVAILABLE")

        await tx.lineupSlot.deleteMany({ where: { teamId: team.id, slotIndex } })
        if (playerId) {
          await tx.lineupSlot.deleteMany({ where: { teamId: team.id, playerId } })
          await tx.lineupSlot.create({ data: { teamId: team.id, playerId, slotIndex } })
        }
      }
    }

    // Every tactical dial is validated against its own allowed values here -
    // the client can never write an unrecognized instruction into the row
    // the match engine later reads.
    const tacticsUpdate: Record<string, string | boolean> = {}
    const stringDials = [
      ["mentality", isMentality],
      ["tempo", isTempo],
      ["pressing", isPressing],
      ["width", isWidth],
      ["attackingStyle", isAttackingStyle],
      ["defensiveLine", isDefensiveLine],
      ["creativeFreedom", isCreativeFreedom],
      ["dribbleFrequency", isDribbleFrequency],
      ["passingType", isPassingType],
      ["attackDirection", isAttackDirection],
      ["fullbackOverlaps", isFullbackOverlaps],
    ] as const

    for (const [field, validate] of stringDials) {
      const value = body[field]
      if (value === undefined) continue
      if (typeof value !== "string" || !validate(value)) throw new Error("VALIDATION_ERROR")
      tacticsUpdate[field] = value
    }

    if (body.offsideTrap !== undefined) {
      if (typeof body.offsideTrap !== "boolean") throw new Error("VALIDATION_ERROR")
      tacticsUpdate.offsideTrap = body.offsideTrap
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
    // 409, not 400: the request is well formed, the squad rules just say no.
    if (err instanceof Error && err.message === "PLAYER_UNAVAILABLE") {
      return NextResponse.json({ error: "PLAYER_UNAVAILABLE" }, { status: 409 })
    }
    throw err
  }

  return NextResponse.json(await currentState(team.id))
}
