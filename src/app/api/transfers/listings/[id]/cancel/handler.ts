import { NextResponse } from "next/server"
import { cancelTransferListing } from "@/lib/transfers/cancel-listing"
import { handleTransferApiError } from "@/lib/transfers/http"

/**
 * Handles a cancel-listing request for an already-resolved, trusted teamId
 * and a listingId taken only from the URL. Deliberately takes no `body`
 * parameter - there is nothing a request body could legitimately contribute
 * here (no askingPrice, sellingTeamId, or playerId is ever read from the
 * client), so route.ts's POST never even parses one. Kept out of route.ts
 * (which may only export HTTP method handlers and route segment config, per
 * Next.js's route-file type constraints) so it can be exercised directly in
 * tests.
 */
export async function handleCancelListingRequest(teamId: string, listingId: string): Promise<NextResponse> {
  try {
    const result = await cancelTransferListing({ teamId, listingId })
    return NextResponse.json(
      { success: true, listingId: result.listingId, alreadyCancelled: result.alreadyCancelled },
      { status: 200 }
    )
  } catch (error) {
    return handleTransferApiError(error)
  }
}
