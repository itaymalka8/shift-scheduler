/**
 * WHICH TIER A CLUB WAS IN, FOR THE WEEK BEING SETTLED.
 *
 * Sponsor income is distributed by tier, so "what tier is this club" has to
 * have an answer that does not change when the league does. Two rules make it
 * one:
 *
 *   THE SEASON IS CHOSEN BY THE SETTLEMENT INSTANT, not by Season.isActive.
 *   `isActive` is mutable and moves the moment the season orchestrator
 *   advances - so a settlement that ran a minute later could read a different
 *   season and pay a different sponsor for the same week. Season.createdAt is
 *   immutable, so "the latest season that had already begun at this instant"
 *   is a fact about the week rather than about when the cron happened to fire.
 *
 *   THE TIER COMES FROM DivisionTeam, never from Team. Team carries no tier
 *   and could only be used to guess one; DivisionTeam records, per season,
 *   which division a club actually played in, with a (seasonId, teamId) unique
 *   constraint so a club appears exactly once. Promotion and relegation change
 *   FUTURE seasons' rows and leave past ones alone, which is precisely why a
 *   settled sponsor row does not change when a club moves tier.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma"

type DbClient = PrismaClient | Prisma.TransactionClient

export interface SeasonTierSnapshot {
  /** The season whose membership governs this instant, or null before any season began. */
  seasonId: string | null
  seasonNumber: number | null
  /** teamId -> division tier. A club absent from the map was not a member. */
  tierByTeamId: Map<string, number>
}

export async function readSeasonTiersAsOf(db: DbClient, instant: Date): Promise<SeasonTierSnapshot> {
  const season = await db.season.findFirst({
    where: { createdAt: { lte: instant } },
    // Newest first by the season's own number, with createdAt as the
    // tie-break. Ordering by number rather than by createdAt alone means a
    // backfilled or re-created row cannot reorder league history.
    orderBy: [{ number: "desc" }, { createdAt: "desc" }],
    select: { id: true, number: true },
  })
  if (!season) return { seasonId: null, seasonNumber: null, tierByTeamId: new Map() }

  const memberships = await db.divisionTeam.findMany({
    where: { seasonId: season.id },
    select: { teamId: true, division: { select: { tier: true } } },
  })

  return {
    seasonId: season.id,
    seasonNumber: season.number,
    tierByTeamId: new Map(memberships.map((row) => [row.teamId, row.division.tier])),
  }
}
