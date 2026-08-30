import { NextResponse } from "next/server"
import { TransferError, type TransferErrorCode } from "./errors"

// Record<TransferErrorCode, number> - TypeScript rejects this file at
// compile time if a code is ever added to errors.ts without a status being
// added here too, so "every TransferError has a mapping" is enforced
// structurally, not just true today.
const TRANSFER_ERROR_HTTP_STATUS: Record<TransferErrorCode, number> = {
  PLAYER_NOT_OWNED: 400,
  PLAYER_NOT_ACTIVE: 409,
  INSUFFICIENT_FUNDS: 409,
  TRANSFER_CONFLICT: 409,
  INVALID_ASKING_PRICE: 400,
  TRANSFER_WINDOW_CLOSED: 409,
  LISTING_ALREADY_EXISTS: 409,
  LISTING_NOT_FOUND: 404,
  LISTING_ALREADY_SOLD: 409,
  LISTING_CANCELLED: 409,
  LISTING_EXPIRED: 409,
  CANNOT_BUY_OWN_LISTING: 400,
  ROSTER_FULL: 409,
  BUYING_TEAM_NOT_FOUND: 404,
}

/**
 * The single place every transfer-market route maps a thrown error to an
 * HTTP response. A known TransferError becomes `{ error: <code> }` at its
 * mapped status. Anything else - a bug, a raw Prisma/Postgres error, an
 * unexpected exception - is logged in full server-side (for real debugging)
 * and reduced to a generic 500 with no details: never a Prisma error
 * message, a Postgres error, a stack trace, an engine code like P2002 or
 * P2034, or any other internal exception reaches the client.
 */
export function handleTransferApiError(error: unknown): NextResponse {
  if (error instanceof TransferError) {
    return NextResponse.json({ error: error.code }, { status: TRANSFER_ERROR_HTTP_STATUS[error.code] })
  }
  console.error("Unexpected error in transfer market API route:", error)
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
}

/** Parses a request body as JSON, never throwing - malformed JSON becomes
 * `null` so the caller can respond with a clean 400 instead of an
 * unhandled exception. This is request-shape validation only, not domain
 * logic - it says nothing about whether the parsed value is valid for any
 * particular route. */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function invalidRequestResponse(): NextResponse {
  return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 })
}
