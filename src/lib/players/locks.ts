import { Prisma as PrismaRuntime } from "@/generated/prisma"
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

/**
 * Takes the Postgres row lock on EVERY player owned by the given clubs, in
 * ascending player id, and nothing else.
 *
 * This is the multi-row extension of lockPlayerRow above, and it exists for
 * exactly one caller: the match. A fixture's legality is judged against the
 * squads, and the engine then simulates those same squads - so between the
 * judgement and the simulation, no player may leave. Every path that can
 * remove one (Purchase, Release, Retirement, Listing) already takes
 * lockPlayerRow on that player as its FIRST statement, so holding the whole
 * squad here means each of them blocks at its own statement zero rather than
 * halfway through. That is what makes "the XI that was validated is the XI
 * that was simulated" a database guarantee rather than a hope.
 *
 * It keeps the documented order intact: Player is still first, and the match
 * takes its Team locks after these and before touching LineupSlot, exactly as
 * Transfer Purchase does.
 *
 * ORDER BY id inside one statement gives both a deterministic lock order and
 * a single round trip. Two matches can only contend if a club has two
 * fixtures in flight at once; sorting by the same key in both means they can
 * never take the same two rows in opposite orders.
 *
 * Returns how many rows were locked.
 */
export async function lockTeamSquads(tx: Prisma.TransactionClient, teamIds: readonly string[]): Promise<number> {
  const ordered = [...new Set(teamIds)].sort()
  if (ordered.length === 0) return 0
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Player" WHERE "teamId" IN (${PrismaRuntime.join(ordered)}) ORDER BY "id" FOR UPDATE
  `
  return rows.length
}
