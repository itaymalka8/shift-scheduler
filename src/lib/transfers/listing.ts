import { Prisma } from "@/generated/prisma"
import { TransferError } from "./errors"
import { runSerializableTransaction } from "./retry"
import { ensureTransferWindowExists, getTransferWindowDefinition, isWithinTransferWindow } from "./window"
import { lockPlayerRow } from "@/lib/players/locks"

// The largest value Prisma's `Int` column type can hold (signed 32-bit).
const PRISMA_INT_MAX = 2_147_483_647

function isValidAskingPrice(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= PRISMA_INT_MAX
}

export interface CreateTransferListingInput {
  /**
   * The selling club's id. This service does no authentication of its own -
   * it trusts the caller to have already resolved this from a trusted layer
   * (the signed-in manager's session), never from a raw client-supplied
   * value. A future API route is what will do that resolution.
   */
  teamId: string
  playerId: string
  askingPrice: number
  /** Injectable for tests; defaults to the real current time. */
  now?: Date
}

export interface CreateTransferListingResult {
  id: string
  playerId: string
  sellingTeamId: string
  askingPrice: number
  windowId: string
  expiresAt: Date
}

/**
 * Lists a player for transfer. askingPrice is frozen at creation - there is
 * no price-edit path here. Never touches the player itself (still eligible
 * for the lineup, captaincy, set-piece roles - being listed doesn't change
 * ownership) and never moves money.
 *
 * `now` is read exactly once and threaded through every check (the window
 * guard and the transaction's own expiry/creation logic) so a single call
 * can never straddle two different instants.
 */
export async function createTransferListing(input: CreateTransferListingInput): Promise<CreateTransferListingResult> {
  const now = input.now ?? new Date()

  if (!isValidAskingPrice(input.askingPrice)) {
    throw new TransferError(
      "INVALID_ASKING_PRICE",
      `askingPrice must be a positive integer within Prisma's Int range, got ${input.askingPrice}`
    )
  }

  // Window guard - pure, no DB - before any write is even considered.
  const window = getTransferWindowDefinition(now)
  if (!isWithinTransferWindow(window, now)) {
    throw new TransferError("TRANSFER_WINDOW_CLOSED", `Transfer window ${window.weekKey} is not open at ${now.toISOString()}`)
  }

  // Only once we know the window is open do we touch the DB at all.
  const windowRow = await ensureTransferWindowExists(now)

  try {
    return await runSerializableTransaction(async (tx) => {
      // 0. Player row lock FIRST, before the listing rows below - the same
      // lock Retirement takes first, so a concurrent retirement can never
      // interleave between this player read and the listing insert (which
      // would leave a RETIRED player carrying an OPEN listing). See
      // lockPlayerRow for the ordering contract.
      const locked = await lockPlayerRow(tx, input.playerId)
      if (!locked) {
        throw new TransferError("PLAYER_NOT_OWNED", `Player ${input.playerId} is not owned by team ${input.teamId}`)
      }

      // 1. Re-read the player inside this transaction, under the lock.
      const player = await tx.player.findUnique({ where: { id: input.playerId } })
      if (!player || player.teamId !== input.teamId) {
        throw new TransferError("PLAYER_NOT_OWNED", `Player ${input.playerId} is not owned by team ${input.teamId}`)
      }

      // 2. Career-lifecycle check.
      if (player.careerStatus !== "ACTIVE") {
        throw new TransferError("PLAYER_NOT_ACTIVE", `Player ${player.id} is not ACTIVE (${player.careerStatus})`)
      }

      // 3. Targeted expire - only this player's own OPEN-but-overdue
      // listing(s), never a global sweep of the market.
      await tx.transferListing.updateMany({
        where: { playerId: player.id, status: "OPEN", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      })

      // 4. After that expire, is there still an OPEN listing for this
      // player? If so, reject - never touch it, never change its price.
      const stillOpen = await tx.transferListing.findFirst({ where: { playerId: player.id, status: "OPEN" } })
      if (stillOpen) {
        throw new TransferError("LISTING_ALREADY_EXISTS", `Player ${player.id} already has an OPEN listing`)
      }

      // 5. Create the new listing. askingPrice is frozen here - no edit
      // path exists. Player itself is not touched anywhere in this
      // function (no teamId/careerStatus/stintNumber/LineupSlot/roles/
      // balance/FinancialTransaction writes).
      const listing = await tx.transferListing.create({
        data: {
          playerId: player.id,
          sellingTeamId: input.teamId,
          askingPrice: input.askingPrice,
          windowId: windowRow.id,
          expiresAt: windowRow.closesAt,
        },
      })

      return {
        id: listing.id,
        playerId: listing.playerId,
        sellingTeamId: listing.sellingTeamId,
        askingPrice: listing.askingPrice,
        windowId: listing.windowId,
        expiresAt: listing.expiresAt,
      }
    })
  } catch (error) {
    // Never caught inside the transaction, never continued on the same tx -
    // the whole transaction already failed and rolled back by the time this
    // runs. Only map to LISTING_ALREADY_EXISTS when the P2002 is
    // unambiguously the raw partial unique index on TransferListing.playerId
    // (empirically confirmed: Prisma reports
    // `{ modelName: "TransferListing", target: ["playerId"] }` for it, even
    // though that index has no schema.prisma representation). Anything else
    // - including a TransferError already thrown above - passes through.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      error.meta?.modelName === "TransferListing" &&
      Array.isArray(error.meta?.target) &&
      (error.meta.target as unknown[]).includes("playerId")
    ) {
      throw new TransferError("LISTING_ALREADY_EXISTS", `Player ${input.playerId} already has an OPEN listing (concurrent create)`)
    }
    throw error
  }
}
