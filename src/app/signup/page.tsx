"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { Check, Eye, EyeOff, Upload, X } from "lucide-react"
import {
  makeAccountSchema,
  makeTeamDetailsSchema,
  makeTeamIdentitySchema,
  type AccountInput,
  type TeamDetailsInput,
  type TeamIdentityInput,
} from "@/lib/validation"
import { isAuthErrorCode } from "@/lib/auth-errors"
import { useLocale, useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import { getCountryOptions, isLaunchCountry } from "@/lib/countries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { BroadcastStadiumHero } from "@/components/stadium3d/BroadcastStadiumHero"
import { DEFAULT_STADIUM_STYLE, type StadiumStyleId } from "@/components/stadium-illustration"
import { getStyleTagKeys } from "@/lib/stadium/stadium3d-config"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { cn } from "@/lib/utils"
import {
  CREST_COLORS,
  CREST_ICON_OPTIONS,
  CREST_PATTERNS,
  CREST_SHAPES,
  DEFAULT_CREST_BORDER_COLOR,
  DEFAULT_CREST_COLOR,
  DEFAULT_CREST_ICON,
  DEFAULT_CREST_PATTERN,
  DEFAULT_CREST_SECONDARY_COLOR,
  DEFAULT_CREST_SHAPE,
  TeamCrest,
  type CrestPatternId,
  type CrestShapeId,
} from "@/components/team-crest"

const MAX_CREST_SIZE = 2 * 1024 * 1024
const ALLOWED_CREST_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]

// Same reasoning as the sign-in loading sequence: club creation is a single
// request with no per-stage server signal, so this is a fixed, time-advanced
// status sequence over client-side estimated progress - it holds on the last
// message until the request actually resolves, and never claims 100% before
// the server has confirmed success.
const CREATE_CLUB_STATUS_KEYS: TranslationKey[] = [
  "loading.createClub.step1",
  "loading.createClub.step2",
  "loading.createClub.step3",
  "loading.createClub.step4",
  "loading.createClub.step5",
  "loading.createClub.step6",
  "loading.createClub.step7",
]
const PROGRESS_CAP = 90
const PROGRESS_TICK_MS = 150
const STATUS_ADVANCE_MS = 900

const SHAPE_LABEL_KEY: Record<CrestShapeId, TranslationKey> = {
  shield: "crest.shapeShield",
  circle: "crest.shapeCircle",
  hexagon: "crest.shapeHexagon",
  pennant: "crest.shapePennant",
}

const PATTERN_LABEL_KEY: Record<CrestPatternId, TranslationKey> = {
  solid: "crest.patternSolid",
  split: "crest.patternSplit",
  stripes: "crest.patternStripes",
}

/**
 * Two traits per crowd style. The real comparison is the 3D ground above -
 * these only need to say what changes, not describe it.
 */
const CROWD_TRAIT_KEYS: Record<"calm" | "ultras", TranslationKey[]> = {
  calm: ["team.crowdCalmTrait1", "team.crowdCalmTrait2"],
  ultras: ["team.crowdUltrasTrait1", "team.crowdUltrasTrait2"],
}

/**
 * The order the styles are offered in: the two everyone recognises first, then
 * the structural variants, then the character grounds. Independent of the
 * renderer's own list, which is keyed by id and has no display order.
 */
const STADIUM_STYLE_ORDER: StadiumStyleId[] = [
  "classic-bowl",
  "modern-arena",
  "four-stand",
  "athletics",
  "retractable",
  "boutique",
  "historic",
  "coastal",
]

const STADIUM_STYLE_LABEL_KEY: Record<StadiumStyleId, TranslationKey> = {
  "classic-bowl": "stadium.classicBowl",
  "modern-arena": "stadium.modernArena",
  "four-stand": "stadium.fourStand",
  athletics: "stadium.athletics",
  boutique: "stadium.boutique",
  retractable: "stadium.retractable",
  historic: "stadium.historic",
  coastal: "stadium.coastal",
}

