import type { Prisma } from "@/generated/prisma"

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
 * Release and Purchase, which both need this exact cleanup whenever a
 * player leaves a team's squad.
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
}
