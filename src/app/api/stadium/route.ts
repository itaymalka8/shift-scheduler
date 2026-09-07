import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const MAX_NAME_LENGTH = 40

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) {
    return NextResponse.json({ error: "NO_TEAM" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const rawName = typeof body?.name === "string" ? body.name : ""
  // Strip markup and control characters and collapse whitespace before length-checking.
  const name = rawName
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)

  if (!name) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 })
  }

  const stadium = await prisma.stadium.update({ where: { teamId: team.id }, data: { name } })
  return NextResponse.json({ name: stadium.name })
}
