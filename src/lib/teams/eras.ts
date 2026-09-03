/**
 * Every write to TeamEra, and the one read that needs the database.
 *
 * LOCK ORDERING. TeamEra sits at the END of the project's lock-ordering
 * contract (see src/lib/players/locks.ts):
 *
 *     Player -> TransferListing -> LineupSlot -> Team -> TeamEra -> financial
 *
 * Every function here that writes an era is called with the Team row
 * already locked by lockTeamRow below, and TeamEra rows are never locked on
 * their own or before a Team. Since the Team lock is always taken first and
 * this is the only writer of TeamEra anywhere in the codebase, no new ABBA
 * cycle can form.
 */
import type { Prisma } from "@/generated/prisma"
import type { EraWindow } from "./era"

export class TeamEraError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeamEraError"
  }
}

/**
 * Takes the Postgres row lock on one Team.
 *
 * A SELECT ... FOR UPDATE, not a findUnique: a plain read under READ
 * COMMITTED sees a snapshot and leaves nothing behind, so two concurrent
 * takeovers would both read `isBot = true` and both write. This makes the
 * second transaction block until the first commits, at which point it sees
 * the club is taken. It is the guard; the isBot re-check below is what
 * reads the result of holding it.
 *
 * Returns false when no such team exists (nothing was locked).
 */
export async function lockTeamRow(tx: Prisma.TransactionClient, teamId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Team" WHERE id = ${teamId} FOR UPDATE`
  return rows.length > 0
}

/** The club's current era - the open one (endedAt = null). Null if the club has none yet (pre-backfill). */
export async function findOpenEra(tx: Prisma.TransactionClient, teamId: string) {
  return tx.teamEra.findFirst({ where: { teamId, endedAt: null } })
}

export interface OpenEraInput {
  teamId: string
  userId: string | null
  type: "BOT" | "HUMAN"
  at: Date
  seasonId?: string | null
}

/**
 * Closes whatever era is currently open on this club and opens the next
 * one, at the SAME instant - which is what makes the boundary half-open and
 * gapless: no match can fall between two eras, and none can fall in both.
 *
 * The caller MUST already hold the Team row lock (lockTeamRow). Without it
 * two callers could each close the open era and each insert a new one, and
 * only the partial unique index
 * (`UNIQUE("teamId") WHERE "endedAt" IS NULL`) would stop the second - as a
 * constraint violation rather than an orderly wait.
 *
 * Opening an era with no era currently open is legitimate and not an error:
 * that is the very first era of a freshly created club.
 */
export async function closeEraAndOpenNext(tx: Prisma.TransactionClient, input: OpenEraInput) {
  const open = await findOpenEra(tx, input.teamId)

  if (open) {
    if (input.at.getTime() <= open.startedAt.getTime()) {
      // The database CHECK would reject this too; failing here names the
      // problem instead of surfacing a raw constraint error.
      throw new TeamEraError(
        `Cannot close era ${open.id}: the new era would start at or before it did (${input.at.toISOString()} <= ${open.startedAt.toISOString()}).`
      )
    }
    await tx.teamEra.update({
      where: { id: open.id },
      data: { endedAt: input.at, endedSeasonId: input.seasonId ?? null },
    })
  }

  return tx.teamEra.create({
    data: {
      teamId: input.teamId,
      userId: input.userId,
      type: input.type,
      startedAt: input.at,
      startedSeasonId: input.seasonId ?? null,
    },
  })
}

/** Opens a club's first BOT era. Used when a bot club is seeded. Idempotent: does nothing if the club already has an open era. */
export async function ensureBotEra(tx: Prisma.TransactionClient, teamId: string, startedAt: Date, seasonId?: string | null) {
  const open = await findOpenEra(tx, teamId)
  if (open) return open
  return tx.teamEra.create({
    data: { teamId, userId: null, type: "BOT", startedAt, startedSeasonId: seasonId ?? null },
  })
}

export interface TakeoverInput {
  teamId: string
  userId: string
  at: Date
  seasonId?: string | null
}

/**
 * The BOT -> HUMAN handover, in one atomic step.
 *
 * Caller must already hold the Team row lock. Closing the bot era and
 * opening the human era happen in the caller's transaction, alongside the
 * Team.userId / isBot writes, so there is no instant at which the club is
 * HUMAN without a HUMAN era to attribute its matches to.
 *
 * Nothing about the club's history is touched: no fixture, event, player
 * stat, standing or balance is read or written here.
 */
export async function recordHumanTakeover(tx: Prisma.TransactionClient, input: TakeoverInput) {
  return closeEraAndOpenNext(tx, {
    teamId: input.teamId,
    userId: input.userId,
    type: "HUMAN",
    at: input.at,
    seasonId: input.seasonId ?? null,
  })
}

/** An era row narrowed to what the boundary rule needs. */
export function toEraWindow(era: { teamId: string; startedAt: Date; endedAt: Date | null }): EraWindow {
  return { teamId: era.teamId, startedAt: era.startedAt, endedAt: era.endedAt }
}
