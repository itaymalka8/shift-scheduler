"use client"

import { useEffect, useState } from "react"
import { getProviders, signIn, type ClientSafeProvider } from "next-auth/react"
import { Button } from "@/components/ui/button"

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-4">
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M16.365 1.43c0 1.14-.416 2.19-1.24 3.05-.9.95-2.1 1.53-3.24 1.44-.13-1.1.44-2.24 1.24-3.03.86-.86 2.15-1.5 3.24-1.46zM20.14 17.06c-.53 1.22-.78 1.77-1.47 2.85-.95 1.47-2.3 3.3-3.97 3.32-1.48.02-1.86-.96-3.87-.95-2 .01-2.43.97-3.91.95-1.67-.02-2.94-1.66-3.89-3.13-2.68-4.1-2.96-8.9-1.31-11.46 1.17-1.82 3.02-2.88 4.76-2.88 1.77 0 2.88 1 4.35 1 1.42 0 2.28-1 4.35-1 1.55 0 3.2.85 4.37 2.32-3.84 2.1-3.22 7.58.59 9z" />
    </svg>
  )
}

const PROVIDER_META: Record<string, { label: string; icon: () => React.JSX.Element }> = {
  google: { label: "המשיכו עם Google", icon: GoogleIcon },
  apple: { label: "המשיכו עם Apple", icon: AppleIcon },
}

export function OAuthButtons({ callbackUrl = "/dashboard" }: { callbackUrl?: string }) {
  const [providers, setProviders] = useState<Record<string, ClientSafeProvider> | null>(null)

  useEffect(() => {
    getProviders().then(setProviders)
  }, [])

  const oauthProviders = providers
    ? Object.values(providers).filter((p) => p.id !== "credentials")
    : []

  if (oauthProviders.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {oauthProviders.map((provider) => {
          const meta = PROVIDER_META[provider.id]
          const Icon = meta?.icon
          return (
            <Button
              key={provider.id}
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={() => signIn(provider.id, { callbackUrl })}
            >
              {Icon && <Icon />}
              {meta?.label ?? `המשיכו עם ${provider.name}`}
            </Button>
          )
        })}
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-card px-2 text-muted-foreground">או</span>
        </div>
      </div>
    </div>
  )
}
