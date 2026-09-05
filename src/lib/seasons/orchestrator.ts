import type { Prisma, Season } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isMatchFinished } from "@/lib/match/timing"
import { generateSeasonYouthIntakes } from "@/lib/youth/intake"
import { processBotYouthIntake } from "@/lib/youth/promote"
import { lockYouthIntake, settleIntakeDeadline } from "@/lib/youth/deadline"
import {
  DEFAULT_REPLENISHMENT_BATCH,
  replenishSeasonSquads,
  verifySeasonRosterInvariant,
} from "./squad-replenishment"
import { SeasonLifecycleError } from "./errors"
import { countRemainingSeasonLifecyclePlayers, processSeasonPlayerLifecycle } from "./player-lifecycle"
import { activateNextSeason, ensureNextSeasonFixtures, isNextSeasonStructureComplete, rescheduleIfStale } from "./next-season"
import {
  createBoundaryFixtures,
  createPromotionBracket,
  isSportingResolutionComplete,
  loadSeasonResolutionState,
  resolveSeasonSporting,
} from "./promotion/resolution"
import { materialiseNextSeasonMembership, verifyNextSeasonMembership } from "./promotion/membership"
import { persistSeasonChampions, resolveSeasonChampions } from "./champions"
import { ensureTitleDecider } from "./deciders"
import { decidePlayoff } from "./playoff-resolution"
import {
  createNextKnockoutRound,
  createRoundRobinRound,
  ensureChampionshipPlayoff,
  ensureKnockoutEntered,
  loadPlayoff,
} from "./playoffs"

/** Bot intakes handled per orchestrator run - keeps one tick bounded without ever holding a long transaction. */
export const DEFAULT_BOT_INTAKE_BATCH = 20

/**
 * A season is finished only once every fixture in every one of its divisions
 * has actually played out - which is NOT the same as every fixture having a
 * playedAt. The simulation writes its result at kickoff and the match then
 * plays out over a 10-real-minute live window, so a fixture can be both
 * "played" and still on screen. Requiring isMatchFinished as well is what
 * stops the offseason from starting underneath a manager watching the last
 * match of the season.
 */
export async function isSeasonReadyForOffseason(seasonId: string, now: Date = new Date()): Promise<boolean> {
  const fixtures = await prisma.fixture.findMany({
    where: { division: { seasonId } },
    select: { playedAt: true, scheduledAt: true },
  })
  if (fixtures.length === 0) return false
  return fixtures.every((f) => f.playedAt !== null && isMatchFinished(f.scheduledAt, now))
}

/**
 * The competition label each division's draw seed is derived from.
 *
 * Country, season number, tier and group are fixed for a season's lifetime,
 * so this is read once outside the transaction: it cannot change underneath
 * the write, and keeping it out keeps the locked transaction short.
 */
async function loadDivisionContext(
  seasonId: string
): Promise<Map<string, { countryCode: string; seasonNumber: number; tier: number; group: string }>> {
  const divisions = await prisma.division.findMany({
    where: { seasonId },
    select: { id: true, tier: true, group: true, season: { select: { countryCode: true, number: true } } },
  })
  return new Map(
    divisions.map((d) => [
      d.id,
      {
        countryCode: d.season.countryCode,
        seasonNumber: d.season.number,
        tier: d.tier,
        group: d.group ?? "",
      },
    ])
  )
}

/** Locks one Season row - the ordering root for every stage transition below. */
async function lockSeason(tx: Prisma.TransactionClient, seasonId: string): Promise<Season> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Season" WHERE id = ${seasonId} FOR UPDATE`
  if (rows.length === 0) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `No such season: ${seasonId}`)
  }
  return tx.season.findUniqueOrThrow({ where: { id: seasonId } })
}

/**
 * Moves a season from one stage to the next, but only if it is still exactly
 * where the caller last saw it. Every advance goes through here, so a second
 * orchestrator that did the same work concurrently can never double-advance:
 * it re-reads under the lock, finds the stage already moved on, and reports
 * that it changed nothing.
 */
