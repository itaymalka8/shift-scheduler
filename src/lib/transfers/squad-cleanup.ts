import type { Prisma } from "@/generated/prisma"
import { repairTeamLineup } from "@/lib/players/lineup-repair"

export interface TeamRoleSnapshot {
  captainId: string | null
  penaltyTakerId: string | null
  freeKickTakerId: string | null
  cornerTakerId: string | null
}

/**
 * Removes a player's involvement in their (former) team's active tactical
 * setup: their lineup slot, and only the set-piece/captaincy roles that are
 * actually theirs - never a role that belongs to someone else. Shared by
 * Release, Purchase and Retirement, which all need this exact cleanup
 * whenever a player leaves a team's squad.
 *
 * IT NOW CLOSES THE HOLE IT MAKES. Deleting the slot was always right;
 * leaving the eleventh slot empty was not, and it is what let a club walk
 * into the next match with ten starters. The canonical repair service runs
 * in the SAME transaction, so a rolled-back departure cannot leave a lineup
 * rebuilt around somebody who never left.
 */
export async function removePlayerFromSquad(
  tx: Prisma.TransactionClient,
  teamId: string,
  playerId: string,
  team: TeamRoleSnapshot
): Promise<void> {
  await tx.lineupSlot.deleteMany({ where: { playerId } })

  const roleClears: Record<string, null> = {}
  if (team.captainId === playerId) roleClears.captainId = null
  if (team.penaltyTakerId === playerId) roleClears.penaltyTakerId = null
  if (team.freeKickTakerId === playerId) roleClears.freeKickTakerId = null
  if (team.cornerTakerId === playerId) roleClears.cornerTakerId = null
  if (Object.keys(roleClears).length > 0) {
    await tx.team.update({ where: { id: teamId }, data: roleClears })
  }

  // ONE canonical repair, called from the one place every departure already
  // funnels through - rather than a copy of the same logic at each call site.
  //
  // AND IT IS TOLD WHO IS LEAVING. Every caller clears the slot before it
  // writes the departure to the Player row, so at this moment the database
  // still says this club owns the leaver - and the repair, left to read the
  // database alone, would hand him the very slot it just cleared. Naming him
  // here is what stops a sold player being re-selected for the club selling
  // him, a released player holding a slot at a club he no longer plays for,
  // and a retiring player being picked to start one more match.
  await repairTeamLineup(tx, teamId, { departing: [playerId] })
}
