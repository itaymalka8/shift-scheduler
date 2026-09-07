// Deliberately dependency-free: this is imported by the Edge middleware as
// well as by lib/auth.ts, and middleware can't pull in Prisma/bcrypt.
//
// Why this exists at all: NextAuth decides the session cookie's name and
// `secure` flag in TWO independent places that don't agree.
//   - The route handler derives it from detectOrigin(), which returns
//     undefined unless NEXTAUTH_URL, VERCEL or AUTH_TRUST_HOST is set - and
//     parseUrl() then falls back to http://localhost:3000, i.e. NOT secure.
//   - getToken() (what withAuth uses in middleware) ignores that entirely and
//     reads `NEXTAUTH_URL?.startsWith("https://") ?? !!VERCEL`.
// On a host that sets none of those (Render), both silently land on the
// unprefixed, non-Secure cookie while the site is actually served over
// HTTPS. Pinning the name and flag here removes the inference - and the
// chance of the two disagreeing - from both sides.
const secureFromUrl = process.env.NEXTAUTH_URL?.startsWith("https://")

/** Escape hatch for running a production build over plain http locally. */
const explicitOverride =
  process.env.AUTH_COOKIE_SECURE === "true" ? true : process.env.AUTH_COOKIE_SECURE === "false" ? false : undefined

export const USE_SECURE_AUTH_COOKIES =
  explicitOverride ?? secureFromUrl ?? process.env.NODE_ENV === "production"

/**
 * A `__Secure-` prefixed cookie is rejected by browsers unless it also
 * carries `Secure`, so the prefix and the flag must always be decided
 * together - hence one constant deriving both.
 */
export const SESSION_COOKIE_NAME = `${USE_SECURE_AUTH_COOKIES ? "__Secure-" : ""}next-auth.session-token`

/** Set AUTH_DEBUG=1 to log session-resolution decisions (never any secret or token contents). */
export const AUTH_DEBUG = process.env.AUTH_DEBUG === "1"
