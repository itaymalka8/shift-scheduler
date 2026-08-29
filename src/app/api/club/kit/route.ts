import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isKitTemplateId } from "@/components/kit/jersey-preview"
import { isValidHexColor } from "@/lib/kits/validation"

/**
 * Saves the signed-in manager's own HOME kit - never any other team's.
 * teamId always comes from the session -> Team lookup below, never from
 * the request body, so a client can't touch a kit it doesn't own by
 * passing a different id.
 */
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
  const { template, primaryColor, secondaryColor, accentColor } = body ?? {}

  if (!isKitTemplateId(template)) {
    return NextResponse.json({ error: "INVALID_TEMPLATE" }, { status: 400 })
  }
  if (![primaryColor, secondaryColor, accentColor].every(isValidHexColor)) {
    return NextResponse.json({ error: "INVALID_COLOR" }, { status: 400 })
  }

  const kit = await prisma.teamKit.upsert({
    where: { teamId_type: { teamId: team.id, type: "HOME" } },
    create: { teamId: team.id, type: "HOME", template, primaryColor, secondaryColor, accentColor },
    update: { template, primaryColor, secondaryColor, accentColor },
  })

  return NextResponse.json({
    template: kit.template,
    primaryColor: kit.primaryColor,
    secondaryColor: kit.secondaryColor,
    accentColor: kit.accentColor,
  })
}
