"use client"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { signIn } from "next-auth/react"
import { Upload, X } from "lucide-react"
import { registerSchema, type RegisterInput } from "@/lib/validation"
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
import { cn } from "@/lib/utils"
import { CREST_PRESETS, DEFAULT_CREST_PRESET, TeamCrest } from "@/components/team-crest"

const MAX_CREST_SIZE = 2 * 1024 * 1024
const ALLOWED_CREST_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]

export default function SignUpPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string>(DEFAULT_CREST_PRESET)
  const [crestFile, setCrestFile] = useState<File | null>(null)
  const [crestPreviewUrl, setCrestPreviewUrl] = useState<string | null>(null)
  const [crestError, setCrestError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_CREST_TYPES.includes(file.type)) {
      setCrestError("סוג קובץ לא נתמך (PNG, JPG, WEBP או SVG)")
      return
    }
    if (file.size > MAX_CREST_SIZE) {
      setCrestError("הקובץ גדול מדי (מקסימום 2MB)")
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

  const onSubmit = async (data: RegisterInput) => {
    setServerError(null)
    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.set("name", data.name)
      formData.set("teamName", data.teamName)
      formData.set("email", data.email)
      formData.set("password", data.password)
      formData.set("confirmPassword", data.confirmPassword)

      if (crestFile) {
        formData.set("crestImage", crestFile)
      } else {
        formData.set("crestPreset", selectedPreset)
      }

      const res = await fetch("/api/register", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const body = await res.json()
        setServerError(body.error ?? "ההרשמה נכשלה")
        return
      }

      const signInResult = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      })

      if (signInResult?.error) {
        setServerError("ההרשמה הצליחה אך ההתחברות נכשלה, נסו להתחבר ידנית")
        router.push("/signin")
        return
      }

      router.push("/dashboard")
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="goalx-hero-gradient min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-6">
        <Image src="/logo.png" alt="Goalx Manager" width={72} height={72} className="rounded-full" />
      </Link>

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">הקמת קבוצה חדשה</CardTitle>
          <CardDescription>מלאו את הפרטים כדי להתחיל לנהל את הקבוצה שלכם</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">שם מלא</Label>
              <Input id="name" type="text" autoComplete="name" {...register("name")} />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="teamName">שם הקבוצה</Label>
              <Input id="teamName" type="text" {...register("teamName")} />
              {errors.teamName && (
                <p className="text-sm text-destructive">{errors.teamName.message}</p>
              )}
            </div>

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
                autoComplete="new-password"
                {...register("password")}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">אימות סיסמה</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label>סמל הקבוצה</Label>

              {crestPreviewUrl ? (
                <div className="flex items-center gap-3">
                  <TeamCrest imageUrl={crestPreviewUrl} size={56} />
                  <div className="flex-1 text-sm text-muted-foreground">
                    {crestFile?.name}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={clearUploadedFile}
                    aria-label="הסירו קובץ"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-5 sm:grid-cols-9 gap-2">
                    {CREST_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.label}
                        onClick={() => setSelectedPreset(preset.id)}
                        className={cn(
                          "rounded-full transition-all",
                          selectedPreset === preset.id
                            ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                            : "opacity-70 hover:opacity-100"
                        )}
                      >
                        <TeamCrest preset={preset.id} size={44} />
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Upload className="size-4" />
                    או העלו סמל משלכם (PNG, JPG, WEBP, SVG - עד 2MB)
                  </button>
                </>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleFileChange}
                className="hidden"
              />

              {crestError && <p className="text-sm text-destructive">{crestError}</p>}
            </div>

            {serverError && (
              <p className="text-sm text-destructive text-center">{serverError}</p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "יוצר קבוצה..." : "צרו את הקבוצה שלי"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            כבר יש לכם קבוצה?{" "}
            <Link href="/signin" className="text-primary font-medium hover:underline">
              התחברו כאן
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
