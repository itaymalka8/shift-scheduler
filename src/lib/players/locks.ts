import type { Prisma } from "@/generated/prisma"

/**
 * Takes the Postgres row lock on one Player, and nothing else.
 *
 * This is the root of the project's lock-ordering contract. Every
 * transaction that mutates a player's OWNERSHIP (teamId) or CAREER STATE
 * (careerStatus) must call this as its first statement, before touching any
 * other table. The canonical order is:
 *
 *     Player  ->  TransferListing  ->  LineupSlot  ->  Team  ->  financial
 *
 * The reason is a real deadlock, reproduced against Postgres: Retirement
 * used to lock the Player first and then reach for the listing/lineup/team
 * rows, while Release and Purchase reached those rows first and only wrote
 * the Player last. Two such transactions on the same player form an ABBA
 * cycle, and Postgres kills one with SQLSTATE 40P01 - which Prisma surfaces
 * as an unstructured PrismaClientUnknownRequestError, so it is neither
 * retried nor mapped to a domain error. Ordering every path the same way
 * makes the cycle impossible to form in the first place; it is the fix, not
 * a retry policy.
 *
 * Deliberately knows nothing about transfers, retirement, or any other
 * domain: it acquires a lock and reports whether the row exists. Callers
 * map a missing row onto their own error vocabulary, so this helper never
 * has to pick one.
 *
 * Returns false when no such player exists (nothing was locked).
 *
 * WHERE MORE THAN ONE TEAM ROW IS ALSO LOCKED (Purchase locks both the
 * selling and the buying club), those Team rows must be locked together in
 * ascending id order - see purchaseTransferListing - so that two concurrent
 * deals between the same two clubs, in opposite directions, cannot form
 * their own ABBA cycle at the Team level.
 */
export async function lockPlayerRow(tx: Prisma.TransactionClient, playerId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Player" WHERE id = ${playerId} FOR UPDATE`
  return rows.length > 0
}
