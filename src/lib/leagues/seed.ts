import { prisma } from "@/lib/prisma"
import { ISRAEL_LEAGUE_TIERS } from "./config"
import { generateBotTeamNames } from "./bot-names"
import { generateDoubleRoundRobin } from "./round-robin"
import {
  CREST_SHAPES,
  CREST_PATTERNS,
  CREST_ICON_OPTIONS,
  CREST_COLORS,
  DEFAULT_CREST_BORDER_COLOR,
} from "@/components/team-crest"
import { STADIUM_STYLES } from "@/components/stadium-illustration"
import { CROWD_STYLES } from "@/lib/validation"

const COUNTRY_CODE = "IL"
const SEASON_NUMBER = 1

/**
 * Creates Season 1 for Israel - every division in ISRAEL_LEAGUE_TIERS, each
 * filled with bot teams and a full double round-robin fixture list - the
 * first time it's needed. Safe to call on every registration; it's a no-op
 * once Season 1 exists.
 */
export async function ensureIsraelSeasonSeeded(): Promise<void> {
  const existing = await prisma.season.findUnique({
    where: { countryCode_number: { countryCode: COUNTRY_CODE, number: SEASON_NUMBER } },
  })
  if (existing) return

  const totalSlots = ISRAEL_LEAGUE_TIERS.reduce((sum, t) => sum + t.groups.length * t.groupSize, 0)
  const names = generateBotTeamNames(totalSlots)
  let nameIndex = 0

  await prisma.$transaction(
    async (tx) => {
      const season = await tx.season.create({
        data: { countryCode: COUNTRY_CODE, number: SEASON_NUMBER },
      })

      for (const tierConfig of ISRAEL_LEAGUE_TIERS) {
        for (const group of tierConfig.groups) {
          const division = await tx.division.create({
            data: {
              seasonId: season.id,
              tier: tierConfig.tier,
              group,
              name: tierConfig.key + (group ? `-${group}` : ""),
            },
          })

          const teamIds: string[] = []
          for (let i = 0; i < tierConfig.groupSize; i++) {
            const n = nameIndex
            const name = names[n]
            nameIndex++

            const team = await tx.team.create({
              data: {
                name,
                isBot: true,
                countryCode: COUNTRY_CODE,
                crestShape: CREST_SHAPES[n % CREST_SHAPES.length].id,
                crestPattern: CREST_PATTERNS[n % CREST_PATTERNS.length].id,
                crestIcon: CREST_ICON_OPTIONS[n % CREST_ICON_OPTIONS.length].id,
                crestColor: CREST_COLORS[n % CREST_COLORS.length],
                crestSecondaryColor: CREST_COLORS[(n + 5) % CREST_COLORS.length],
                crestBorderColor: DEFAULT_CREST_BORDER_COLOR,
                stadiumName: `אצטדיון ${name}`,
                stadiumStyle: STADIUM_STYLES[n % STADIUM_STYLES.length].id,
                stadiumCapacity: 100,
                crowdStyle: CROWD_STYLES[n % CROWD_STYLES.length],
              },
            })
            teamIds.push(team.id)
            await tx.divisionTeam.create({ data: { divisionId: division.id, teamId: team.id } })
          }

          const fixtures = generateDoubleRoundRobin(teamIds)
          await tx.fixture.createMany({
            data: fixtures.map((f) => ({
              divisionId: division.id,
              matchday: f.matchday,
              homeTeamId: f.homeTeamId,
              awayTeamId: f.awayTeamId,
            })),
          })
        }
      }
    },
    { timeout: 30000 }
  )
}
