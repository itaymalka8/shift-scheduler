/**
 * THE MANAGER PROFILE READER.
 *
 * Read-only over history that other systems already wrote. It fetches, hands
 * the rows to the pure career layer, and returns. No rule about attribution
 * lives here - every one of them is in @/lib/teams/era, which the whole
 * project already shares.
 *
 * THE QUERY SHAPE, and why it is what it is:
 *
 *   1  User            name and avatar. Presentation only.
 *   2  TeamEra         every HUMAN era of this user, with its club and the
 *                      seasons it started and ended in.
 *   3  SeasonChampion  the trophy cabinet, which also supplies the per-era
 *                      championship counts - one query serving both, rather
 *                      than counting titles a second way.
 *   4  Fixture         ONE bounded read covering every club of the career.
 *   5  Season          only when there is a current club, for its record.
 *
 * FOUR QUERIES, NOT ONE PER ERA. A career of six spells still issues one
 * fixture read; the eras are partitioned in memory afterwards by
 * computeManagerRecord. A test asserts the call count so an N+1 cannot creep
 * back in.
 *
 * THE FIXTURE READ IS BOUNDED THREE WAYS: to the clubs this manager actually
 * managed, to kickoffs at or after their first era began, and to matches whose
 * live window has fully played out. The last of those is the anti-spoiler -
 * `scheduledAt <= now - MATCH_REAL_DURATION_MINUTES` is isMatchFinished pushed
 * into SQL, so a live match's score, which the engine writes at kickoff, never
 * enters this process at all.
 */
import { prisma } from "@/lib/prisma"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import { computeManagerRecord, type FixtureResult, type ManagerRecord } from "@/lib/teams/era"
import { EMPTY_MANAGER_RECORD } from "@/lib/teams/era"
import type { ChampionshipView } from "@/lib/trophies/championship"
import { championshipsByEra, getManagerTrophies } from "./trophies"
import { buildCareerSpells, currentSpell, summariseCareer, type CareerSpell, type CareerSummary } from "./career"

const CLUB_SELECT = {
  id: true,
  name: true,
  countryCode: true,
  crestShape: true,
  crestPattern: true,
  crestIcon: true,
  crestColor: true,
  crestSecondaryColor: true,
  crestBorderColor: true,
  crestImageUrl: true,
} as const

export type ProfileClub = {
  id: string
  name: string
  countryCode: string | null
  crestShape: string | null
  crestPattern: string | null
  crestIcon: string | null
  crestColor: string | null
  crestSecondaryColor: string | null
  crestBorderColor: string | null
  crestImageUrl: string | null
}

export interface ProfileSpell extends CareerSpell {
  club: ProfileClub
}

export interface ManagerProfile {
  /** THE canonical identity. Everything joins on this. */
  userId: string
  /** Presentation, read fresh on every render. A rename never fragments a career. */
  name: string | null
  image: string | null
  summary: CareerSummary
  spells: ProfileSpell[]
  /** The open HUMAN era's club, or null when the manager is between clubs. */
  currentClub: ProfileClub | null
  currentSpell: ProfileSpell | null
  /** The current club's record in the active season. Null without a current club. */
  currentSeasonRecord: { record: ManagerRecord; seasonNumber: number; countryCode: string } | null
  trophies: ChampionshipView[]
}

/**
 * One manager's whole profile, or null if no such user exists.
 *
 * A user who has never managed anything is NOT null - they are a real person
 * with an empty career, and the page says so.
 */
