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
import {
  CREST_COLORS,
  CREST_ICON_OPTIONS,
  CREST_SHAPES,
  DEFAULT_CREST_COLOR,
  DEFAULT_CREST_ICON,
  DEFAULT_CREST_SHAPE,
  TeamCrest,
  type CrestShapeId,
} from "@/components/team-crest"

const MAX_CREST_SIZE = 2 * 1024 * 1024
const ALLOWED_CREST_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]

export default function SignUpPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [shape, setShape] = useState<CrestShapeId>(DEFAULT_CREST_SHAPE)
  const [icon, setIcon] = useState<string>(DEFAULT_CREST_ICON)
  const [color, setColor] = useState<string>(DEFAULT_CREST_COLOR)
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
      formData.set("crestShape", shape)

      if (crestFile) {
        formData.set("crestImage", crestFile)
      } else {
        formData.set("crestIcon", icon)
        formData.set("crestColor", color)
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

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center gap-4">
                <TeamCrest shape={shape} icon={icon} color={color} imageUrl={crestPreviewUrl} size={72} />
                <div className="flex-1">
                  <Label>סמל הקבוצה</Label>
                  {crestPreviewUrl && (
                    <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="truncate">{crestFile?.name}</span>
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
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1.5">צורה</p>
                <div className="flex gap-2">
                  {CREST_SHAPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      title={s.label}
                      onClick={() => setShape(s.id)}
                      className={cn(
                        "rounded-full p-0.5 transition-all",
                        shape === s.id
                          ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                          : "opacity-60 hover:opacity-100"
                      )}
                    >
                      <TeamCrest shape={s.id} icon={icon} color={color} size={36} />
                    </button>
                  ))}
                </div>
              </div>

              {!crestPreviewUrl && (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">אייקון</p>
                    <div className="grid grid-cols-7 gap-2">
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
                          <TeamCrest shape="circle" icon={opt.id} color={color} size={32} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">צבע</p>
                    <div className="flex flex-wrap gap-2">
                      {CREST_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          style={{ backgroundColor: c }}
                          className={cn(
                            "size-7 rounded-full transition-all",
                            color === c
                              ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                              : "opacity-70 hover:opacity-100"
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Upload className="size-4" />
                {crestPreviewUrl
                  ? "בחרו קובץ אחר"
                  : "או העלו סמל משלכם (PNG, JPG, WEBP, SVG - עד 2MB)"}
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
