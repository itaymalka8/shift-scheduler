import { prisma } from "@/lib/prisma"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { calculateMatchStadiumRevenue, calculateAttendance } from "@/lib/stadium/attendance"
import { calculateTeamTotalQuality } from "@/lib/players/quality"
import { ensureStadiumForTeam } from "@/lib/stadium/actions"
import { assertFixtureLineupsLegal, MatchPreflightError } from "./lineup-preflight"
import { calculateHomeMatchExpenses, calculateAwayTravelCost } from "@/lib/economy/match-expenses"
import { createFinancialTransaction } from "@/lib/economy/service"
import { simulateMatch } from "./engine/engine"
import { buildMatchSnapshot } from "./engine/build-snapshot"
import { generateMatchSeed, SeededRandom } from "./engine/rng"
import { DEFAULT_GAME_BALANCE_CONFIG } from "./engine/config"
import { rollFanIncident, fanIncidentFine } from "./engine/crowd"
import { canGoToShootout, hasNeutralFinances, isNeutralVenue } from "./competition"
import { runShootout } from "./shootout"
import { buildShootoutSide, type TakerCandidate } from "./shootout-takers"

// Only a domestic league exists so far - cup/international competitions
// (and their higher cost modifiers) plug in here once they're built.
const CURRENT_COMPETITION = "league" as const

/**
 * The attributes a shootout needs, for the players who finished the match.
 *
 * One query, explicit select: no names, no club ownership, nothing that
 * could make the shootout depend on anything mutable. The ids come from
 * EngineResult.finalOnPitch, so this asks about the eleven-a-side who were
 * actually on the pitch at the whistle and nobody else.
 */
async function loadTakerCandidates(playerIds: string[]): Promise<TakerCandidate[]> {
  if (playerIds.length === 0) return []
  return prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, primaryPosition: true, penalties: true, penaltySaving: true },
  }).then((rows) =>
    rows.map((r) => ({
      playerId: r.id,
      primaryPosition: r.primaryPosition,
      penalties: r.penalties,
      penaltySaving: r.penaltySaving,
    }))
  )
}

/**
 * Plays a fixture through the match engine the first time it's needed,
 * once kickoff has passed. The engine simulates events and the score falls
 * out of them - nothing here decides a result up front.
 *
 * Runs once per fixture (guarded by `playedAt`), entirely server-side, from
 * a snapshot of the real database state. The stored matchSeed makes the
 * whole thing reproducible.
 */
