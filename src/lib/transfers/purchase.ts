import { createFinancialTransaction } from "@/lib/economy/service"
import { InsufficientFundsError } from "@/lib/finance/balance"
import { TransferError } from "./errors"
import { runSerializableTransaction } from "./retry"
import { removePlayerFromSquad } from "./squad-cleanup"
import { ensureTransferWindowExists, getTransferWindowDefinition, isWithinTransferWindow } from "./window"

const MAX_ACTIVE_ROSTER_SIZE = 22

export interface PurchaseTransferListingInput {
  /**
   * The buying club's id. This service does no authentication of its own -
   * it trusts the caller to have already resolved this from a trusted layer
   * (the signed-in manager's session), never from a raw client-supplied
   * value. A future API route is what will do that resolution.
   */
  buyingTeamId: string
  listingId: string
  /** Injectable for tests; defaults to the real current time. */
  now?: Date
}

export interface PurchaseTransferListingResult {
  listingId: string
  playerId: string
  sellingTeamId: string
  buyingTeamId: string
  askingPrice: number
}

function referenceIdFor(listingId: string): string {
  return `PURCHASE_${listingId}`
}

/**
 * Buys an OPEN transfer listing at its frozen askingPrice - never a
 * client-supplied or expected price, the Listing row is the sole source of
 * truth for what this costs. Moves ownership from the seller to the buyer,
 * charges the buyer, credits the seller, and clears the player's lineup
 * slot and set-piece/captaincy roles on the selling side (shared with
 * Release via removePlayerFromSquad) - all in one Serializable transaction.
 *
 * `now` is read exactly once and threaded through the window guard and the
 * transaction's own expiry check.
 *
 * Idempotency does not rely on a separate flag: the Listing's own OPEN ->
 * SOLD transition is the single source of truth. Step 10's conditional
 * `updateMany({ where: { id, status: "OPEN" } })` can only ever flip a given
 * listing exactly once - a second concurrent purchase attempt updates zero
 * rows and is rejected with the listing's actual current state, never
 * treated as a duplicate success. That means by the time this function ever
 * reaches the ledger writes, it has already uniquely won the right to sell
 * this listing - the FinancialTransaction unique constraint on
 * (teamId, referenceId) is only a backstop that, by this design, should
 * never actually be hit in normal operation (same principle as Release).
 */
