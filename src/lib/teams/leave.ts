/**
 * A MANAGER LEAVING THEIR CLUB.
 *
 * The mirror of the takeover, and deliberately built from the SAME parts:
 * closeEraAndOpenNext does the ownership-interval work here exactly as it
 * does for recordHumanTakeover, so there is one algorithm for era
 * boundaries in this codebase and not two that could drift.
 *
 * WHAT LEAVING IS. At one instant T the HUMAN era closes, a BOT era opens at
 * the same T, and the club's current state follows. The window stays
 * half-open, [startedAt, endedAt), so a match kicking off exactly at T
 * belongs to the BOT era and to nothing else - the same rule, and the same
 * boundary semantics, as the takeover it undoes.
 *
 * WHAT LEAVING IS NOT. It is not a reset. The squad, players, lineups,
 * tactics, stadium, finances, fixtures, events, player stats, league
 * position, titles and every historical era stay exactly as they are. The
 * club keeps its name, its crest and its colours: it is the same club, now
 * unmanaged. Nothing in this file reads or writes any of them, which is the
 * strongest form that promise can take.
 *
 * The manager keeps everything they earned. Their closed era still names
 * them, every match inside it still counts toward their career, and any
 * SeasonChampion pointing at that era is theirs permanently - teamEraId is
 * RESTRICT, so the era cannot even be deleted while a title references it.
 * No match after T is ever theirs.
 *
 * A LATER RETURN IS A NEW ERA. Never reopen a closed one, never merge two
 * human eras. Two spells at one club are two rows, and a career sums them
 * separately - which is what keeps the bot interval between them out of the
 * manager's record.
 */
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { getFixtureListStatus } from "@/lib/match/fixture-status"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import { closeEraAndOpenNext, lockTeamRow } from "./eras"

/** Stable codes, so an API route maps them without inventing its own vocabulary. */
export type LeaveFailureReason =
  /** The user manages no club. */
  | "NO_TEAM"
  /** The club is not theirs - most often a race this request lost. */
  | "NOT_MANAGER"
  /** The club is already unmanaged. */
  | "ALREADY_BOT"
  /** Era rows and current state disagree. FAIL CLOSED - never repaired here. */
  | "ERA_MISMATCH"
  /** One of the club's matches is being played right now. */
  | "MATCH_LIVE"

export class TeamLeaveError extends Error {
  readonly reason: LeaveFailureReason

  constructor(reason: LeaveFailureReason, message: string) {
    super(message)
    this.name = "TeamLeaveError"
    this.reason = reason
  }
}

export interface LeaveResult {
  teamId: string
  /** The era that just closed - the manager's, forever. */
  closedEraId: string
  /** The bot era that now holds the club. */
  openedEraId: string
  /** The single instant the whole transition happened at. */
  at: Date
}

/**
 * Every club fixture that is being played AT THIS INSTANT.
 *
 * The SQL is exactly the live window - kicked off, and less than the real
 * duration ago - pushed down so the read is bounded. getFixtureListStatus
 * then decides, because it is the project's ONE definition of "live" and
 * this file must not become a second one. Deliberately not playedAt: the
 * engine writes a match's whole result at kickoff, so playedAt is true from
 * the first second of a match still being watched.
 */
async function liveFixtureCount(tx: Prisma.TransactionClient, teamId: string, now: Date): Promise<number> {
  const windowStart = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)
  const candidates = await tx.fixture.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      scheduledAt: { gt: windowStart, lte: now },
    },
    select: { scheduledAt: true, playedAt: true },
  })
  return candidates.filter((fixture) => getFixtureListStatus(fixture, now) === "live").length
}

