import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSimulatedMinute, hasKickedOff, isMatchFinished } from "@/lib/match/timing"
import { computeLiveScore, computeLiveStats } from "@/lib/match/live-view"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"

const CREST_SELECT = {
  id: true,
  name: true,
  crestShape: true,
  crestPattern: true,
  crestIcon: true,
  crestColor: true,
  crestSecondaryColor: true,
  crestBorderColor: true,
  crestImageUrl: true,
} as const

// Read-only: never simulates. A fixture is played by processDueFixtures()
// (see src/lib/match/simulate.ts), run on its own schedule - not by someone
// polling this endpoint while watching. Before the scheduler catches up to
// a just-kicked-off fixture, this correctly reports "live" with zero
// events yet, which is honest (not a bug) rather than a reason to trigger
// the engine from a GET.
//
// SPOILER SAFETY: the whole match is computed and written to the DB in one
// shot at kickoff (see the engine audit) - Fixture.homeScore/awayScore/
// homeStats/awayStats already hold the FINAL result the instant that
// happens, long before the live 10-minute clock has caught up. Those four
// fields are therefore never selected in the query every request runs
// (`fixture` below) - only a second, explicitly finished-gated query further
// down can ever read them, so a live response cannot leak the final result
// even by accident. Everything else (score, stats) is derived fresh, on
// every request, from whichever MatchEvent rows have a minute at or before
// the live clock's current minute.
export async function GET(_request: Request, { params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    select: {
      id: true,
      scheduledAt: true,
      // Not a spoiler on its own (a boolean "has the engine run yet",
      // never the score) - lets the client know whether kickoff activation
      // (POST .../ensure-simulated) is still worth trying, without ever
      // selecting homeScore/awayScore/homeStats/awayStats here.
      playedAt: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: {
        select: {
          ...CREST_SELECT,
          stadiumStyle: true,
          crowdStyle: true,
          stadium: { select: { regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true } },
        },
      },
      awayTeam: { select: CREST_SELECT },
    },
  })
  if (!fixture) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
  }

  // Captured once, right here, and echoed back untouched - the client uses
  // it only to correct for its own clock skew when driving the smooth
  // visual match clock (see use-match-clock.ts). `minute` below is a
  // completely separate, floored value used only to gate event visibility
  // - the two are deliberately never conflated.
  const serverNow = new Date()

  const kickedOff = hasKickedOff(fixture.scheduledAt, serverNow)
  const minute = getSimulatedMinute(fixture.scheduledAt, serverNow)
  const finished = isMatchFinished(fixture.scheduledAt, serverNow)
  const status: "scheduled" | "live" | "finished" = !kickedOff ? "scheduled" : finished ? "finished" : "live"

  const { stadium, ...homeTeam } = fixture.homeTeam
  const stadiumCapacity = stadium ? calculateStadiumCapacity(toSeatCounts(stadium)) : null

  const base = {
    status,
    minute,
    scheduledAt: fixture.scheduledAt,
    serverNow: serverNow.toISOString(),
    // True once ensureFixtureSimulated has actually run for this fixture
    // (Cron, or kickoff activation - see .../ensure-simulated/route.ts).
    // Lets a "live" client tell "kicked off, waiting on simulation" apart
    // from "kicked off, already simulated" without exposing the result.
    simulationReady: !!fixture.playedAt,
    homeTeam: { ...homeTeam, stadiumCapacity },
    awayTeam: fixture.awayTeam,
  }

  if (!kickedOff) {
    return NextResponse.json({ ...base, liveScore: null, events: [], liveStats: null, finalStats: null })
  }

  // Every event the engine ever produced for this fixture is already in the
  // DB - the ONLY thing standing between that and a spoiler is this
  // `lte: minute` filter. It is applied identically whether the match is
  // still live or already finished (a finished match's `minute` is always
  // 90, and the engine never emits an event past minute 90 - see
  // engine.ts), so one filter is both sufficient and safe in either state.
  const revealed = await prisma.matchEvent.findMany({
    where: { fixtureId, minute: { lte: minute } },
    orderBy: [{ minute: "asc" }, { id: "asc" }],
    select: { id: true, minute: true, type: true, teamId: true, playerId: true, secondaryPlayerId: true, outcome: true, context: true },
  })

  // One extra query total (not one per event) to attach player names to the
  // feed without an N+1.
  const playerIds = [...new Set(revealed.flatMap((e) => [e.playerId, e.secondaryPlayerId]).filter((id): id is string => !!id))]
  const players = playerIds.length
    ? await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, firstName: true, lastName: true } })
    : []
  const nameById = new Map(players.map((p) => [p.id, `${p.firstName} ${p.lastName}`]))

  const events = revealed.map((e) => ({
    id: e.id,
    minute: e.minute,
    type: e.type,
    teamId: e.teamId,
    playerId: e.playerId,
    playerName: e.playerId ? (nameById.get(e.playerId) ?? null) : null,
    secondaryPlayerId: e.secondaryPlayerId,
    secondaryPlayerName: e.secondaryPlayerId ? (nameById.get(e.secondaryPlayerId) ?? null) : null,
    outcome: e.outcome,
    context: e.context,
  }))

  const liveScore = computeLiveScore(revealed, fixture.homeTeamId, fixture.awayTeamId)
  const liveStats = computeLiveStats(revealed, fixture.homeTeamId, fixture.awayTeamId)

  let finalStats: { homeScore: number; awayScore: number; home: unknown; away: unknown } | null = null
  if (finished) {
    // Isolated, finished-only read of the authoritative result. This code
    // path is structurally unreachable while `finished` is false, so the
    // real score/stats can never leak into a live response.
    const result = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: { homeScore: true, awayScore: true, homeStats: true, awayStats: true },
    })
    if (result?.homeScore != null && result.awayScore != null) {
      finalStats = { homeScore: result.homeScore, awayScore: result.awayScore, home: result.homeStats, away: result.awayStats }
    }
  }

  return NextResponse.json({ ...base, liveScore, events, liveStats, finalStats })
}
