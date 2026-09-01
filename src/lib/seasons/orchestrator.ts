import type { Prisma, Season } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isMatchFinished } from "@/lib/match/timing"
import { generateSeasonYouthIntakes } from "@/lib/youth/intake"
import { processBotYouthIntake } from "@/lib/youth/promote"
import { lockYouthIntake, settleIntakeDeadline } from "@/lib/youth/deadline"
import { SeasonLifecycleError } from "./errors"
import { countRemainingSeasonLifecyclePlayers, processSeasonPlayerLifecycle } from "./player-lifecycle"
import { activateNextSeason, ensureNextSeasonStructure, isNextSeasonStructureComplete, rescheduleIfStale } from "./next-season"

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
  nextSeasonId?: string
  fixturesCreated?: number
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
    // Re-checked inside the transaction: between the check above and the
    // lock, nothing may have changed, but the whole point of this gate is
    // that it is never decided on a stale read.
    const advanced = await prisma.$transaction(async (tx) => {
      const locked = await lockSeason(tx, seasonId)
      if (locked.status !== "ACTIVE" || locked.offseasonStage !== "NONE") return false
      if (!(await isSeasonReadyForOffseason(seasonId, now))) return false
      await tx.season.update({
        where: { id: seasonId },
        data: { status: "OFFSEASON", offseasonStage: "PLAYER_LIFECYCLE" },
      })
      return true
    })
    return advanced
      ? { ...base, toStatus: "OFFSEASON", toStage: "PLAYER_LIFECYCLE", advanced: true, detail: "season finished - entering offseason" }
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
    const advanced = await advanceStage(seasonId, { status: "OFFSEASON", stage: "WAITING_HUMANS" }, { stage: "CREATE_NEXT" })
    return {
      ...base,
      toStage: advanced ? "CREATE_NEXT" : base.toStage,
      advanced,
      detail: advanced ? "every intake is closed" : "another run already advanced this stage",
      humanIntakesSettled: settled,
      humanIntakesOpen: 0,
    }
  }

  // --- CREATE_NEXT --------------------------------------------------------
  if (season.offseasonStage === "CREATE_NEXT") {
    const structure = await ensureNextSeasonStructure(seasonId, now)
    if (!(await isNextSeasonStructureComplete(structure.nextSeasonId, structure.divisions))) {
      return {
        ...base,
        detail: "next season structure still incomplete",
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

// A full transition is 6 stage advances; the cap is only a guard against a
// bug turning this into an unbounded loop, never something a healthy run
// reaches.
const MAX_STEPS_PER_RUN = 12

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

/**
 * Entry point for a scheduled runner: every country's currently-active
 * season, plus any season already mid-offseason. A season whose handover
 * completed is not picked up again - it is no longer active, and its
 * successor is.
 */
export async function runSeasonEndOrchestratorForAllSeasons(now: Date = new Date()): Promise<OrchestratorRunSummary[]> {
  const seasons = await prisma.season.findMany({
    where: { OR: [{ isActive: true }, { status: "OFFSEASON" }] },
    select: { id: true },
    orderBy: { id: "asc" },
  })
  const summaries: OrchestratorRunSummary[] = []
  for (const season of seasons) {
    summaries.push(await runSeasonEndOrchestrator(season.id, now))
  }
  return summaries
}
