/**
 * THE PLAYER PROFILE READER.
 *
 * Read-only. It fetches canonical rows, hands them to the pure career layer
 * and returns; no attribution rule lives here. There is no write path in this
 * file, and none anywhere else the profile touches.
 *
 * THE QUERY SHAPE, and why:
 *
 *   1  Player            identity and CURRENT state, with its current club.
 *   2  PlayerMatchStats  every eligible historical row, with its fixture.
 *   3  Team              names and crests for every club those rows name -
 *                        the clubs played FOR and the opponents faced.
 *
 * THREE READS, NOT ONE PER APPEARANCE. Query 3 is an `id IN (...)` over the
 * ids query 2 returned, so a career of two hundred matches issues the same
 * three reads as a career of two. A source guard asserts it, and the count was
 * measured at the database.
 *
 * CURRENT STATE AND HISTORY ARE READ SEPARATELY AND NEVER MIXED. Query 1's
 * Player.teamId answers "where does this player play now" and is used for
 * nothing else. Every historical figure comes from PlayerMatchStats.teamId -
 * the club they played THAT match for - so a transfer moves the header and
 * leaves every past appearance where it was.
 *
 * THE ELIGIBILITY GATE IS THE ANTI-SPOILER RULE. The engine writes a whole
 * match, final score included, at kickoff - so a PlayerMatchStats row exists
 * from the moment a match starts, and having one is NOT the same as the match
 * being public. This read therefore requires the fixture's live window to have
 * fully played out (isMatchFinished pushed into SQL as
 * `scheduledAt <= now - MATCH_REAL_DURATION_MINUTES`), which is deliberately
 * stricter than Phase 3F's `playedAt IS NOT NULL` retention rule. Retention
 * protects a row from kickoff; publication waits. A live match is never
 * fetched, so it cannot be filtered out incorrectly later.
 */
import { prisma } from "@/lib/prisma"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import { revealFinalScore } from "@/lib/match/fixture-status"
import { buildPlayerCareer, type DatedCareerMatchRecord, type PlayerCareer } from "./career"

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

export interface ProfileClub {
  id: string
  name: string
  crestShape: string | null
  crestPattern: string | null
  crestIcon: string | null
  crestColor: string | null
  crestSecondaryColor: string | null
  crestBorderColor: string | null
  crestImageUrl: string | null
}

/**
 * CURRENT state. Every field here is what is true right now, and none of it
 * is history: a transfer, a release or a retirement rewrites this block and
 * touches nothing below it.
 */
export interface PlayerCurrentState {
  /** THE canonical identity. Everything joins on this - never the name. */
  playerId: string
  firstName: string
  lastName: string
  primaryPosition: string
  secondaryPositions: string[]
  nationality: string
  age: number
  shirtNumber: number
  careerStatus: string
  /** Squad availability (available / injured / suspended), not career status. */
  squadStatus: string
  injuryStatus: string | null
  suspensionMatches: number
  fitness: number
  /** CURRENT ability, cached from the attributes. Never used to explain a past rating. */
  overall: number
  potential: number
  preferredFoot: string
  /**
   * Where they play NOW, from Player.teamId - which is exactly what that
   * column means. Null for a free agent and for a retired player. Never
   * inferred from the latest PlayerMatchStats row, which answers a different
   * question: where they last played, which may be a club they have left.
   */
  currentClub: ProfileClub | null
}

/** One appearance, ready to render. Score is present only when publicly revealable. */
export interface ProfileAppearance {
  fixtureId: string
  kickoffAt: Date
  matchday: number
  /** The club they played FOR in this match. Historical. */
  club: ProfileClub | null
  /** Who they faced. Historical - the opponent of the club they played for. */
  opponent: ProfileClub | null
  wasHome: boolean
  /** Goals for/against from the perspective of the club they played for. Null if not revealable. */
  score: { for: number; against: number } | null
  minutesPlayed: number
  goals: number
  assists: number
  rating: number
  yellowCards: number
  redCards: number
  saves: number
}

/** A club career row, with the club's current identity attached for display. */
export interface ProfileClubCareer {
  club: ProfileClub | null
  /** The historical club id, which is canonical even if the Team row vanished. */
  teamId: string
  career: PlayerCareer["clubs"][number]
}

export interface PlayerProfile {
  current: PlayerCurrentState
  career: PlayerCareer
  clubs: ProfileClubCareer[]
  /** Every eligible appearance, most recent first. */
  appearances: ProfileAppearance[]
  /** The instant the whole page was measured from. */
  measuredAt: Date
}

const CURRENT_PLAYER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  primaryPosition: true,
  secondaryPositions: true,
  nationality: true,
  age: true,
  shirtNumber: true,
  careerStatus: true,
  status: true,
  injuryStatus: true,
  suspensionMatches: true,
  fitness: true,
  overall: true,
  potential: true,
  preferredFoot: true,
  // The CURRENT club, and the only place Player.teamId is read. Selecting the
  // relation rather than the raw id keeps that intent visible at the call site.
  team: { select: CLUB_SELECT },
} as const

/**
 * The whole profile, measured from ONE instant.
 *
 * Returns null for an id that names no player, so the route can answer 404
 * rather than 500. A player with no history at all is NOT null - they have a
 * profile, it simply has no career in it. Production has 476 of those.
 */
