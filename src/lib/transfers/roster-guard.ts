/**
 * THE ONE VALIDATOR A VOLUNTARY DEPARTURE PASSES THROUGH.
 *
 * Release and the selling side of Purchase are the only two ways a manager
 * can choose to make their squad smaller, and both must obey the same rule.
 * Two implementations would drift; this is one function with two call sites.
 *
 * ===================== WHY THE COUNT FLOOR IS NOT ENOUGH ==================
 *
 * A club with 18 players and exactly 2 goalkeepers that sells one keeper has
 * 17 players - it clears any count floor - and one goalkeeper. One injury
 * later an outfielder is in goal, rated 45 on every keeper attribute, for up
 * to four matches, with nothing warning anybody. The guard therefore checks
 * the COMPLETE invariant: total AND every positional minimum.
 *
 * ======================= IT IS THE POST-STATE, NOT THE DELTA ==============
 *
 * The rule is "the roster after this transaction satisfies the floor", full
 * stop - not "this transaction does not make things worse". A club already
 * below a floor (a legacy state, or one created before this guard existed)
 * can make no voluntary departure at all until the season boundary repairs
 * it. "You may make it worse as long as you were already bad" is not a guard.
 *
 * =============================== NO NEW LOCKS =============================
 *
 * Both callers already hold the departing player's row lock and the club's
 * roster lock by the time they reach this. The guard is a COUNT under locks
 * the transaction already owns plus a pure comparison, so it introduces no
 * new lock, no new lock order, and no new deadlock surface.
 *
 * RETIREMENT IS NOT A CALLER. It is involuntary and may legitimately push a
 * club below any floor - that is precisely what the season-boundary
 * replenishment stage exists to repair.
 */
import type { Prisma } from "@/generated/prisma"
import { countRoster, countsAfterDeparture, failedConstraints } from "@/lib/players/roster-floor"
import { TransferError } from "./errors"

/**
 * Reads the club's ACTIVE owned squad by position, under whatever lock the
 * caller is already holding.
 *
 * ACTIVE ownership only: fitness, status, injuryMatchesRemaining and
 * suspensionMatches are deliberately not selected. Temporary unavailability
 * is Phase 3L's territory and must never influence a permanent roster rule.
 */
export async function readRosterCounts(tx: Prisma.TransactionClient, teamId: string) {
  const players = await tx.player.findMany({
    where: { teamId, careerStatus: "ACTIVE" },
    select: { primaryPosition: true },
  })
  return countRoster(players)
}

/**
 * Throws SQUAD_FLOOR_REACHED if losing this player would leave the club
 * unable to carry a season. Does nothing otherwise - and, critically,
 * mutates nothing either way, so a rejected transaction has written no
 * lineup change, no ownership change, no stint change and no ledger row.
 */
export async function assertDepartureKeepsRosterLegal(
  tx: Prisma.TransactionClient,
  teamId: string,
  departing: { id: string; primaryPosition: string }
): Promise<void> {
  const counts = await readRosterCounts(tx, teamId)
  const after = countsAfterDeparture(counts, departing.primaryPosition)
  const failed = failedConstraints(after)
  if (failed.length === 0) return
  throw new TransferError(
    "SQUAD_FLOOR_REACHED",
    `Team ${teamId} cannot release player ${departing.id}: the squad would breach ${failed.join(", ")} ` +
      `(after: total=${after.total} GK=${after.GK} DEF=${after.DF} MID=${after.MF} ATT=${after.FW})`
  )
}
