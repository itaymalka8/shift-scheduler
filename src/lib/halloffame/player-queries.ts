/**
 * THE PLAYER HALL OF FAME READER. Fetches canonical historical facts and hands
 * them to the pure player layer. No ranking, no threshold, no tie semantics.
 *
 * THREE QUERIES FOR EVERY PLAYER BOARD, and the count does not grow with the
 * number of players:
 *
 *   1  PlayerMatchStats  every row whose fixture is PUBLICLY FINISHED.
 *   2  Player            identity and display, for the players those rows name.
 *   3  Team              names for the clubs those rows name.
 *
 * NOT ONE READ PER PLAYER. Queries 2 and 3 are `id IN (...)` over the ids
 * query 1 returned, so a thousand players is still three statements. A source
 * guard asserts the count.
 *
 * THE FINISHED GATE IS THE ANTI-SPOILER RULE, NOT THE RETENTION RULE. The
 * engine writes the whole match at kickoff, so a PlayerMatchStats row exists
 * from the moment a match starts - having one is NOT the same as the match
 * being public. This read therefore requires the fixture's live window to have
 * fully played out (isMatchFinished, pushed into SQL), which is deliberately
 * stricter than Phase 3F's `playedAt IS NOT NULL` retention rule. Retention
 * protects from kickoff; publication waits.
 *
 * Player.teamId IS NEVER SELECTED. Historical club attribution comes from
 * PlayerMatchStats.teamId, and the pure layer cannot reach for current
 * ownership because it is never handed it.
 */
import { prisma } from "@/lib/prisma"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import {
  buildPlayerHallOfFame,
  type HallOfFameClubRef,
  type HallOfFamePlayer,
  type PlayerHallOfFame,
  type PlayerHallOfFameFacts,
  type PlayerMatchRecord,
} from "./players"

export async function loadPlayerHallOfFameFacts(now: Date): Promise<PlayerHallOfFameFacts> {
  const liveWindowCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)

  // 1. THE CANONICAL HISTORICAL RECORD. Filtered through the fixture relation
  // so a live match's already-written stats are never selected at all - not
  // filtered out afterwards, never fetched.
  const records = await prisma.playerMatchStats.findMany({
    where: {
      fixture: {
        playedAt: { not: null },
        scheduledAt: { not: null, lte: liveWindowCutoff },
      },
    },
    select: { playerId: true, teamId: true, goals: true, assists: true, rating: true, minutesPlayed: true },
  })

  if (records.length === 0) {
    return { records: [], players: new Map(), clubs: new Map() }
  }

  const playerIds = [...new Set(records.map((r) => r.playerId))]
  const teamIds = [...new Set(records.map((r) => r.teamId))]

  // 2. IDENTITY AND DISPLAY. careerStatus is selected to LABEL a retired
  // player, never to filter one out. teamId is deliberately absent.
  const playerRows = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, firstName: true, lastName: true, primaryPosition: true, nationality: true, careerStatus: true },
  })

  // 3. CLUB NAMES for the clubs that appear in the history above.
  const clubRows = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, name: true },
  })

  const players = new Map<string, HallOfFamePlayer>(
    playerRows.map((p) => [
      p.id,
      {
        playerId: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        primaryPosition: p.primaryPosition,
        nationality: p.nationality,
        careerStatus: p.careerStatus,
      },
    ])
  )
  const clubs = new Map<string, HallOfFameClubRef>(clubRows.map((c) => [c.id, { id: c.id, name: c.name }]))

  return { records: records as PlayerMatchRecord[], players, clubs }
}

/** Every player board, measured from ONE instant. */
export async function loadPlayerHallOfFame(now: Date = new Date()): Promise<PlayerHallOfFame> {
  return buildPlayerHallOfFame(await loadPlayerHallOfFameFacts(now), now)
}
