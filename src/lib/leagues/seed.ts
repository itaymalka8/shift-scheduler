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
import { generateSquad } from "@/lib/players/generate"
import { computeRecommendedLineup } from "@/lib/players/recommend"
import { DEFAULT_FORMATION, isFormationId } from "@/lib/players/formations"
import { getSeasonStartMonday, computeMatchdayDate } from "@/lib/match/schedule"
import { DEFAULT_STARTING_SEATS, toSeatColumns } from "@/lib/stadium/config"
import { calculatePlayerSalary } from "@/lib/economy/salary"
import { calculatePlayerMarketValue } from "@/lib/players/market-value"
import { calculatePlayerOverall } from "@/lib/players/overall"
import { generateAttributesForTargetOverall } from "@/lib/players/attribute-generation"
import { isPlayerPosition } from "@/lib/players/positions"

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

  let nameIndex = 0
  for (const division of divisions) {
    const botMemberships = division.teams.filter((dt) => dt.team.isBot)
    const names = generateBotTeamNames(botMemberships.length, nameIndex)
    nameIndex += botMemberships.length

    for (let i = 0; i < botMemberships.length; i++) {
      const team = botMemberships[i].team
      const newName = names[i]
      if (team.name !== newName) {
        await tx.team.update({ where: { id: team.id }, data: { name: newName } })
        await tx.stadium.updateMany({ where: { teamId: team.id }, data: { name: `אצטדיון ${newName}` } })
      }
    }
  }
}

/**
 * Fills in game-engine data (squads, fixture kickoff times) that an
 * already-seeded season was created before - so a season seeded by an
 * older version of this code catches up instead of being stuck without
 * players or a schedule forever.
 */
async function backfillMissingGameData(tx: Prisma.TransactionClient, seasonId: string): Promise<void> {
  const teamsInSeason = await tx.team.findMany({
    where: { divisionMemberships: { some: { division: { seasonId } } } },
    include: { players: true, lineupSlots: true, stadium: true },
  })

  for (const team of teamsInSeason) {
    if (!team.stadium) {
      await tx.stadium.create({
        data: { teamId: team.id, name: `אצטדיון ${team.name}`, ...toSeatColumns(DEFAULT_STARTING_SEATS) },
      })
    }

    // Squads generated before the attribute system existed have no
    // attributes at all - a real generated goalkeeper always has Reflexes,
    // a real outfield player always has Shooting, so a null there
    // unambiguously means "not backfilled yet" regardless of position.
    // Attributes are generated targeting the player's EXISTING Overall (so
    // a 76-rated player stays roughly 76), then Overall itself is
    // recomputed from those attributes - never left as the old
    // independently-set number.
    for (const player of team.players) {
      const position = isPlayerPosition(player.primaryPosition) ? player.primaryPosition : "CM"
      const needsAttributes = position === "GK" ? player.reflexes == null : player.shooting == null
      if (needsAttributes) {
        const attributes = generateAttributesForTargetOverall(position, player.overall)
        const overall = calculatePlayerOverall({ ...attributes, primaryPosition: position })
        await tx.player.update({
          where: { id: player.id },
          data: {
            ...attributes,
            overall,
            marketValue: calculatePlayerMarketValue({
              overall,
              age: player.age,
              potential: player.potential,
              primaryPosition: position,
              fitness: player.fitness,
            }),
            weeklySalary: calculatePlayerSalary({ overall, age: player.age, potential: player.potential, primaryPosition: position }),
          },
        })
      } else if (player.weeklySalary === 0) {
        // Squads generated before player salaries existed (but after
        // attributes) still carry the column's default of 0 - a real
        // generated player's salary is always at least SALARY_MIN.
        await tx.player.update({
          where: { id: player.id },
          data: { weeklySalary: calculatePlayerSalary(player) },
        })
      }
    }

    if (team.players.length === 0) {
      await generateSquad(tx, team.id)
    } else if (team.lineupSlots.length === 0) {
      // The lineup-slot schema changed (x/y -> slotIndex) and dropped old
      // rows - give any squad left without a starting XI a fresh one.
      const formation = isFormationId(team.formation) ? team.formation : DEFAULT_FORMATION
      const assignments = computeRecommendedLineup(
        formation,
        team.players.map((p) => ({
          id: p.id,
          primaryPosition: p.primaryPosition,
          secondaryPositions: p.secondaryPositions,
          overall: p.overall,
          fitness: p.fitness,
          status: p.status,
        }))
      )
      await tx.lineupSlot.createMany({
        data: assignments.map((a) => ({ teamId: team.id, playerId: a.playerId, slotIndex: a.slotIndex })),
      })
      if (!isFormationId(team.formation)) {
        await tx.team.update({ where: { id: team.id }, data: { formation } })
      }
    }
  }

  const unscheduledFixtures = await tx.fixture.findMany({
    where: { division: { seasonId }, scheduledAt: null },
    select: { id: true, matchday: true },
  })
  if (unscheduledFixtures.length > 0) {
    const seasonStartMonday = getSeasonStartMonday()
    for (const fixture of unscheduledFixtures) {
      await tx.fixture.update({
        where: { id: fixture.id },
        data: { scheduledAt: computeMatchdayDate(seasonStartMonday, fixture.matchday) },
      })
    }
  }
}

/**
 * Creates Season 1 for Israel - every division in ISRAEL_LEAGUE_TIERS, each
 * filled with bot teams and a full double round-robin fixture list - the
 * first time it's needed. Safe to call on every registration; once Season 1
 * exists it just re-syncs bot team names and backfills any missing squads/
 * schedule instead.
 */
export async function ensureIsraelSeasonSeeded(): Promise<void> {
  const existing = await prisma.season.findUnique({
    where: { countryCode_number: { countryCode: COUNTRY_CODE, number: SEASON_NUMBER } },
  })
  if (existing) {
    await prisma.$transaction(
      async (tx) => {
        await refreshBotTeamNames(tx)
        await backfillMissingGameData(tx, existing.id)
      },
      { timeout: 30000 }
    )
    return
  }

  let nameIndex = 0
  const seasonStartMonday = getSeasonStartMonday()

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

          // One continuous index across every division (not one global list
          // sliced up ahead of time) so places/prefixes never overlap
          // between divisions either - see bot-names.ts.
          const names = generateBotTeamNames(tierConfig.groupSize, nameIndex)

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
                stadiumStyle: STADIUM_STYLES[n % STADIUM_STYLES.length].id,
                crowdStyle: CROWD_STYLES[n % CROWD_STYLES.length],
              },
            })
            teamIds.push(team.id)
            await tx.divisionTeam.create({ data: { divisionId: division.id, teamId: team.id } })
            await generateSquad(tx, team.id)
            await tx.stadium.create({
              data: { teamId: team.id, name: `אצטדיון ${name}`, ...toSeatColumns(DEFAULT_STARTING_SEATS) },
            })
          }

          const fixtures = generateDoubleRoundRobin(teamIds)
          await tx.fixture.createMany({
            data: fixtures.map((f) => ({
              divisionId: division.id,
              matchday: f.matchday,
              homeTeamId: f.homeTeamId,
              awayTeamId: f.awayTeamId,
              scheduledAt: computeMatchdayDate(seasonStartMonday, f.matchday),
            })),
          })
        }
      }
    },
    { timeout: 30000 }
  )
}
