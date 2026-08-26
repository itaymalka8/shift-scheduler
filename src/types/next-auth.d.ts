import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface User {
    id: string
    teamId?: string
    teamName?: string
  }

  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      teamId?: string
      teamName?: string
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    teamId?: string
    teamName?: string
  }
}
