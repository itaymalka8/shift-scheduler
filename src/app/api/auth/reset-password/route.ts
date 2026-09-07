import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const token = typeof body?.token === "string" ? body.token : ""
  // Never lowercased or trimmed - stored and compared exactly as typed.
  const password = typeof body?.password === "string" ? body.password : ""

  if (!token || password.length < 6) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } })
  if (!record || record.expires < new Date()) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(password, 10)

  await prisma.$transaction([
    prisma.user.update({ where: { email: record.identifier }, data: { passwordHash } }),
    prisma.verificationToken.deleteMany({ where: { identifier: record.identifier } }),
  ])

  return NextResponse.json({ ok: true })
}
