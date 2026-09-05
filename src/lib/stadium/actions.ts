import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { createFinancialTransaction, InsufficientFundsError } from "@/lib/economy/service"
import {
  DEFAULT_STADIUM_CONFIG,
  DEFAULT_STARTING_SEATS,
  DEFAULT_STADIUM_NAME_SUFFIX,
  toSeatColumns,
  toSeatCounts,
  type SeatCounts,
  type StadiumConfig,
} from "./config"
import { calculateConstructionCost, calculateConstructionTime, totalSeats } from "./construction"
import { seatsAsOf, type SeatsAsOfResult } from "./as-of"

export class ConstructionInProgressError extends Error {
  constructor() {
    super("CONSTRUCTION_IN_PROGRESS")
  }
}

export class NoSeatsRequestedError extends Error {
  constructor() {
    super("VALIDATION_ERROR")
  }
}

/**
 * Creates a default stadium for a team that doesn't have one yet - safe to
 * call repeatedly AND safe to call concurrently.
 *
 * The find-then-create below is not atomic on its own: two callers that both
 * find nothing will both try to insert, and Stadium.teamId is unique, so the
 * loser gets a raw P2002. That is not hypothetical - this function is called
 * from the match engine (simulate.ts, build-snapshot.ts), so two overlapping
 * scheduled runs playing the same fixture hit it directly, and it is also
 * called from three separate page loads, so two tabs opened at once on a
 * club that has no stadium row yet do the same.
 *
 * Catching P2002 and re-reading is the fix, matching the convention already
 * used elsewhere for exactly this shape (generateYouthIntakeForTeam,
 * upsertNextSeasonRow): the loser of the race simply adopts the row the
 * winner created. Prisma's own `upsert` would NOT help here - it is
 * find-then-write client-side, not an atomic INSERT ... ON CONFLICT, so it
 * races in precisely the same way.
 */
export async function ensureStadiumForTeam(teamId: string, name?: string) {
  const existing = await prisma.stadium.findUnique({ where: { teamId } })
  if (existing) return existing
  try {
    return await prisma.stadium.create({
      data: { teamId, name: name ?? DEFAULT_STADIUM_NAME_SUFFIX, ...toSeatColumns(DEFAULT_STARTING_SEATS) },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.stadium.findUniqueOrThrow({ where: { teamId } })
    }
    throw error
  }
}

/**
 * THE CLUB'S SEATS AS OF A GIVEN INSTANT - the read every match must use.
 *
 * Reads the Stadium row (creating it on miss, as every other stadium reader
 * does) plus that stadium's whole construction history, and hands both to the
 * pure seatsAsOf calculation. See src/lib/stadium/as-of.ts for why the answer
 * cannot be the Stadium row alone, in either direction.
 *
 * Deliberately NOT taking a transaction client: ensureStadiumForTeam creates
 * on miss and recovers from a unique-constraint race by re-reading, and a
 * failed statement poisons the rest of a Postgres transaction. The stadium is
 * not part of the legality question the match transaction holds locks for.
 */
export async function readSeatsAsOf(teamId: string, asOf: Date | null, name?: string): Promise<SeatsAsOfResult> {
  const stadium = await ensureStadiumForTeam(teamId, name)
  const jobs = await prisma.stadiumConstructionJob.findMany({
    where: { stadiumId: stadium.id },
    select: {
      status: true,
      endsAt: true,
      regularSeatsAdded: true,
      coveredSeatsAdded: true,
      premiumSeatsAdded: true,
      vipSeatsAdded: true,
    },
  })
  return seatsAsOf(toSeatCounts(stadium), jobs, asOf)
}

/**
 * Starts a stadium expansion: verifies funds, computes cost/time itself
 * (never trusts a client-submitted price), debits the club's balance through
 * the central finance function, and records the job - all in one
 * serializable transaction, so two near-simultaneous requests (a double
 * click, or a client bypassing its own submit lock) can't both succeed:
 * whichever loses the race gets a transaction conflict, not a second job.
 */
export async function startStadiumConstruction(
  teamId: string,
  seatsToAdd: SeatCounts,
  config: StadiumConfig = DEFAULT_STADIUM_CONFIG
) {
  const totalNew = totalSeats(seatsToAdd)
  if (totalNew <= 0) throw new NoSeatsRequestedError()

  return prisma.$transaction(
    async (tx) => {
      const stadium = await tx.stadium.findUniqueOrThrow({ where: { teamId } })
      const activeJob = await tx.stadiumConstructionJob.findFirst({
        where: { stadiumId: stadium.id, status: { in: ["pending", "active"] } },
      })
      if (activeJob) throw new ConstructionInProgressError()

      const totalCost = calculateConstructionCost(seatsToAdd, config)
      const days = calculateConstructionTime(totalNew, config)
      const startedAt = new Date()
      const endsAt = new Date(startedAt.getTime() + days * 24 * 60 * 60 * 1000)

      const job = await tx.stadiumConstructionJob.create({
        data: {
          stadiumId: stadium.id,
          regularSeatsAdded: seatsToAdd.regular,
          coveredSeatsAdded: seatsToAdd.covered,
          premiumSeatsAdded: seatsToAdd.premium,
          vipSeatsAdded: seatsToAdd.vip,
          totalCost,
          status: "active",
          startedAt,
          endsAt,
        },
      })

      // Discretionary spend - this is the user's own choice, so unlike
      // mandatory recurring costs it must block (and roll the job creation
      // back) rather than push the balance negative.
      await createFinancialTransaction(tx, {
        teamId,
        type: "stadiumConstruction",
        amount: -totalCost,
        description: `שדרוג אצטדיון: ${totalNew.toLocaleString()} מקומות חדשים`,
        referenceId: `STADIUM_CONSTRUCTION_${job.id}`,
        allowNegative: false,
      })

      return job
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  )
}

/** Applies a finished job's seats to the stadium and marks it completed. Idempotent. */
export async function completeStadiumConstruction(jobId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const job = await tx.stadiumConstructionJob.findUnique({ where: { id: jobId } })
    if (!job || job.status !== "active" || job.endsAt > new Date()) return

    await tx.stadium.update({
      where: { id: job.stadiumId },
      data: {
        regularSeats: { increment: job.regularSeatsAdded },
        coveredSeats: { increment: job.coveredSeatsAdded },
        premiumSeats: { increment: job.premiumSeatsAdded },
        vipSeats: { increment: job.vipSeatsAdded },
      },
    })
    await tx.stadiumConstructionJob.update({
      where: { id: jobId },
      data: { status: "completed", completedAt: new Date() },
    })
  })
}

