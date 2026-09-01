import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { createFinancialTransaction, InsufficientFundsError } from "@/lib/economy/service"
import {
  DEFAULT_STADIUM_CONFIG,
  DEFAULT_STARTING_SEATS,
  DEFAULT_STADIUM_NAME_SUFFIX,
  toSeatColumns,
  type SeatCounts,
  type StadiumConfig,
} from "./config"
import { calculateConstructionCost, calculateConstructionTime, totalSeats } from "./construction"

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
 * Self-heal, run on every stadium page load - relies on server time, never a
 * browser-side timer. Returns the just-finished job (if any) so the page can
 * show a one-time completion message.
 *
 * Unlike match results (see processDueFixtures in
 * src/lib/match/simulate.ts), completing a construction job is a single
 * idempotent update with no simulation and no risk of a duplicate/
 * conflicting write, so it stays safe to run from a page load rather than
 * needing a scheduled job of its own.
 */
export async function settleDueStadiumConstruction(teamId: string) {
  const stadium = await prisma.stadium.findUnique({
    where: { teamId },
    include: { constructionJobs: { where: { status: "active", endsAt: { lte: new Date() } } } },
  })
  if (!stadium || stadium.constructionJobs.length === 0) return null

  for (const job of stadium.constructionJobs) {
    await completeStadiumConstruction(job.id)
  }
  return stadium.constructionJobs[0]
}

export { InsufficientFundsError }
