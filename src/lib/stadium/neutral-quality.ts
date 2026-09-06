/**
 * THE LEAGUE NEUTRAL, READ FROM THE DATABASE - one deterministic authority,
 * used by every attendance roll in a season.
 *
 * WHICH CLUBS COUNT: the clubs that are MEMBERS OF THAT SEASON, read from
 * DivisionTeam, never from current Team state. Team is mutable - a club can be
 * created, promoted, relegated or moved between divisions - and using it would
 * make "the league" mean something different depending on when the question
 * was asked. DivisionTeam carries a (seasonId, teamId) unique constraint, so a
 * club appears exactly once per season and the population is a set by
 * construction rather than by the query remembering to deduplicate.
 *
 * WHICH PLAYERS COUNT: owned and career-ACTIVE, the same population payroll
 * charges for. careerStatus is filtered explicitly rather than relying on
 * retirement happening to null teamId, for the reason payroll states: a future
 * phase that left a retired player attached to a club must not silently start
 * drawing a crowd.
 *
 * WHAT MAKES IT DETERMINISTIC. The value is derived inside the SAME
 * transaction that settles the thing using it, so every club settled in that
 * transaction is judged against one number - it is not re-read per club and
 * cannot drift halfway through a league-wide settlement. The result of the
 * settlement is then PERSISTED (Fixture.attendance and its money columns), so
 * a later re-read never recomputes it at all.
 *
 * WHAT IS HONESTLY NOT GUARANTEED, AND WHY. If a settlement is retried after
 * rolling back, and a roster changed in between, the recomputed neutral can
 * differ from the one the abandoned attempt would have used. It cannot be
 * otherwise: no player-attribute history is persisted anywhere in this
 * codebase, so "the league median as of an earlier instant" is not merely
 * unimplemented, it is unreconstructible from the data that exists. This is
 * exactly the rule autonomous payroll already documents and operates under -
 * settle promptly rather than reconstruct - and the abandoned attempt left no
 * row, no ledger entry and no observable state, so there is nothing for the
 * retry to be inconsistent WITH. Fixing the residual would require persisting
 * a per-season snapshot, which is a schema change this phase does not need and
 * does not take.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma"
import { ATTENDANCE_QUALITY_FLOOR, REPLACEMENT_OVERALL, calculateLeagueNeutralQuality } from "./attendance-quality"

type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * The median attendance quality across a season's member clubs.
 *
 * One statement. The surplus-above-replacement sum is done in Postgres rather
 * than by pulling every player row into Node, because this runs inside a match
 * transaction that is already holding squad locks and the only thing needed
 * out of a thousand-odd rows is sixty integers.
 *
 * A club with an empty squad still counts, at the floor. It is in the league,
 * it plays fixtures, and dropping it would let a club improve the league
 * average by having no players - a smaller version of the exact incentive the
 * replacement floor exists to close.
 */
export async function readLeagueNeutralQuality(db: DbClient, seasonId: string): Promise<number> {
  const rows = await db.$queryRaw<{ surplus: bigint | number }[]>`
    SELECT COALESCE(SUM(GREATEST(p."overall" - ${REPLACEMENT_OVERALL}, 0)), 0) AS surplus
    FROM "DivisionTeam" dt
    LEFT JOIN "Player" p ON p."teamId" = dt."teamId" AND p."careerStatus" = 'ACTIVE'
    WHERE dt."seasonId" = ${seasonId}
    GROUP BY dt."teamId"
  `
  return calculateLeagueNeutralQuality(rows.map((row) => ATTENDANCE_QUALITY_FLOOR + Number(row.surplus)))
}
