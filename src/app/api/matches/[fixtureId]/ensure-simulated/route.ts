import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ensureFixtureSimulated } from "@/lib/match/simulate"

/**
 * Kickoff activation: lets a Match Center client that's actually watching a
 * fixture trigger its simulation the moment kickoff arrives, instead of
 * waiting for the next Cron tick (up to ~2 minutes away - see render.yaml).
 * The Cron is NOT removed and keeps running unchanged as the fallback for
 * every fixture nobody is watching; this endpoint only closes the gap for
 * the fixture a real viewer's clock says has just kicked off.
 *
 * Accepts NOTHING from the client but the fixtureId in the URL - no score,
 * no events, no teamId, no minute, no scheduledAt. Every fact this route
 * acts on (whether kickoff has passed, whether the match is already played)
 * is re-read from the database, never taken from the request body. It does
 * not reimplement simulation: it calls the exact same ensureFixtureSimulated
 * the Cron itself uses (see src/lib/match/simulate.ts), which owns the real
 * concurrency protection (a `SELECT ... FOR UPDATE` row lock) - so two
 * clients racing this endpoint for the same fixture, or a client racing the
 * Cron, can never produce two simulations of the same match.
 *
 * The response is deliberately minimal and carries no spoiler: at most
 * `ready` and `alreadySimulated`, never a score, an event, or match stats.
 * Live score/stats/events continue to come exclusively from the read-only
 * GET /api/matches/[fixtureId].
 *
 * AUTHORIZATION: being logged in is not enough - only the manager of the
 * home or away team actually playing in this fixture may trigger it. The
 * candidate teamId is never taken from the client (there is no request
 * body at all); it's resolved purely from the Fixture's own homeTeam/
 * awayTeam.userId, compared against the session's user id. Anyone else
 * (a spectator, or the manager of an unrelated team) gets 403 with no
 * database write and no call to ensureFixtureSimulated - this specifically
 * prevents an authenticated-but-unrelated user from mass-triggering
 * simulation across fixtures they have no stake in. The Cron remains the
 * one responsible for a fixture neither manager happens to be watching.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ fixtureId: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const { fixtureId } = await params

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    select: {
      id: true,
      scheduledAt: true,
      playedAt: true,
      homeTeam: { select: { userId: true } },
      awayTeam: { select: { userId: true } },
    },
  })
  if (!fixture) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }

  const isMatchManager = fixture.homeTeam.userId === session.user.id || fixture.awayTeam.userId === session.user.id
  if (!isMatchManager) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
  }

  if (fixture.playedAt) {
    return NextResponse.json({ ready: true, alreadySimulated: true })
  }

  if (!fixture.scheduledAt || fixture.scheduledAt.getTime() > Date.now()) {
    return NextResponse.json({ ready: false, alreadySimulated: false, reason: "NOT_KICKED_OFF" })
  }

  await ensureFixtureSimulated(fixtureId)

  // Re-read the true post-state rather than assuming this call was the one
  // that actually wrote it - a concurrent caller (another viewer, or the
  // Cron firing at the same moment) may have won the row lock instead; the
  // database is always the source of truth for what happened.
  const after = await prisma.fixture.findUnique({ where: { id: fixtureId }, select: { playedAt: true } })

  return NextResponse.json({ ready: !!after?.playedAt, alreadySimulated: false })
}
