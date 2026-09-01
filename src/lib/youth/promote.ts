import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { calculatePlayerOverall } from "@/lib/players/overall"
import { calculatePlayerMarketValue } from "@/lib/players/market-value"
import { calculatePlayerSalary } from "@/lib/economy/salary"
import { extractPlayerAttributes } from "@/lib/players/attributes"
import { getAvailableRosterSlots, lockTeamRoster, pickAvailableShirtNumber } from "@/lib/players/roster"
import { YouthError } from "./errors"
import { MAX_PROMOTIONS_PER_INTAKE } from "./config"

export interface PromoteYouthProspectInput {
  intakeId: string
  prospectId: string
}

export interface PromoteYouthProspectResult {
  prospectId: string
  intakeId: string
  teamId: string
  playerId: string
  promotedCount: number
  /** true when this promotion filled the intake's last slot, closing it. */
  intakeClosed: boolean
}

/**
 * The single promotion engine. Bot auto-promotion goes through this today
 * and the human promotion API will go through this same function - there is
 * deliberately no second code path, so the rules below can never drift
 * between the two.
 *
 * Lock ordering inside the youth domain, consistent with the contract in
 * src/lib/players/locks.ts:
 *
 *     YouthIntake  ->  Team  ->  roster count  ->  Player insert
 *
 * The intake row is locked first because promotedCount is the value two
 * concurrent promotions race on; the Team row is locked next through the
 * SAME lockTeamRoster that Transfer Purchase uses, so a purchase filling the
 * last roster slot and a promotion claiming it cannot both succeed. There is
 * no existing Player to lock first here - the player is created by this
 * function - so this never contends with the transfer paths' Player lock.
 */