/**
 * The manager leaves their club, atomically.
 *
 * LOCK ORDER. Team first, then TeamEra - the tail of the project's existing
 * contract (Player -> TransferListing -> LineupSlot -> Team -> TeamEra ->
 * financial). No other table is locked, so this path cannot introduce a new
 * cycle. One Team row only, so it cannot form a Team-level ABBA either.
 *
 * THE LOCK IS TAKEN BEFORE ANYTHING IS TRUSTED. The club is found by
 * userId outside the lock - that read can be stale by the time the lock is
 * granted - so every field is RE-READ under the lock and re-validated. Two
 * concurrent leave requests therefore serialise: the winner nulls
 * Team.userId, and the loser wakes up, sees a club that is no longer theirs,
 * and fails closed with NOT_MANAGER rather than closing a second era.
 *
 * A LEAVE RACING A TAKEOVER cannot interleave either: claimFreeBotTeam
 * selects `FOR UPDATE SKIP LOCKED` on `isBot = true AND userId IS NULL`, so
 * while this transaction holds the row a signup passes the club over and
 * claims another. After commit the club is a legitimate free slot.
 *
 * `now` is taken as a parameter, and used ONCE for the whole transition:
 * endedAt, startedAt and the live-match check all see the same instant, so
 * the boundary is exact and the guard cannot be evaluated against a
 * different clock than the write.
 */
export async function leaveManagedTeam(userId: string, now: Date = new Date()): Promise<LeaveResult> {
  const current = await prisma.team.findUnique({ where: { userId }, select: { id: true } })
  if (!current) {
    throw new TeamLeaveError("NO_TEAM", "You are not managing a club.")
  }

  return prisma.$transaction(async (tx) => {
    if (!(await lockTeamRow(tx, current.id))) {
      throw new TeamLeaveError("NO_TEAM", `Club ${current.id} no longer exists.`)
    }

    // Everything below is read UNDER the lock. Nothing read before it is
    // trusted for a decision.
    const team = await tx.team.findUniqueOrThrow({
      where: { id: current.id },
      select: { id: true, userId: true, isBot: true, countryCode: true },
    })

    if (team.userId !== userId) {
      throw new TeamLeaveError("NOT_MANAGER", `Club ${team.id} is not managed by this user.`)
    }
    if (team.isBot) {
      throw new TeamLeaveError("ALREADY_BOT", `Club ${team.id} is already unmanaged.`)
    }

    // The club's era history must agree with its current state before
    // anything is written. A disagreement is a data defect, and the correct
    // response to one is to stop - never to guess which side is right, and
    // never to quietly repair it inside an unrelated user action.
    const openEras = await tx.teamEra.findMany({
      where: { teamId: team.id, endedAt: null },
      select: { id: true, type: true, userId: true },
    })
    if (openEras.length !== 1) {
      throw new TeamLeaveError(
        "ERA_MISMATCH",
        `Club ${team.id} has ${openEras.length} open eras; exactly one is required to leave.`
      )
    }
    const [openEra] = openEras
    if (openEra.type !== "HUMAN" || openEra.userId !== userId) {
      throw new TeamLeaveError(
        "ERA_MISMATCH",
        `Club ${team.id}'s open era (${openEra.type}) does not belong to this user.`
      )
    }

    // THE ONE PRODUCT RULE ON TIMING. A future fixture never blocks leaving,
    // an active season never blocks leaving, and the offseason never blocks
    // leaving. A match happening RIGHT NOW does: ownership changing hands
    // while a manager is watching their own match play out is confusing
    // whatever the attribution rule says, and it is the one case that costs
    // nothing to refuse.
    const live = await liveFixtureCount(tx, team.id, now)
    if (live > 0) {
      throw new TeamLeaveError(
        "MATCH_LIVE",
        `Club ${team.id} has ${live} match(es) being played right now; try again when they finish.`
      )
    }

    // The season is an ANNOTATION on both eras, never a boundary - the
    // boundary is T. Recorded when it can be determined honestly and left
    // null when it cannot; no season is ever invented for it.
    const season = team.countryCode
      ? await tx.season.findFirst({
          where: { countryCode: team.countryCode, isActive: true },
          select: { id: true },
        })
      : null

    // ONE instant for the whole handover, so the closing endedAt and the
    // opening startedAt are byte-identical: no gap, no overlap, and a match
    // kicking off exactly then belongs to the bot era alone.
    const opened = await closeEraAndOpenNext(tx, {
      teamId: team.id,
      userId: null,
      type: "BOT",
      at: now,
      seasonId: season?.id ?? null,
    })

    // Current state follows the era, in the same transaction, so the club is
    // never a bot without a bot era to attribute its matches to. The name,
    // crest and colours are deliberately absent: this is the same club.
    await tx.team.update({ where: { id: team.id }, data: { userId: null, isBot: true } })

    return { teamId: team.id, closedEraId: openEra.id, openedEraId: opened.id, at: now }
  })
}
