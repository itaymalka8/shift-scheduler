import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { CROWD_STYLES, makeAccountSchema, makeTeamDetailsSchema } from "@/lib/validation"
import {
  DEFAULT_CREST_BORDER_COLOR,
  DEFAULT_CREST_COLOR,
  DEFAULT_CREST_ICON,
  DEFAULT_CREST_PATTERN,
  DEFAULT_CREST_SECONDARY_COLOR,
  DEFAULT_CREST_SHAPE,
  isCrestColor,
  isCrestIcon,
  isCrestPattern,
  isCrestShape,
} from "@/components/team-crest"
import { DEFAULT_STADIUM_STYLE, isStadiumStyle } from "@/components/stadium-illustration"

const DEFAULT_STADIUM_CAPACITY = 100

const MAX_CREST_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_CREST_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
}

// Server-side validation is a defense-in-depth check behind the client's
// already-localized zod validation, so the schema's own message text is
// never shown to the user - only the stable `error` code below is.
const noopT = (key: string) => key
const accountSchema = makeAccountSchema(noopT)
const teamDetailsSchema = makeTeamDetailsSchema(noopT)

export async function POST(request: Request) {
  const formData = await request.formData()

  const accountParsed = accountSchema.safeParse({
    name: formData.get("name"),
    teamName: formData.get("teamName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    crestShape: formData.get("crestShape") || undefined,
    crestPattern: formData.get("crestPattern") || undefined,
    crestIcon: formData.get("crestIcon") || undefined,
    crestColor: formData.get("crestColor") || undefined,
    crestSecondaryColor: formData.get("crestSecondaryColor") || undefined,
    crestBorderColor: formData.get("crestBorderColor") || undefined,
  })

  if (!accountParsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  const teamDetailsParsed = teamDetailsSchema.safeParse({
    countryCode: formData.get("countryCode"),
    stadiumName: formData.get("stadiumName"),
    stadiumStyle: formData.get("stadiumStyle") || undefined,
    crowdStyle: formData.get("crowdStyle"),
  })

  if (!teamDetailsParsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  const {
    name,
    teamName,
    email,
    password,
    crestShape,
    crestPattern,
    crestIcon,
    crestColor,
    crestSecondaryColor,
    crestBorderColor,
  } = accountParsed.data
  const { countryCode, stadiumName, stadiumStyle, crowdStyle } = teamDetailsParsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 })
  }

  const crestFile = formData.get("crestImage")
  let crestImageUrl: string | null = null

  if (crestFile instanceof File && crestFile.size > 0) {
    if (crestFile.size > MAX_CREST_SIZE) {
      return NextResponse.json({ error: "CREST_TOO_LARGE" }, { status: 400 })
    }

    const extension = ALLOWED_CREST_TYPES[crestFile.type]
    if (!extension) {
      return NextResponse.json({ error: "CREST_BAD_TYPE" }, { status: 400 })
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
  const resolvedBorder = isCrestColor(crestBorderColor) ? crestBorderColor : DEFAULT_CREST_BORDER_COLOR
  const resolvedPattern = crestImageUrl
    ? null
    : isCrestPattern(crestPattern)
      ? crestPattern
      : DEFAULT_CREST_PATTERN
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
  const resolvedSecondary = crestImageUrl
    ? null
    : isCrestColor(crestSecondaryColor)
      ? crestSecondaryColor
      : DEFAULT_CREST_SECONDARY_COLOR
  const resolvedCrowdStyle = CROWD_STYLES.includes(crowdStyle) ? crowdStyle : "calm"
  const resolvedStadiumStyle = isStadiumStyle(stadiumStyle) ? stadiumStyle : DEFAULT_STADIUM_STYLE

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      team: {
        create: {
          name: teamName,
          crestShape: resolvedShape,
          crestPattern: resolvedPattern,
          crestIcon: resolvedIcon,
          crestColor: resolvedColor,
          crestSecondaryColor: resolvedSecondary,
          crestBorderColor: resolvedBorder,
          crestImageUrl,
          countryCode,
          stadiumName,
          stadiumStyle: resolvedStadiumStyle,
          stadiumCapacity: DEFAULT_STADIUM_CAPACITY,
          crowdStyle: resolvedCrowdStyle,
        },
      },
    },
  })

  return NextResponse.json({ ok: true })
}
