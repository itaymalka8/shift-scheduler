// Domain-error vocabulary for the youth academy, in the same shape as the
// transfer market's (src/lib/transfers/errors.ts) and the season
// lifecycle's: a stable `.code` a future API layer maps to an HTTP status,
// never a raw Prisma error forwarded to a client.
export const YOUTH_ERROR_CODES = [
  "SEASON_NOT_FOUND",
  "TEAM_NOT_FOUND",
  "TEAM_NOT_IN_SEASON",
  "INTAKE_NOT_FOUND",
  "INTAKE_NOT_OWNED",
  "INTAKE_CLOSED",
  "INTAKE_EXPIRED",
  "PROSPECT_NOT_FOUND",
  "PROSPECT_NOT_IN_INTAKE",
  "PROSPECT_NOT_PENDING",
  "PROMOTION_LIMIT_REACHED",
  "ROSTER_FULL",
  // The club has a free slot but spending it here would make the season's
  // roster invariant unreachable - a squad one short of the cap with no
  // goalkeeper cannot be given two. A discretionary promotion may not
  // consume headroom a hard invariant needs. See youth/promote.ts.
  "SQUAD_FLOOR_UNREACHABLE",
  "PROSPECT_INTEGRITY",
  "TEAM_NOT_BOT",
  "TEAM_IS_BOT",
] as const

export type YouthErrorCode = (typeof YOUTH_ERROR_CODES)[number]

export class YouthError extends Error {
  constructor(
    public readonly code: YouthErrorCode,
    message?: string
  ) {
    super(message ?? code)
    this.name = "YouthError"
  }
}