export async function ensureFixtureSimulated(fixtureId: string): Promise<void> {
  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } })
  if (!fixture || fixture.playedAt) return
  if (!fixture.scheduledAt || fixture.scheduledAt.getTime() > Date.now()) return

  // FAIL CLOSED BEFORE ANYTHING IS SIMULATED. Both clubs are repaired through
  // the canonical lineup service and then judged against the canonical legal
  // XI; a club that still cannot field one throws MatchPreflightError here,
  // which is BEFORE the snapshot, the engine, and every write below. The
  // fixture keeps playedAt = null, so nothing partial exists and the match is
  // still there to be played once the squad is fixed.
  await prisma.$transaction((tx) => assertFixtureLineupsLegal(tx, fixtureId, [fixture.homeTeamId, fixture.awayTeamId]))

  const seed = fixture.matchSeed ?? generateMatchSeed()
  // A championship match - a two-club decider or any playoff fixture - is
  // played on neutral turf: neither club gets the home multiplier or the home
  // crowd. Everything else about the match (the engine, its probabilities,
  // the events, the ratings) is identical.
  //
  // Asked through ./competition.ts rather than by comparing to a stage value
  // here, so that a new championship stage cannot accidentally inherit league
  // behaviour. See that module's header for why this used to be the riskiest
  // line in the feature.
  const neutralVenue = isNeutralVenue(fixture.stage)
  const snapshot = await buildMatchSnapshot(fixtureId, seed, { neutralVenue })
  const result = simulateMatch(snapshot)

  // A decider cannot end level. If the 90 minutes did, the same seed that
  // played the match decides the penalties - salted, exactly as the
  // fan-incident roll is, so the shootout draws its own stream rather than
  // continuing the match's.
  let shootout: { home: number; away: number } | null = null
  if (canGoToShootout(fixture.stage) && result.homeGoals === result.awayGoals) {
    const candidates = await loadTakerCandidates([
      ...result.finalOnPitch.home,
      ...result.finalOnPitch.away,
    ])
    const byId = new Map(candidates.map((c) => [c.playerId, c]))
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((c): c is TakerCandidate => !!c)
    const outcome = runShootout(
      buildShootoutSide(snapshot.home.teamId, pick(result.finalOnPitch.home), snapshot.home.penaltyTakerId),
      buildShootoutSide(snapshot.away.teamId, pick(result.finalOnPitch.away), snapshot.away.penaltyTakerId),
      `${seed}-shootout`
    )
    shootout = { home: outcome.homeScore, away: outcome.awayScore }
  }

  // Gate revenue/expenses for the home side. Attendance comes from the same
  // snapshot the engine ran on, so the crowd that affected the match is the
  // crowd that paid to get in.
  const homeStadium = await ensureStadiumForTeam(fixture.homeTeamId)
  const capacity = calculateStadiumCapacity(toSeatCounts(homeStadium))
  const homePlayers = await prisma.player.findMany({ where: { teamId: fixture.homeTeamId } })
  const attendanceDetail = calculateAttendance(
    { isHome: true },
    { teamTotalQuality: calculateTeamTotalQuality(homePlayers) },
    { seats: toSeatCounts(homeStadium) }
  )
  // NEUTRAL VENUE MEANS NEUTRAL MONEY TOO.
  //
  // League economics are asymmetric by design: the home club takes the gate
  // and pays to host, the away club pays to travel, and only the home crowd
  // can incur a fan fine. At a neutral ground for a one-off title decider
  // every one of those would be an arbitrary advantage handed to whichever
  // club happened to sort first by teamId - which is explicitly a technical
  // role with no sporting meaning.
  //
  // V1 therefore records ZERO club money for a decider rather than splitting
  // a modelled gate. Splitting would require inventing a neutral-venue
  // revenue share, a ticket split and a hosting-cost rule that no part of
  // this game has yet - inventing an economy to avoid an asymmetry is a
  // bigger risk than not paying anyone. The match is still played in full
  // and still draws a crowd; the money is simply not modelled.
  const neutralMoney = hasNeutralFinances(fixture.stage)
  const revenue = neutralMoney ? { total: 0 } : calculateMatchStadiumRevenue(attendanceDetail.bySeatType)
  const expenses = neutralMoney
    ? { total: 0 }
    : calculateHomeMatchExpenses({ capacity }, snapshot.attendance, CURRENT_COMPETITION)
  const awayTravelCost = neutralMoney ? 0 : calculateAwayTravelCost(CURRENT_COMPETITION)

  // Fan incidents are rolled from the same seed, so they're reproducible
  // alongside the match itself.
  const incidentRng = new SeededRandom(`${seed}-fans`)
  const homeLost = result.homeGoals < result.awayGoals
  const fanIncident = rollFanIncident(
    snapshot.fanType,
    { lost: homeLost, cardsAgainst: result.homeStats.yellowCards + result.homeStats.redCards, important: false },
    DEFAULT_GAME_BALANCE_CONFIG,
    incidentRng.next()
  )
  // No home crowd at a neutral venue, so no home-crowd fine either.
  const fine = fanIncident && !neutralMoney ? fanIncidentFine(DEFAULT_GAME_BALANCE_CONFIG, incidentRng.next()) : 0

  await prisma.$transaction(async (tx) => {
    // SELECT ... FOR UPDATE, not a plain findUnique: this actually locks the
    // row at the database level. Two processes racing on the same fixture
    // (two scheduler ticks overlapping, a retry racing the original run)
    // both pass the early-return checks above and both reach here at
    // roughly the same time - under Postgres's default READ COMMITTED
    // isolation a plain SELECT would let both see playedAt as still null
    // and both write. FOR UPDATE forces the second transaction to block
    // until the first commits, then re-read the now-updated row and bail
    // out on the playedAt check below - a real DB-enforced guarantee, not
    // just an application-level check.
    const [fresh] = await tx.$queryRaw<{ id: string; playedAt: Date | null }[]>`
      SELECT "id", "playedAt" FROM "Fixture" WHERE "id" = ${fixtureId} FOR UPDATE
    `
    if (!fresh || fresh.playedAt) return

    await tx.matchEvent.createMany({
      data: result.events.map((e) => ({
        fixtureId,
        minute: e.minute,
        teamId: e.teamId,
        type: e.type,
        playerId: e.playerId ?? null,
        secondaryPlayerId: e.secondaryPlayerId ?? null,
        outcome: e.outcome ?? null,
        context: e.context ? (e.context as object) : undefined,
      })),
    })

    await tx.playerMatchStats.createMany({
      data: result.playerStats.map((s) => ({
        fixtureId,
        playerId: s.playerId,
        teamId: s.teamId,
        minutesPlayed: s.minutesPlayed,
        goals: s.goals,
        assists: s.assists,
        shots: s.shots,
        shotsOnTarget: s.shotsOnTarget,
        passesAttempted: s.passesAttempted,
        passesCompleted: s.passesCompleted,
        keyPasses: s.keyPasses,
        dribblesAttempted: s.dribblesAttempted,
        dribblesCompleted: s.dribblesCompleted,
        tackles: s.tackles,
        interceptions: s.interceptions,
        aerialDuelsWon: s.aerialDuelsWon,
        fouls: s.fouls,
        yellowCards: s.yellowCards,
        redCards: s.redCards,
        saves: s.saves,
        rating: s.rating,
      })),
      skipDuplicates: true,
    })

    await tx.fixture.update({
      where: { id: fixtureId },
      data: {
        homeScore: result.homeGoals,
        awayScore: result.awayGoals,
        playedAt: new Date(),
        matchSeed: seed,
        attendance: snapshot.attendance,
        homeRevenue: revenue.total,
        homeMatchExpense: expenses.total,
        // Null unless penalties were actually taken. The database CHECK
        // constraints refuse a half-written, drawn, or non-decider shootout.
        homeShootoutScore: shootout?.home ?? null,
        awayShootoutScore: shootout?.away ?? null,
        homeStats: result.homeStats as unknown as object,
        awayStats: result.awayStats as unknown as object,
      },
    })

    // Mandatory match-day costs/income - these must go through even if the
    // club's balance goes negative as a result; that pressure is the point.
    //
    // A neutral-venue decider writes NO financial row at all - not a zero
    // row. A zero-valued transaction would still appear in a club's ledger
    // as a match-day entry that earned nothing, which is a worse story than
    // "this competition's finances are not modelled".
    if (!neutralMoney) {
      await createFinancialTransaction(tx, {
        teamId: fixture.homeTeamId,
        type: "matchRevenue",
        amount: revenue.total,
        description: "הכנסות קהל ממשחק בית",
        referenceId: `MATCH_${fixtureId}_HOME_REVENUE`,
      })
      await createFinancialTransaction(tx, {
        teamId: fixture.homeTeamId,
        type: "matchExpense",
        amount: -expenses.total,
        description: "הוצאות אירוח משחק בית",
        referenceId: `MATCH_${fixtureId}_HOME_EXPENSE`,
      })
    }
    if (awayTravelCost > 0) {
      await createFinancialTransaction(tx, {
        teamId: fixture.awayTeamId,
        type: "matchExpense",
        amount: -awayTravelCost,
        description: "הוצאות נסיעה למשחק חוץ",
        referenceId: `MATCH_${fixtureId}_AWAY_TRAVEL`,
      })
    }
    if (fine > 0) {
      await createFinancialTransaction(tx, {
        teamId: fixture.homeTeamId,
        type: "other",
        amount: -fine,
        description: "קנס בעקבות התנהגות אוהדים",
        referenceId: `MATCH_${fixtureId}_FAN_INCIDENT`,
      })
    }
  })
}