const STADIUM_STYLE_DESC_KEY: Record<StadiumStyleId, TranslationKey> = {
  "classic-bowl": "stadium.desc.classicBowl",
  "modern-arena": "stadium.desc.modernArena",
  "four-stand": "stadium.desc.fourStand",
  athletics: "stadium.desc.athletics",
  boutique: "stadium.desc.boutique",
  retractable: "stadium.desc.retractable",
  historic: "stadium.desc.historic",
  coastal: "stadium.desc.coastal",
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2.5">
        {CREST_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
            style={{ backgroundColor: c }}
            className={cn(
              "size-10 shrink-0 rounded-full border border-black/10 transition-all",
              value === c
                ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                : "opacity-70 hover:opacity-100"
            )}
          />
        ))}
      </div>
    </div>
  )
}

export default function SignUpPage() {
  const router = useRouter()
  const t = useT()
  const { locale } = useLocale()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [rememberMe, setRememberMe] = useState(true)

  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusIndex, setStatusIndex] = useState(0)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimers = () => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    if (statusTimerRef.current) clearInterval(statusTimerRef.current)
    progressTimerRef.current = null
    statusTimerRef.current = null
  }

  useEffect(() => stopTimers, [])
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [shape, setShape] = useState<CrestShapeId>(DEFAULT_CREST_SHAPE)
  const [pattern, setPattern] = useState<CrestPatternId>(DEFAULT_CREST_PATTERN)
  const [icon, setIcon] = useState<string>(DEFAULT_CREST_ICON)
  const [color, setColor] = useState<string>(DEFAULT_CREST_COLOR)
  const [secondaryColor, setSecondaryColor] = useState<string>(DEFAULT_CREST_SECONDARY_COLOR)
  const [borderColor, setBorderColor] = useState<string>(DEFAULT_CREST_BORDER_COLOR)
  const [crestFile, setCrestFile] = useState<File | null>(null)
  const [crestPreviewUrl, setCrestPreviewUrl] = useState<string | null>(null)
  const [crestError, setCrestError] = useState<string | null>(null)

  const countryOptions = useMemo(() => getCountryOptions(locale), [locale])

  const accountForm = useForm<AccountInput>({
    resolver: zodResolver(makeAccountSchema(t)),
  })

  const identityForm = useForm<TeamIdentityInput>({
    resolver: zodResolver(makeTeamIdentitySchema(t)),
  })

  const teamForm = useForm<TeamDetailsInput>({
    resolver: zodResolver(makeTeamDetailsSchema(t)),
    defaultValues: { crowdStyle: "calm", stadiumName: "", countryCode: "" },
  })
  const [stadiumStyle, setStadiumStyle] = useState<StadiumStyleId>(DEFAULT_STADIUM_STYLE)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_CREST_TYPES.includes(file.type)) {
      setCrestError(t("crest.fileTypeNotSupported"))
      return
    }
    if (file.size > MAX_CREST_SIZE) {
      setCrestError(t("crest.fileTooLarge"))
      return
    }

    setCrestError(null)
    setCrestFile(file)
    setCrestPreviewUrl(URL.createObjectURL(file))
  }

  const clearUploadedFile = () => {
    setCrestFile(null)
    setCrestPreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const goToStep3 = (identity: TeamIdentityInput) => {
    if (!teamForm.getValues("stadiumName")) {
      teamForm.setValue("stadiumName", identity.teamName)
    }
    setStep(3)
  }

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
      setStatusIndex((i) => Math.min(i + 1, CREATE_CLUB_STATUS_KEYS.length - 1))
    }, STATUS_ADVANCE_MS)
  }

  // Attempts a sign-in with the credentials just submitted. Used both for the
  // normal post-registration auto-sign-in AND as the recovery path when the
  // server says the email is already registered - if that's true because our
  // own previous attempt actually succeeded before its response reached us
  // (a cut connection, a retry after a timeout), the account and password
  // are exactly the ones we just tried, so signing in here completes the
  // same flow instead of surfacing a false "duplicate" error.
  const finishWithSignIn = async (email: string, password: string) => {
    return signIn("credentials", { email, password, remember: String(rememberMe), redirect: false })
  }

  const goToDashboard = async () => {
    stopTimers()
    setProgress(100)
    // Let the ring finish and "club ready" register before navigating.
    await new Promise((resolve) => setTimeout(resolve, 600))
    router.push("/dashboard")
    router.refresh()
  }

  const onFinalSubmit = async (teamDetails: TeamDetailsInput) => {
    if (isLoading) return
    const account = accountForm.getValues()
    const identity = identityForm.getValues()
    setLoadingError(null)
    setIsLoading(true)
    startLoadingAnimation()

    const formData = new FormData()
    formData.set("name", account.name)
    formData.set("email", account.email)
    formData.set("password", account.password)
    formData.set("confirmPassword", account.confirmPassword)
    formData.set("teamName", identity.teamName)
    formData.set("crestShape", shape)
    formData.set("crestBorderColor", borderColor)
    formData.set("countryCode", teamDetails.countryCode)
    formData.set("stadiumName", teamDetails.stadiumName)
    formData.set("stadiumStyle", stadiumStyle)
    formData.set("crowdStyle", teamDetails.crowdStyle)

    if (crestFile) {
      formData.set("crestImage", crestFile)
    } else {
      formData.set("crestPattern", pattern)
      formData.set("crestIcon", icon)
      formData.set("crestColor", color)
      formData.set("crestSecondaryColor", secondaryColor)
    }

    let res: Response
    try {
      res = await fetch("/api/register", { method: "POST", body: formData })
    } catch {
      stopTimers()
      setLoadingError(t("error.NETWORK_ERROR"))
      return
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null)
      const code = body?.error as string | undefined

      if (code === "EMAIL_ALREADY_EXISTS") {
        // Could be a genuine pre-existing account, or our own earlier attempt
        // that actually committed server-side before we saw its response -
        // signing in with what we just submitted tells them apart without
        // ever issuing a second create.
        const recovered = await finishWithSignIn(account.email, account.password).catch(() => null)
        if (recovered && !recovered.error) {
          await goToDashboard()
          return
        }
        stopTimers()
        setLoadingError(t("signup.emailExistsTitle"))
        return
      }

      stopTimers()
      const key = (isAuthErrorCode(code) ? `error.${code}` : "loading.createClub.error") as TranslationKey
      setLoadingError(t(key))
      return
    }

    // Auto-sign-in right after a successful registration.
    const signInResult = await finishWithSignIn(account.email, account.password)
    if (signInResult?.error) {
      stopTimers()
      setLoadingError(t("signup.signupSucceededSigninFailed"))
      return
    }

    await goToDashboard()
  }

  const handleRetry = () => {
    void teamForm.handleSubmit(onFinalSubmit)()
  }

  const handleBack = () => {
    stopTimers()
    setIsLoading(false)
    setLoadingError(null)
    setProgress(0)
    setStatusIndex(0)
  }

  return (
    <div className="goalx-auth-background min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg flex justify-end mb-2">
        <LanguageSwitcher variant="dark" />
      </div>
      <Link href="/" className="mb-6">
        <Image src="/logo.png" alt="Goalx Manager" width={72} height={72} className="rounded-full" />
      </Link>

      <Card className={cn("goalx-auth-card w-full shadow-2xl", step === 1 ? "max-w-lg" : "max-w-4xl")}>
        {step === 1 && (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">{t("signup.title")}</CardTitle>
              <CardDescription>{t("signup.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OAuthButtons />

              <form onSubmit={accountForm.handleSubmit(() => setStep(2))} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t("auth.fullName")}</Label>
                  <Input id="name" type="text" autoComplete="name" {...accountForm.register("name")} />
                  {accountForm.formState.errors.name && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.name.message}
                    </p>
                  )}
                </div>

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
                    {...accountForm.register("email")}
                  />
                  {accountForm.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="pe-10"
                      {...accountForm.register("password")}
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
                  {accountForm.formState.errors.password && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="pe-10"
                      {...accountForm.register("confirmPassword")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((v) => !v)}
                      aria-label={
                        showConfirmPassword ? t("signin.hidePassword") : t("signin.showPassword")
                      }
                      className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {accountForm.formState.errors.confirmPassword && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.confirmPassword.message}
                    </p>
                  )}
                </div>

                <Button type="submit" className="w-full">
                  {t("signup.createAccount")}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {t("signup.alreadyHaveTeam")}{" "}
                <Link href="/signin" className="text-primary font-medium hover:underline">
                  {t("signup.signInHere")}
                </Link>
              </p>
              <p className="mt-3 text-center text-xs text-muted-foreground">{t("signup.legalFooter")}</p>
            </CardContent>
          </>
        )}

        {step === 2 && (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">{t("crest.title")}</CardTitle>
              <CardDescription>{t("signup.identityDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={identityForm.handleSubmit(goToStep3)} className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:items-start">
                  {/* Preview - the hero element. Comes first in DOM order so
                      mobile sees it on top; the team name lives inside this
                      panel so it reads as part of the crest identity. */}
                  <div className="lg:sticky lg:top-6">
                    <div className="goalx-broadcast-panel flex flex-col items-center gap-4 p-6 text-center">
                      <TeamCrest
                        shape={shape}
                        pattern={pattern}
                        icon={icon}
                        color={color}
                        secondaryColor={secondaryColor}
                        borderColor={borderColor}
                        imageUrl={crestPreviewUrl}
                        size={140}
                      />
                      <div className="w-full space-y-1.5">
                        <Input
                          id="teamName"
                          type="text"
                          placeholder={t("auth.teamName")}
                          className="border-white/20 bg-white/5 text-center text-lg font-bold text-white placeholder:text-white/40 focus-visible:ring-white/40"
                          {...identityForm.register("teamName")}
                        />
                        {identityForm.formState.errors.teamName && (
                          <p className="text-sm text-red-300">{identityForm.formState.errors.teamName.message}</p>
                        )}
                      </div>

                      {crestPreviewUrl && (
                        <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80">
                          <span className="max-w-40 truncate">{crestFile?.name}</span>
                          <button
                            type="button"
                            onClick={clearUploadedFile}
                            aria-label={t("crest.removeFile")}
                            className="text-white/70 hover:text-white"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="space-y-6">
                    <div>
                      <p className="mb-2 text-sm font-medium">{t("crest.shape")}</p>
                      <div className="grid grid-cols-4 gap-2">
                        {CREST_SHAPES.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={shape === s.id}
                            onClick={() => setShape(s.id)}
                            className={cn(
                              "flex min-h-11 flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition-colors",
                              shape === s.id
                                ? "border-primary bg-primary/10"
                                : "border-transparent bg-muted/40 hover:bg-muted"
                            )}
                          >
                            <TeamCrest
                              shape={s.id}
                              pattern={pattern}
                              icon={icon}
                              color={color}
                              secondaryColor={secondaryColor}
                              borderColor={borderColor}
                              size={44}
                            />
                            <span className="text-[11px] font-medium leading-tight">{t(SHAPE_LABEL_KEY[s.id])}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {!crestPreviewUrl && (
                      <>
                        <div>
                          <p className="mb-2 text-sm font-medium">{t("crest.pattern")}</p>
                          <div className="grid grid-cols-3 gap-2">
                            {CREST_PATTERNS.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                aria-pressed={pattern === p.id}
                                onClick={() => setPattern(p.id)}
                                className={cn(
                                  "flex min-h-11 flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition-colors",
                                  pattern === p.id
                                    ? "border-primary bg-primary/10"
                                    : "border-transparent bg-muted/40 hover:bg-muted"
                                )}
                              >
                                <TeamCrest
                                  shape={shape}
                                  pattern={p.id}
                                  icon={icon}
                                  color={color}
                                  secondaryColor={secondaryColor}
                                  borderColor={borderColor}
                                  size={44}
                                />
                                <span className="text-[11px] font-medium leading-tight">{t(PATTERN_LABEL_KEY[p.id])}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        <ColorRow label={t("crest.primaryColor")} value={color} onChange={setColor} />
                        {pattern !== "solid" && (
                          <ColorRow
                            label={t("crest.secondaryColor")}
                            value={secondaryColor}
                            onChange={setSecondaryColor}
                          />
                        )}

                        <div>
                          <p className="mb-2 text-sm font-medium">{t("crest.icon")}</p>
                          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
                            {CREST_ICON_OPTIONS.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                aria-pressed={icon === opt.id}
                                onClick={() => setIcon(opt.id)}
                                className={cn(
                                  "flex min-h-11 min-w-11 items-center justify-center rounded-lg border-2 p-1.5 transition-colors",
                                  icon === opt.id
                                    ? "border-primary bg-primary/10"
                                    : "border-transparent bg-muted/40 hover:bg-muted"
                                )}
                              >
                                <TeamCrest
                                  shape="circle"
                                  pattern="solid"
                                  icon={opt.id}
                                  color={color}
                                  borderColor={color}
                                  size={28}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    <ColorRow label={t("crest.borderColor")} value={borderColor} onChange={setBorderColor} />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      <Upload className="size-4" />
                      {crestPreviewUrl ? t("crest.chooseAnotherFile") : t("crest.uploadOwn")}
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={handleFileChange}
                      className="hidden"
                    />

                    {crestError && <p className="text-sm text-destructive">{crestError}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-3 border-t border-white/10 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setStep(1)}
                  >
                    {t("signup.back")}
                  </Button>
                  {/* The one primary action on the screen - given the width and
                      weight, so it outranks the swatches and icon tiles above. */}
                  <Button type="submit" size="lg" className="flex-1 text-base font-bold shadow-lg">
                    {t("signup.next")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </>
        )}

        {step === 3 && (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">{t("team.title")}</CardTitle>
              <CardDescription>{t("team.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={teamForm.handleSubmit(onFinalSubmit)} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="countryCode">{t("team.country")}</Label>
                  <Controller
                    control={teamForm.control}
                    name="countryCode"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="countryCode" className="w-full">
                          <SelectValue placeholder={t("team.countryPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {countryOptions.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.name}
                              {!c.isLaunchCountry && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  ({t("team.countryComingSoonBadge")})
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {teamForm.formState.errors.countryCode && (
                    <p className="text-sm text-destructive">
                      {teamForm.formState.errors.countryCode.message}
                    </p>
                  )}
                  {teamForm.watch("countryCode") && !isLaunchCountry(teamForm.watch("countryCode")) && (
                    <p className="text-sm text-muted-foreground">{t("team.countryComingSoonNote")}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stadiumName">{t("team.stadiumName")}</Label>
                  <Input id="stadiumName" type="text" {...teamForm.register("stadiumName")} />
                  {teamForm.formState.errors.stadiumName && (
                    <p className="text-sm text-destructive">
                      {teamForm.formState.errors.stadiumName.message}
                    </p>
                  )}
                </div>

                <div data-testid="stadium-selector" className="space-y-3">
                  <Label>{t("team.stadiumStyle")}</Label>

                  {/* The real match renderer, not a thumbnail: the manager sees
                      the actual ground they are choosing, in their own club
                      colours, with the crowd style picked below already in it.
                      This ONE canvas is the preview for both selectors below -
                      eight live WebGL contexts on a signup form would be
                      indefensible, and eight drawn thumbnails would only ever
                      be a second, worse depiction of the same ground. */}
                  <div data-testid="stadium-hero" className="goalx-broadcast-panel overflow-hidden">
                    <BroadcastStadiumHero
                      stadiumStyle={stadiumStyle}
                      // A demo capacity purely for this preview - every club
                      // starts small in practice (real seat counts live on the
                      // Stadium row); this shows the architecture at a size
                      // where it actually reads.
                      capacity={22_000}
                      crowdStyle={teamForm.watch("crowdStyle")}
                      primaryColor={color}
                      secondaryColor={secondaryColor}
                      className="aspect-[16/10] w-full sm:aspect-[16/9]"
                    />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold">{t(STADIUM_STYLE_LABEL_KEY[stadiumStyle])}</p>
                    <p className="text-sm text-muted-foreground">{t("team.crowdPreviewHint")}</p>
                  </div>

                  {/* Just a picker. The 3D ground above is the preview, so a
                      tile only has to name the style, say what it is in a
                      line, and show the one or two things that actually differ
                      between grounds - a second depiction on every tile is
                      what these replaced. */}
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {STADIUM_STYLE_ORDER.map((id) => {
                      const selected = stadiumStyle === id
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setStadiumStyle(id)}
                          className={cn("goalx-style-tile", selected && "is-selected")}
                        >
                          <span className="flex items-start justify-between gap-1.5">
                            <span className="text-sm font-bold leading-tight text-white">
                              {t(STADIUM_STYLE_LABEL_KEY[id])}
                            </span>
                            {selected && <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={3} />}
                          </span>
                          <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/55">
                            {t(STADIUM_STYLE_DESC_KEY[id])}
                          </span>
                          <span className="mt-auto block pt-1.5 text-[11px] font-medium leading-snug text-white/70">
                            {getStyleTagKeys(id).map((k) => t(k as TranslationKey)).join(" · ")}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div data-testid="crowd-selector" className="space-y-3">
                  <Label>{t("team.crowdStyle")}</Label>
                  <Controller
                    control={teamForm.control}
                    name="crowdStyle"
                    render={({ field }) => (
                      // No per-tile preview: the real comparison happens in the
                      // 3D ground above, which rebuilds its crowd the moment one
                      // of these is picked - different palette, different home
                      // end, different amount of movement.
                      <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-2 gap-2">
                        {(["calm", "ultras"] as const).map((option) => {
                          const selected = field.value === option
                          return (
                            <label key={option} className={cn("goalx-style-tile cursor-pointer", selected && "is-selected")}>
                              <RadioGroupItem value={option} className="sr-only" />
                              <span className="flex items-start justify-between gap-1.5">
                                <span className="text-sm font-bold leading-tight text-white">
                                  {t(option === "calm" ? "team.crowdStyleCalm" : "team.crowdStyleUltras")}
                                </span>
                                {selected && <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={3} />}
                              </span>
                              <span className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/55">
                                {t(option === "calm" ? "team.crowdCalmTileDesc" : "team.crowdUltrasTileDesc")}
                              </span>
                              <span className="mt-auto block pt-1.5 text-[11px] font-medium leading-snug text-white/70">
                                {CROWD_TRAIT_KEYS[option].map((k) => t(k)).join(" · ")}
                              </span>
                            </label>
                          )
                        })}
                      </RadioGroup>
                    )}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                  />
                  <Label htmlFor="rememberMe" className="text-sm font-normal cursor-pointer">
                    {t("auth.rememberMeSignup")}
                  </Label>
                </div>

                <div className="flex items-center gap-3 border-t border-white/10 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setStep(2)}
                    disabled={isLoading}
                  >
                    {t("signup.back")}
                  </Button>
                  <Button type="submit" size="lg" className="flex-1 gap-2 text-base font-bold shadow-lg" disabled={isLoading}>
                    {t("signup.submit")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </>
        )}

        {isLoading && (
          <GoalXLoadingScreen
            mode="createClub"
            progress={progress}
            status={t(CREATE_CLUB_STATUS_KEYS[statusIndex])}
            error={loadingError}
            onRetry={handleRetry}
            onBack={handleBack}
          />
        )}
      </Card>
    </div>
  )
}
