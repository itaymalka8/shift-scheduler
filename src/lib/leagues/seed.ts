import { prisma } from "@/lib/prisma"
import { ISRAEL_LEAGUE_TIERS, type LeagueTierConfig } from "./config"
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
import { generateInitialSquad, generateSquad, type GeneratedPlayer } from "@/lib/players/generate"
import { computeRecommendedLineup } from "@/lib/players/recommend"
import { DEFAULT_FORMATION, FORMATIONS, isFormationId } from "@/lib/players/formations"
import { getSeasonStartMonday, computeMatchdayDate } from "@/lib/match/schedule"
import { DEFAULT_STARTING_SEATS, toSeatColumns } from "@/lib/stadium/config"
import { calculatePlayerSalary } from "@/lib/economy/salary"
import { calculatePlayerMarketValue } from "@/lib/players/market-value"
import { calculatePlayerOverall } from "@/lib/players/overall"
import { generateAttributesForTargetOverall } from "@/lib/players/attribute-generation"
import { isPlayerPosition } from "@/lib/players/positions"

const COUNTRY_CODE = "IL"
const SEASON_NUMBER = 1

// Rows per INSERT. Postgres caps a statement at 65535 bound parameters and a
// Player carries ~60 columns, so this keeps each statement far under the
// limit while still collapsing hundreds of inserts into a handful.
const INSERT_CHUNK = 200

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Everything one division needs, generated in memory with no database
 * connection held. Squad generation is pure CPU, and doing it here - rather
 * than between writes - is what keeps the write transaction short.
 */
function buildDivisionSeedData(tierConfig: LeagueTierConfig, nameIndex: number) {
  const names = generateBotTeamNames(tierConfig.groupSize, nameIndex)

  return names.map((name, i) => {
    const n = nameIndex + i
    return {
      name,
      squad: generateInitialSquad(),
      team: {
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
        // Set at creation rather than by a follow-up update per team - the
        // defaults are identical for every bot.
        formation: DEFAULT_FORMATION,
        mentality: "balanced",
        tempo: "normal",
        pressing: "normal",
        width: "balanced",
      },
    }
  })
}

/**
 * Writes one fully-formed division: its teams, their squads and stadiums, and
 * the season's fixture list for it.
 *
 * Deliberately a handful of bulk statements rather than a per-team loop. The
 * previous shape issued ~367 sequential queries for the whole league inside a
 * single interactive transaction; against a remote Postgres that is minutes of
 * round trips with one transaction held open the entire time, which a
 * connection pooler terminates long before it finishes (Prisma then reports
 * P2028, "Transaction not found"). Bulk writes keep it to ~7 statements.
 */
async function seedDivisionTeams(
  divisionId: string,
  tierConfig: LeagueTierConfig,
  nameIndex: number,
  seasonStartMonday: Date
): Promise<void> {
  const seedData = buildDivisionSeedData(tierConfig, nameIndex)

  await prisma.$transaction(
    async (tx) => {
      const teams = await tx.team.createManyAndReturn({
        data: seedData.map((d) => d.team),
        select: { id: true },
      })

      await tx.divisionTeam.createMany({
        data: teams.map((t) => ({ divisionId, teamId: t.id })),
      })

      await tx.stadium.createMany({
        data: teams.map((t, i) => ({
          teamId: t.id,
          name: `אצטדיון ${seedData[i].name}`,
          ...toSeatColumns(DEFAULT_STARTING_SEATS),
        })),
      })

      const playerRows: (GeneratedPlayer & { teamId: string })[] = []
      teams.forEach((team, i) => {
        for (const player of seedData[i].squad) playerRows.push({ teamId: team.id, ...player })
      })

      const created: { id: string; teamId: string; primaryPosition: string; secondaryPositions: string[]; overall: number; fitness: number; status: string }[] = []
      for (const batch of chunk(playerRows, INSERT_CHUNK)) {
        const rows = await tx.player.createManyAndReturn({
          data: batch,
          select: {
            id: true,
            teamId: true,
            primaryPosition: true,
            secondaryPositions: true,
            overall: true,
            fitness: true,
            status: true,
          },
        })
        created.push(...rows)
      }

      const byTeam = new Map<string, typeof created>()
      for (const player of created) {
        const list = byTeam.get(player.teamId)
        if (list) list.push(player)
        else byTeam.set(player.teamId, [player])
      }

      const slots: { teamId: string; playerId: string; slotIndex: number }[] = []
      for (const [teamId, squad] of byTeam) {
        for (const assignment of computeRecommendedLineup(FORMATIONS[DEFAULT_FORMATION], squad)) {
          slots.push({ teamId, playerId: assignment.playerId, slotIndex: assignment.slotIndex })
        }
      }
      for (const batch of chunk(slots, INSERT_CHUNK)) {
        await tx.lineupSlot.createMany({ data: batch })
      }

      const fixtures = generateDoubleRoundRobin(teams.map((t) => t.id))
      for (const batch of chunk(fixtures, INSERT_CHUNK)) {
        await tx.fixture.createMany({
          data: batch.map((f) => ({
            divisionId,
            matchday: f.matchday,
            homeTeamId: f.homeTeamId,
            awayTeamId: f.awayTeamId,
            scheduledAt: computeMatchdayDate(seasonStartMonday, f.matchday),
          })),
        })
      }
    },
    { timeout: 30000 }
  )
}

