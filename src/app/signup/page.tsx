"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useRef, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { Upload, X } from "lucide-react"
import {
  makeAccountSchema,
  makeTeamDetailsSchema,
  type AccountInput,
  type TeamDetailsInput,
} from "@/lib/validation"
import { markLoginRemember } from "@/lib/remember-me"
import { useLocale, useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import { getCountryOptions } from "@/lib/countries"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { CrowdIllustration } from "@/components/crowd-illustration"
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
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {CREST_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            style={{ backgroundColor: c }}
            className={cn(
              "size-6 rounded-full border border-black/10 transition-all",
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
  const [step, setStep] = useState<1 | 2>(1)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)

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

  const teamForm = useForm<TeamDetailsInput>({
    resolver: zodResolver(makeTeamDetailsSchema(t)),
    defaultValues: { crowdStyle: "calm", stadiumName: "", countryCode: "" },
  })

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

  const goToStep2 = () => {
    const teamName = accountForm.getValues("teamName")
    if (!teamForm.getValues("stadiumName") && teamName) {
      teamForm.setValue("stadiumName", teamName)
    }
    setStep(2)
  }

  const onFinalSubmit = async (teamDetails: TeamDetailsInput) => {
    const account = accountForm.getValues()
    setServerError(null)
    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.set("name", account.name)
      formData.set("teamName", account.teamName)
      formData.set("email", account.email)
      formData.set("password", account.password)
      formData.set("confirmPassword", account.confirmPassword)
      formData.set("crestShape", shape)
      formData.set("crestBorderColor", borderColor)
      formData.set("countryCode", teamDetails.countryCode)
      formData.set("stadiumName", teamDetails.stadiumName)
      formData.set("crowdStyle", teamDetails.crowdStyle)

      if (crestFile) {
        formData.set("crestImage", crestFile)
      } else {
        formData.set("crestPattern", pattern)
        formData.set("crestIcon", icon)
        formData.set("crestColor", color)
        formData.set("crestSecondaryColor", secondaryColor)
      }

      const res = await fetch("/api/register", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const body = await res.json()
        const code = body.error as string | undefined
        const key = (code ? `error.${code}` : "error.GENERIC") as TranslationKey
        setServerError(t(key) === key ? t("error.GENERIC") : t(key))
        return
      }

      const signInResult = await signIn("credentials", {
        email: account.email,
        password: account.password,
        redirect: false,
      })

      if (signInResult?.error) {
        setServerError(t("signup.signupSucceededSigninFailed"))
        router.push("/signin")
        return
      }

      markLoginRemember(rememberMe)
      router.push("/dashboard")
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="goalx-hero-gradient min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg flex justify-end mb-2">
        <LanguageSwitcher variant="dark" />
      </div>
      <Link href="/" className="mb-6">
        <Image src="/logo.png" alt="Goalx Manager" width={72} height={72} className="rounded-full" />
      </Link>

      <Card className="w-full max-w-lg">
        {step === 1 ? (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">{t("signup.title")}</CardTitle>
              <CardDescription>{t("signup.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OAuthButtons />

              <form onSubmit={accountForm.handleSubmit(goToStep2)} className="space-y-4">
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
                  <Label htmlFor="teamName">{t("auth.teamName")}</Label>
                  <Input id="teamName" type="text" {...accountForm.register("teamName")} />
                  {accountForm.formState.errors.teamName && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.teamName.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">{t("auth.email")}</Label>
                  <Input id="email" type="email" autoComplete="email" {...accountForm.register("email")} />
                  {accountForm.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    {...accountForm.register("password")}
                  />
                  {accountForm.formState.errors.password && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    {...accountForm.register("confirmPassword")}
                  />
                  {accountForm.formState.errors.confirmPassword && (
                    <p className="text-sm text-destructive">
                      {accountForm.formState.errors.confirmPassword.message}
                    </p>
                  )}
                </div>

                <div className="space-y-4 border-t pt-4">
                  <div className="flex items-center gap-4">
                    <TeamCrest
                      shape={shape}
                      pattern={pattern}
                      icon={icon}
                      color={color}
                      secondaryColor={secondaryColor}
                      borderColor={borderColor}
                      imageUrl={crestPreviewUrl}
                      size={80}
                    />
                    <div className="flex-1">
                      <Label>{t("crest.title")}</Label>
                      {crestPreviewUrl && (
                        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="truncate">{crestFile?.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={clearUploadedFile}
                            aria-label={t("crest.removeFile")}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">{t("crest.shape")}</p>
                    <div className="flex gap-2">
                      {CREST_SHAPES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          title={t(SHAPE_LABEL_KEY[s.id])}
                          onClick={() => setShape(s.id)}
                          className={cn(
                            "rounded-full p-0.5 transition-all",
                            shape === s.id
                              ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                              : "opacity-60 hover:opacity-100"
                          )}
                        >
                          <TeamCrest
                            shape={s.id}
                            pattern={pattern}
                            icon={icon}
                            color={color}
                            secondaryColor={secondaryColor}
                            borderColor={borderColor}
                            size={40}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {!crestPreviewUrl && (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1.5">{t("crest.pattern")}</p>
                        <div className="flex gap-2">
                          {CREST_PATTERNS.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              title={t(PATTERN_LABEL_KEY[p.id])}
                              onClick={() => setPattern(p.id)}
                              className={cn(
                                "rounded-full p-0.5 transition-all",
                                pattern === p.id
                                  ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                                  : "opacity-60 hover:opacity-100"
                              )}
                            >
                              <TeamCrest
                                shape={shape}
                                pattern={p.id}
                                icon={icon}
                                color={color}
                                secondaryColor={secondaryColor}
                                borderColor={borderColor}
                                size={40}
                              />
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
                        <p className="text-xs text-muted-foreground mb-1.5">{t("crest.icon")}</p>
                        <div className="grid grid-cols-7 gap-1.5">
                          {CREST_ICON_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setIcon(opt.id)}
                              className={cn(
                                "rounded-full p-0.5 transition-all",
                                icon === opt.id
                                  ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                                  : "opacity-60 hover:opacity-100"
                              )}
                            >
                              <TeamCrest
                                shape="circle"
                                pattern="solid"
                                icon={opt.id}
                                color={color}
                                borderColor={color}
                                size={30}
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
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
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

                <Button type="submit" className="w-full">
                  {t("signup.next")}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {t("signup.alreadyHaveTeam")}{" "}
                <Link href="/signin" className="text-primary font-medium hover:underline">
                  {t("signup.signInHere")}
                </Link>
              </p>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="text-2xl">{t("team.title")}</CardTitle>
              <CardDescription>{t("team.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={teamForm.handleSubmit(onFinalSubmit)} className="space-y-4">
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

                <div className="space-y-2">
                  <Label>{t("team.crowdStyle")}</Label>
                  <Controller
                    control={teamForm.control}
                    name="crowdStyle"
                    render={({ field }) => (
                      <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-3">
                        <label
                          className={cn(
                            "block rounded-lg border p-3 cursor-pointer transition-colors overflow-hidden",
                            field.value === "calm" ? "border-primary bg-primary/5" : "border-border"
                          )}
                        >
                          <CrowdIllustration style="calm" className="w-full h-24 rounded-md mb-3" />
                          <span className="flex items-start gap-3">
                            <RadioGroupItem value="calm" className="mt-1" />
                            <span>
                              <span className="block font-medium">{t("team.crowdStyleCalm")}</span>
                              <span className="block text-sm text-muted-foreground">
                                {t("team.crowdStyleCalmDesc")}
                              </span>
                            </span>
                          </span>
                        </label>
                        <label
                          className={cn(
                            "block rounded-lg border p-3 cursor-pointer transition-colors overflow-hidden",
                            field.value === "ultras" ? "border-primary bg-primary/5" : "border-border"
                          )}
                        >
                          <CrowdIllustration style="ultras" className="w-full h-24 rounded-md mb-3" />
                          <span className="flex items-start gap-3">
                            <RadioGroupItem value="ultras" className="mt-1" />
                            <span>
                              <span className="block font-medium">{t("team.crowdStyleUltras")}</span>
                              <span className="block text-sm text-muted-foreground">
                                {t("team.crowdStyleUltrasDesc")}
                              </span>
                            </span>
                          </span>
                        </label>
                      </RadioGroup>
                    )}
                  />
                </div>

                {serverError && (
                  <p className="text-sm text-destructive text-center">{serverError}</p>
                )}

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStep(1)}
                    disabled={isSubmitting}
                  >
                    {t("signup.back")}
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isSubmitting}>
                    {isSubmitting ? t("signup.submitting") : t("signup.submit")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
