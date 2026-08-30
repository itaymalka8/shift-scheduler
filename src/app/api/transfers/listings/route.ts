import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { createTransferListing } from "@/lib/transfers/listing"
import { handleTransferApiError, invalidRequestResponse, parseJsonBody } from "@/lib/transfers/http"

/**
 * Handles a create-listing request for an already-resolved, trusted
 * teamId. Only checks that `playerId` and `askingPrice` have the right
 * JSON shape (a non-empty string, a number) - the actual business rule for
 * a valid askingPrice (positive integer, within Prisma's Int range) lives
 * exclusively in createTransferListing, not duplicated here. Never reads
 * sellingTeamId, windowId, expiresAt, status, or careerStatus from `body` -
 * those are entirely server-derived.
 */
export async function handleCreateListingRequest(teamId: string, body: unknown): Promise<NextResponse> {
  if (typeof body !== "object" || body === null) {
    return invalidRequestResponse()
  }
  const { playerId, askingPrice } = body as Record<string, unknown>
  if (typeof playerId !== "string" || playerId.length === 0) {
    return invalidRequestResponse()
  }
  if (typeof askingPrice !== "number") {
    return invalidRequestResponse()
  }

  try {
    const listing = await createTransferListing({ teamId, playerId, askingPrice })
    return NextResponse.json(
      {
        listingId: listing.id,
        playerId: listing.playerId,
        askingPrice: listing.askingPrice,
        expiresAt: listing.expiresAt,
        // createTransferListing only ever returns successfully for a
        // freshly-created OPEN listing - no extra read needed to know this.
        status: "OPEN",
      },
      { status: 201 }
    )
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
  return handleCreateListingRequest(team.id, body)
}
