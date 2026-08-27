import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ensureFixtureSimulated } from "@/lib/match/simulate"
import { getSimulatedMinute, hasKickedOff, MATCH_SIMULATED_MINUTES } from "@/lib/match/timing"

export async function GET(_request: Request, { params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true },
  })
  if (!fixture) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }

  await ensureFixtureSimulated(fixtureId)

  const kickedOff = hasKickedOff(fixture.scheduledAt)
  const minute = getSimulatedMinute(fixture.scheduledAt)
  const finished = minute >= MATCH_SIMULATED_MINUTES

  let homeScore = 0
  let awayScore = 0
  let events: { minute: number; teamId: string }[] = []

  if (kickedOff) {
    const allEvents = await prisma.matchEvent.findMany({
      where: { fixtureId },
      orderBy: { minute: "asc" },
    })
    events = allEvents.filter((e) => e.minute <= minute).map((e) => ({ minute: e.minute, teamId: e.teamId }))
    homeScore = events.filter((e) => e.teamId === fixture.homeTeamId).length
    awayScore = events.filter((e) => e.teamId === fixture.awayTeamId).length
  }

  return NextResponse.json({
    status: !kickedOff ? "scheduled" : finished ? "finished" : "live",
    minute,
    scheduledAt: fixture.scheduledAt,
    homeTeam: { id: fixture.homeTeam.id, name: fixture.homeTeam.name },
    awayTeam: { id: fixture.awayTeam.id, name: fixture.awayTeam.name },
    homeScore,
    awayScore,
    events,
  })
}
