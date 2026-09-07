import type { Prisma, PrismaClient } from "@/generated/prisma"
import { NEW_SIGNUP_TIER } from "./config"

const COUNTRY_CODE = "IL"

type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * Every bot slot a new signup could take over, in whichever Tier 2 division
 * currently holds the most bot teams - so real signups spread evenly across
 * the parallel divisions over time.
 *
 * Returns a LIST, not a single pick, and sorted by id. Both matter:
 *
 *  - A list, because a single pick made this a race. Two concurrent signups
 *    read the same snapshot under READ COMMITTED, both saw the same club as
 *    free, and the loser could only fail. With every candidate in hand the
 *    caller can claim whichever is genuinely free (see claimFreeBotTeam).
 *
 *  - Sorted, because claiming walks the list in this order. Two concurrent
 *    signups therefore consider the same clubs in the same order, which is
 *    the project's rule for locking more than one Team row (see
 *    src/lib/players/locks.ts) and removes any chance of an ABBA cycle
 *    between them.
 *
 * Takes the db client explicitly so callers run it inside their own
 * transaction.
 */
export async function pickBotTeamCandidates(db: DbClient): Promise<string[]> {
  const divisions = await db.division.findMany({
    where: { tier: NEW_SIGNUP_TIER, season: { countryCode: COUNTRY_CODE, isActive: true } },
    include: { teams: { include: { team: true } } },
  })

  let bestDivisionTeams: (typeof divisions)[number]["teams"] | null = null
  let bestBotCount = -1
  for (const division of divisions) {
    const botCount = division.teams.filter((dt) => dt.team.isBot).length
    if (botCount > bestBotCount) {
      bestBotCount = botCount
      bestDivisionTeams = division.teams
    }
  }

  return (bestDivisionTeams ?? [])
    .filter((dt) => dt.team.isBot)
    .map((dt) => dt.teamId)
    .sort()
}
