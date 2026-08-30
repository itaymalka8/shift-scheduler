import { NextResponse } from "next/server"
import { releasePlayer } from "@/lib/transfers/release"
import { handleTransferApiError, invalidRequestResponse } from "@/lib/transfers/http"

/**
 * Handles a release request for an already-resolved, trusted teamId - the
 * only teamId this ever uses is the one the caller passed in, never
 * anything read from `body`. Kept out of route.ts (which may only export
 * HTTP method handlers and route segment config, per Next.js's route-file
 * type constraints) so it can be exercised directly in tests with a real
 * (test-created) team and a real Prisma-backed releasePlayer call, without
 * needing to fake next-auth's getServerSession - production traffic always
 * goes through route.ts's POST, which is what actually calls getServerSession.
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
