import NextAuth from "next-auth"
import { decode } from "next-auth/jwt"
import { authOptions } from "@/lib/auth"
import { AUTH_DEBUG, SESSION_COOKIE_NAME } from "@/lib/auth-cookies"

const handler = NextAuth(authOptions)

function isSessionCookie(setCookie: string): boolean {
  const name = setCookie.slice(0, setCookie.indexOf("=")).trim()
  // NextAuth splits an oversized token into `<name>.0`, `<name>.1`, ...
  return name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`)
}

function cookieTokenValue(setCookie: string): string {
  const eq = setCookie.indexOf("=")
  const end = setCookie.indexOf(";")
  return decodeURIComponent(setCookie.slice(eq + 1, end === -1 ? undefined : end))
}

function stripExpiry(setCookie: string): string {
  return setCookie
    .split(";")
    .filter((part) => {
      const key = part.trim().split("=")[0]?.toLowerCase()
      return key !== "expires" && key !== "max-age"
    })
    .join(";")
}

/**
 * NextAuth always issues the session cookie with an explicit Expires
 * computed from session.maxAge - there is no built-in way to opt out of that
 * for a single sign-in. "Remember me" = false is enforced here instead:
 * decode the session cookie a response is about to set, and if the token
 * says it isn't meant to be remembered, drop Expires/Max-Age so the browser
 * keeps it only until the browser itself closes.
 *
 * Runs on every response through this route, not just sign-in, because
 * NextAuth re-issues the cookie on its own periodic refresh too - otherwise
 * a non-remembered session would quietly become persistent on first refresh.
 *
 * A remembered sign-in is passed through completely untouched.
 */
async function enforceRememberMe(response: Response): Promise<Response> {
  const setCookies = response.headers.getSetCookie?.() ?? []
  if (setCookies.length === 0) return response

  let rewrote = false
  const rewritten = await Promise.all(
    setCookies.map(async (raw) => {
      if (!isSessionCookie(raw)) return raw

      const value = cookieTokenValue(raw)
      const token = value
        ? await decode({ token: value, secret: process.env.NEXTAUTH_SECRET ?? "" }).catch(() => null)
        : null

      if (AUTH_DEBUG) {
        console.info(
          "[auth] issuing session cookie",
          JSON.stringify({
            cookieName: SESSION_COOKIE_NAME,
            tokenDecoded: !!token,
            remember: token?.remember ?? null,
            hasExpiry: /(?:^|;)\s*(expires|max-age)=/i.test(raw),
            isClearing: value === "",
          })
        )
      }

      if (token && token.remember === false) {
        rewrote = true
        return stripExpiry(raw)
      }
      return raw
    })
  )

  if (!rewrote) return response

  const headers = new Headers()
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== "set-cookie") headers.append(key, value)
  }
  for (const cookie of rewritten) headers.append("set-cookie", cookie)

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function auth(request: Request, context: { params: Promise<{ nextauth: string[] }> }): Promise<Response> {
  const response: Response = await handler(request, context)
  return enforceRememberMe(response)
}

export { auth as GET, auth as POST }
