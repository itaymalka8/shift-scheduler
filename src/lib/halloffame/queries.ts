/**
 * THE HALL OF FAME READER. Fetches historical facts and hands them to the pure
 * leaderboard layer. No ranking, no thresholds, no tie semantics live here.
 *
 * THREE QUERIES FOR THE WHOLE BOARD, and the count does not grow with the
 * number of managers, clubs or leaderboards:
 *
 *   1  TeamEra        every HUMAN era ever, with its club and its manager.
 *   2  SeasonChampion every championship ever, with its club.
 *   3  Fixture        ONE bounded read covering every club any manager held.
 *
 * NOT ONE READ PER MANAGER, and not one per leaderboard either: six of the
 * seven boards are computed from the same three result sets. A source guard
 * asserts the query count so an N+1 leaderboard cannot creep back in.
 *
 * WHY WHOLE ROWS RATHER THAN A GROUP BY. A championship row is one row per
 * season per division - bounded by the calendar, not by traffic - and the
 * manager board has to resolve each title through its era anyway. Counting in
 * the pure layer keeps both championship boards reading the same rows by the
 * same rule, where a test can see it.
 *
 * SIZE AUDIT, against Production as it stands: 63 TeamEra rows (3 HUMAN), 60
 * clubs, 1140 LEAGUE fixtures, 0 SeasonChampion. Query 3 is bounded to the
 * clubs that have had a human manager - 3 of 60 - so it returns on the order
 * of a hundred rows. If human managers ever approach the number of clubs, this
 * read approaches the whole fixture table, and THAT is the point at which a
 * discardable cache is worth measuring. See loadHallOfFameFacts' note.
 */
import { prisma } from "@/lib/prisma"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import type { FixtureResult } from "@/lib/teams/era"
import {
  buildHallOfFame,
  type HallOfFame,
  type HallOfFameChampionship,
  type HallOfFameClub,
  type HallOfFameEra,
  type HallOfFameFacts,
  type HallOfFameManager,
} from "./leaderboards"

const CLUB_SELECT = {
  id: true,
  name: true,
  crestShape: true,
  crestPattern: true,
  crestIcon: true,
  crestColor: true,
  crestSecondaryColor: true,
  crestBorderColor: true,
  crestImageUrl: true,
} as const

/**
 * Every fact the Hall of Fame is built from.
 *
 * NO CACHE. Every render derives from the rows, so the board can never
 * disagree with the profile pages it links to. When measurements eventually
 * justify one, it belongs around THIS function - a rebuildable projection of
 * what these three queries return - and never as a table the game writes to.
 */
export async function loadHallOfFameFacts(now: Date): Promise<HallOfFameFacts> {
  // 1. HISTORICAL OWNERSHIP. type: "HUMAN" is stated rather than inferred from
  // userId being non-null - it says what is meant - and userId: { not: null }
  // is what narrows the type so the pure layer can require a userId.
  const eraRows = await prisma.teamEra.findMany({
    where: { type: "HUMAN", userId: { not: null } },
    select: {
      id: true,
      teamId: true,
      userId: true,
      startedAt: true,
      endedAt: true,
      team: { select: CLUB_SELECT },
      user: { select: { id: true, name: true, image: true } },
    },
  })

  // 2. EVERY CHAMPIONSHIP EVER. Not filtered by era type: the club board counts
  // bot titles, and the manager board excludes them by failing to find their
  // era among the HUMAN ones - never by a condition here that could drift.
  const championshipRows = await prisma.seasonChampion.findMany({
    select: { teamId: true, teamEraId: true, team: { select: CLUB_SELECT } },
  })

  const humanEras: HallOfFameEra[] = []
  const managers = new Map<string, HallOfFameManager>()
  const clubs = new Map<string, HallOfFameClub>()

  for (const row of eraRows) {
    // Defensive: a HUMAN era without a user is broken data, and it is skipped
    // rather than credited to nobody or to a placeholder.
    if (!row.userId || !row.user) continue
    humanEras.push({
      id: row.id,
      teamId: row.teamId,
      userId: row.userId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    })
    managers.set(row.userId, { userId: row.user.id, name: row.user.name, image: row.user.image })
    clubs.set(row.teamId, row.team)
  }

  const championships: HallOfFameChampionship[] = championshipRows.map((row) => ({
    teamId: row.teamId,
    teamEraId: row.teamEraId,
  }))
  // A club can hold titles without ever having had a human manager, so the
  // club board's names come from the championship rows too.
  for (const row of championshipRows) clubs.set(row.teamId, row.team)

  return { humanEras, championships, fixtures: await loadCareerFixtures(humanEras, now), managers, clubs }
}

/**
 * Every finished fixture of every club any manager ever held, in ONE query.
 *
 * Bounded three ways: to those clubs, to kickoffs at or after the earliest era
 * began, and to matches whose live window has fully played out. That last bound
 * is isMatchFinished pushed into SQL - a live match's score, which the engine
 * writes at kickoff, is never selected, so it cannot reach a leaderboard even
 * by accident.
 *
 * Deliberately NOT filtered per era in SQL: the eras are disjoint windows over
 * these same clubs, and computeManagerRecord applies each one in memory.
 */
async function loadCareerFixtures(humanEras: HallOfFameEra[], now: Date): Promise<FixtureResult[]> {
  if (humanEras.length === 0) return []

  const liveWindowCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)
  const earliest = humanEras.reduce((min, era) => (era.startedAt < min ? era.startedAt : min), humanEras[0].startedAt)
  if (earliest.getTime() > liveWindowCutoff.getTime()) return []

  const teamIds = [...new Set(humanEras.map((era) => era.teamId))]
  const rows = await prisma.fixture.findMany({
    where: {
      OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
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
    },
  })
  return rows
}

/** The whole board, measured from ONE instant. */
export async function loadHallOfFame(now: Date = new Date()): Promise<HallOfFame> {
  return buildHallOfFame(await loadHallOfFameFacts(now), now)
}