async function advanceStage(
  seasonId: string,
  expected: { status: Season["status"]; stage: Season["offseasonStage"] },
  next: { status?: Season["status"]; stage: Season["offseasonStage"] }
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const season = await lockSeason(tx, seasonId)
    if (season.status !== expected.status || season.offseasonStage !== expected.stage) return false
    await tx.season.update({
      where: { id: seasonId },
      data: { status: next.status ?? season.status, offseasonStage: next.stage },
    })
    return true
  })
}

export interface OrchestratorStepSummary {
  seasonId: string
  fromStatus: Season["status"]
  fromStage: Season["offseasonStage"]
  toStatus: Season["status"]
  toStage: Season["offseasonStage"]
  advanced: boolean
  /** Why this run stopped where it did - the one line worth reading in a cron log. */
  detail: string
  playersProcessed?: number
  playersRemaining?: number
  intakesCreated?: number
  intakesExisting?: number
  botIntakesProcessed?: number
  botIntakesRemaining?: number
  humanIntakesSettled?: number
  humanIntakesOpen?: number
  /** Clubs this step actually replenished (a club that needed nothing still counts). */
  teamsReplenished?: number
  teamsAwaitingReplenishment?: number
  /** Fallback players created this step, across every club in the batch. */
  fallbackPlayersGenerated?: number
  nextSeasonId?: string
  fixturesCreated?: number
  /** Champion rows written by this step. Present only on the ACTIVE -> OFFSEASON transition. */
  championsPersisted?: number
  /** Divisions still level after every head-to-head criterion, and therefore awaiting a decider. */
  divisionsAwaitingDecider?: number
  /** Boundary fixtures this step created, across all divisions. */
  boundaryFixturesCreated?: number
  /** Promotion playoff fixtures this step created (0 or 2). */
  promotionFixturesCreated?: number
  /** Membership rows the PROMOTION_RELEGATION stage wrote (0 on a retry). */
  membershipsWritten?: number
  promotedTeamIds?: string[]
  relegatedTeamIds?: string[]
  /** Title deciders this step created. Zero when they already existed. */
  decidersCreated?: number
  /** Championship playoff fixtures this step created, across all divisions. */
  playoffFixturesCreated?: number
  /** True when this step ran the Official Sporting Draw and persisted its result. */
  knockoutDrawPersisted?: boolean
}

/**
 * One step of the season-end machine. Does the work the season's current
 * stage calls for, then advances only if that work is genuinely finished -
 * "finished" always being re-derived from the database, never assumed from
 * the fact that a service just ran.
 */