export async function loadPlayerProfile(playerId: string, now: Date = new Date()): Promise<PlayerProfile | null> {
  // 1. IDENTITY AND CURRENT STATE.
  const player = await prisma.player.findUnique({ where: { id: playerId }, select: CURRENT_PLAYER_SELECT })
  if (!player) return null

  const liveWindowCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)

  // 2. EVERY ELIGIBLE APPEARANCE. Gated through the fixture relation, so a
  // live match's already-written stats are never selected at all.
  const rows = await prisma.playerMatchStats.findMany({
    where: {
      playerId,
      fixture: { playedAt: { not: null }, scheduledAt: { not: null, lte: liveWindowCutoff } },
    },
    select: {
      teamId: true,
      minutesPlayed: true,
      goals: true,
      assists: true,
      shots: true,
      shotsOnTarget: true,
      passesAttempted: true,
      passesCompleted: true,
      keyPasses: true,
      dribblesAttempted: true,
      dribblesCompleted: true,
      tackles: true,
      interceptions: true,
      aerialDuelsWon: true,
      fouls: true,
      yellowCards: true,
      redCards: true,
      saves: true,
      rating: true,
      fixture: {
        select: {
          id: true,
          matchday: true,
          scheduledAt: true,
          playedAt: true,
          homeTeamId: true,
          awayTeamId: true,
          homeScore: true,
          awayScore: true,
        },
      },
    },
  })

  const current: PlayerCurrentState = {
    playerId: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    primaryPosition: player.primaryPosition,
    secondaryPositions: player.secondaryPositions,
    nationality: player.nationality,
    age: player.age,
    shirtNumber: player.shirtNumber,
    careerStatus: player.careerStatus,
    squadStatus: player.status,
    injuryStatus: player.injuryStatus,
    suspensionMatches: player.suspensionMatches,
    fitness: player.fitness,
    overall: player.overall,
    potential: player.potential,
    preferredFoot: player.preferredFoot,
    currentClub: player.team ?? null,
  }

  if (rows.length === 0) {
    return { current, career: buildPlayerCareer([]), clubs: [], appearances: [], measuredAt: now }
  }

  // 3. EVERY CLUB THESE ROWS NAME - played for AND faced - in one read.
  const clubIds = new Set<string>()
  for (const row of rows) {
    clubIds.add(row.teamId)
    clubIds.add(row.fixture.homeTeamId)
    clubIds.add(row.fixture.awayTeamId)
  }
  const clubRows = await prisma.team.findMany({ where: { id: { in: [...clubIds] } }, select: CLUB_SELECT })
  const clubsById = new Map<string, ProfileClub>(clubRows.map((c) => [c.id, c]))

  // The SQL above already excludes anything not publicly finished, so every
  // kickoff here is non-null. The assertion is narrowing, not a rule.
  const records: DatedCareerMatchRecord[] = rows.map((row) => ({
    fixtureId: row.fixture.id,
    kickoffAt: row.fixture.scheduledAt as Date,
    teamId: row.teamId,
    minutesPlayed: row.minutesPlayed,
    goals: row.goals,
    assists: row.assists,
    shots: row.shots,
    shotsOnTarget: row.shotsOnTarget,
    passesAttempted: row.passesAttempted,
    passesCompleted: row.passesCompleted,
    keyPasses: row.keyPasses,
    dribblesAttempted: row.dribblesAttempted,
    dribblesCompleted: row.dribblesCompleted,
    tackles: row.tackles,
    interceptions: row.interceptions,
    aerialDuelsWon: row.aerialDuelsWon,
    fouls: row.fouls,
    yellowCards: row.yellowCards,
    redCards: row.redCards,
    saves: row.saves,
    rating: row.rating,
  }))

  const career = buildPlayerCareer(records)

  const appearances: ProfileAppearance[] = rows
    .map((row) => {
      const f = row.fixture
      const wasHome = f.homeTeamId === row.teamId
      const opponentId = wasHome ? f.awayTeamId : f.homeTeamId
      // The ONE place a stored score becomes a displayable one, reused rather
      // than re-derived. Belt and braces over the SQL gate: if this ever
      // returns null the row simply shows no score, never a wrong one.
      const revealed = revealFinalScore(f, now)
      return {
        fixtureId: f.id,
        kickoffAt: f.scheduledAt as Date,
        matchday: f.matchday,
        club: clubsById.get(row.teamId) ?? null,
        opponent: clubsById.get(opponentId) ?? null,
        wasHome,
        score: revealed ? { for: wasHome ? revealed.home : revealed.away, against: wasHome ? revealed.away : revealed.home } : null,
        minutesPlayed: row.minutesPlayed,
        goals: row.goals,
        assists: row.assists,
        rating: row.rating,
        yellowCards: row.yellowCards,
        redCards: row.redCards,
        saves: row.saves,
      }
    })
    // Most recent first. Kickoff decides; the fixture id only breaks an exact
    // tie so the order is total and stable, and carries no meaning.
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime() || a.fixtureId.localeCompare(b.fixtureId))

  const clubs: ProfileClubCareer[] = career.clubs.map((c) => ({
    teamId: c.teamId,
    club: clubsById.get(c.teamId) ?? null,
    career: c,
  }))

  return { current, career, clubs, appearances, measuredAt: now }
}

/** Just the name, for the page title. A separate tiny read, never the whole profile. */
export async function getPlayerName(playerId: string): Promise<{ firstName: string; lastName: string } | null> {
  return prisma.player.findUnique({ where: { id: playerId }, select: { firstName: true, lastName: true } })
}