/**
 * Brings one division to a complete state, and is safe to re-run: an
 * already-populated division is left alone, and an empty one is filled in a
 * single transaction. Because each division commits independently, a failure
 * part-way through the league leaves the divisions already written intact and
 * the next attempt resumes from there instead of starting over.
 */
async function ensureDivisionSeeded(
  seasonId: string,
  tierConfig: LeagueTierConfig,
  group: string,
  nameIndex: number,
  seasonStartMonday: Date
): Promise<void> {
  const division = await prisma.division.upsert({
    where: { seasonId_tier_group: { seasonId, tier: tierConfig.tier, group } },
    create: {
      seasonId,
      tier: tierConfig.tier,
      group,
      name: tierConfig.key + (group ? `-${group}` : ""),
    },
    update: {},
  })

  const teamCount = await prisma.divisionTeam.count({ where: { divisionId: division.id } })
  if (teamCount === 0) {
    // Rare (once per division, ever) but the most expensive thing this app
    // does - worth a line in the server log so a slow or failed first
    // registration is diagnosable without guesswork.
    const startedAt = Date.now()
    await seedDivisionTeams(division.id, tierConfig, nameIndex, seasonStartMonday)
    console.info(`Seeded division ${division.name}: ${tierConfig.groupSize} teams in ${Date.now() - startedAt}ms`)
    return
  }

  // Populated by an earlier run, but its fixtures may not have been written
  // (older seeds created teams and fixtures in separate steps).
  const fixtureCount = await prisma.fixture.count({ where: { divisionId: division.id } })
  if (fixtureCount === 0) {
    const memberships = await prisma.divisionTeam.findMany({
      where: { divisionId: division.id },
      orderBy: { joinedAt: "asc" },
      select: { teamId: true },
    })
    const fixtures = generateDoubleRoundRobin(memberships.map((m) => m.teamId))
    for (const batch of chunk(fixtures, INSERT_CHUNK)) {
      await prisma.fixture.createMany({
        data: batch.map((f) => ({
          divisionId: division.id,
          matchday: f.matchday,
          homeTeamId: f.homeTeamId,
          awayTeamId: f.awayTeamId,
          scheduledAt: computeMatchdayDate(seasonStartMonday, f.matchday),
        })),
      })
    }
  }
}

/**
 * Re-derives every remaining bot team's name/stadium from the current
 * generator, division by division. Lets a naming scheme change (like
 * fixing repeated city names) reach an already-seeded season without
 * touching real teams or their fixtures - only Team.name/stadiumName get
 * updated, so team ids (and everything keyed on them) are untouched.
 */
async function refreshBotTeamNames(seasonId: string): Promise<void> {
  const divisions = await prisma.division.findMany({
    where: { seasonId },
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
        await prisma.team.update({ where: { id: team.id }, data: { name: newName } })
        await prisma.stadium.updateMany({ where: { teamId: team.id }, data: { name: `אצטדיון ${newName}` } })
      }
    }
  }
}

/**
 * True when an already-seeded season is missing game data an older version of
 * this code didn't create. Four cheap counts, so the common case (nothing to
 * repair) costs almost nothing on a path that runs on every registration.
 */
async function needsBackfill(seasonId: string): Promise<boolean> {
  const inSeason = { divisionMemberships: { some: { division: { seasonId } } } }
  const [squadless, stadiumless, unscheduled, unpaid] = await Promise.all([
    prisma.team.count({ where: { ...inSeason, players: { none: {} } } }),
    prisma.team.count({ where: { ...inSeason, stadium: { is: null } } }),
    prisma.fixture.count({ where: { division: { seasonId }, scheduledAt: null } }),
    prisma.player.count({ where: { team: inSeason, weeklySalary: 0 } }),
  ])
  return squadless > 0 || stadiumless > 0 || unscheduled > 0 || unpaid > 0
}

