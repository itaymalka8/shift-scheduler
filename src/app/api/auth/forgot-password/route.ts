import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma"
import { isRateLimited, recordFailedAttempt } from "@/lib/rate-limit"

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const rawEmail = typeof body?.email === "string" ? body.email : ""
  const email = rawEmail.trim().toLowerCase()

  // Always respond the same way whether or not the email is valid/known -
  // this endpoint must never reveal account existence (see the identical
  // response below).
  if (!email) {
    return NextResponse.json({ ok: true })
  }

  const rateLimitKey = `forgot:${email}`
  if (isRateLimited(rateLimitKey)) {
    return NextResponse.json({ ok: true })
  }
  recordFailedAttempt(rateLimitKey)

  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    const token = randomBytes(32).toString("hex")
    // Reusing the NextAuth adapter's VerificationToken model rather than a
    // bespoke one - identifier holds the email, same as NextAuth's own
    // email-provider flow would use it.
    await prisma.verificationToken.deleteMany({ where: { identifier: email } })
    await prisma.verificationToken.create({
      data: { identifier: email, token, expires: new Date(Date.now() + TOKEN_TTL_MS) },
    })

    // No mail provider is configured yet in this project (same gap as the
    // Apple OAuth credentials) - logging the link server-side keeps the
    // reset flow usable/testable until one is wired up.
    console.log(`Password reset requested for ${email}: /reset-password?token=${token}`)
  }

  return NextResponse.json({ ok: true })
}
