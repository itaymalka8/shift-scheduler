import type { Prisma } from "@/generated/prisma"
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
 * Re-derives every remaining bot team's name/stadium from the current
 * generator, division by division. Lets a naming scheme change (like
 * fixing repeated city names) reach an already-seeded season without
 * touching real teams or their fixtures - only Team.name/stadiumName get
 * updated, so team ids (and everything keyed on them) are untouched.
 */
async function refreshBotTeamNames(tx: Prisma.TransactionClient): Promise<void> {
  const season = await tx.season.findUnique({
    where: { countryCode_number: { countryCode: COUNTRY_CODE, number: SEASON_NUMBER } },
  })
  if (!season) return

  const divisions = await tx.division.findMany({
    where: { seasonId: season.id },
    orderBy: [{ tier: "asc" }, { group: "asc" }],
    include: { teams: { include: { team: true }, orderBy: { joinedAt: "asc" } } },
  })

  let divisionOrdinal = 0
  for (const division of divisions) {
    const botMemberships = division.teams.filter((dt) => dt.team.isBot)
    const names = generateBotTeamNames(botMemberships.length, divisionOrdinal)
    divisionOrdinal++

    for (let i = 0; i < botMemberships.length; i++) {
      const team = botMemberships[i].team
      const newName = names[i]
      if (team.name !== newName) {
        await tx.team.update({
          where: { id: team.id },
          data: { name: newName, stadiumName: `אצטדיון ${newName}` },
        })
      }
    }
  }
}

/**
 * Creates Season 1 for Israel - every division in ISRAEL_LEAGUE_TIERS, each
 * filled with bot teams and a full double round-robin fixture list - the
 * first time it's needed. Safe to call on every registration; once Season 1
 * exists it just re-syncs bot team names to the current generator instead.
 */
export async function ensureIsraelSeasonSeeded(): Promise<void> {
  const existing = await prisma.season.findUnique({
    where: { countryCode_number: { countryCode: COUNTRY_CODE, number: SEASON_NUMBER } },
  })
  if (existing) {
    await prisma.$transaction((tx) => refreshBotTeamNames(tx), { timeout: 30000 })
    return
  }

  let nameIndex = 0
  let divisionOrdinal = 0

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

          // Generated per division (not one global list sliced up) so every
          // division draws its own set of distinct places - see bot-names.ts.
          const names = generateBotTeamNames(tierConfig.groupSize, divisionOrdinal)
          divisionOrdinal++

          const teamIds: string[] = []
          for (let i = 0; i < tierConfig.groupSize; i++) {
            const n = nameIndex
            const name = names[i]
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
