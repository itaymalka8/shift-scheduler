/**
 * THE PLAYER HALL OF FAME, ranked. Pure: no Prisma, no clock, no I/O.
 *
 * A READ MODEL over PlayerMatchStats, which is the canonical per-match player
 * record. Nothing here is stored, cached or recomputed from anywhere else -
 * goals come from the goals column, ratings from the rating column, and
 * MatchEvent is never consulted for either. Two sources for one leaderboard
 * would eventually disagree, and the one that disagreed would be a lie about
 * somebody's career.
 *
 * A CAREER IS THE SUM OF A PLAYER'S ROWS, GROUPED BY playerId AND NOTHING
 * ELSE. Not by club, not by name, not by position or nationality. A player who
 * moves from one club to another has ONE career, and the transfer is invisible
 * to every total below.
 *
 * HISTORICAL CLUB COMES FROM PlayerMatchStats.teamId - the club they played
 * that match FOR. Player.teamId is current state, it is null for a free agent
 * and for a retired player, and it never decides where an old appearance
 * belongs. This module is not given Player.teamId at all, so it cannot.
 *
 * RETIRED AND RELEASED PLAYERS ARE FULLY ELIGIBLE. careerStatus and current
 * club are absent from the inputs by design: a career is what someone did, not
 * what they are doing now, and a retired player may top any board here.
 *
 * BOT OR HUMAN MANAGEMENT IS IRRELEVANT. These are the player's numbers. Who
 * picked the team is a different history, on a different page.
 */
import { boardTop, rankEntries, type BoardCut } from "./leaderboards"

/**
 * How many places each player board shows.
 *
 * The player population is nothing like the manager population - Production
 * has 844 players with history against 38 managers - so an uncapped player
 * board is a page of hundreds of rows. Ten is a hall of fame's shape.
 */
export const PLAYER_BOARD_PLACES = 10

/**
 * The row budget behind those ten places.
 *
 * Ten PLACES is not ten ROWS, because a place can be shared, and a shared
 * place is never split - so places alone do not bound anything. Production
 * today is the worst case in the flesh: every one of its 844 players has
 * exactly 2 appearances, which is one rank group of 844.
 *
 * A group that does not fit inside this budget is SUMMARISED instead of
 * truncated - see boardTop. 25 leaves room for a genuinely shared podium
 * while keeping the page finite.
 */
export const PLAYER_BOARD_MAX_ROWS = 25

/**
 * The minimum appearances before a career average rating is ranked.
 *
 * MEASURED FIRST, THEN CHOSEN. Production on 2026-09-04 (prod:players:distribution):
 * 844 players with eligible history, appearances min=1 p25=2 median=2 p75=2
 * p90=2 p95=2 max=2. Every quantile is 2. That is not a distribution of
 * careers - it is a league two matchdays old (844 players is 38 squads, 1669
 * rows is two each), and it cannot calibrate a career threshold because there
 * are no careers in it yet.
 *
 * SO THE THRESHOLD IS NOT FITTED TO IT, DELIBERATELY. Fitting would mean 1 or
 * 2, and at >= 1 appearance the board's leader has a career average of 8.800
 * from a single good afternoon. That is a man-of-the-match board wearing a
 * hall of fame's title.
 *
 * AND IT CAN NEVER BE RAISED LATER. Raising it would evict players who had
 * already qualified, which is not something a hall of fame may do. A threshold
 * has exactly one chance to be right, so it is chosen for the game this will
 * be rather than the fortnight it is.
 *
 * 20 IS ROUGHLY HALF A 38-MATCH LEAGUE SEASON: reachable inside one season by
 * an ever-present player, unreachable by a cameo, and the same shape as the
 * manager board already shipped (MIN_MATCHES_FOR_WIN_RATE = 38, a full
 * season). Its honest consequence today is an EMPTY BOARD - nobody has 20
 * appearances and nobody will until matchday 20 - and the UI states the rule
 * so that empty reads as "nobody qualifies yet" rather than as a fault.
 *
 * Constant for every player. Never varied by position, club or era.
 */
export const MIN_APPEARANCES_FOR_RATING = 20

