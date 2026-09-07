/**
 * WHICH DIVISION A CLUB IS IN RIGHT NOW - one answer, in one place.
 *
 * The obvious implementation is wrong, and was wrong in two places before
 * Phase 3Q:
 *
 *     divisionTeam.findFirst({ where: { teamId }, orderBy: { joinedAt: "desc" } })
 *
 * "Newest membership" is not "current division". Season N+1's membership is
 * written during the offseason, BEFORE activateNextSeason switches it on - so
 * between those two moments that query returns the club's FUTURE division.
 * With promotion and relegation it returns the wrong TIER: a club would see
 * itself in Ligat Ha'al before it had been promoted, and lose the division it
 * is still actually playing in.
 *
 * The current division is the one belonging to the country's ACTIVE season.
 * Nothing else is, and there is no ordering of membership rows that makes a
 * dormant season's row into a current one.
 */
import { prisma } from "@/lib/prisma"

export interface CurrentMembership {
  seasonId: string
  seasonNumber: number
  divisionId: string
  tier: number
  group: string
  name: string
}

/**
 * The club's membership in its country's active season, or null.
 *
 * Null is a real answer, not an error: a club whose country has no active
 * season (a moment mid-handover, see activateNextSeason) genuinely has no
 * current division, and inventing one from a dormant season would be the
 * exact bug this function exists to prevent.
 */
export async function findCurrentMembership(
  teamId: string,
  countryCode: string | null
): Promise<CurrentMembership | null> {
  if (!countryCode) return null
  const membership = await prisma.divisionTeam.findFirst({
    where: { teamId, division: { season: { countryCode, isActive: true } } },
    select: {
      division: {
        select: {
          id: true,
          tier: true,
          group: true,
          name: true,
          season: { select: { id: true, number: true } },
        },
      },
    },
  })
  if (!membership) return null
  return {
    seasonId: membership.division.season.id,
    seasonNumber: membership.division.season.number,
    divisionId: membership.division.id,
    tier: membership.division.tier,
    group: membership.division.group ?? "",
    name: membership.division.name,
  }
}

/**
 * The season a club-scoped screen should treat as current.
 *
 * The active season when the club is in one; otherwise the club's most recent
 * season by number, so a page mid-handover shows the season just finished
 * rather than nothing at all. Never "newest joinedAt".
 */
export async function findCurrentSeasonIdForTeam(
  teamId: string,
  countryCode: string | null
): Promise<string | null> {
  const current = await findCurrentMembership(teamId, countryCode)
  if (current) return current.seasonId

  const latest = await prisma.divisionTeam.findFirst({
    where: { teamId },
    orderBy: { division: { season: { number: "desc" } } },
    select: { division: { select: { season: { select: { id: true } } } } },
  })
  return latest?.division.season.id ?? null
}
