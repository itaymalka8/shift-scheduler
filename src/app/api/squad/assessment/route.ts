import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { buildTeamSnapshot } from "@/lib/match/engine/build-snapshot"
import { assessTactics } from "@/lib/match/engine/coach-advice"

/**
 * Read-only "how good is my current plan" check, computed with the exact
 * same engine logic (calculateTacticalFit / assessTactics) the match
 * simulation itself uses - so the number shown here is never a separate,
 * possibly-inconsistent UI estimate.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) {
    return NextResponse.json({ error: "NO_TEAM" }, { status: 404 })
  }

  const snapshot = await buildTeamSnapshot(team.id)
  const assessment = assessTactics(snapshot.starters, snapshot.tactics)

  return NextResponse.json(assessment)
}
