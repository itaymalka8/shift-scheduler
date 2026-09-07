import { NextResponse } from "next/server"
import { finalizeYouthIntake } from "@/lib/youth/intake"
import { handleYouthApiError } from "@/lib/youth/http"

/**
 * Handles a finalize request for an already-resolved, trusted teamId and an
 * intakeId taken only from the URL. No request body - finalize is a pure
 * "I'm done" signal with nothing else for a client to supply. Kept out of
 * route.ts so it can be exercised directly in tests without mocking
 * next-auth.
 */
export async function handleFinalizeRequest(teamId: string, intakeId: string): Promise<NextResponse> {
  try {
    const result = await finalizeYouthIntake({ teamId, intakeId })
    return NextResponse.json(
      { intakeId: result.intakeId, status: result.status, promotedCount: result.promotedCount, alreadyClosed: result.alreadyClosed },
      { status: 200 }
    )
  } catch (error) {
    return handleYouthApiError(error)
  }
}
