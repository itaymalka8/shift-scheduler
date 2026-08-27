"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"

export function SignOutButton({ label }: { label: string }) {
  return (
    <Button variant="outline" onClick={() => signOut({ callbackUrl: "/" })}>
      {label}
    </Button>
  )
}
