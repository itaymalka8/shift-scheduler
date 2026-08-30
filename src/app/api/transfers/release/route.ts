import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { releasePlayer } from "@/lib/transfers/release"
import { handleTransferApiError, invalidRequestResponse, parseJsonBody } from "@/lib/transfers/http"

/**
 * Handles a release request for an already-resolved, trusted teamId - the
 * only teamId this ever uses is the one the caller passed in, never
 * anything read from `body`. Exported separately from POST so it can be
 * exercised directly in tests with a real (test-created) team and a real
 * Prisma-backed releasePlayer call, without needing to fake next-auth's
 * getServerSession - production traffic always goes through POST below,
 * which is what actually calls getServerSession.
 */
export async function handleReleaseRequest(teamId: string, body: unknown): Promise<NextResponse> {
  if (typeof body !== "object" || body === null) {
    return invalidRequestResponse()
  }
  const playerId = (body as Record<string, unknown>).playerId
  if (typeof playerId !== "string" || playerId.length === 0) {
    return invalidRequestResponse()
  }

  try {
    const result = await releasePlayer({ teamId, playerId })
    return NextResponse.json({ success: true, alreadyProcessed: result.alreadyProcessed }, { status: 200 })
  } catch (error) {
    return handleTransferApiError(error)
  }
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

  const body = await parseJsonBody(request)
  return handleReleaseRequest(team.id, body)
}
