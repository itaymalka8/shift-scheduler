import { TransferError } from "./errors"
import { runSerializableTransaction } from "./retry"

export interface CancelTransferListingInput {
  listingId: string
  /**
   * The requesting club's id. This service does no authentication of its
   * own - it trusts the caller to have already resolved this from a trusted
   * layer (the signed-in manager's session), never from a raw
   * client-supplied value. The API route is what does that resolution.
   */
  teamId: string
  /** Injectable for tests; defaults to the real current time. */
  now?: Date
}

export interface CancelTransferListingResult {
  listingId: string
  alreadyCancelled: boolean
}

/**
 * Cancels an OPEN transfer listing on behalf of the selling club. Touches
 * only TransferListing.status - never the player, the team balance, a
 * FinancialTransaction, a LineupSlot, a set-piece/captaincy role, the
 * TransferWindow, askingPrice, or expiresAt. Idempotent: cancelling an
 * already-CANCELLED listing owned by the same team is a no-op success
 * (alreadyCancelled: true), not an error.
 *
 * A listing whose expiresAt has already passed but is still stored as OPEN
 * (the background expiration job hasn't synced it yet) is reported as
 * LISTING_EXPIRED and never flipped to CANCELLED here - syncing EXPIRED
 * status is exclusively that processor's job, same principle as
 * createTransferListing's own targeted-expire step never being duplicated
 * by this service.
 *
 * The close itself is a single conditional `updateMany({ where: { id,
 * sellingTeamId: teamId, status: "OPEN" } })`, the same pattern
 * purchaseTransferListing uses to close a listing exactly once under
 * concurrency - if it ever updates zero rows, the listing's fresh state is
 * re-read and reported precisely, never guessed, and never surfaced as a
 * raw Prisma error.
 */
export async function cancelTransferListing(input: CancelTransferListingInput): Promise<CancelTransferListingResult> {
  const now = input.now ?? new Date()

  return runSerializableTransaction(async (tx) => {
    const listing = await tx.transferListing.findUnique({ where: { id: input.listingId } })
    if (!listing) {
      throw new TransferError("LISTING_NOT_FOUND", `No such listing: ${input.listingId}`)
    }

    if (listing.sellingTeamId !== input.teamId) {
      throw new TransferError("LISTING_NOT_OWNED", `Listing ${listing.id} does not belong to team ${input.teamId}`)
    }

    if (listing.status === "CANCELLED") {
      return { listingId: listing.id, alreadyCancelled: true }
    }
    if (listing.status === "SOLD") {
      throw new TransferError("LISTING_ALREADY_SOLD", `Listing ${listing.id} is already SOLD`)
    }
    if (listing.status === "EXPIRED") {
      throw new TransferError("LISTING_EXPIRED", `Listing ${listing.id} has EXPIRED`)
    }

    // Still OPEN, but its own expiresAt may already have passed even though
    // the expiration processor hasn't synced it yet - report it without
    // writing anything (never CANCELLED, never EXPIRED - that's the
    // processor's own job).
    if (listing.expiresAt.getTime() <= now.getTime()) {
      throw new TransferError("LISTING_EXPIRED", `Listing ${listing.id} expired at ${listing.expiresAt.toISOString()}`)
    }

    // Conditioned on id + sellingTeamId + status OPEN - can only ever
    // succeed once. Never guess on a mismatch: re-read and report the
    // listing's actual current state.
    const closed = await tx.transferListing.updateMany({
      where: { id: listing.id, sellingTeamId: input.teamId, status: "OPEN" },
      data: { status: "CANCELLED" },
    })
    if (closed.count !== 1) {
      const fresh = await tx.transferListing.findUnique({ where: { id: listing.id } })
      if (!fresh) throw new TransferError("LISTING_NOT_FOUND", `Listing ${listing.id} vanished mid-cancel`)
      if (fresh.status === "CANCELLED") return { listingId: fresh.id, alreadyCancelled: true }
      if (fresh.status === "SOLD") throw new TransferError("LISTING_ALREADY_SOLD", `Listing ${listing.id} was sold concurrently`)
      if (fresh.status === "EXPIRED") throw new TransferError("LISTING_EXPIRED", `Listing ${listing.id} expired concurrently`)
      throw new TransferError("TRANSFER_CONFLICT", `Listing ${listing.id} could not be cancelled for an unexpected reason`)
    }

    return { listingId: listing.id, alreadyCancelled: false }
  })
}
