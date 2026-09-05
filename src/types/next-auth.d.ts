import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface User {
    id: string
    teamId?: string
    teamName?: string
    /** Only set by the credentials authorize() - whether this sign-in should survive closing the browser. */
    remember?: boolean
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
    /**
     * Whether this session should survive closing the browser. Set once at
     * sign-in and carried forward on every refresh - see
     * src/app/api/auth/[...nextauth]/route.ts, which reads it to decide
     * whether the session cookie gets a real expiry or none at all.
     * Undefined (OAuth sign-ins, which don't go through the credentials
     * form) is treated as "remembered".
     */
    remember?: boolean
  }
}
