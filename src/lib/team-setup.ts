import type { Prisma, PrismaClient } from "@/generated/prisma"
import {
  DEFAULT_CREST_BORDER_COLOR,
  DEFAULT_CREST_COLOR,
  DEFAULT_CREST_ICON,
  DEFAULT_CREST_PATTERN,
  DEFAULT_CREST_SECONDARY_COLOR,
  DEFAULT_CREST_SHAPE,
} from "@/components/team-crest"
import { DEFAULT_STADIUM_STYLE } from "@/components/stadium-illustration"
import { generateSquad } from "@/lib/players/generate"

type Client = PrismaClient | Prisma.TransactionClient

/**
 * Creates a default Team (+ squad) for a user who has none - used both right
 * after a first-time OAuth sign-in and as a self-heal for any account that
 * somehow ended up without a club (e.g. an earlier OAuth attempt that
 * created the User but failed partway through creating the Team). Safe to
 * call repeatedly: it's a no-op once the user already has a team.
 */
export async function ensureTeamForUser(
  client: Client,
  userId: string,
  displayName: string | null
): Promise<void> {
  const existingTeam = await client.team.findUnique({ where: { userId } })
  if (existingTeam) return

  const team = await client.team.create({
    data: {
      userId,
      name: displayName ? `קבוצת ${displayName}` : "הקבוצה החדשה שלי",
      crestShape: DEFAULT_CREST_SHAPE,
      crestPattern: DEFAULT_CREST_PATTERN,
      crestIcon: DEFAULT_CREST_ICON,
      crestColor: DEFAULT_CREST_COLOR,
      crestSecondaryColor: DEFAULT_CREST_SECONDARY_COLOR,
      crestBorderColor: DEFAULT_CREST_BORDER_COLOR,
      crowdStyle: "calm",
      stadiumStyle: DEFAULT_STADIUM_STYLE,
      stadiumCapacity: 100,
    },
  })
  await generateSquad(client, team.id)
}