/**
 * The one place responsible for turning "kickoff has passed" into a played
 * match, across every division - a scheduled job's entrypoint, never a page
 * load's. Finds every fixture whose time has come, processes each one
 * through ensureFixtureSimulated (which does the actual locking, one
 * fixture at a time - see the FOR UPDATE above), and reports what it did.
 *
 * Never call this from a GET route, a Server Component, or anything else on
 * a navigation path - computeStandings only reads already-played results,
 * and the live match view only reads what's already in the database. A
 * match gets played by this function running on its own schedule, not by
 * someone happening to look.
 */
export async function processDueFixtures(): Promise<{
  processedCount: number
  fixtureIds: string[]
  blocked: { fixtureId: string; code: string; detail: string }[]
}> {
  const due = await prisma.fixture.findMany({
    where: { playedAt: null, scheduledAt: { lte: new Date() } },
    select: { id: true },
  })
  const blocked: { fixtureId: string; code: string; detail: string }[] = []
  for (const fixture of due) {
    try {
      await ensureFixtureSimulated(fixture.id)
    } catch (error) {
      // A club that cannot field a legal XI blocks ITS OWN fixture and
      // nothing else - the rest of the matchday still plays. Reported rather
      // than swallowed, because a league quietly not playing matches is worse
      // than one that says which club is short and why.
      if (error instanceof MatchPreflightError) {
        blocked.push({ fixtureId: fixture.id, code: error.code, detail: error.message })
        continue
      }
      throw error
    }
  }
  return { processedCount: due.length, fixtureIds: due.map((f) => f.id), blocked }
}