async function runOneStep(seasonId: string, now: Date): Promise<OrchestratorStepSummary> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `No such season: ${seasonId}`)
  }

  const base = {
    seasonId,
    fromStatus: season.status,
    fromStage: season.offseasonStage,
    toStatus: season.status,
    toStage: season.offseasonStage,
    advanced: false,
  }

  if (season.status === "COMPLETED") {
    return { ...base, detail: "season already completed" }
  }

  // --- ACTIVE -> OFFSEASON ------------------------------------------------
  if (season.status === "ACTIVE") {
    if (!(await isSeasonReadyForOffseason(seasonId, now))) {
      return { ...base, detail: "season still running - fixtures remain unplayed or still live" }
    }
    // WHO WON, decided before the transaction opens.
    //
    // The season is over by the check above, so no result can change under
    // this read - and it must not run inside the transaction below, because
    // it reads through the global prisma client and would therefore see
    // outside it. The transaction re-asserts readiness under the lock
    // before anything is written, which is what actually makes this safe.
    const champions = await resolveSeasonChampions(seasonId, now)

    // PROMOTION AND RELEGATION'S OWN SPORTING QUESTIONS, read at the same
    // instant and from the same finished season. Titles and places are
    // separate questions with separate machinery: resolveSeasonChampions owns
    // rank 1 of every division, and this owns every other outcome boundary
    // (rank 16 in tier 1; ranks 2 and 3 in each tier 2 group) plus the
    // promotion bracket. A tier 2 group's rank 1 is BOTH its title and its
    // automatic promotion - one tie, one fixture - which is why
    // boundaryRanksFor never returns 1.
    const resolutionState = await loadSeasonResolutionState(seasonId)
    const sporting = resolutionState ? resolveSeasonSporting(resolutionState, now) : null

    // FAIL CLOSED. A division still level after points, goal difference,
    // goals scored and all three head-to-head criteria has no champion yet -
    // it has a fixture still to play. Phase 2B does not create or simulate
    // that decider, so the correct behaviour is to leave the season ACTIVE
    // and write nothing: no invented champion, no half-persisted season, no
    // offseason starting on top of an undecided title.
    if (!champions.fullyResolved || !sporting || !sporting.complete) {
      const tied = champions.needsDecider.length
      if (tied === 0 && (!sporting || sporting.complete)) {
        return { ...base, detail: "season finished but its champions could not be resolved from the data" }
      }

      // A tied division needs one more match played, so create it - inside
      // the SAME Season lock every stage transition uses, and never
      // transition the season here. Once the decider exists and is
      // unplayed, isSeasonReadyForOffseason is false again by itself, which
      // is what holds the season ACTIVE until it has been played out. No new
      // status, no stored "waiting" flag, nothing to get out of step.
      // The competition label a playoff's draw seed is derived from. Read
      // before the transaction because it cannot change: a division's country,
      // season number, tier and group are fixed for the season's lifetime.
      const divisionContext = await loadDivisionContext(seasonId)

      const created = await prisma.$transaction(async (tx) => {
        const empty = { deciders: 0, playoffFixtures: 0, drawPersisted: false, boundaries: 0, promotion: 0 }
        const locked = await lockSeason(tx, seasonId)
        if (locked.status !== "ACTIVE" || locked.offseasonStage !== "NONE") return empty
        if (!(await isSeasonReadyForOffseason(seasonId, now))) return empty

        let deciders = 0
        let playoffFixtures = 0
        let drawPersisted = false
        let boundaries = 0
        let promotion = 0

        // --- PROMOTION AND RELEGATION'S FIXTURES --------------------------
        // Created here, while the season is still ACTIVE, so every match that
        // can change who goes up or down is played by the squads that earned
        // the result - before PLAYER_LIFECYCLE ages, retires or replenishes
        // anybody. Each one holds the season ACTIVE by itself the moment it
        // exists, because isSeasonReadyForOffseason counts every fixture of
        // the season with no stage filter.
        if (resolutionState && sporting) {
          for (const work of sporting.boundaryWork) {
            const division = resolutionState.divisions.find((d) => d.divisionId === work.divisionId)
            if (!division) continue
            if (work.decision.kind === "blocked") {
              console.error(
                `Boundary rank ${work.boundaryRank} of division ${work.divisionId} is blocked: ${work.decision.reason}`
              )
              continue
            }
            boundaries += await createBoundaryFixtures(tx, division, work, now)
          }

          // The bracket depends on FINAL tier 2 positions, so it can only be
          // written once every tier 2 boundary is settled. That dependency is
          // exactly why isSportingResolutionComplete exists: there is an
          // instant where every EXISTING fixture is finished and this has
          // never been created.
          if (sporting.boundaryWork.length === 0 && sporting.bracket.length > 0 && !sporting.bracketCreated) {
            const tier1 = resolutionState.divisions.find((d) => d.tier === 1)
            if (tier1) {
              promotion += await createPromotionBracket(tx, { tier1, bracket: sporting.bracket, now })
            }
          }
        }

        for (const division of champions.needsDecider) {
          const tiedTeamIds = champions.tiedTeamIdsByDivision.get(division.divisionId)
          if (!tiedTeamIds || tiedTeamIds.length < 2) continue

          // TWO CLUBS: one neutral match settles it. Phase 2C, untouched.
          if (tiedTeamIds.length === 2) {
            const decider = await ensureTitleDecider(tx, { divisionId: division.divisionId, tiedTeamIds, now })
            if (decider.created) deciders++
            continue
          }

          // THREE OR MORE: a whole competition. Up to three neutral round
          // robins, then a knockout - which is what makes termination
          // guaranteed rather than hoped for.
          const context = divisionContext.get(division.divisionId)
          if (!context) continue

          const playoff = await ensureChampionshipPlayoff(tx, {
            seasonId,
            divisionId: division.divisionId,
            ...context,
          })

          // Read THROUGH the transaction: on the tick that creates the
          // playoff, its row is not visible on any other connection yet.
          const state = await loadPlayoff(division.divisionId, tx)
          if (!state || state.fixtures.length === 0) {
            // Brand new: round 1 is the full tied field.
            playoffFixtures += await createRoundRobinRound(tx, {
              playoffId: playoff.id,
              divisionId: division.divisionId,
              round: 1,
              teamIds: tiedTeamIds,
              now,
            })
            continue
          }

          const decision = decidePlayoff(state, now)
          if (decision.kind === "needRoundRobin") {
            playoffFixtures += await createRoundRobinRound(tx, {
              playoffId: playoff.id,
              divisionId: division.divisionId,
              round: decision.round,
              teamIds: decision.teamIds,
              now,
            })
          } else if (decision.kind === "needKnockout") {
            const entered = await ensureKnockoutEntered(tx, {
              playoffId: playoff.id,
              divisionId: division.divisionId,
              drawSeed: playoff.drawSeed,
              entrants: decision.entrants,
              now,
            })
            playoffFixtures += entered.fixturesCreated
            drawPersisted = drawPersisted || entered.drawPersisted
          } else if (decision.kind === "needKnockoutRound" && state.knockoutDraw) {
            playoffFixtures += await createNextKnockoutRound(tx, {
              playoffId: playoff.id,
              divisionId: division.divisionId,
              draw: state.knockoutDraw,
              round: decision.round,
              survivorsInBracketOrder: decision.survivorsInBracketOrder,
              now,
            })
          }
          // "waiting" and "blocked" create nothing. A blocked playoff holds
          // the season ACTIVE and is reported rather than guessed at - an
          // infrastructure failure, never a sporting one.
        }
        return { deciders, playoffFixtures, drawPersisted, boundaries, promotion }
      })

      const parts: string[] = []
      if (created.deciders > 0) parts.push(`${created.deciders} title decider(s) scheduled`)
      if (created.playoffFixtures > 0) parts.push(`${created.playoffFixtures} playoff fixture(s) scheduled`)
      if (created.drawPersisted) parts.push("championship draw made")
      if (created.boundaries > 0) parts.push(`${created.boundaries} boundary decider(s) scheduled`)
      if (created.promotion > 0) parts.push(`${created.promotion} promotion playoff fixture(s) scheduled`)

      const pending = sporting && !sporting.complete ? sporting.detail : `${tied} division(s) still level`

      return {
        ...base,
        detail:
          parts.length > 0
            ? `season finished but not settled (${pending}) - ${parts.join(", ")}; season stays ACTIVE until they are played`
            : `season finished but not settled - ${pending}`,
        divisionsAwaitingDecider: tied,
        decidersCreated: created.deciders,
        boundaryFixturesCreated: created.boundaries,
        promotionFixturesCreated: created.promotion,
        playoffFixturesCreated: created.playoffFixtures,
        knockoutDrawPersisted: created.drawPersisted,
      }
    }

    // Re-checked inside the transaction: between the check above and the
    // lock, nothing may have changed, but the whole point of this gate is
    // that it is never decided on a stale read.
    //
    // The champion rows and the status change commit together. A season can
    // never enter its offseason without its titles recorded, and titles can
    // never be recorded for a season that did not transition.
    const result = await prisma.$transaction(async (tx) => {
      const locked = await lockSeason(tx, seasonId)
      if (locked.status !== "ACTIVE" || locked.offseasonStage !== "NONE") return null
      if (!(await isSeasonReadyForOffseason(seasonId, now))) return null
      // THE EXISTENCE GATE, and it is load-bearing.
      //
      // isSeasonReadyForOffseason asks "is every fixture that EXISTS
      // finished". That is necessary and not sufficient: the promotion
      // bracket cannot be created until the tier 2 boundary ties are
      // finished, so there is an instant at which every existing fixture is
      // finished and the bracket has never been written. Transitioning there
      // would skip promotion entirely - no exception, no log line, just a
      // league that did not change. This asks the other half: does every
      // fixture that MUST exist exist, and has it publicly finished.
      if (!(await isSportingResolutionComplete(seasonId, now))) return null
      const persisted = await persistSeasonChampions(tx, champions)
      await tx.season.update({
        where: { id: seasonId },
        data: { status: "OFFSEASON", offseasonStage: "PLAYER_LIFECYCLE" },
      })
      return persisted
    })
    return result
      ? {
          ...base,
          toStatus: "OFFSEASON",
          toStage: "PLAYER_LIFECYCLE",
          advanced: true,
          detail: `season finished - ${result.filter((r) => r.created).length} champion(s) recorded, entering offseason`,
          championsPersisted: result.filter((r) => r.created).length,
        }
      : { ...base, detail: "another run already started the offseason" }
  }

  // --- PLAYER_LIFECYCLE ---------------------------------------------------
  if (season.offseasonStage === "PLAYER_LIFECYCLE") {
    const summary = await processSeasonPlayerLifecycle(seasonId)
    const remaining = await countRemainingSeasonLifecyclePlayers(seasonId)
    if (remaining > 0) {
      return {
        ...base,
        detail: `${remaining} players still need their season transition`,
        playersProcessed: summary.processed,
        playersRemaining: remaining,
      }
    }
    const advanced = await advanceStage(seasonId, { status: "OFFSEASON", stage: "PLAYER_LIFECYCLE" }, { stage: "YOUTH_GENERATION" })
    return {
      ...base,
      toStage: advanced ? "YOUTH_GENERATION" : base.toStage,
      advanced,
      detail: advanced ? "player lifecycle complete" : "another run already advanced this stage",
      playersProcessed: summary.processed,
      playersRemaining: 0,
    }
  }

  // --- YOUTH_GENERATION ---------------------------------------------------
  if (season.offseasonStage === "YOUTH_GENERATION") {
    const summary = await generateSeasonYouthIntakes(seasonId)
    const intakeCount = await prisma.youthIntake.count({ where: { seasonId } })
    if (intakeCount !== summary.teamsFound) {
      return {
        ...base,
        detail: `${summary.teamsFound - intakeCount} clubs still have no intake`,
        intakesCreated: summary.created,
        intakesExisting: summary.existing,
      }
    }
    const advanced = await advanceStage(seasonId, { status: "OFFSEASON", stage: "YOUTH_GENERATION" }, { stage: "BOT_PROMOTION" })
    return {
      ...base,
      toStage: advanced ? "BOT_PROMOTION" : base.toStage,
      advanced,
      detail: advanced ? `${intakeCount} youth intakes ready` : "another run already advanced this stage",
      intakesCreated: summary.created,
      intakesExisting: summary.existing,
    }
  }

  // --- BOT_PROMOTION ------------------------------------------------------
  if (season.offseasonStage === "BOT_PROMOTION") {
    const openBotIntakes = await prisma.youthIntake.findMany({
      where: { seasonId, status: "OPEN", team: { isBot: true } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: DEFAULT_BOT_INTAKE_BATCH,
    })
    let processed = 0
    for (const intake of openBotIntakes) {
      await processBotYouthIntake(intake.id)
      processed++
    }
    const remaining = await prisma.youthIntake.count({ where: { seasonId, status: "OPEN", team: { isBot: true } } })
    if (remaining > 0) {
      return { ...base, detail: `${remaining} bot intakes still open`, botIntakesProcessed: processed, botIntakesRemaining: remaining }
    }
    const advanced = await advanceStage(seasonId, { status: "OFFSEASON", stage: "BOT_PROMOTION" }, { stage: "WAITING_HUMANS" })
    return {
      ...base,
      toStage: advanced ? "WAITING_HUMANS" : base.toStage,
      advanced,
      detail: advanced ? "every bot club has chosen" : "another run already advanced this stage",
      botIntakesProcessed: processed,
      botIntakesRemaining: 0,
    }
  }

  // --- WAITING_HUMANS -----------------------------------------------------
  if (season.offseasonStage === "WAITING_HUMANS") {
    // Anything past its deadline is settled through the SAME helper the
    // Youth API uses, never a second copy of that rule. Nothing is ever
    // promoted on a manager's behalf: an expired intake simply expires its
    // remaining prospects.
    const expired = await prisma.youthIntake.findMany({
      where: { seasonId, status: "OPEN", closesAt: { lte: now }, team: { isBot: false } },
      select: { id: true },
    })
    let settled = 0
    for (const intake of expired) {
      const result = await prisma.$transaction(async (tx) => {
        const locked = await lockYouthIntake(tx, intake.id)
        return settleIntakeDeadline(tx, locked, now)
      })
      if (result.justExpired) settled++
    }

    const stillOpen = await prisma.youthIntake.count({ where: { seasonId, status: "OPEN" } })
    if (stillOpen > 0) {
      return { ...base, detail: `${stillOpen} managers still deciding`, humanIntakesSettled: settled, humanIntakesOpen: stillOpen }
    }
    const advanced = await advanceStage(seasonId, { status: "OFFSEASON", stage: "WAITING_HUMANS" }, { stage: "SQUAD_REPLENISHMENT" })
    return {
      ...base,
      toStage: advanced ? "SQUAD_REPLENISHMENT" : base.toStage,
      advanced,
      detail: advanced ? "every intake is closed" : "another run already advanced this stage",
      humanIntakesSettled: settled,
      humanIntakesOpen: 0,
    }
  }

  // --- SQUAD_REPLENISHMENT ------------------------------------------------
  // Runs only once EVERY intake is closed, so it sees the final post-youth
  // roster. Nothing here promotes a prospect on anybody's behalf: a human who
  // let their window expire has already lost those five, and what they get
  // instead is the worst players in the game, and only as many as the floor
  // arithmetic demands.
  if (season.offseasonStage === "SQUAD_REPLENISHMENT") {
    const summary = await replenishSeasonSquads(seasonId, DEFAULT_REPLENISHMENT_BATCH, now)
    for (const failure of summary.failures) {
      console.error(`Squad replenishment failed for team ${failure.teamId}:`, failure.error)
    }
    if (summary.remaining > 0 || summary.failures.length > 0) {
      return {
        ...base,
        detail:
          summary.failures.length > 0
            ? `${summary.failures.length} club(s) could not be replenished`
            : `${summary.remaining} clubs still to replenish`,
        teamsReplenished: summary.teamsProcessed,
        teamsAwaitingReplenishment: summary.remaining,
        fallbackPlayersGenerated: summary.playersGenerated,
      }
    }

    // THE LEAGUE GATE. Re-derived from the database, never inferred from the
    // ledger count: transfers run on the calendar Thursday window regardless
    // of season state, so a club replenished an hour ago could have been sold
    // from since. The voluntary floor guard should have refused that sale;
    // this is where we find out.
    const invariant = await verifySeasonRosterInvariant(seasonId)
    if (!invariant.ok) {
      for (const failure of invariant.failures) {
        console.error(`Season roll blocked - team ${failure.teamId}: ${failure.reason}`)
      }
      return {
        ...base,
        detail: `${invariant.failures.length} club(s) fail the roster invariant`,
        teamsReplenished: summary.teamsProcessed,
        teamsAwaitingReplenishment: 0,
        fallbackPlayersGenerated: summary.playersGenerated,
      }
    }

    const advanced = await advanceStage(
      seasonId,
      { status: "OFFSEASON", stage: "SQUAD_REPLENISHMENT" },
      { stage: "PROMOTION_RELEGATION" }
    )
    return {
      ...base,
      toStage: advanced ? "PROMOTION_RELEGATION" : base.toStage,
      advanced,
      detail: advanced
        ? `every club satisfies the roster floor (${invariant.teamsChecked} checked)`
        : "another run already advanced this stage",
      teamsReplenished: summary.teamsProcessed,
      teamsAwaitingReplenishment: 0,
      fallbackPlayersGenerated: summary.playersGenerated,
    }
  }

  // --- PROMOTION_RELEGATION -----------------------------------------------
  // Creates NO sporting fixture. Every match that could change who goes up or
  // down was played while season N was still ACTIVE, on the squads that
  // earned the result, so by the time this runs the answer is a pure function
  // of facts that cannot change again - which is what makes a retry recompute
  // the identical membership rather than move anybody twice.
  if (season.offseasonStage === "PROMOTION_RELEGATION") {
    const state = await loadSeasonResolutionState(seasonId)
    const sporting = state ? resolveSeasonSporting(state, now) : null
    if (!state || !sporting || !sporting.complete) {
      // Unreachable in a healthy roll - the season could not have left ACTIVE
      // without this being true - so it is reported rather than retried into.
      return { ...base, detail: `cannot materialise membership: ${sporting?.detail ?? "no resolution state"}` }
    }

    const membership = await materialiseNextSeasonMembership({
      oldSeasonId: seasonId,
      finalDivisions: sporting.finalDivisions,
      playoffResults: sporting.playoffResults,
    })

    const verdict = await verifyNextSeasonMembership(seasonId, membership.nextSeasonId)
    if (!verdict.ok) {
      for (const failure of verdict.failures) {
        console.error(`Season ${seasonId} membership invariant failed: ${failure}`)
      }
      return {
        ...base,
        detail: `${verdict.failures.length} membership invariant(s) failed`,
        nextSeasonId: membership.nextSeasonId,
        membershipsWritten: membership.created,
      }
    }

    const advanced = await advanceStage(
      seasonId,
      { status: "OFFSEASON", stage: "PROMOTION_RELEGATION" },
      { stage: "CREATE_NEXT" }
    )
    return {
      ...base,
      toStage: advanced ? "CREATE_NEXT" : base.toStage,
      advanced,
      detail: advanced
        ? `${membership.promoted.length} promoted, ${membership.relegated.length} relegated; ` +
          `${verdict.clubs} clubs placed (${membership.attested ? "attested an earlier run" : "written"})`
        : "another run already advanced this stage",
      nextSeasonId: membership.nextSeasonId,
      membershipsWritten: membership.created,
      promotedTeamIds: membership.promoted,
      relegatedTeamIds: membership.relegated,
    }
  }

  // --- CREATE_NEXT --------------------------------------------------------
  // Fixtures and activation ONLY. It has no membership authority of any kind:
  // ensureNextSeasonFixtures refuses outright if any division is empty, and
  // the completeness gate below re-derives every structural invariant from the
  // database before the season may be switched on.
  if (season.offseasonStage === "CREATE_NEXT") {
    const nextSeason = await prisma.season.findFirst({
      where: { countryCode: season.countryCode, number: season.number + 1 },
      select: { id: true, number: true },
    })
    if (!nextSeason) {
      return { ...base, detail: "next season row does not exist - PROMOTION_RELEGATION has not run" }
    }
    const structure = await ensureNextSeasonFixtures(nextSeason.id, now)
    const complete = await isNextSeasonStructureComplete(seasonId, structure.nextSeasonId)
    if (!complete.ok) {
      for (const failure of complete.failures) {
        console.error(`Next season ${structure.nextSeasonId} not activatable: ${failure}`)
      }
      return {
        ...base,
        detail: `next season structure still incomplete (${complete.failures.length} failure(s))`,
        nextSeasonId: structure.nextSeasonId,
        fixturesCreated: structure.fixturesCreated,
      }
    }
    // A structure prepared before a long wait can have a first kickoff that
    // is no longer far enough out; shift the whole schedule rather than
    // start a season in the past.
    await rescheduleIfStale(structure.nextSeasonId, now)

    const activation = await activateNextSeason(seasonId, structure.nextSeasonId)
    return {
      ...base,
      toStatus: "COMPLETED",
      toStage: "DONE",
      advanced: !activation.alreadyActivated,
      detail: activation.alreadyActivated
        ? "another run already activated the next season"
        : `season ${structure.nextSeasonNumber} is now live`,
      nextSeasonId: structure.nextSeasonId,
      fixturesCreated: structure.fixturesCreated,
    }
  }

  return { ...base, detail: `nothing to do at stage ${season.offseasonStage}` }
}

