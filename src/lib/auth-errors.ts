// Stable, distinct error codes shared by every Auth-adjacent API route and
// by NextAuth's authorize() (thrown as Error.message - see auth.ts). Never
// shown to the user directly - src/lib/i18n/translations.ts maps each code
// to a friendly message per locale, and code here is only for branching
// logic (e.g. "show a signin link" for EMAIL_ALREADY_EXISTS).
export const AUTH_ERROR_CODES = [
  "INVALID_CREDENTIALS",
  "EMAIL_ALREADY_EXISTS",
  "EMAIL_NOT_VERIFIED",
  "WEAK_PASSWORD",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "ACCOUNT_SETUP_INCOMPLETE",
  "VALIDATION_ERROR",
  "UNKNOWN_ERROR",
  "DATABASE_ERROR",
  "SQUAD_GENERATION_FAILED",
  "LEAGUE_SETUP_FAILED",
] as const

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number]

export function isAuthErrorCode(value: string | undefined | null): value is AuthErrorCode {
  return !!value && (AUTH_ERROR_CODES as readonly string[]).includes(value)
}
