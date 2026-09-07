import type { Prisma, YouthIntake } from "@/generated/prisma"
import { YouthError } from "./errors"

/**
 * Locks one YouthIntake row - the root of lock ordering inside the youth
 * domain (see promote.ts: YouthIntake -> Team -> roster count -> Player
 * insert). Shared by the promotion engine and the deadline/finalize paths
 * below so there is exactly one way this row ever gets locked.
 */
export async function lockYouthIntake(tx: Prisma.TransactionClient, intakeId: string): Promise<YouthIntake> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "YouthIntake" WHERE id = ${intakeId} FOR UPDATE`
  if (rows.length === 0) {
    throw new YouthError("INTAKE_NOT_FOUND", `No such intake: ${intakeId}`)
  }
  return tx.youthIntake.findUniqueOrThrow({ where: { id: intakeId } })
}

/**
 * The one place PENDING prospects become EXPIRED and an intake becomes
 * CLOSED - whether that's because its deadline passed (settleIntakeDeadline
 * below) or because a manager finalized it early (finalizeYouthIntake in
 * intake.ts). Caller must already hold the intake's row lock.
 */
export async function closeIntakeAndExpireRemaining(
  tx: Prisma.TransactionClient,
  intakeId: string,
  closedAt: Date
): Promise<YouthIntake> {
  await tx.youthProspect.updateMany({
    where: { youthIntakeId: intakeId, status: "PENDING" },
    data: { status: "EXPIRED" },
  })
  return tx.youthIntake.update({ where: { id: intakeId }, data: { status: "CLOSED", closedAt } })
}

export interface IntakeDeadlineSettlement {
  intake: YouthIntake
  /** true only when THIS call is what closed the intake because its deadline had passed. */
  justExpired: boolean
}

/**
 * closesAt is a hard deadline enforced here, not by a cron - a human
 * mutation (Promotion, Finalize) or a GET must never show or act on an
 * intake as OPEN once its deadline has passed, whether or not any
 * scheduled job has gotten around to it yet. Caller must already hold the
 * intake's row lock (via lockYouthIntake) so two concurrent callers can
 * never both observe "still OPEN" and race to close it twice.
 */
export async function settleIntakeDeadline(
  tx: Prisma.TransactionClient,
  intake: YouthIntake,
  now: Date
): Promise<IntakeDeadlineSettlement> {
  if (intake.status !== "OPEN" || intake.closesAt > now) {
    return { intake, justExpired: false }
  }
  const closed = await closeIntakeAndExpireRemaining(tx, intake.id, now)
  return { intake: closed, justExpired: true }
}
