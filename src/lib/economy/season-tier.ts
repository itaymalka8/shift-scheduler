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
 *   season and pay a different sponsor for the same week.
 *
 *   AND THE INSTANT A SEASON BECOMES TIER-EFFECTIVE IS ITS FIRST LEAGUE
 *   FIXTURE, not its row's createdAt. Both are immutable; only one is sporting
 *   truth. The offseason creates season N+1's row and its whole membership at
 *   PROMOTION_RELEGATION and its fixtures only later at CREATE_NEXT, so a
 *   createdAt rule handed N+1's post-promotion tiers to weeks that were still
 *   being played in season N.
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
  // A SEASON IS TIER-EFFECTIVE FROM ITS FIRST LEAGUE FIXTURE - the instant its
  // football begins - and Season.createdAt is NOT that instant.
  //
  // The offseason writes season N+1's row and its complete DivisionTeam
  // membership at stage PROMOTION_RELEGATION, and only creates its fixtures
  // later at CREATE_NEXT. Under a createdAt rule, a sponsor week settled in
  // that interval read N+1's POST-promotion tiers while every club was still
  // playing in season N's divisions: a relegated club paid at the tier-2
  // multiplier for a week of tier-1 football, a promoted one paid at 1.25
  // before it had played a tier-1 match. Neither had played the football the
  // money claimed.
  //
  // stage = LEAGUE only. TITLE_DECIDER, TITLE_PLAYOFF and BOUNDARY_DECIDER are
  // played after their season's regular programme, so they cannot lower a
  // season's minimum - but PROMOTION_PLAYOFF is the one that would actively
  // mislead: the schema files it under season N's TIER 1 division while its
  // four clubs "remain tier 2 members for the whole of season N". A rule that
  // counted it would be reading a competition whose filing division
  // deliberately does not describe its clubs' tier.
  //
  // scheduledAt is written once, at fixture creation (leagues/seed.ts and
  // seasons/next-season.ts), and never updated afterwards - simulate.ts writes
  // scores, playedAt, matchSeed, attendance and stats, and does not touch it -
  // so this authority is as immutable as createdAt was, and unlike createdAt it
  // is sporting truth.
  const rows = await db.$queryRaw<{ id: string; number: number }[]>`
    SELECT s."id", s."number"
      FROM "Season" s
      JOIN "Division" d ON d."seasonId" = s."id"
      JOIN "Fixture" f ON f."divisionId" = d."id"
     WHERE f."stage" = 'LEAGUE' AND f."scheduledAt" IS NOT NULL
     GROUP BY s."id", s."number"
    HAVING MIN(f."scheduledAt") <= ${instant}
     ORDER BY s."number" DESC
     LIMIT 1
  `
  const season = rows[0]
  // No season has kicked off yet at this instant - the same empty snapshot the
  // createdAt rule returned before any season existed, so every club falls to
  // SPONSOR_DEFAULT_TIER. A season created but never given fixtures (an
  // activation the readiness check refused) is simply never tier-effective,
  // which is the correct outcome rather than a special case.
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
