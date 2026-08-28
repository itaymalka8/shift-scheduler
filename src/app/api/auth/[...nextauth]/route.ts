import NextAuth from "next-auth"
import { decode } from "next-auth/jwt"
import { authOptions } from "@/lib/auth"

const handler = NextAuth(authOptions)

const SESSION_COOKIE_NAMES = ["next-auth.session-token", "__Secure-next-auth.session-token"]

function sessionCookieName(setCookie: string): string | null {
  const name = setCookie.slice(0, setCookie.indexOf("=")).trim()
  const match = SESSION_COOKIE_NAMES.find((n) => name === n || name.startsWith(`${n}.`))
  return match ?? null
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
 * NextAuth always issues the session cookie with an explicit Expires/Max-Age
 * computed from session.maxAge - there is no built-in option to opt out of
 * that per sign-in. "Remember me" = false is enforced here instead, after
 * the fact: decode whatever session cookie a response is about to set, and
 * if the token says it isn't meant to be remembered, strip Expires/Max-Age
 * so the browser treats it as a true session cookie - gone once the browser
 * itself (not the tab, not backgrounding the app) actually closes.
 *
 * This runs on every response through this route, not just sign-in, because
 * NextAuth also re-issues the cookie on its own periodic refresh
 * (session.updateAge) - without rewriting that response too, a "not
 * remembered" cookie would quietly turn persistent again the next time it
 * refreshed.
 */
async function enforceRememberMe(response: Response): Promise<Response> {
  const setCookies = response.headers.getSetCookie?.() ?? []
  if (setCookies.length === 0) return response

  let rewrote = false
  const rewritten = await Promise.all(
    setCookies.map(async (raw) => {
      const name = sessionCookieName(raw)
      if (!name) return raw

      const token = await decode({ token: cookieTokenValue(raw), secret: process.env.NEXTAUTH_SECRET! }).catch(() => null)
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