export async function loadManagerProfile(userId: string, now: Date = new Date()): Promise<ManagerProfile | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, image: true } })
  if (!user) return null

  // HISTORICAL OWNERSHIP, and the only source of it. type: "HUMAN" is stated
  // rather than inferred from userId being non-null: it says what is meant.
  const eras = await prisma.teamEra.findMany({
    where: { userId, type: "HUMAN" },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      teamId: true,
      startedAt: true,
      endedAt: true,
      team: { select: CLUB_SELECT },
      startedSeason: { select: { number: true, countryCode: true } },
      endedSeason: { select: { number: true, countryCode: true } },
    },
  })

  const trophies = await getManagerTrophies(userId, now)

  if (eras.length === 0) {
    return {
      userId: user.id,
      name: user.name,
      image: user.image,
      summary: summariseCareer([]),
      spells: [],
      currentClub: null,
      currentSpell: null,
      currentSeasonRecord: null,
      trophies,
    }
  }

  const fixtures = await loadCareerFixtures(eras, now)
  const clubById = new Map(eras.map((era) => [era.teamId, era.team]))

  const spells: ProfileSpell[] = buildCareerSpells(
    eras.map((era) => ({
      id: era.id,
      teamId: era.teamId,
      startedAt: era.startedAt,
      endedAt: era.endedAt,
      startedSeason: era.startedSeason,
      endedSeason: era.endedSeason,
    })),
    fixtures,
    championshipsByEra(trophies),
    now
  ).map((spell) => ({ ...spell, club: clubById.get(spell.teamId) as ProfileClub }))

  const current = currentSpell(spells) as ProfileSpell | null

  return {
    userId: user.id,
    name: user.name,
    image: user.image,
    summary: summariseCareer(spells),
    spells,
    currentClub: current?.club ?? null,
    currentSpell: current,
    currentSeasonRecord: current ? await loadCurrentSeasonRecord(current, fixtures, now) : null,
    trophies,
  }
}

/**
 * Every finished fixture of every club this manager ever held, in one query.
 *
 * Deliberately NOT filtered per era in SQL: the eras are disjoint windows over
 * these same clubs, and computeManagerRecord applies each window in memory.
 * One read is both faster and simpler to reason about than N reads whose
 * boundaries must each be re-expressed as SQL.
 *
 * Fixtures before the manager's first era are excluded here, and any fixture
 * falling outside a particular era is excluded by fixtureBelongsToEra - so a
 * bot interval between two spells at the same club is skipped twice over.
 */
async function loadCareerFixtures(
  eras: { teamId: string; startedAt: Date }[],
  now: Date
): Promise<(FixtureResult & { divisionSeasonId: string })[]> {
  const liveWindowCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)
  const earliest = eras.reduce((min, era) => (era.startedAt < min ? era.startedAt : min), eras[0].startedAt)
  if (earliest.getTime() > liveWindowCutoff.getTime()) return []

  const teamIds = [...new Set(eras.map((era) => era.teamId))]
  const rows = await prisma.fixture.findMany({
    where: {
      OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      // isMatchFinished, pushed into SQL. A live match is not merely filtered
      // out later - it is never selected, so its stored score never arrives.
      scheduledAt: { gte: earliest, lte: liveWindowCutoff },
      playedAt: { not: null },
    },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      scheduledAt: true,
      playedAt: true,
      homeScore: true,
      awayScore: true,
      division: { select: { seasonId: true } },
    },
  })

  return rows.map((row) => ({
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    scheduledAt: row.scheduledAt,
    playedAt: row.playedAt,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    divisionSeasonId: row.division.seasonId,
  }))
}

/**
 * The current club's record in the season that is running right now.
 *
 * The same era window and the same rule as the career total, narrowed to the
 * fixtures of the active season - so matches the bot played before the
 * takeover are outside the window and never counted, and a live match was
 * never fetched.
 */
async function loadCurrentSeasonRecord(
  spell: ProfileSpell,
  fixtures: (FixtureResult & { divisionSeasonId: string })[],
  now: Date
) {
  if (!spell.club.countryCode) return null
  const season = await prisma.season.findFirst({
    where: { countryCode: spell.club.countryCode, isActive: true },
    select: { id: true, number: true, countryCode: true },
  })
  if (!season) return null

  const record = computeManagerRecord(
    { teamId: spell.teamId, startedAt: spell.startedAt, endedAt: spell.endedAt },
    fixtures.filter((fixture) => fixture.divisionSeasonId === season.id),
    now
  )
  return { record: record ?? { ...EMPTY_MANAGER_RECORD }, seasonNumber: season.number, countryCode: season.countryCode }
}
