/**
 * THE PHASE 3R ACTIVATION LOCK - the thing that makes the salary-era crossing
 * atomic for the whole league.
 *
 * THE RACE THIS EXISTS TO CLOSE. Repricing commits the league onto the
 * calibrated curve together with the activation week's sponsor rows, so the
 * existence of that sponsor row is durable evidence that the crossing
 * happened. Checking for that marker is necessary but NOT sufficient, because
 * a salary writer can interleave with the scan:
 *
 *   1. writer checks the marker            -> absent, so it prices on legacy
 *   2. the settlement transaction begins repricing
 *   3. repricing scans every ACTIVE player -> the writer's row does not exist yet
 *   4. the writer inserts its legacy-priced player and commits
 *   5. the settlement commits the marker
 *
 * The marker now says the league is calibrated, and one player is not. Nothing
 * ever revisits him except the next week's convergence, so for a week the
 * league is in exactly the mixed state Phase 3R was built to make
 * unrepresentable.
 *
 * THE FIX: ONE LOCK, TWO MODES. Salary writers hold it SHARED for the whole
 * transaction in which they decide the curve and insert the player. The
 * repricing settlement holds it EXCLUSIVE. Shared and exclusive are mutually
 * exclusive, so for any writer W and the activation transaction R exactly one
 * of two orders happens, and neither produces a mixed league:
 *
 *   W FIRST   R blocks at its exclusive acquire until W commits. While W holds
 *             shared, R has not committed, so the marker is absent, so W
 *             prices on LEGACY - and commits BEFORE the repricing scan runs.
 *             The scan therefore sees W's player and reprices him.
 *
 *   R FIRST   W blocks at its shared acquire until R commits or rolls back.
 *             On commit the marker exists, so W prices on PHASE 3R. On
 *             rollback repricing is undone with it, the marker is absent, and
 *             W correctly prices on legacy - the crossing simply has not
 *             happened yet.
 *
 * THERE IS NO THIRD STATE. The only way out of those two is for W's marker
 * read to be concurrent with R's marker write, and that is exactly what the
 * lock forbids: W reads strictly inside its shared hold, R writes strictly
 * inside its exclusive hold, and the two holds cannot overlap.
 *
 * TWO PRECONDITIONS THE PROOF DEPENDS ON, stated so they are not lost in a
 * later refactor:
 *   (a) A writer must read the marker AFTER taking the lock, in the SAME
 *       transaction that inserts or updates the player. A wage computed
 *       outside the transaction and written later re-opens the race in full.
 *   (b) repriceLeagueSalaries must stay inside the transaction that writes the
 *       marker. It is (weekly-settlement.ts), and it must remain so.
 *
 * COST AFTER ACTIVATION. Nothing ever takes exclusive again except the weekly
 * settlement, whose repricing is a no-op by then, so a writer's shared acquire
 * is uncontended - one round trip. It is not skipped once the marker exists,
 * because "the marker exists" is itself a read that would need this lock to be
 * trustworthy, and one uncontended advisory acquire is cheaper than the
 * reasoning required to prove a fast path safe.
 *
 * LOCK ORDER. This is the FIRST lock any transaction takes - before
 * goalx:economy:history, before Team rows, before Player rows. Activation
 * repricing holds it exclusive and then takes Player row locks via updateMany,
 * so any transaction that grabbed a Player row before asking for this one
 * could deadlock against it. One global first-lock removes that whole class.
 */
import type { Prisma } from "@/generated/prisma"

const PHASE_3R_ACTIVATION_LOCK = "goalx:phase3r:activation"

/**
 * Taken by every salary writer, for the whole transaction in which it decides
 * a curve and writes a player. Shared, so ordinary play does not serialise
 * against itself.
 */
export async function acquirePhase3RActivationShared(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${PHASE_3R_ACTIVATION_LOCK}))`
}

/**
 * Taken by the transaction that reprices the league and writes the activation
 * marker. Exclusive: it waits for every in-flight salary writer to commit, and
 * holds off every new one until the crossing is durable.
 */
export async function acquirePhase3RActivationExclusive(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PHASE_3R_ACTIVATION_LOCK}))`
}