/**
 * One canonical historical match record for one player.
 *
 * ONE ROW IS ONE APPEARANCE. The database guarantees it: PlayerMatchStats
 * carries @@unique([fixtureId, playerId]), so a player cannot hold two rows
 * for one match, and the engine only writes a row for someone who actually
 * took the pitch. So appearances are counted, never DISTINCTed - a DISTINCT
 * here would be hiding a duplicate the domain says cannot exist.
 *
 * A ROW WITH minutesPlayed = 0 IS STILL AN APPEARANCE, AND ITS RATING STILL
 * COUNTS. Production has 3 of them. They are NOT unused substitutes - the
 * engine writes no row at all for a player who never came on. They are players
 * who came on in stoppage time and whose minutes rounded down to zero, which
 * football counts as a substitute appearance. Their 6.0 is not a null
 * sentinel either: calculateMatchRating returns a deliberate neutral 6 for a
 * cameo, it is the rating the match report already shows, and second-guessing
 * it here would make this module a second opinion about what a rating is.
 */
export interface PlayerMatchRecord {
  playerId: string
  /** The club they played this match FOR. Never their current club. */
  teamId: string
  goals: number
  assists: number
  rating: number
  minutesPlayed: number
}

/** Presentation only. Identity is playerId; none of this decides a rank. */
export interface HallOfFamePlayer {
  playerId: string
  firstName: string
  lastName: string
  primaryPosition: string
  nationality: string
  /** RETIRED players stay on every board - this only labels them. */
  careerStatus: string
}

export interface HallOfFameClubRef {
  id: string
  name: string
}

/** Everything a player did, across every club, in one career. */
export interface PlayerCareer {
  playerId: string
  appearances: number
  goals: number
  assists: number
  minutesPlayed: number
  /** Kept for reproducibility: averageRating is ratingSum / appearances exactly. */
  ratingSum: number
  /** The unrounded mean. Null with no appearances. NEVER persisted. */
  averageRating: number | null
  /** Distinct clubs represented, in first-seen order of the supplied rows. */
  clubIds: string[]
  /** Appearances per club, for historical context. */
  appearancesByClub: Map<string, number>
}

/**
 * Aggregates every supplied row into one career per player.
 *
 * The caller supplies ONLY rows from publicly finished fixtures; this layer
 * does no filtering of its own, because the finished rule needs a clock and
 * this module deliberately has none.
 */
export function buildPlayerCareers(records: PlayerMatchRecord[]): Map<string, PlayerCareer> {
  const careers = new Map<string, PlayerCareer>()

  for (const record of records) {
    let career = careers.get(record.playerId)
    if (!career) {
      career = {
        playerId: record.playerId,
        appearances: 0,
        goals: 0,
        assists: 0,
        minutesPlayed: 0,
        ratingSum: 0,
        averageRating: null,
        clubIds: [],
        appearancesByClub: new Map(),
      }
      careers.set(record.playerId, career)
    }
    career.appearances += 1
    career.goals += record.goals
    career.assists += record.assists
    career.minutesPlayed += record.minutesPlayed
    career.ratingSum += record.rating
    if (!career.appearancesByClub.has(record.teamId)) career.clubIds.push(record.teamId)
    career.appearancesByClub.set(record.teamId, (career.appearancesByClub.get(record.teamId) ?? 0) + 1)
  }

  for (const career of careers.values()) {
    career.averageRating = career.appearances > 0 ? career.ratingSum / career.appearances : null
  }
  return careers
}

/** The most recent club a player actually turned out for, from history alone. */
export function mostRecentClub(career: PlayerCareer): string | null {
  return career.clubIds.length > 0 ? career.clubIds[career.clubIds.length - 1] : null
}

export interface PlayerEntry {
  player: HallOfFamePlayer
  career: PlayerCareer
  /** The club of their LAST recorded appearance. Historical, not current. */
  historicalClub: HallOfFameClubRef | null
}

function toEntries(
  careers: Map<string, PlayerCareer>,
  players: Map<string, HallOfFamePlayer>,
  clubs: Map<string, HallOfFameClubRef>
): PlayerEntry[] {
  const entries: PlayerEntry[] = []
  for (const career of careers.values()) {
    const player = players.get(career.playerId)
    // A career whose player row is missing is broken data, and it is skipped
    // rather than rendered as an anonymous line on a public leaderboard.
    if (!player) continue
    const clubId = mostRecentClub(career)
    entries.push({ player, career, historicalClub: clubId ? (clubs.get(clubId) ?? null) : null })
  }
  return entries
}

/**
 * MOST APPEARANCES. One row is one appearance; see PlayerMatchRecord.
 *
 * Ties share a rank, and the technical order inside a tie is by playerId - an
 * immutable id, never a name. See rankEntries in ./leaderboards.
 */