export interface OrchestratorRunSummary {
  seasonId: string
  steps: OrchestratorStepSummary[]
  finalStatus: Season["status"]
  finalStage: Season["offseasonStage"]
  nextSeasonId: string | null
}

// A full transition is 8 stage advances: ACTIVE -> PLAYER_LIFECYCLE ->
// YOUTH_GENERATION -> BOT_PROMOTION -> WAITING_HUMANS -> SQUAD_REPLENISHMENT
// -> PROMOTION_RELEGATION -> CREATE_NEXT -> DONE. The cap is only a guard
// against a bug turning this into an unbounded loop, never something a
// healthy run reaches.
const MAX_STEPS_PER_RUN = 16

/**
 * Drives a season as far through the end-of-season machine as it can get
 * right now, then stops. Each stage advances only when its own work is
 * genuinely done, so a run that stops early (managers still choosing, a
 * batch left to process) simply resumes from that stage next time - there is
 * no cursor to keep and nothing to clean up after a crash.
 *
 * Advancing several stages in one call rather than one-per-tick is
 * deliberate: with an hourly schedule, one-stage-per-tick would leave hours
 * of dead air between the last match of a season and the next season
 * existing.
 */
export async function runSeasonEndOrchestrator(
  seasonId: string,
  now: Date = new Date()
): Promise<OrchestratorRunSummary> {
  const steps: OrchestratorStepSummary[] = []

  for (let i = 0; i < MAX_STEPS_PER_RUN; i++) {
    const step = await runOneStep(seasonId, now)
    steps.push(step)
    if (!step.advanced) break
    if (step.toStatus === "COMPLETED") break
  }

  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })
  return {
    seasonId,
    steps,
    finalStatus: season.status,
    finalStage: season.offseasonStage,
    nextSeasonId: steps.find((s) => s.nextSeasonId)?.nextSeasonId ?? null,
  }
}

