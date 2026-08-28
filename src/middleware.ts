import { withAuth } from "next-auth/middleware"

export default withAuth({
  pages: {
    signIn: "/signin",
  },
})

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