/**
 * THE SCHEDULED SETTLER - every club, every overdue job, once per tick.
 *
 * This replaces the per-club self-heal that used to run from the /stadium
 * page render. A page load is a fact about one manager's browser, and 57 of
 * this league's 60 clubs have no manager at all, so a build could sit
 * finished-but-unmaterialised indefinitely while the matches it should have
 * been open for were played at the old capacity.
 *
 * IT MOVES NO MONEY, and that is what makes migrating it safe: the whole cost
 * was debited when the job was created (startStadiumConstruction, in the same
 * transaction), so there is no backlog of charges hiding behind an overdue
 * job. Completion adds seats and closes a job, nothing else.
 *
 * IT IS NOT WHAT MAKES MATCHES CORRECT. Running this first in the tick keeps
 * the Stadium row fresh, but a fixture's capacity is decided by seatsAsOf
 * (src/lib/stadium/as-of.ts) against the fixture's own scheduledAt, so a
 * match played by a late cron gets the same stadium a punctual one would have
 * given it. This settler is a freshness step, not an authority.
 *
 * BOUNDED: at most `limit` jobs per run, oldest deadline first, so one club
 * with a pile of history can never monopolise a tick. Club-type agnostic on
 * purpose - a club can be abandoned back to BOT status while a job is still
 * running, and that job must still finish.
 */
export const STADIUM_COMPLETION_BATCH = 50

export interface StadiumCompletionResult {
  found: number
  completed: number
  failures: { jobId: string; error: unknown }[]
}

export async function settleDueStadiumConstructionForAll(
  now: Date = new Date(),
  limit: number = STADIUM_COMPLETION_BATCH
): Promise<StadiumCompletionResult> {
  const due = await prisma.stadiumConstructionJob.findMany({
    where: { status: "active", endsAt: { lte: now } },
    orderBy: [{ endsAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  })

  const result: StadiumCompletionResult = { found: due.length, completed: 0, failures: [] }
  for (const job of due) {
    try {
      await completeStadiumConstruction(job.id)
      result.completed++
    } catch (error) {
      // One club's job failing must not stop the rest of the league's.
      result.failures.push({ jobId: job.id, error })
    }
  }
  return result
}

export { InsufficientFundsError }
