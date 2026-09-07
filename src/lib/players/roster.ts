import type { Prisma } from "@/generated/prisma"
import { DEFAULT_SQUAD_COMPOSITION } from "./config"

/**
 * The cap on a club's ACTIVE roster. Read from the squad composition config
 * rather than restated as a literal, so a future change to squadSize moves
 * the transfer cap and the youth intake cap together instead of leaving one
 * behind.
 */
export const MAX_ACTIVE_ROSTER_SIZE = DEFAULT_SQUAD_COMPOSITION.squadSize

/**
 * Takes the Postgres row lock on one club. Every path that changes the size
 * of a club's ACTIVE roster - Transfer Purchase, Youth Promotion, and
 * anything added later - must hold this before counting the roster, so a
 * count can never go stale between the check and the insert that depends on
 * it (which is how a squad ends up at 23).
 *
 * Lock ordering, per src/lib/players/locks.ts:
 *
 *   Purchase:  Player -> Team(s, ascending id) -> roster count
 *   Youth:     YouthIntake -> Team -> roster count -> Player insert
 *
 * A caller that must lock more than one club (Purchase locks both the
 * selling and the buying side) calls this once per club in ascending id
 * order - see lockTeamRosters - so two concurrent deals between the same
 * two clubs in opposite directions cannot deadlock.
 *
 * Deliberately a WRITE, not a `SELECT ... FOR UPDATE`. A plain row lock is
 * not enough here, and the difference is a bug that reached this repo:
 * Transfer Purchase runs SERIALIZABLE, so its roster count is answered from
 * the snapshot taken when its transaction began. A concurrent Youth
 * Promotion that took the Team lock first, inserted its player and
 * committed, left no trace that snapshot could see - a `FOR UPDATE` lock is
 * not a row version change, so nothing raised a serialization failure, the
 * purchase counted a roster one player out of date, and the club ended up
 * with 23.
 *
 * Writing the row instead materializes the conflict. `SET "name" = "name"`
 * changes nothing observable but produces a new row version, so:
 *
 *  - a READ COMMITTED caller blocks here, then reads a fresh roster count;
 *  - a SERIALIZABLE caller whose snapshot predates the other's commit gets
 *    SQLSTATE 40001 here, which withSerializableRetry re-runs from scratch
 *    against a fresh snapshot.
 *
 * Either way the roster count that follows this call is current, which is
 * the only thing that makes the cap check trustworthy.
 *
 * Returns false when no such club exists (nothing was locked).
 */
export async function lockTeamRoster(tx: Prisma.TransactionClient, teamId: string): Promise<boolean> {
  const affected = await tx.$executeRaw`UPDATE "Team" SET "name" = "name" WHERE "id" = ${teamId}`
  return affected > 0
}

/** Locks several clubs in ascending id order - the deterministic order that keeps two multi-club transactions from deadlocking. */
export async function lockTeamRosters(tx: Prisma.TransactionClient, teamIds: string[]): Promise<boolean> {
  const ordered = [...new Set(teamIds)].sort()
  for (const teamId of ordered) {
    if (!(await lockTeamRoster(tx, teamId))) return false
  }
  return true
}

/** How many ACTIVE players a club currently owns. Retired players never count against the cap. */
export function getActiveRosterCount(tx: Prisma.TransactionClient, teamId: string): Promise<number> {
  return tx.player.count({ where: { teamId, careerStatus: "ACTIVE" } })
}

/** Free ACTIVE roster slots, never negative - call only while holding lockTeamRoster. */
export async function getAvailableRosterSlots(tx: Prisma.TransactionClient, teamId: string): Promise<number> {
  const count = await getActiveRosterCount(tx, teamId)
  return Math.max(0, MAX_ACTIVE_ROSTER_SIZE - count)
}

/**
 * The lowest shirt number from 1 upward that nobody on the club's ACTIVE
 * roster is already wearing. Squad generation hands out 1..squadSize to a
 * fresh squad; a player joining an existing squad (youth promotion today,
 * any future signing path) needs whatever is actually free, which may be
 * above squadSize once numbers have been vacated and reused.
 */
export async function pickAvailableShirtNumber(tx: Prisma.TransactionClient, teamId: string): Promise<number> {
  const worn = await tx.player.findMany({
    where: { teamId, careerStatus: "ACTIVE" },
    select: { shirtNumber: true },
  })
  const taken = new Set(worn.map((p) => p.shirtNumber))
  let candidate = 1
  while (taken.has(candidate)) candidate++
  return candidate
}
