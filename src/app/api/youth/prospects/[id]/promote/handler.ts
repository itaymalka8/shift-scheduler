import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getActiveRosterCount, MAX_ACTIVE_ROSTER_SIZE } from "@/lib/players/roster"
import { promoteYouthProspectAsManager } from "@/lib/youth/promote"
import { handleYouthApiError } from "@/lib/youth/http"

/**
 * Handles a promotion request for an already-resolved, trusted teamId and a
 * prospectId taken only from the URL. Deliberately takes no request body -
 * there is nothing for a client to legitimately supply here (not even
 * which team: that comes from the session, never the request). Kept out of
 * route.ts so it can be exercised directly in tests without mocking
 * next-auth.
 */
export async function handlePromoteRequest(teamId: string, prospectId: string): Promise<NextResponse> {
  try {
    const result = await promoteYouthProspectAsManager({ teamId, prospectId })

    const player = await prisma.player.findUniqueOrThrow({
      where: { id: result.playerId },
      select: { id: true, firstName: true, lastName: true, age: true, primaryPosition: true, overall: true, potential: true, shirtNumber: true },
    })
    const activeCount = await getActiveRosterCount(prisma, teamId)

    return NextResponse.json(
      {
        promotedPlayer: {
          id: player.id,
          name: `${player.firstName} ${player.lastName}`,
          age: player.age,
          position: player.primaryPosition,
          overall: player.overall,
          potential: player.potential,
          shirtNumber: player.shirtNumber,
        },
        intake: { promotedCount: result.promotedCount, status: result.intakeClosed ? "CLOSED" : "OPEN" },
        roster: { activeCount, availableSlots: Math.max(0, MAX_ACTIVE_ROSTER_SIZE - activeCount) },
      },
      { status: 200 }
    )
  } catch (error) {
    return handleYouthApiError(error)
  }
}
