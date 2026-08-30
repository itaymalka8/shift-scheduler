import { createFinancialTransaction } from "@/lib/economy/service"
import { InsufficientFundsError } from "@/lib/finance/balance"
import { TransferError } from "./errors"
import { runSerializableTransaction } from "./retry"

export interface ReleasePlayerInput {
  /**
   * The releasing club's id. This service does no authentication of its
   * own - it trusts the caller to have already resolved this from a
   * trusted layer (the signed-in manager's session), never from a raw
   * client-supplied value. A future API route is what will do that
   * resolution; it must never forward a client-supplied teamId here as-is.
   */
  teamId: string
  playerId: string
}

export interface ReleasePlayerResult {
  playerId: string
  stintNumber: number
  /** true when this call found the release already done (by an earlier
   * call for this exact team+stint) and performed no new charge or write. */
  alreadyProcessed: boolean
}

function referenceIdFor(playerId: string, stintNumber: number): string {
  return `RELEASE_${playerId}_${stintNumber}`
}

/**
 * Releases a player to free agency: teamId -> null, careerStatus stays
 * ACTIVE, stintNumber is untouched (it only advances when a player enters a
 * *new* team's ownership - Release ends the current stint, it doesn't
 * start one). Costs exactly one weeklySalary, charged to the releasing
 * club. Allowed even while the transfer window is closed.
 *
 * The whole thing runs in one Serializable transaction (via
 * runSerializableTransaction) so a concurrent conflict on the same player,
 * or on the same team's balance, is caught by Postgres and this call is
 * transparently retried from scratch - never partially applied.
 *
 * Idempotency is NOT built on catching FinancialTransaction's unique
 * constraint mid-transaction (Postgres aborts the rest of an interactive
 * transaction after any failed statement, even one whose JS error gets
 * caught - continuing to write on the same tx afterward is unsafe). The
 * real protection is: re-reading the player's current ownership inside this
 * same transaction, plus Serializable + full-transaction retry on a write
 * conflict. The FinancialTransaction unique constraint on
 * (teamId, referenceId) is only a backstop that this design means should
 * never actually be hit in normal operation.
 */
export async function releasePlayer(input: ReleasePlayerInput): Promise<ReleasePlayerResult> {
  return runSerializableTransaction(async (tx) => {
    // 1. Re-read the player inside this transaction - never trust a value
    // read before the transaction started.
    const player = await tx.player.findUnique({ where: { id: input.playerId } })
    if (!player) {
      throw new TransferError("PLAYER_NOT_OWNED", `No such player: ${input.playerId}`)
    }

    // 2. Career-lifecycle check comes before ownership, regardless of it.
    if (player.careerStatus !== "ACTIVE") {
      throw new TransferError("PLAYER_NOT_ACTIVE", `Player ${player.id} is not ACTIVE (${player.careerStatus})`)
    }

    const referenceId = referenceIdFor(player.id, player.stintNumber)

    if (player.teamId !== input.teamId) {
      // Not currently owned by the requesting team - either never was (in
      // this stint), or this is a repeat call after a release that already
      // happened. Idempotency check: has *this team* already recorded a
      // release charge for *this exact stint*? A wrong-team caller looks
      // up its own teamId here and will never find the original owner's
      // charge, so it correctly falls through to PLAYER_NOT_OWNED too.
      const existingCharge = await tx.financialTransaction.findUnique({
        where: { teamId_referenceId: { teamId: input.teamId, referenceId } },
      })
      if (existingCharge) {
        return { playerId: player.id, stintNumber: player.stintNumber, alreadyProcessed: true }
      }
      throw new TransferError("PLAYER_NOT_OWNED", `Player ${player.id} is not owned by team ${input.teamId}`)
    }

    // 3. From here on this is a brand-new release for this team+stint.
    const team = await tx.team.findUniqueOrThrow({
      where: { id: input.teamId },
      select: { balance: true, captainId: true, penaltyTakerId: true, freeKickTakerId: true, cornerTakerId: true },
    })

    // 4. Balance check - fail fast, before touching listings/lineup/roles,
    // and before ever attempting the charge itself.
    if (team.balance - player.weeklySalary < 0) {
      throw new TransferError(
        "INSUFFICIENT_FUNDS",
        `Team ${input.teamId} balance ${team.balance} is insufficient for release cost ${player.weeklySalary}`
      )
    }

    // 5. Cancel any OPEN listing for this player - including one whose
    // expiresAt has already passed but the expiration processor hasn't run
    // yet. No OPEN row may survive a Release.
    await tx.transferListing.updateMany({
      where: { playerId: player.id, status: "OPEN" },
      data: { status: "CANCELLED" },
    })

    // 6. Remove the player's current lineup slot, if any.
    await tx.lineupSlot.deleteMany({ where: { playerId: player.id } })

    // 7. Clear only the set-piece/captaincy roles that are actually this
    // player's - never touch a role that belongs to someone else.
    const roleClears: Record<string, null> = {}
    if (team.captainId === player.id) roleClears.captainId = null
    if (team.penaltyTakerId === player.id) roleClears.penaltyTakerId = null
    if (team.freeKickTakerId === player.id) roleClears.freeKickTakerId = null
    if (team.cornerTakerId === player.id) roleClears.cornerTakerId = null
    if (Object.keys(roleClears).length > 0) {
      await tx.team.update({ where: { id: input.teamId }, data: roleClears })
    }

    // 8. Charge exactly one weeklySalary, through the Economy Service - the
    // only place allowed to change Team.balance. allowNegative:false is
    // defense-in-depth on top of the explicit check in step 4 (same
    // transaction, so it can never actually disagree with it).
    let charge: Awaited<ReturnType<typeof createFinancialTransaction>>
    try {
      charge = await createFinancialTransaction(tx, {
        teamId: input.teamId,
        type: "playerSalaries",
        amount: -player.weeklySalary,
        description: `Release: ${player.firstName} ${player.lastName}`,
        referenceId,
        allowNegative: false,
      })
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new TransferError("INSUFFICIENT_FUNDS", error.message)
      }
      throw error
    }
    if (!charge) {
      // createFinancialTransaction only returns null when its own insert
      // hit the (teamId, referenceId) unique constraint - something the
      // ownership check above should already have made impossible here.
      // Never treat this as a quiet success: abort loudly rather than
      // continue mutating Player on a transaction whose insert just
      // silently no-opped underneath us.
      throw new TransferError("TRANSFER_CONFLICT", `Unexpected duplicate release ledger entry for ${referenceId}`)
    }

    // 9. Release the player. careerStatus and stintNumber are untouched.
    await tx.player.update({ where: { id: player.id }, data: { teamId: null } })

    return { playerId: player.id, stintNumber: player.stintNumber, alreadyProcessed: false }
  })
}