export interface SeasonLifecycleFailure {
  seasonId: string
  error: unknown
}

export interface SeasonLifecycleRunReport {
  /** How many seasons the discovery query found - not how many advanced. */
  seasonsChecked: number
  /** Stage advances that actually happened this run, across every season. */
  transitionsPerformed: number
  summaries: OrchestratorRunSummary[]
  failures: SeasonLifecycleFailure[]
}

/**
 * Entry point for a scheduled runner: every country's currently-active
 * season, plus any season already mid-offseason. Discovery is deliberately
 * keyed on isActive rather than status === "ACTIVE": a season that has
 * already entered its offseason is still the live season for its country and
 * still needs driving. COMPLETED seasons are excluded outright - a finished
 * season is history, and history is never re-run.
 *
 * Nothing here is hardcoded to one country: seasons are handled as a list, so
 * a second league appearing later needs no change to this function.
 *
 * One season's failure never denies the others their run. Each season is
 * caught on its own and recorded in `failures`; the caller decides what a
 * non-empty `failures` means (the scheduled runner turns it into a non-zero
 * exit code). Nothing is swallowed - every error is returned intact.
 */
export async function runSeasonEndOrchestratorForAllSeasons(now: Date = new Date()): Promise<SeasonLifecycleRunReport> {
  const seasons = await prisma.season.findMany({
    where: {
      status: { not: "COMPLETED" },
      OR: [{ isActive: true }, { status: "OFFSEASON" }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  })

  const summaries: OrchestratorRunSummary[] = []
  const failures: SeasonLifecycleFailure[] = []
  for (const season of seasons) {
    try {
      summaries.push(await runSeasonEndOrchestrator(season.id, now))
    } catch (error) {
      failures.push({ seasonId: season.id, error })
    }
  }
  const transitionsPerformed = summaries.reduce(
    (total, summary) => total + summary.steps.filter((step) => step.advanced).length,
    0
  )
  return { seasonsChecked: seasons.length, transitionsPerformed, summaries, failures }
}
