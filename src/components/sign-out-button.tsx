"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"

export function SignOutButton({ label, size = "default" }: { label: string; size?: "default" | "sm" }) {
  return (
    <Button variant="outline" size={size} onClick={() => signOut({ callbackUrl: "/" })}>
      {label}
    </Button>
  )
}
