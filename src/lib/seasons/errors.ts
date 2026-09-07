// Domain-error vocabulary for the season lifecycle, in the same shape as the
// transfer market's own (src/lib/transfers/errors.ts): a stable `.code` a
// future API layer maps to an HTTP status, never a raw Prisma error
// forwarded to a client.
export const SEASON_LIFECYCLE_ERROR_CODES = ["SEASON_NOT_FOUND", "PLAYER_NOT_FOUND"] as const

export type SeasonLifecycleErrorCode = (typeof SEASON_LIFECYCLE_ERROR_CODES)[number]

export class SeasonLifecycleError extends Error {
  constructor(
    public readonly code: SeasonLifecycleErrorCode,
    message?: string
  ) {
    super(message ?? code)
    this.name = "SeasonLifecycleError"
  }
}
