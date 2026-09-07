import { prisma } from "@/lib/prisma"

export interface ExpireDueTransferListingsResult {
  expiredCount: number
}

/**
 * Flips every TransferListing whose expiresAt has passed from OPEN to
 * EXPIRED - nothing else. A listing in any other status (SOLD, CANCELLED,
 * already EXPIRED) is never touched, regardless of its expiresAt. Touches
 * no other table - Player, Team, balance, FinancialTransaction, LineupSlot,
 * and TransferWindow are all untouched.
 *
 * A single `updateMany` is the whole implementation: no Serializable
 * transaction, no retry wrapper needed. Every other write path in this
 * feature (Release, Purchase, createTransferListing) needs Serializable
 * because it makes a decision based on a value it read earlier in the same
 * call (current ownership, current balance, roster count) and then writes
 * based on that decision - a second concurrent writer acting on the same
 * stale read is exactly the anomaly Serializable exists to catch. This
 * function reads nothing first: the `updateMany`'s WHERE clause *is* the
 * entire decision, evaluated and applied atomically by Postgres in one
 * statement. Two of these running at once, or overlapping with a Release or
 * Purchase that's independently flipping the same row via its own
 * conditional update, simply race for who updates the row first - there is
 * no earlier read to go stale, so nothing needs detecting or retrying.
 *
 * Idempotent by construction: once a row's status is EXPIRED, the WHERE
 * clause (`status: "OPEN"`) no longer matches it, so a second call with the
 * same (or a later) `now` updates zero further rows for it.
 */
export async function expireDueTransferListings(now: Date = new Date()): Promise<ExpireDueTransferListingsResult> {
  if (Number.isNaN(now.getTime())) {
    throw new Error("expireDueTransferListings: received an invalid Date")
  }

  const result = await prisma.transferListing.updateMany({
    where: { status: "OPEN", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  })

  return { expiredCount: result.count }
}
