"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { Eye, EyeOff } from "lucide-react"
import { makeSignInSchema, type SignInInput } from "@/lib/validation"
import { isAuthErrorCode } from "@/lib/auth-errors"
import { useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
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
import { GoalXLoadingScreen } from "@/components/goalx-loading-screen"

// Status copy shown, in order, while a sign-in is in flight. There's no
// per-stage signal from the server for a single credentials call, so this is
// a fixed, time-advanced sequence rather than real backend progress - it
// holds on the last message until the request actually resolves.
const LOGIN_STATUS_KEYS: TranslationKey[] = [
  "loading.login.step1",
  "loading.login.step2",
  "loading.login.step3",
  "loading.login.step4",
  "loading.login.step5",
  "loading.login.step6",
]

// Same reasoning as the status sequence: no real progress signal for a
// single sign-in call, so this eases toward (never reaching) the cap and
// only ever jumps to 100 once the request has genuinely succeeded.
const PROGRESS_CAP = 90
const PROGRESS_TICK_MS = 150
const STATUS_ADVANCE_MS = 900

function SignInForm() {
  const router = useRouter()
  const t = useT()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard"
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusIndex, setStatusIndex] = useState(0)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const pendingDataRef = useRef<SignInInput | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimers = () => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    if (statusTimerRef.current) clearInterval(statusTimerRef.current)
    progressTimerRef.current = null
    statusTimerRef.current = null
  }

  useEffect(() => stopTimers, [])

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<SignInInput>({
    resolver: zodResolver(makeSignInSchema(t)),
    defaultValues: { email: searchParams.get("email") ?? "" },
  })

  const startLoadingAnimation = () => {
    setProgress(0)
    setStatusIndex(0)
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + (PROGRESS_CAP - p) * 0.06
        return next >= PROGRESS_CAP - 0.5 ? PROGRESS_CAP : next
      })
    }, PROGRESS_TICK_MS)
    statusTimerRef.current = setInterval(() => {
      setStatusIndex((i) => Math.min(i + 1, LOGIN_STATUS_KEYS.length - 1))
    }, STATUS_ADVANCE_MS)
  }

  const performSignIn = async (data: SignInInput) => {
    setLoadingError(null)
    setIsLoading(true)
    startLoadingAnimation()
    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        remember: String(rememberMe),
        redirect: false,
      })

      if (result?.error) {
        stopTimers()
        const key = (isAuthErrorCode(result.error) ? `error.${result.error}` : "error.UNKNOWN_ERROR") as TranslationKey
        setLoadingError(t(key))
        // Deliberately never clear the email field on failure - re-typing a
        // correct email after a wrong password is a real, common complaint.
        setValue("password", "")
        return
      }

      stopTimers()
      setProgress(100)
      // Let the ring actually finish and "ready" register before navigating -
      // jumping straight to the dashboard would make the 100% state invisible.
      await new Promise((resolve) => setTimeout(resolve, 600))
      router.push(callbackUrl)
      router.refresh()
    } catch {
      stopTimers()
      setLoadingError(t("error.NETWORK_ERROR"))
    }
  }

  const onSubmit = async (data: SignInInput) => {
    if (isLoading) return
    pendingDataRef.current = data
    await performSignIn(data)
  }

  const handleRetry = () => {
    if (pendingDataRef.current) void performSignIn(pendingDataRef.current)
  }

  const handleBack = () => {
    stopTimers()
    setIsLoading(false)
    setLoadingError(null)
    setProgress(0)
    setStatusIndex(0)
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
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="email"
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                {t("signin.forgotPassword")}
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
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

          <Button type="submit" className="w-full gap-2" disabled={isLoading}>
            {t("signin.submit")}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("signin.noTeamYet")}{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">
            {t("signin.createTeamHere")}
          </Link>
        </p>
      </CardContent>

      {isLoading && (
        <GoalXLoadingScreen
          mode="login"
          progress={progress}
          status={t(LOGIN_STATUS_KEYS[statusIndex])}
          error={loadingError}
          onRetry={handleRetry}
          onBack={handleBack}
        />
      )}
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
