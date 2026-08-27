"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { signInSchema, type SignInInput } from "@/lib/validation"
import { markLoginRemember } from "@/lib/remember-me"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { OAuthButtons } from "@/components/oauth-buttons"

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard"
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
  })

  const onSubmit = async (data: SignInInput) => {
    setServerError(null)
    setIsSubmitting(true)
    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      })

      if (result?.error) {
        setServerError("אימייל או סיסמה שגויים")
        return
      }

      markLoginRemember(rememberMe)
      router.push(callbackUrl)
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">התחברות למנהלים</CardTitle>
        <CardDescription>התחברו כדי לנהל את הקבוצה שלכם</CardDescription>
      </CardHeader>
      <CardContent>
        <OAuthButtons callbackUrl={callbackUrl} />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">אימייל</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">סיסמה</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="rememberMe"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked === true)}
            />
            <Label htmlFor="rememberMe" className="text-sm font-normal cursor-pointer">
              זכרו אותי (השארו מחוברים גם אחרי סגירת הדפדפן)
            </Label>
          </div>

          {serverError && (
            <p className="text-sm text-destructive text-center">{serverError}</p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "מתחבר..." : "התחברות"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          עדיין אין לכם קבוצה?{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            הקימו קבוצה חדשה
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}

export default function SignInPage() {
  return (
    <div className="goalx-hero-gradient min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6">
        <Image src="/logo.png" alt="Goalx Manager" width={72} height={72} className="rounded-full" />
      </Link>
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  )
}
