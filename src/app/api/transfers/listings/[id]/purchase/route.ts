import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { purchaseTransferListing } from "@/lib/transfers/purchase"
import { handleTransferApiError } from "@/lib/transfers/http"

/**
 * Handles a purchase request for an already-resolved, trusted buyingTeamId
 * and a listingId taken only from the URL. Deliberately takes no `body`
 * parameter - purchaseTransferListing's price is always listing.askingPrice
 * read fresh from the database, so there is nothing a request body could
 * legitimately contribute, and POST below never even parses one. No
 * askingPrice, buyingTeamId, sellingTeamId, or playerId can reach this
 * function from the client in any form.
 */
export async function handlePurchaseRequest(buyingTeamId: string, listingId: string): Promise<NextResponse> {
  try {
    const result = await purchaseTransferListing({ buyingTeamId, listingId })
    return NextResponse.json({ success: true, listingId: result.listingId, playerId: result.playerId }, { status: 200 })
  } catch (error) {
    return handleTransferApiError(error)
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) {
    return NextResponse.json({ error: "NO_TEAM" }, { status: 404 })
  }

  const { id } = await params
  return handlePurchaseRequest(team.id, id)
}
