"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { makeSignInSchema, type SignInInput } from "@/lib/validation"
import { markLoginRemember } from "@/lib/remember-me"
import { useT } from "@/lib/i18n/locale-context"
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
import { LanguageSwitcher } from "@/components/language-switcher"

function SignInForm() {
  const router = useRouter()
  const t = useT()
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
    resolver: zodResolver(makeSignInSchema(t)),
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
        setServerError(t("signin.invalidCredentials"))
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
        <CardTitle className="text-2xl">{t("signin.title")}</CardTitle>
        <CardDescription>{t("signin.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <OAuthButtons callbackUrl={callbackUrl} />

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
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
              {t("auth.rememberMeSignin")}
            </Label>
          </div>

          {serverError && (
            <p className="text-sm text-destructive text-center">{serverError}</p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t("signin.submitting") : t("signin.submit")}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("signin.noTeamYet")}{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            {t("signin.createTeamHere")}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}

export default function SignInPage() {
  return (
    <div className="goalx-hero-gradient min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md flex justify-end mb-2">
        <LanguageSwitcher variant="dark" />
      </div>
      <Link href="/" className="mb-6">
        <Image src="/logo.png" alt="Goalx Manager" width={72} height={72} className="rounded-full" />
      </Link>
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  )
}
