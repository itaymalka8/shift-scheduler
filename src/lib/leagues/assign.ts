import type { Prisma, PrismaClient } from "@/generated/prisma"
import { NEW_SIGNUP_TIER } from "./config"

const COUNTRY_CODE = "IL"

type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * Finds a bot team slot for a newly registered team to take over - in
 * whichever Tier 2 division currently holds the most bot teams, so real
 * signups spread evenly across the parallel divisions over time. Takes the
 * db client explicitly so callers can run it inside their own transaction
 * (avoiding two concurrent signups picking the same bot).
 */
export async function pickBotTeamForNewSignup(db: DbClient): Promise<string | null> {
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

  const botMembership = bestDivisionTeams?.find((dt) => dt.team.isBot)
  return botMembership?.teamId ?? null
}
