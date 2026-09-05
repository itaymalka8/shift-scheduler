"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { useT } from "@/lib/i18n/locale-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LanguageSwitcher } from "@/components/language-switcher"

type FormInput = { password: string }

function ResetPasswordForm() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput>({
    resolver: zodResolver(z.object({ password: z.string().min(6, t("validation.passwordMin")) })),
  })

  const onSubmit = async (data: FormInput) => {
    if (isSubmitting) return
    setServerError(null)
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setServerError(
          body?.error === "INVALID_TOKEN" ? t("resetPassword.invalidToken") : t("error.UNKNOWN_ERROR")
        )
        return
      }
      setSuccess(true)
    } catch {
      setServerError(t("error.NETWORK_ERROR"))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="goalx-auth-card w-full max-w-md shadow-2xl">
      <CardHeader>
        <CardTitle className="text-2xl">{t("resetPassword.title")}</CardTitle>
        <CardDescription>{t("resetPassword.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <p className="text-sm text-destructive text-center">{t("resetPassword.invalidToken")}</p>
        ) : success ? (
          <>
            <p className="text-sm text-center mb-4">{t("resetPassword.success")}</p>
            <Button className="w-full" onClick={() => router.push("/signin")}>
              {t("forgotPassword.backToSignin")}
            </Button>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t("resetPassword.newPassword")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="pe-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t("signin.hidePassword") : t("signin.showPassword")}
                  className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>

            {serverError && <p className="text-sm text-destructive text-center">{serverError}</p>}

            <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isSubmitting ? t("resetPassword.submitting") : t("resetPassword.submit")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="goalx-auth-background min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md flex justify-end mb-2">
        <LanguageSwitcher variant="dark" />
      </div>
      <Link href="/" className="mb-6">
        <Image src="/logo.png" alt="Goalx Manager" width={72} height={72} className="rounded-full" />
      </Link>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  )
}
