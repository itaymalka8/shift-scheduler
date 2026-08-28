import { withAuth } from "next-auth/middleware"
import { AUTH_DEBUG, SESSION_COOKIE_NAME, USE_SECURE_AUTH_COOKIES } from "@/lib/auth-cookies"

export default withAuth(
  function middleware(request) {
    if (!AUTH_DEBUG) return

    // Deliberately logs only shape, never content: no token payload, no
    // cookie value, no secret. Enough to tell apart "the browser never sent
    // a cookie" from "it sent one we couldn't read" from "we read it and
    // still redirected" - the three cases that look identical from the UI.
    const token = request.nextauth?.token
    console.info(
      "[auth]",
      JSON.stringify({
        path: request.nextUrl.pathname,
        expectedCookie: SESSION_COOKIE_NAME,
        secureCookies: USE_SECURE_AUTH_COOKIES,
        cookiePresent: request.cookies.has(SESSION_COOKIE_NAME),
        // If this lists a name we are NOT looking for, the two halves of
        // NextAuth have disagreed about the cookie name.
        authCookiesSeen: request.cookies
          .getAll()
          .map((c) => c.name)
          .filter((n) => n.includes("next-auth")),
        tokenDecoded: !!token,
        remember: token?.remember ?? null,
        nextauthUrlSet: !!process.env.NEXTAUTH_URL,
        secretSet: !!process.env.NEXTAUTH_SECRET,
        outcome: token ? "allow" : "redirect-to-signin",
      })
    )
  },
  {
    pages: {
      signIn: "/signin",
    },
    // withAuth passes this straight to getToken() as `cookieName`; without
    // it getToken re-derives the name from NEXTAUTH_URL and can look in a
    // different cookie than the one the sign-in route actually wrote.
    // Only `name` is accepted here - middleware just reads the cookie, so it
    // has no use for the write-side attributes.
    cookies: {
      sessionToken: { name: SESSION_COOKIE_NAME },
    },
  }
)

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/league/:path*",
    "/match/:path*",
    "/squad/:path*",
    "/stadium/:path*",
    "/economy/:path*",
  ],
}
