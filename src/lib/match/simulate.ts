import { prisma } from "@/lib/prisma"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { calculateMatchStadiumRevenue, calculateAttendance } from "@/lib/stadium/attendance"
import { calculateTeamTotalQuality } from "@/lib/players/quality"
import { ensureStadiumForTeam } from "@/lib/stadium/actions"
import { calculateHomeMatchExpenses, calculateAwayTravelCost } from "@/lib/economy/match-expenses"
import { createFinancialTransaction } from "@/lib/economy/service"
import { simulateMatch } from "./engine/engine"
import { buildMatchSnapshot } from "./engine/build-snapshot"
import { generateMatchSeed, SeededRandom } from "./engine/rng"
import { DEFAULT_GAME_BALANCE_CONFIG } from "./engine/config"
import { rollFanIncident, fanIncidentFine } from "./engine/crowd"

// Only a domestic league exists so far - cup/international competitions
// (and their higher cost modifiers) plug in here once they're built.
const CURRENT_COMPETITION = "league" as const

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

  const seed = fixture.matchSeed ?? generateMatchSeed()
  const snapshot = await buildMatchSnapshot(fixtureId, seed)
  const result = simulateMatch(snapshot)

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
  const revenue = calculateMatchStadiumRevenue(attendanceDetail.bySeatType)
  const expenses = calculateHomeMatchExpenses({ capacity }, snapshot.attendance, CURRENT_COMPETITION)
  const awayTravelCost = calculateAwayTravelCost(CURRENT_COMPETITION)

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
  const fine = fanIncident ? fanIncidentFine(DEFAULT_GAME_BALANCE_CONFIG, incidentRng.next()) : 0

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
        homeStats: result.homeStats as unknown as object,
        awayStats: result.awayStats as unknown as object,
      },
    })

    // Mandatory match-day costs/income - these must go through even if the
    // club's balance goes negative as a result; that pressure is the point.
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
export async function processDueFixtures(): Promise<{ processedCount: number; fixtureIds: string[] }> {
  const due = await prisma.fixture.findMany({
    where: { playedAt: null, scheduledAt: { lte: new Date() } },
    select: { id: true },
  })
  for (const fixture of due) {
    await ensureFixtureSimulated(fixture.id)
  }
  return { processedCount: due.length, fixtureIds: due.map((f) => f.id) }
}
