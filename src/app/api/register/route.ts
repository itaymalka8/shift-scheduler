import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { CROWD_STYLES, makeAccountSchema, makeTeamDetailsSchema, makeTeamIdentitySchema } from "@/lib/validation"
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
import { ensureIsraelSeasonSeeded } from "@/lib/leagues/seed"
import { pickBotTeamForNewSignup } from "@/lib/leagues/assign"
import { generateSquad } from "@/lib/players/generate"

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
const teamIdentitySchema = makeTeamIdentitySchema(noopT)
const teamDetailsSchema = makeTeamDetailsSchema(noopT)

export async function POST(request: Request) {
  const formData = await request.formData()

  const accountParsed = accountSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  })

  if (!accountParsed.success) {
    const isWeakPassword = accountParsed.error.issues.every((issue) => issue.path[0] === "password")
    return NextResponse.json({ error: isWeakPassword ? "WEAK_PASSWORD" : "VALIDATION_ERROR" }, { status: 400 })
  }

  const teamIdentityParsed = teamIdentitySchema.safeParse({
    teamName: formData.get("teamName"),
    crestShape: formData.get("crestShape") || undefined,
    crestPattern: formData.get("crestPattern") || undefined,
    crestIcon: formData.get("crestIcon") || undefined,
    crestColor: formData.get("crestColor") || undefined,
    crestSecondaryColor: formData.get("crestSecondaryColor") || undefined,
    crestBorderColor: formData.get("crestBorderColor") || undefined,
  })

  if (!teamIdentityParsed.success) {
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

  const { name, password } = accountParsed.data
  const email = accountParsed.data.email.trim().toLowerCase()
  const {
    teamName,
    crestShape,
    crestPattern,
    crestIcon,
    crestColor,
    crestSecondaryColor,
    crestBorderColor,
  } = teamIdentityParsed.data
  const { countryCode, stadiumName, stadiumStyle, crowdStyle } = teamDetailsParsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: "EMAIL_ALREADY_EXISTS" }, { status: 409 })
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

  if (countryCode === "IL") {
    await ensureIsraelSeasonSeeded()
  }

  const teamData = {
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
  }

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, passwordHash } })

      // Real signups take over an existing bot team's slot (and fixtures)
      // instead of joining without a division - see pickBotTeamForNewSignup.
      const botTeamId = countryCode === "IL" ? await pickBotTeamForNewSignup(tx) : null

      if (botTeamId) {
        // Inherits the bot's already-generated squad and fixtures as-is.
        await tx.team.update({ where: { id: botTeamId }, data: { ...teamData, userId: user.id, isBot: false } })
      } else {
        const team = await tx.team.create({ data: { ...teamData, userId: user.id } })
        await generateSquad(tx, team.id)
      }
    })
  } catch (error) {
    // Two concurrent requests can both pass the `existing` check above and
    // then race into user.create - the DB's unique constraint on email is
    // the real guard, so a P2002 violation here still means "already
    // registered", not a server error. Since user+team creation is one
    // transaction, any other failure rolls back user.create too - there is
    // no half-registered user left behind by this path.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "EMAIL_ALREADY_EXISTS" }, { status: 409 })
    }
    console.error("Registration failed", error)
    return NextResponse.json({ error: "UNKNOWN_ERROR" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