export function mostAppearances(
  careers: Map<string, PlayerCareer>,
  players: Map<string, HallOfFamePlayer>,
  clubs: Map<string, HallOfFameClubRef>
): BoardCut<PlayerEntry> {
  return boardTop(
    rankEntries(
      toEntries(careers, players, clubs),
      (e) => e.career.appearances,
      (e) => e.player.playerId
    ),
    PLAYER_BOARD_PLACES,
    PLAYER_BOARD_MAX_ROWS
  )
}

/** MOST GOALS. From PlayerMatchStats.goals, the canonical aggregate - never recounted from MatchEvent. */
export function mostGoals(
  careers: Map<string, PlayerCareer>,
  players: Map<string, HallOfFamePlayer>,
  clubs: Map<string, HallOfFameClubRef>
): BoardCut<PlayerEntry> {
  return boardTop(
    rankEntries(
      toEntries(careers, players, clubs).filter((e) => e.career.goals > 0),
      (e) => e.career.goals,
      (e) => e.player.playerId
    ),
    PLAYER_BOARD_PLACES,
    PLAYER_BOARD_MAX_ROWS
  )
}

/** MOST ASSISTS. PlayerMatchStats.assists is a real persisted column, so this is a real leaderboard. */
export function mostAssists(
  careers: Map<string, PlayerCareer>,
  players: Map<string, HallOfFamePlayer>,
  clubs: Map<string, HallOfFameClubRef>
): BoardCut<PlayerEntry> {
  return boardTop(
    rankEntries(
      toEntries(careers, players, clubs).filter((e) => e.career.assists > 0),
      (e) => e.career.assists,
      (e) => e.player.playerId
    ),
    PLAYER_BOARD_PLACES,
    PLAYER_BOARD_MAX_ROWS
  )
}

/**
 * HIGHEST CAREER AVERAGE RATING, among players at or above the threshold.
 *
 * THE RANK USES THE UNROUNDED MEAN. 7.449 and 7.451 both display as 7.45 at
 * two decimals but are not tied, and ranking on the formatted value would
 * invent a tie that does not exist. Formatting happens in the page, after the
 * rank is already decided.
 *
 * Floating point: ratings are Float in the database and summed as IEEE-754
 * doubles, so equality here is exact double equality - two players tie only if
 * their sums and counts produce bit-identical means. That is the honest
 * comparison; rounding to "look tied" would be a display concept leaking into
 * a sporting one.
 *
 * The threshold is applied BEFORE ranking, so a one-appearance player is never
 * rank 1 and then hidden - they were never in the running.
 */
export function bestAverageRating(
  careers: Map<string, PlayerCareer>,
  players: Map<string, HallOfFamePlayer>,
  clubs: Map<string, HallOfFameClubRef>,
  minimumAppearances: number = MIN_APPEARANCES_FOR_RATING
): BoardCut<PlayerEntry> {
  const eligible = toEntries(careers, players, clubs).filter(
    (e) => e.career.appearances >= minimumAppearances && e.career.averageRating !== null
  )
  return boardTop(
    rankEntries(
      eligible,
      (e) => e.career.averageRating as number,
      (e) => e.player.playerId
    ),
    PLAYER_BOARD_PLACES,
    PLAYER_BOARD_MAX_ROWS
  )
}

export interface PlayerHallOfFame {
  measuredAt: Date
  mostAppearances: BoardCut<PlayerEntry>
  mostGoals: BoardCut<PlayerEntry>
  mostAssists: BoardCut<PlayerEntry>
  bestAverageRating: BoardCut<PlayerEntry>
  minimumAppearancesForRating: number
  /** How many places each board shows. Stated so the UI can say so. */
  places: number
  /** How many players have any eligible history at all - drives the empty state. */
  playersWithHistory: number
}

export interface PlayerHallOfFameFacts {
  records: PlayerMatchRecord[]
  players: Map<string, HallOfFamePlayer>
  clubs: Map<string, HallOfFameClubRef>
}

/** Every player board, from one set of facts and ONE instant. */
export function buildPlayerHallOfFame(facts: PlayerHallOfFameFacts, now: Date): PlayerHallOfFame {
  const careers = buildPlayerCareers(facts.records)
  return {
    measuredAt: now,
    mostAppearances: mostAppearances(careers, facts.players, facts.clubs),
    mostGoals: mostGoals(careers, facts.players, facts.clubs),
    mostAssists: mostAssists(careers, facts.players, facts.clubs),
    bestAverageRating: bestAverageRating(careers, facts.players, facts.clubs),
    minimumAppearancesForRating: MIN_APPEARANCES_FOR_RATING,
    places: PLAYER_BOARD_PLACES,
    playersWithHistory: careers.size,
  }
}