/**
 * Fills in game-engine data (squads, stadiums, attributes, fixture kickoff
 * times) that an already-seeded season was created before - so a season seeded
 * by an older version of this code catches up instead of being stuck without
 * players or a schedule forever.
 *
 * Each repair is independently idempotent, so this deliberately does NOT wrap
 * everything in one transaction: a single long transaction across every team
 * in the league is exactly what a connection pooler kills mid-flight.
 */
async function backfillMissingGameData(seasonId: string): Promise<void> {
  const teamsInSeason = await prisma.team.findMany({
    where: { divisionMemberships: { some: { division: { seasonId } } } },
    include: { players: true, lineupSlots: true, stadium: true },
  })

  for (const team of teamsInSeason) {
    if (!team.stadium) {
      await prisma.stadium.create({
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
        await prisma.player.update({
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
        await prisma.player.update({
          where: { id: player.id },
          data: { weeklySalary: calculatePlayerSalary(player) },
        })
      }
    }

    if (team.players.length === 0) {
      await generateSquad(prisma, team.id)
    } else if (team.lineupSlots.length === 0) {
      // The lineup-slot schema changed (x/y -> slotIndex) and dropped old
      // rows - give any squad left without a starting XI a fresh one.
      const formation = isFormationId(team.formation) ? team.formation : DEFAULT_FORMATION
      const assignments = computeRecommendedLineup(
        FORMATIONS[formation],
        team.players.map((p) => ({
          id: p.id,
          primaryPosition: p.primaryPosition,
          secondaryPositions: p.secondaryPositions,
          overall: p.overall,
          fitness: p.fitness,
          status: p.status,
        }))
      )
      await prisma.lineupSlot.createMany({
        data: assignments.map((a) => ({ teamId: team.id, playerId: a.playerId, slotIndex: a.slotIndex })),
      })
      if (!isFormationId(team.formation)) {
        await prisma.team.update({ where: { id: team.id }, data: { formation } })
      }
    }
  }

  const unscheduledFixtures = await prisma.fixture.findMany({
    where: { division: { seasonId }, scheduledAt: null },
    select: { id: true, matchday: true },
  })
  if (unscheduledFixtures.length > 0) {
    const seasonStartMonday = getSeasonStartMonday()
    for (const fixture of unscheduledFixtures) {
      await prisma.fixture.update({
        where: { id: fixture.id },
        data: { scheduledAt: computeMatchdayDate(seasonStartMonday, fixture.matchday) },
      })
    }
  }
}

// ensureIsraelSeasonSeeded is self-heal, safe to call on every request, but
// its "nothing to do" path still costs ~15-30 sequential round trips (one
// upsert/count per division, a full team scan for bot-name refresh, four
// backfill counts) - fine once per registration, wasteful on every /dashboard
// and /league page view. This short debounce skips re-verifying within the
// window; on Render's actually-networked Postgres those round trips are the
// difference between a snappy nav and a very noticeable stall, and nothing
// about season/division config changes on a timescale this cache would ever
// make visible.
const RECHECK_INTERVAL_MS = 2 * 60_000
let lastVerifiedAt = 0

/**
 * Creates Season 1 for Israel - every division in ISRAEL_LEAGUE_TIERS, each
 * filled with bot teams and a full double round-robin fixture list - the
 * first time it's needed. Safe to call on every registration; once Season 1
 * exists it just re-syncs bot team names and backfills any missing squads/
 * schedule instead.
 *
 * Every step is independently committed and re-runnable, so a partial failure
 * never leaves the league in a state the next call can't finish.
 */
export async function ensureIsraelSeasonSeeded(): Promise<void> {
  if (Date.now() - lastVerifiedAt < RECHECK_INTERVAL_MS) return

  const season = await prisma.season.upsert({
    where: { countryCode_number: { countryCode: COUNTRY_CODE, number: SEASON_NUMBER } },
    create: { countryCode: COUNTRY_CODE, number: SEASON_NUMBER },
    update: {},
  })

  const seasonStartMonday = getSeasonStartMonday()

  // One continuous index across every division (not one global list sliced up
  // ahead of time) so places/prefixes never overlap between divisions either -
  // see bot-names.ts. Derived from the config order, so it stays stable across
  // runs even though each division is now seeded separately.
  let nameIndex = 0
  for (const tierConfig of ISRAEL_LEAGUE_TIERS) {
    for (const group of tierConfig.groups) {
      await ensureDivisionSeeded(season.id, tierConfig, group, nameIndex, seasonStartMonday)
      nameIndex += tierConfig.groupSize
    }
  }

  await refreshBotTeamNames(season.id)
  if (await needsBackfill(season.id)) {
    await backfillMissingGameData(season.id)
  }

  lastVerifiedAt = Date.now()
}
