import { PrismaAdapter } from "@auth/prisma-adapter"
import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import AppleProvider from "next-auth/providers/apple"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { ensureTeamForUser } from "@/lib/team-setup"
import { isRateLimited, recordFailedAttempt, clearAttempts } from "@/lib/rate-limit"

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "אימייל", type: "email" },
      password: { label: "סיסמה", type: "password" },
    },
    // Throws a distinct error code per failure reason instead of returning
    // null for everything - NextAuth passes a thrown Error's message straight
    // through as signIn()'s result.error, but silently collapses a `null`
    // return into a single generic "CredentialsSignin" string. User-not-found
    // and wrong-password are deliberately kept under the same
    // INVALID_CREDENTIALS code (never revealing which one it was) to avoid
    // leaking whether an email is registered - every other case here is a
    // real, distinct condition that safely can (and per the product spec,
    // must) be told apart.
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        throw new Error("VALIDATION_ERROR")
      }

      // Password is compared byte-for-byte via bcrypt, never lowercased or
      // trimmed - only the email identity lookup is normalized.
      const email = credentials.email.trim().toLowerCase()
      const rateLimitKey = `login:${email}`

      if (isRateLimited(rateLimitKey)) {
        throw new Error("RATE_LIMITED")
      }

      let user
      try {
        user = await prisma.user.findUnique({ where: { email } })
      } catch {
        throw new Error("NETWORK_ERROR")
      }

      if (!user || !user.passwordHash) {
        recordFailedAttempt(rateLimitKey)
        throw new Error("INVALID_CREDENTIALS")
      }

      const isValid = await bcrypt.compare(credentials.password, user.passwordHash)
      if (!isValid) {
        recordFailedAttempt(rateLimitKey)
        throw new Error("INVALID_CREDENTIALS")
      }

      clearAttempts(rateLimitKey)
      return { id: user.id, email: user.email, name: user.name }
    },
  }),
]

// Google/Apple only appear as sign-in options once the site owner configures
// real OAuth credentials - see .env.example for the required variables.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  )
}

if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  providers.push(
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    })
  )
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: 60 * 24 * 60 * 60, // 60 days - users stay signed in automatically
  },
  pages: {
    signIn: "/signin",
  },
  providers,
  events: {
    // Fires once when the Prisma adapter creates a brand-new user - i.e. a
    // first-time Google/Apple sign-in (credentials signup creates its own
    // Team directly in /api/register and never goes through this path).
    // If this fails partway through, the user is left signed in but without
    // a team ("account setup incomplete") rather than fully broken - the
    // same ensureTeamForUser call self-heals that state on their next
    // dashboard load, so nobody gets stuck.
    async createUser({ user }) {
      try {
        await ensureTeamForUser(prisma, user.id, user.name ?? null)
      } catch (error) {
        console.error("Failed to create default team for new OAuth user", user.id, error)
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id

      if (token.sub && (!token.teamId || user)) {
        const team = await prisma.team.findUnique({ where: { userId: token.sub } })
        token.teamId = team?.id
        token.teamName = team?.name
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string
        session.user.teamId = token.teamId as string | undefined
        session.user.teamName = token.teamName as string | undefined
      }
      return session
    },
  },
}
