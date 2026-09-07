import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { TeamLeaveError, leaveManagedTeam } from "@/lib/teams/leave"

/**
 * The signed-in manager leaves their own club - never any other.
 *
 * The user id always comes from the session, never from the request body, so
 * there is nothing here a client can point at someone else's club. This route
 * owns NO business logic: it authenticates, delegates to the one canonical
 * service, and maps that service's stable reasons onto status codes. The
 * transition, its locking and its guards all live in src/lib/teams/leave.ts.
 */
const STATUS_BY_REASON: Record<string, number> = {
  NO_TEAM: 404,
  NOT_MANAGER: 409,
  ALREADY_BOT: 409,
  ERA_MISMATCH: 409,
  MATCH_LIVE: 409,
}

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  try {
    const result = await leaveManagedTeam(session.user.id)
    return NextResponse.json({ teamId: result.teamId, leftAt: result.at.toISOString() })
  } catch (error) {
    if (error instanceof TeamLeaveError) {
      // Stable codes, translated client-side - the same contract /api/register
      // already uses, rather than a sentence the UI has to match on.
      return NextResponse.json({ error: error.reason }, { status: STATUS_BY_REASON[error.reason] ?? 409 })
    }
    throw error
  }
}
