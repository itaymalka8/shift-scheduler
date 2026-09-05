import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { calculateMatchStadiumRevenue, calculateAttendance } from "@/lib/stadium/attendance"
import { calculateTeamTotalQuality } from "@/lib/players/quality"
import { readSeatsAsOf } from "@/lib/stadium/actions"
import { assertFixtureLineupsLegal, MatchPreflightError } from "./lineup-preflight"
import { settlePriorConsequences } from "./consequence-service"
import { lockTeamSquads } from "@/lib/players/locks"
import { lockTeamRosters } from "@/lib/players/roster"
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
 *
 * Reads through the match's own transaction, like everything else the result
 * depends on.
 */
async function loadTakerCandidates(
  db: Prisma.TransactionClient,
  playerIds: string[]
): Promise<TakerCandidate[]> {
  if (playerIds.length === 0) return []
  return db.player.findMany({
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
 *
 * ==================== TWO THINGS MUST BE TRUE FIRST =======================
 *
 * 1. THE PAST MUST BE SETTLED. Every earlier fixture of either club that the
 *    public has already seen finish must have had its consequences applied.
 *    Otherwise a cron outage lets Wednesday be simulated from Monday-morning
 *    squads: a player sent off on Monday plays, an injury does not exist yet,
 *    Monday's fatigue is never paid, and the result is recorded forever. This
 *    is settled through the ONE canonical activation service, before the
 *    transaction below opens - because each prior fixture is applied in its
 *    own transaction and must be committed, not nested.
 *
 * 2. THE XI THAT IS JUDGED MUST BE THE XI THAT PLAYS. Legality, the snapshot
 *    and the simulation all happen inside ONE transaction that first locks
 *    the fixture, then every player of both clubs, then both clubs. Every
 *    path that can remove a player - Purchase, Release, Retirement, Listing -
 *    takes that same Player row lock as its own first statement, so none of
 *    them can slip a sale in between the check and the whistle. Before this,
 *    legality was proved in a transaction that COMMITTED, and the squad was
 *    only read afterwards.
 */
export async function ensureFixtureSimulated(fixtureId: string): Promise<void> {
  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } })
  if (!fixture || fixture.playedAt) return
  if (!fixture.scheduledAt || fixture.scheduledAt.getTime() > Date.now()) return

  const teamIds = [fixture.homeTeamId, fixture.awayTeamId]

  // 1. THE PAST, SETTLED - or an explicit refusal.
  //
  // Anything still outstanding after this is a prior fixture the public has
  // NOT seen finish, which must never be activated early just because a later
  // one is due. That is a scheduling collision, and it fails closed: the
  // fixture keeps playedAt = null and is simply played on a later tick.
  const settlement = await settlePriorConsequences(fixtureId, teamIds, fixture.scheduledAt)
  const unsettled = [...settlement.blockedByPublicFinish, ...settlement.stillOutstanding]
  if (unsettled.length > 0) {
    throw new MatchPreflightError(
      "PRIOR_CONSEQUENCES_PENDING",
      fixtureId,
      [],
      `${unsettled.length} earlier fixture(s) of these clubs have unapplied consequences: ${unsettled.join(", ")}` +
        (settlement.blockedByPublicFinish.length > 0 ? " (not publicly finished yet)" : "")
    )
  }

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

  // AS OF KICKOFF, NOT AS OF NOW - the same rule the snapshot uses, so the
  // expenses this match is charged are computed against the stadium it was
  // actually played in. See src/lib/stadium/as-of.ts.
  //
  // Outside the transaction ON PURPOSE: this creates on miss and recovers
  // from a unique-constraint race by re-reading, and a failed statement
  // poisons the rest of a Postgres transaction. The stadium is not part of
  // the XI question, so it is settled before the authority is taken.
  const { seats: homeSeatsAtKickoff } = await readSeatsAsOf(fixture.homeTeamId, fixture.scheduledAt)
  const capacity = calculateStadiumCapacity(homeSeatsAtKickoff)

  await prisma.$transaction(async (tx) => {
    // ---- AUTHORITY, IN THE PROJECT'S DOCUMENTED LOCK ORDER ----------------
    //
    //   Fixture -> Player -> Team -> LineupSlot -> financial
    //
    // Player before Team before LineupSlot is exactly the order Transfer
    // Purchase uses (see lockPlayerRow and lockTeamRosters); taking the Team
    // rows here, before the repair inside the preflight writes any
    // LineupSlot, is what stops this transaction and a purchase from forming
    // an ABBA cycle over those two tables.

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

    // THE SQUADS ARE NOW FROZEN. Nothing can sell, release or retire a player
    // of either club until this transaction ends.
    await lockTeamSquads(tx, teamIds)
    await lockTeamRosters(tx, teamIds)

    // FAIL CLOSED BEFORE ANYTHING IS SIMULATED. Both clubs are repaired
    // through the canonical lineup service and then judged against the
    // canonical legal XI; a club that still cannot field one throws
    // MatchPreflightError here, which rolls this whole transaction back. The
    // fixture keeps playedAt = null, so nothing partial exists and the match
    // is still there to be played once the squad is fixed.
    await assertFixtureLineupsLegal(tx, fixtureId, teamIds)

    // Read through `tx`, so the eleven the engine gets are the eleven that
    // were just judged legal, under the locks taken above.
    const snapshot = await buildMatchSnapshot(fixtureId, seed, { neutralVenue }, tx)
    const result = simulateMatch(snapshot)

    // A decider cannot end level. If the 90 minutes did, the same seed that
    // played the match decides the penalties - salted, exactly as the
    // fan-incident roll is, so the shootout draws its own stream rather than
    // continuing the match's.
    let shootout: { home: number; away: number } | null = null
    if (canGoToShootout(fixture.stage) && result.homeGoals === result.awayGoals) {
      const candidates = await loadTakerCandidates(tx, [
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
    const homePlayers = await tx.player.findMany({ where: { teamId: fixture.homeTeamId } })
    const attendanceDetail = calculateAttendance(
      { isHome: true },
      { teamTotalQuality: calculateTeamTotalQuality(homePlayers) },
      { seats: homeSeatsAtKickoff }
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
  },
  // The whole match now lives in here - legality, snapshot, engine, writes -
  // so it gets more than Prisma's 5s default. It is normally tens of
  // milliseconds; the headroom is for a tick that has to queue behind
  // another run holding the same squads.
  { timeout: 30_000, maxWait: 15_000 })
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
  // SPORTING CHRONOLOGY. A backlog must be played in the order the matches
  // were scheduled, not in whatever order the database happens to return -
  // otherwise Wednesday can be simulated before Monday and Monday's
  // consequences arrive after the match they should have shaped. id is a
  // stable tie-break only; fixtures sharing a kickoff never share a club.
  const due = await prisma.fixture.findMany({
    where: { playedAt: null, scheduledAt: { lte: new Date() } },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
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