export async function purchaseTransferListing(input: PurchaseTransferListingInput): Promise<PurchaseTransferListingResult> {
  const now = input.now ?? new Date()

  const window = getTransferWindowDefinition(now)
  if (!isWithinTransferWindow(window, now)) {
    throw new TransferError("TRANSFER_WINDOW_CLOSED", `Transfer window ${window.weekKey} is not open at ${now.toISOString()}`)
  }
  await ensureTransferWindowExists(now)

  return runSerializableTransaction(async (tx) => {
    // 1. Read the listing plus its player.
    const listing = await tx.transferListing.findUnique({ where: { id: input.listingId }, include: { player: true } })
    if (!listing) {
      throw new TransferError("LISTING_NOT_FOUND", `No such listing: ${input.listingId}`)
    }

    // 2. Status must be OPEN to proceed at all.
    if (listing.status === "SOLD") {
      throw new TransferError("LISTING_ALREADY_SOLD", `Listing ${listing.id} is already SOLD`)
    }
    if (listing.status === "CANCELLED") {
      throw new TransferError("LISTING_CANCELLED", `Listing ${listing.id} was CANCELLED`)
    }
    if (listing.status === "EXPIRED") {
      throw new TransferError("LISTING_EXPIRED", `Listing ${listing.id} has EXPIRED`)
    }

    // 3. Still OPEN, but its own expiresAt may already have passed even
    // though the expiration processor hasn't synced it yet - block the
    // purchase without needing to update status here ourselves.
    if (listing.expiresAt.getTime() <= now.getTime()) {
      throw new TransferError("LISTING_EXPIRED", `Listing ${listing.id} expired at ${listing.expiresAt.toISOString()}`)
    }

    // 4. Can't buy your own listing.
    if (listing.sellingTeamId === input.buyingTeamId) {
      throw new TransferError("CANNOT_BUY_OWN_LISTING", `Team ${input.buyingTeamId} cannot buy its own listing ${listing.id}`)
    }

    const player = listing.player

    // 5. Player must still be career-ACTIVE.
    if (player.careerStatus !== "ACTIVE") {
      throw new TransferError("PLAYER_NOT_ACTIVE", `Player ${player.id} is not ACTIVE (${player.careerStatus})`)
    }

    // 6. Player must still actually belong to the selling team.
    if (player.teamId !== listing.sellingTeamId) {
      throw new TransferError("PLAYER_NOT_OWNED", `Player ${player.id} is no longer owned by selling team ${listing.sellingTeamId}`)
    }

    // 7. Buying team must exist - never let a missing team surface as a
    // raw Prisma error.
    const buyingTeam = await tx.team.findUnique({ where: { id: input.buyingTeamId }, select: { balance: true } })
    if (!buyingTeam) {
      throw new TransferError("BUYING_TEAM_NOT_FOUND", `No such team: ${input.buyingTeamId}`)
    }

    // 8. Roster cap - same transaction as the ownership transfer itself.
    const activeRosterCount = await tx.player.count({ where: { teamId: input.buyingTeamId, careerStatus: "ACTIVE" } })
    if (activeRosterCount >= MAX_ACTIVE_ROSTER_SIZE) {
      throw new TransferError("ROSTER_FULL", `Team ${input.buyingTeamId} already has ${activeRosterCount} active players`)
    }

    // 9. Price is listing.askingPrice - never a client-supplied or
    // expected price.
    if (buyingTeam.balance < listing.askingPrice) {
      throw new TransferError(
        "INSUFFICIENT_FUNDS",
        `Team ${input.buyingTeamId} balance ${buyingTeam.balance} is insufficient for asking price ${listing.askingPrice}`
      )
    }

    // 10. Atomically close the listing - only ever succeeds for one
    // concurrent winner. Never guess on a mismatch: re-read and report the
    // listing's actual current state.
    const closed = await tx.transferListing.updateMany({
      where: { id: listing.id, status: "OPEN" },
      data: { status: "SOLD" },
    })
    if (closed.count !== 1) {
      const fresh = await tx.transferListing.findUnique({ where: { id: listing.id } })
      if (!fresh) throw new TransferError("LISTING_NOT_FOUND", `Listing ${listing.id} vanished mid-purchase`)
      if (fresh.status === "SOLD") throw new TransferError("LISTING_ALREADY_SOLD", `Listing ${listing.id} was sold concurrently`)
      if (fresh.status === "CANCELLED") throw new TransferError("LISTING_CANCELLED", `Listing ${listing.id} was cancelled concurrently`)
      if (fresh.status === "EXPIRED") throw new TransferError("LISTING_EXPIRED", `Listing ${listing.id} expired concurrently`)
      throw new TransferError("TRANSFER_CONFLICT", `Listing ${listing.id} could not be closed for an unexpected reason`)
    }

    const referenceId = referenceIdFor(listing.id)

    // 11. Charge the buyer. If this ever returns null (its own insert hit
    // the ledger's unique constraint) - something step 10 should already
    // have made impossible - abort loudly instead of continuing on this tx.
    let debit: Awaited<ReturnType<typeof createFinancialTransaction>>
    try {
      debit = await createFinancialTransaction(tx, {
        teamId: input.buyingTeamId,
        type: "transferPurchase",
        amount: -listing.askingPrice,
        description: `Purchase: ${player.firstName} ${player.lastName}`,
        referenceId,
        allowNegative: false,
      })
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new TransferError("INSUFFICIENT_FUNDS", error.message)
      }
      throw error
    }
    if (!debit) {
      throw new TransferError("TRANSFER_CONFLICT", `Unexpected duplicate purchase debit for listing ${listing.id}`)
    }

    // 12. Credit the seller.
    const credit = await createFinancialTransaction(tx, {
      teamId: listing.sellingTeamId,
      type: "transferSale",
      amount: listing.askingPrice,
      description: `Sale: ${player.firstName} ${player.lastName}`,
      referenceId,
    })
    if (!credit) {
      throw new TransferError("TRANSFER_CONFLICT", `Unexpected duplicate purchase credit for listing ${listing.id}`)
    }

    // 13. Clear the player's lineup slot and set-piece/captaincy roles on
    // the selling side - the same cleanup Release does, since the player is
    // leaving that team's active squad either way.
    const sellingTeam = await tx.team.findUniqueOrThrow({
      where: { id: listing.sellingTeamId },
      select: { captainId: true, penaltyTakerId: true, freeKickTakerId: true, cornerTakerId: true },
    })
    await removePlayerFromSquad(tx, listing.sellingTeamId, player.id, sellingTeam)

    // 14. Transfer ownership. stintNumber advances - this is a new
    // ownership episode starting, unlike Release which only ends one.
    await tx.player.update({
      where: { id: player.id },
      data: { teamId: input.buyingTeamId, stintNumber: { increment: 1 } },
    })

    return {
      listingId: listing.id,
      playerId: player.id,
      sellingTeamId: listing.sellingTeamId,
      buyingTeamId: input.buyingTeamId,
      askingPrice: listing.askingPrice,
    }
  })
}
