/**
 * A MANAGER'S TROPHY CABINET.
 *
 * Read-only, and it enters through SeasonChampion because SeasonChampion is
 * the authority on who won what. Nothing here recomputes a table, re-derives a
 * winner from fixtures, or looks at who holds a club today.
 *
 * THE ATTRIBUTION, once, in one place:
 *
 *     SeasonChampion -> teamEraId -> TeamEra WHERE type = HUMAN AND userId = X
 *
 * Not Team.userId. A club's current owner has nothing to do with who was
 * managing it when it won - that is the entire reason teamEraId exists. The
 * relation filter also implies teamEraId IS NOT NULL, and `type: "HUMAN"` is
 * stated explicitly rather than relying on the database CHECK that makes a BOT
 * era's userId null: filtering on type says what is meant.
 */
import { prisma } from "@/lib/prisma"
import { CHAMPIONSHIP_SELECT, byMostRecent, toChampionshipView, type ChampionshipView } from "@/lib/trophies/championship"

/** Every title this manager won, most recent first. Empty for a manager with none. */
export async function getManagerTrophies(userId: string, now: Date = new Date()): Promise<ChampionshipView[]> {
  const rows = await prisma.seasonChampion.findMany({
    where: { teamEra: { is: { type: "HUMAN", userId } } },
    select: CHAMPIONSHIP_SELECT,
  })
  return rows.map((row) => toChampionshipView(row, now)).sort(byMostRecent)
}

/** How many titles each era produced, for the career spells. Derived from the same rows. */
export function championshipsByEra(trophies: ChampionshipView[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const trophy of trophies) {
    if (!trophy.teamEraId) continue
    counts.set(trophy.teamEraId, (counts.get(trophy.teamEraId) ?? 0) + 1)
  }
  return counts
}
