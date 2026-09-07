import { NextResponse } from "next/server"
import { YouthError, type YouthErrorCode } from "./errors"

// Record<YouthErrorCode, number> - a compile error if a new code is ever
// added to errors.ts without a status mapping here, same discipline as
// src/lib/transfers/http.ts.
const YOUTH_ERROR_HTTP_STATUS: Record<YouthErrorCode, number> = {
  SEASON_NOT_FOUND: 404,
  TEAM_NOT_FOUND: 404,
  TEAM_NOT_IN_SEASON: 409,
  INTAKE_NOT_FOUND: 404,
  INTAKE_NOT_OWNED: 403,
  INTAKE_CLOSED: 409,
  INTAKE_EXPIRED: 409,
  PROSPECT_NOT_FOUND: 404,
  PROSPECT_NOT_IN_INTAKE: 400,
  PROSPECT_NOT_PENDING: 409,
  PROMOTION_LIMIT_REACHED: 409,
  ROSTER_FULL: 409,
  SQUAD_FLOOR_UNREACHABLE: 409,
  PROSPECT_INTEGRITY: 500,
  TEAM_NOT_BOT: 409,
  TEAM_IS_BOT: 403,
}

/**
 * The single place every youth-academy route maps a thrown error to an HTTP
 * response - same contract as handleTransferApiError: a known YouthError
 * becomes `{ error: <code> }` at its mapped status, anything else is logged
 * server-side and reduced to a generic 500 with no internal detail.
 */
export function handleYouthApiError(error: unknown): NextResponse {
  if (error instanceof YouthError) {
    return NextResponse.json({ error: error.code }, { status: YOUTH_ERROR_HTTP_STATUS[error.code] })
  }
  console.error("Unexpected error in youth academy API route:", error)
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
}
