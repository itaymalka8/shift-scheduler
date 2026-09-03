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
import { ensureBotEra, lockTeamRow, recordHumanTakeover } from "@/lib/teams/eras"
import { generateSquad } from "@/lib/players/generate"
import { DEFAULT_STARTING_SEATS, toSeatColumns } from "@/lib/stadium/config"

// Tags exactly where inside the registration transaction a failure happened,
// so the catch block can return a specific error code instead of collapsing
// every failure into one generic message - the underlying cause always still
// goes to the server log (see the catch block), never to the client.
class LeagueSetupError extends Error {
  constructor(public readonly cause: unknown) {
    super("League setup failed")
  }
}
class SquadGenerationError extends Error {
  constructor(public readonly cause: unknown) {
    super("Squad generation failed")
  }
}
/**
 * Raised when the bot club this signup picked was claimed by another
 * registration first. Not a server fault - the whole transaction rolls back
 * (the user row included) and the caller is told to try again, which will
 * pick a different free slot.
 */
class TeamTakenOverError extends Error {
  constructor() {
    super("Bot team was claimed by another registration")
  }
}

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
    stadiumStyle: resolvedStadiumStyle,
    crowdStyle: resolvedCrowdStyle,
  }

  try {
    // Runs before the user/team transaction and manages its own (idempotent)
    // transaction internally - if it fails, nothing below has been written
    // yet, so a retry (e.g. the user submitting again) starts clean.
    if (countryCode === "IL") {
      try {
        await ensureIsraelSeasonSeeded()
      } catch (cause) {
        throw new LeagueSetupError(cause)
      }
    }

    await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({ data: { name, email, passwordHash } })

        // Real signups take over an existing bot team's slot (and fixtures)
        // instead of joining without a division - see pickBotTeamForNewSignup.
        const botTeamId = countryCode === "IL" ? await pickBotTeamForNewSignup(tx) : null

        if (botTeamId) {
          // THE TAKEOVER. Everything from here to the end of this branch is
          // one atomic step: the club is never HUMAN without a HUMAN era to
          // attribute its matches to, and never has an era for a user whose
          // Team.userId was rolled back.
          //
          // The row lock comes FIRST and is the real concurrency guard.
          // pickBotTeamForNewSignup reads under READ COMMITTED, so two
          // concurrent signups can both see the same club as a free bot;
          // without this lock both would write and the second would silently
          // overwrite the first's userId, leaving one manager with no club.
          // The loser of the race blocks here, then finds isBot already
          // false below and picks a different slot on retry.
          if (!(await lockTeamRow(tx, botTeamId))) {
            throw new TeamTakenOverError()
          }

          // Re-read AFTER the lock, never before: only a read that happens
          // while holding the lock can be trusted to still be true when we
          // write.
          const locked = await tx.team.findUniqueOrThrow({
            where: { id: botTeamId },
            select: { isBot: true, userId: true, createdAt: true },
          })
          if (!locked.isBot || locked.userId !== null) {
            throw new TeamTakenOverError()
          }

          // One instant for the whole handover, so the outgoing era's
          // endedAt and the incoming era's startedAt are byte-identical and
          // the [startedAt, endedAt) window has neither a gap nor an
          // overlap. A match kicking off exactly now belongs to the new
          // manager.
          const takeoverAt = new Date()

          // Backfill has not necessarily run for this club, and a takeover
          // must not depend on it having: if the bot era is missing, open it
          // from the club's own createdAt (the same deterministic source the
          // backfill uses) so the handover always has something to close.
          await ensureBotEra(tx, botTeamId, locked.createdAt)

          // Inherits the bot's already-generated squad, fixtures, and stadium
          // seats as-is - only the stadium's name changes to the one picked at signup.
          await tx.team.update({ where: { id: botTeamId }, data: { ...teamData, userId: user.id, isBot: false } })
          await tx.stadium.update({ where: { teamId: botTeamId }, data: { name: stadiumName } })
          await recordHumanTakeover(tx, { teamId: botTeamId, userId: user.id, at: takeoverAt })
        } else {
          const team = await tx.team.create({ data: { ...teamData, userId: user.id } })
          try {
            await generateSquad(tx, team.id)
          } catch (cause) {
            throw new SquadGenerationError(cause)
          }
          await tx.stadium.create({ data: { teamId: team.id, name: stadiumName, ...toSeatColumns(DEFAULT_STARTING_SEATS) } })
          // Born human: one open HUMAN era from the club's creation. There
          // is no bot era to close, because this club was never a bot.
          await tx.teamEra.create({ data: { teamId: team.id, userId: user.id, type: "HUMAN", startedAt: team.createdAt } })
        }
      },
      // The default 5s transaction timeout is tight for a multi-step write
      // against a remote/serverless Postgres (Neon) - a cold-started compute
      // alone can eat a meaningful chunk of that. This is still one atomic
      // transaction: any failure below rolls back user.create too, so there
      // is never a half-registered user (a user row without a team) left
      // behind by this path.
      { timeout: 15000 }
    )
  } catch (error) {
    // Two concurrent requests can both pass the `existing` check above and
    // then race into user.create - the DB's unique constraint on email is
    // the real guard, so a P2002 violation here still means "already
    // registered", not a server error.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "EMAIL_ALREADY_EXISTS" }, { status: 409 })
    }
    if (error instanceof LeagueSetupError) {
      console.error("Registration failed: league setup error", error.cause)
      return NextResponse.json({ error: "LEAGUE_SETUP_FAILED" }, { status: 500 })
    }
    if (error instanceof TeamTakenOverError) {
      // Also the shape a lost race takes if two transactions somehow reach
      // the era insert together: the partial unique index
      // (UNIQUE("teamId") WHERE "endedAt" IS NULL) rejects the second.
      return NextResponse.json({ error: "TEAM_TAKEN_TRY_AGAIN" }, { status: 409 })
    }
    if (error instanceof SquadGenerationError) {
      console.error("Registration failed: squad generation error", error.cause)
      return NextResponse.json({ error: "SQUAD_GENERATION_FAILED" }, { status: 500 })
    }
    // Full detail always goes to the server log for debugging - never to the
    // client, which only ever sees the stable code below.
    console.error("Registration failed: database error", error)
    return NextResponse.json({ error: "DATABASE_ERROR" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
