// Central domain-error vocabulary for the transfer market. A future API
// layer maps `.code` to an HTTP status and a stable JSON error body - it
// never forwards a raw Prisma error (message, stack, engine error code) to
// a client.
export const TRANSFER_ERROR_CODES = [
  "PLAYER_NOT_OWNED",
  "PLAYER_NOT_ACTIVE",
  "INSUFFICIENT_FUNDS",
  "TRANSFER_CONFLICT",
  "INVALID_ASKING_PRICE",
  "TRANSFER_WINDOW_CLOSED",
  "LISTING_ALREADY_EXISTS",
  "LISTING_NOT_FOUND",
  "LISTING_NOT_OWNED",
  "LISTING_ALREADY_SOLD",
  "LISTING_CANCELLED",
  "LISTING_EXPIRED",
  "CANNOT_BUY_OWN_LISTING",
  "ROSTER_FULL",
  // Not in the requested list - added because step 7 of Purchase explicitly
  // requires a clear domain error (never a raw Prisma error) when the
  // buying team doesn't exist, and none of the other codes fit that case.
  "BUYING_TEAM_NOT_FOUND",
] as const

export type TransferErrorCode = (typeof TRANSFER_ERROR_CODES)[number]

export class TransferError extends Error {
  constructor(public readonly code: TransferErrorCode, message?: string) {
    super(message ?? code)
    this.name = "TransferError"
  }
}
