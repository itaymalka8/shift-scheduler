"use client"

import { useEffect } from "react"
import { signOut, useSession } from "next-auth/react"
import { shouldForceSignOut } from "@/lib/remember-me"

/** Signs out a user who chose not to be remembered once their browser has been closed and reopened. */
export function SessionGuard() {
  const { status } = useSession()

  useEffect(() => {
    if (status === "authenticated" && shouldForceSignOut()) {
      signOut({ callbackUrl: "/" })
    }
  }, [status])

  return null
}
