import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { registerSchema } from "@/lib/validation"
import {
  DEFAULT_CREST_COLOR,
  DEFAULT_CREST_ICON,
  DEFAULT_CREST_SHAPE,
  isCrestColor,
  isCrestIcon,
  isCrestShape,
} from "@/components/team-crest"

const MAX_CREST_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_CREST_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
}

export async function POST(request: Request) {
  const formData = await request.formData()

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    teamName: formData.get("teamName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    crestShape: formData.get("crestShape") || undefined,
    crestIcon: formData.get("crestIcon") || undefined,
    crestColor: formData.get("crestColor") || undefined,
  })

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "נתונים לא תקינים" },
      { status: 400 }
    )
  }

  const { name, teamName, email, password, crestShape, crestIcon, crestColor } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json(
      { error: "כבר קיים חשבון עם כתובת האימייל הזו" },
      { status: 409 }
    )
  }

  const crestFile = formData.get("crestImage")
  let crestImageUrl: string | null = null

  if (crestFile instanceof File && crestFile.size > 0) {
    if (crestFile.size > MAX_CREST_SIZE) {
      return NextResponse.json(
        { error: "קובץ הסמל גדול מדי (מקסימום 2MB)" },
        { status: 400 }
      )
    }

    const extension = ALLOWED_CREST_TYPES[crestFile.type]
    if (!extension) {
      return NextResponse.json(
        { error: "סוג קובץ לא נתמך (יש להעלות PNG, JPG, WEBP או SVG)" },
        { status: 400 }
      )
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "crests")
    await mkdir(uploadDir, { recursive: true })

    const filename = `${randomUUID()}.${extension}`
    const buffer = Buffer.from(await crestFile.arrayBuffer())
    await writeFile(path.join(uploadDir, filename), buffer)

    crestImageUrl = `/uploads/crests/${filename}`
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const resolvedShape = isCrestShape(crestShape) ? crestShape : DEFAULT_CREST_SHAPE
  const resolvedIcon = crestImageUrl
    ? null
    : isCrestIcon(crestIcon)
      ? crestIcon
      : DEFAULT_CREST_ICON
  const resolvedColor = crestImageUrl
    ? null
    : isCrestColor(crestColor)
      ? crestColor
      : DEFAULT_CREST_COLOR

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      team: {
        create: {
          name: teamName,
          crestShape: resolvedShape,
          crestIcon: resolvedIcon,
          crestColor: resolvedColor,
          crestImageUrl,
        },
      },
    },
  })

  return NextResponse.json({ ok: true })
}
