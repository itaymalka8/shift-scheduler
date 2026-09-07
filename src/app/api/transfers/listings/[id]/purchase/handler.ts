import { NextResponse } from "next/server"
import { purchaseTransferListing } from "@/lib/transfers/purchase"
import { handleTransferApiError } from "@/lib/transfers/http"

/**
 * Handles a purchase request for an already-resolved, trusted buyingTeamId
 * and a listingId taken only from the URL. Deliberately takes no `body`
 * parameter - purchaseTransferListing's price is always listing.askingPrice
 * read fresh from the database, so there is nothing a request body could
 * legitimately contribute, and route.ts's POST never even parses one. No
 * askingPrice, buyingTeamId, sellingTeamId, or playerId can reach this
 * function from the client in any form. Kept out of route.ts (which may
 * only export HTTP method handlers and route segment config, per Next.js's
 * route-file type constraints) so it can be exercised directly in tests.
 */
export async function handlePurchaseRequest(buyingTeamId: string, listingId: string): Promise<NextResponse> {
  try {
    const result = await purchaseTransferListing({ buyingTeamId, listingId })
    return NextResponse.json({ success: true, listingId: result.listingId, playerId: result.playerId }, { status: 200 })
  } catch (error) {
    return handleTransferApiError(error)
  }
}
