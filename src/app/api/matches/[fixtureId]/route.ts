import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSimulatedMinute, hasKickedOff, isMatchFinished } from "@/lib/match/timing"
import { computeLiveScore, computeLiveStats } from "@/lib/match/live-view"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import type { PlayerMatchStatView } from "@/lib/match/player-stats-view"

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
      // Which competition this fixture belongs to. Public from the moment
      // the fixture is created - a manager can see "Championship Decider"
      // in their fixture list days beforehand - so it is not a spoiler and
      // belongs in the base query, unlike anything about the result.
      stage: true,
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
    stage: fixture.stage,
    // A decider is played on neutral turf, so the Match Center must not
    // present either club as hosting. Derived from stage rather than stored,
    // because it is the same fact said twice.
    neutralVenue: fixture.stage === "TITLE_DECIDER",
    homeTeam: { ...homeTeam, stadiumCapacity },
    awayTeam: fixture.awayTeam,
  }

  if (!kickedOff) {
    return NextResponse.json({ ...base, liveScore: null, events: [], liveStats: null, finalStats: null, playerStats: null, shootout: null })
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
  /** Penalties, when a decider needed them. Null for every other match, and while live. */
  let shootout: { home: number; away: number } | null = null
  let playerStats: PlayerMatchStatView[] | null = null
  if (finished) {
    // Isolated, finished-only read of the authoritative result. This code
    // path is structurally unreachable while `finished` is false, so the
    // real score/stats can never leak into a live response.
    const result = await prisma.fixture.findUnique({
      where: { id: fixtureId },
      // The shootout scores ride in this SAME finished-only query, for
      // exactly the reason playerStats does: a penalty result is the final
      // score by another name, and a decider's shootout is the most
      // spoiling single number in the game - it names the champion. Being
      // selected only here means the columns never enter the process while
      // the match is live, rather than being fetched and then filtered.
      select: {
        homeScore: true,
        awayScore: true,
        homeStats: true,
        awayStats: true,
        homeShootoutScore: true,
        awayShootoutScore: true,
      },
    })
    if (result?.homeScore != null && result.awayScore != null) {
      finalStats = { homeScore: result.homeScore, awayScore: result.awayScore, home: result.homeStats, away: result.awayStats }
    }
    if (result?.homeShootoutScore != null && result.awayShootoutScore != null) {
      shootout = { home: result.homeShootoutScore, away: result.awayShootoutScore }
    }

    // PER-PLAYER STATISTICS - deliberately INSIDE this same finished-only
    // branch, not beside it.
    //
    // PlayerMatchStats rows carry no minute dimension: the engine writes
    // each player's complete 90-minute totals in one shot at kickoff, the
    // same instant the final score lands. There is no "as of minute 36"
    // form of this data anywhere in the schema, so there is nothing here
    // that could be safely revealed part-way through. A striker showing
    // `goals: 2` at simulated minute 10 would announce the result of a
    // match the viewer is still watching.
    //
    // Placing the query inside the branch rather than guarding it with its
    // own `if` is the point: this line is unreachable while `finished` is
    // false, so a live request never issues the query at all - the rows
    // never enter the process, rather than entering it and being filtered
    // out afterwards. The route's tests assert exactly that, by checking
    // findMany was never called.
    //
    // `finished` is isMatchFinished(scheduledAt, now) - the canonical clock
    // rule. Never playedAt, which only says the engine has run and is true
    // from kickoff onward (see this file's header).
    //
    // One query, explicit select (never `include: { player: true }` - the
    // Player row carries ~70 attribute columns this screen has no use for),
    // one nested select for the four fields the UI needs. No N+1: the
    // @@unique([fixtureId, playerId]) index leads with fixtureId, so this
    // is a single index seek returning ~28 rows.
    const rows = await prisma.playerMatchStats.findMany({
      where: { fixtureId },
      select: {
        playerId: true,
        // The HISTORICAL club - a snapshot of who this player turned out
        // for on the day. Never player.teamId, which is current ownership.
        teamId: true,
        minutesPlayed: true,
        goals: true,
        assists: true,
        shots: true,
        shotsOnTarget: true,
        passesAttempted: true,
        passesCompleted: true,
        keyPasses: true,
        dribblesAttempted: true,
        dribblesCompleted: true,
        tackles: true,
        interceptions: true,
        aerialDuelsWon: true,
        fouls: true,
        yellowCards: true,
        redCards: true,
        saves: true,
        rating: true,
        player: { select: { firstName: true, lastName: true, primaryPosition: true, shirtNumber: true } },
      },
    })

    // Flattened, and nothing invented: only rows that exist are returned.
    // The engine writes a row solely for a player who took the pitch
    // (minutesPlayed > 0 || onPitch), so an unused substitute simply has no
    // line here - never a fabricated row of zeroes.
    playerStats = rows.map(({ player, ...stat }) => ({
      ...stat,
      firstName: player.firstName,
      lastName: player.lastName,
      primaryPosition: player.primaryPosition,
      shirtNumber: player.shirtNumber,
    }))
  }

  return NextResponse.json({ ...base, liveScore, events, liveStats, finalStats, playerStats, shootout })
}