export async function runPromoteYouthProspect(
  tx: Prisma.TransactionClient,
  input: PromoteYouthProspectInput
): Promise<PromoteYouthProspectResult> {
  // 1. Intake row lock, first - this is what guards promotedCount.
  const intakeLock = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "YouthIntake" WHERE id = ${input.intakeId} FOR UPDATE
  `
  if (intakeLock.length === 0) {
    throw new YouthError("INTAKE_NOT_FOUND", `No such intake: ${input.intakeId}`)
  }

  const intake = await tx.youthIntake.findUniqueOrThrow({ where: { id: input.intakeId } })
  if (intake.status !== "OPEN") {
    throw new YouthError("INTAKE_CLOSED", `Intake ${intake.id} is ${intake.status}`)
  }
  if (intake.promotedCount >= MAX_PROMOTIONS_PER_INTAKE) {
    throw new YouthError(
      "PROMOTION_LIMIT_REACHED",
      `Intake ${intake.id} has already promoted ${intake.promotedCount} prospects`
    )
  }

  const prospect = await tx.youthProspect.findUnique({ where: { id: input.prospectId } })
  if (!prospect) {
    throw new YouthError("PROSPECT_NOT_FOUND", `No such prospect: ${input.prospectId}`)
  }
  if (prospect.youthIntakeId !== intake.id) {
    throw new YouthError("PROSPECT_NOT_IN_INTAKE", `Prospect ${prospect.id} does not belong to intake ${intake.id}`)
  }
  if (prospect.status !== "PENDING") {
    throw new YouthError("PROSPECT_NOT_PENDING", `Prospect ${prospect.id} is ${prospect.status}`)
  }

  // 2. Team row lock, through the same helper Transfer Purchase uses, then
  // the roster count - never counted before the lock is held.
  if (!(await lockTeamRoster(tx, intake.teamId))) {
    throw new YouthError("TEAM_NOT_FOUND", `No such team: ${intake.teamId}`)
  }
  const availableSlots = await getAvailableRosterSlots(tx, intake.teamId)
  if (availableSlots <= 0) {
    throw new YouthError("ROSTER_FULL", `Team ${intake.teamId} has no free roster slot`)
  }

  // 3. The snapshot must still grade out at the Overall it was stored with.
  // A mismatch means the row was tampered with or written by something that
  // bypassed generation - surface it, never silently re-derive.
  const attributes = extractPlayerAttributes(prospect as unknown as Record<string, unknown>)
  const derivedOverall = calculatePlayerOverall({ primaryPosition: prospect.primaryPosition, ...attributes })
  if (derivedOverall !== prospect.overall) {
    throw new YouthError(
      "PROSPECT_INTEGRITY",
      `Prospect ${prospect.id} stores overall ${prospect.overall} but its attributes grade out at ${derivedOverall}`
    )
  }

  // 4. Create the real Player from the snapshot - no reroll of anything.
  const rating = {
    overall: prospect.overall,
    age: prospect.age,
    potential: prospect.potential,
    primaryPosition: prospect.primaryPosition,
  }
  const player = await tx.player.create({
    data: {
      ...attributes,
      teamId: intake.teamId,
      careerStatus: "ACTIVE",
      firstName: prospect.firstName,
      lastName: prospect.lastName,
      age: prospect.age,
      overall: prospect.overall,
      potential: prospect.potential,
      primaryPosition: prospect.primaryPosition,
      secondaryPositions: prospect.secondaryPositions,
      preferredFoot: prospect.preferredFoot,
      nationality: prospect.nationality,
      // Same baselines a generated squad player starts on.
      fitness: 100,
      status: "available",
      shirtNumber: await pickAvailableShirtNumber(tx, intake.teamId),
      marketValue: calculatePlayerMarketValue({ ...rating, fitness: 100 }),
      weeklySalary: calculatePlayerSalary(rating),
    },
    select: { id: true },
  })

  await tx.youthProspect.update({
    where: { id: prospect.id },
    data: { status: "PROMOTED", promotedPlayerId: player.id, promotedAt: new Date() },
  })

  const promotedCount = intake.promotedCount + 1
  const reachedLimit = promotedCount >= MAX_PROMOTIONS_PER_INTAKE

  await tx.youthIntake.update({
    where: { id: intake.id },
    data: {
      promotedCount,
      // The last allowed promotion closes the intake and expires whatever is
      // left - there is nothing further to decide.
      ...(reachedLimit ? { status: "CLOSED" as const, closedAt: new Date() } : {}),
    },
  })

  if (reachedLimit) {
    await tx.youthProspect.updateMany({
      where: { youthIntakeId: intake.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    })
  }

  return {
    prospectId: prospect.id,
    intakeId: intake.id,
    teamId: intake.teamId,
    playerId: player.id,
    promotedCount,
    intakeClosed: reachedLimit,
  }
}

/** Promotes one prospect in its own short transaction. */
export function promoteYouthProspect(input: PromoteYouthProspectInput): Promise<PromoteYouthProspectResult> {
  return prisma.$transaction((tx) => runPromoteYouthProspect(tx, input))
}

export interface ProcessBotYouthIntakeResult {
  intakeId: string
  teamId: string
  promoted: string[]
  expired: number
  /** true when the intake was already CLOSED before this call - nothing was done. */
  alreadyClosed: boolean
}

/**
 * A bot club's whole intake decision: take the best prospects it has room
 * for, then close the intake. Bots never sit on an open intake waiting for a
 * manager, so this always ends with the intake CLOSED and no PENDING
 * prospect left - including when the roster was full and nothing at all
 * could be promoted.
 *
 * How many: min(MAX_PROMOTIONS_PER_INTAKE, free roster slots, pending
 * prospects). Which: highest Overall first, then highest Potential, then id
 * as a deterministic tie-break so the same intake always resolves the same
 * way.
 *
 * Every promotion goes through the shared promotion engine above - this
 * never creates a Player itself - so a bot is held to exactly the same rules
 * a human manager will be.
 */
export async function processBotYouthIntake(intakeId: string): Promise<ProcessBotYouthIntakeResult> {
  const intake = await prisma.youthIntake.findUnique({
    where: { id: intakeId },
    select: { id: true, teamId: true, status: true, team: { select: { isBot: true } } },
  })
  if (!intake) {
    throw new YouthError("INTAKE_NOT_FOUND", `No such intake: ${intakeId}`)
  }
  // Team.isBot is the project's source of truth for bot clubs (see
  // leagues/seed.ts, leagues/assign.ts, standings.ts, and the register route,
  // which flips it to false when a human claims a bot slot).
  if (!intake.team.isBot) {
    throw new YouthError("TEAM_NOT_BOT", `Team ${intake.teamId} is not a bot club`)
  }
  if (intake.status !== "OPEN") {
    return { intakeId: intake.id, teamId: intake.teamId, promoted: [], expired: 0, alreadyClosed: true }
  }

  const candidates = await prisma.youthProspect.findMany({
    where: { youthIntakeId: intake.id, status: "PENDING" },
    orderBy: [{ overall: "desc" }, { potential: "desc" }, { id: "asc" }],
    select: { id: true },
  })

  const promoted: string[] = []
  for (const candidate of candidates) {
    if (promoted.length >= MAX_PROMOTIONS_PER_INTAKE) break
    try {
      const result = await promoteYouthProspect({ intakeId: intake.id, prospectId: candidate.id })
      promoted.push(result.prospectId)
      if (result.intakeClosed) break
    } catch (error) {
      // A full roster (or an intake a concurrent runner just closed) ends the
      // bot's promotions; it does not stop the intake from being closed
      // below, which is the whole point of a bot intake never idling.
      if (
        error instanceof YouthError &&
        (error.code === "ROSTER_FULL" || error.code === "PROMOTION_LIMIT_REACHED" || error.code === "INTAKE_CLOSED")
      ) {
        break
      }
      throw error
    }
  }

  // Close the intake and expire the rest, whatever happened above - a bot
  // intake is never left OPEN, not even when it promoted nobody.
  const expired = await prisma.$transaction(async (tx) => {
    const expiredRows = await tx.youthProspect.updateMany({
      where: { youthIntakeId: intake.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    })
    await tx.youthIntake.updateMany({
      where: { id: intake.id, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    })
    return expiredRows.count
  })

  return { intakeId: intake.id, teamId: intake.teamId, promoted, expired, alreadyClosed: false }
}
