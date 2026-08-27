import { PrismaAdapter } from "@auth/prisma-adapter"
import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import AppleProvider from "next-auth/providers/apple"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import {
  DEFAULT_CREST_BORDER_COLOR,
  DEFAULT_CREST_COLOR,
  DEFAULT_CREST_ICON,
  DEFAULT_CREST_PATTERN,
  DEFAULT_CREST_SECONDARY_COLOR,
  DEFAULT_CREST_SHAPE,
} from "@/components/team-crest"
import { DEFAULT_STADIUM_STYLE } from "@/components/stadium-illustration"

const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "אימייל", type: "email" },
      password: { label: "סיסמה", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null

      const email = credentials.email.trim().toLowerCase()
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || !user.passwordHash) return null

      const isValid = await bcrypt.compare(credentials.password, user.passwordHash)
      if (!isValid) return null

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
    async createUser({ user }) {
      const existingTeam = await prisma.team.findUnique({ where: { userId: user.id } })
      if (existingTeam) return

      await prisma.team.create({
        data: {
          userId: user.id,
          name: user.name ? `קבוצת ${user.name}` : "הקבוצה החדשה שלי",
          crestShape: DEFAULT_CREST_SHAPE,
          crestPattern: DEFAULT_CREST_PATTERN,
          crestIcon: DEFAULT_CREST_ICON,
          crestColor: DEFAULT_CREST_COLOR,
          crestSecondaryColor: DEFAULT_CREST_SECONDARY_COLOR,
          crestBorderColor: DEFAULT_CREST_BORDER_COLOR,
          crowdStyle: "calm",
          stadiumStyle: DEFAULT_STADIUM_STYLE,
          stadiumCapacity: 100,
        },
      })
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
