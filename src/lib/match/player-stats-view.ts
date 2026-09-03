/**
 * Pure presentation rules for a finished match's per-player statistics.
 * No Prisma, no React, no clock, no I/O - so every edge below is decided by
 * a test rather than discovered in the UI.
 *
 * WHAT THIS FILE DOES NOT DO: it never decides whether player stats may be
 * shown at all. That is the API's job, and it is answered there by
 * isMatchFinished (see src/app/api/matches/[fixtureId]/route.ts). Anything
 * reaching these helpers has already passed that gate.
 */

/** The goalkeeper position, per src/lib/players/positions.ts's PlayerPosition union. */
export const GOALKEEPER_POSITION = "GK"

/**
 * One player's line in the match. Mirrors exactly the columns
 * PlayerMatchStats actually has - there is no `passAccuracy` column and no
 * `position` column in that table, so the first is derived here and the
 * second comes from the joined Player row.
 */
export interface PlayerMatchStatView {
  playerId: string
  /**
   * The club this player played FOR IN THIS MATCH - PlayerMatchStats.teamId,
   * a historical snapshot. Never Player.teamId, which is current ownership
   * and moves when the player is transferred. Grouping by the latter would
   * quietly hand a player's past performances to whoever bought him
   * afterwards.
   */
  teamId: string
  firstName: string
  lastName: string
  primaryPosition: string
  shirtNumber: number
  minutesPlayed: number
  goals: number
  assists: number
  shots: number
  shotsOnTarget: number
  passesAttempted: number
  passesCompleted: number
  keyPasses: number
  dribblesAttempted: number
  dribblesCompleted: number
  tackles: number
  interceptions: number
  aerialDuelsWon: number
  fouls: number
  yellowCards: number
  redCards: number
  saves: number
  rating: number
}

/**
 * Completed passes as a percentage, or null when the player attempted none.
 *
 * Null, not 0: a substitute who came on for two minutes and touched the ball
 * once did not pass at 0% accuracy - the number does not exist for him, and
 * printing "0%" would read as a terrible performance rather than an absent
 * measurement. The UI renders null as a dash. (0/0 in JS is NaN, which would
 * render literally as "NaN%".)
 */
export function passAccuracy(stat: Pick<PlayerMatchStatView, "passesAttempted" | "passesCompleted">): number | null {
  if (stat.passesAttempted <= 0) return null
  return Math.round((stat.passesCompleted / stat.passesAttempted) * 100)
}

/** Ratings are stored as Float and always shown to one decimal, so 7 and 7.04 read alike. */
export function formatRating(rating: number): string {
  return rating.toFixed(1)
}

export function isGoalkeeper(stat: Pick<PlayerMatchStatView, "primaryPosition">): boolean {
  return stat.primaryPosition === GOALKEEPER_POSITION
}

/**
 * Saves belong to goalkeepers. An outfield player's `saves` is structurally
 * 0 - the engine has no path that increments it for them - so showing the
 * column for all 28 players would be 27 meaningless zeroes framing one real
 * number. Conversely a keeper's shots/shotsOnTarget are noise.
 *
 * Returns which of the two mutually exclusive column sets a row gets.
 */
export function shootingColumnsFor(stat: Pick<PlayerMatchStatView, "primaryPosition">): "saves" | "shots" {
  return isGoalkeeper(stat) ? "saves" : "shots"
}

/**
 * Default order: best performance first.
 *
 * rating DESC is the headline number a reader scans for. goals DESC breaks
 * ties the way a match report would, and minutesPlayed DESC puts a starter
 * above a substitute who matched him in a fraction of the time. playerId
 * last so the order is total and stable - two rows can otherwise swap
 * between renders, which looks like a bug.
 *
 * Returns a new array; the input is not mutated.
 */
export function sortPlayerStats<T extends Pick<PlayerMatchStatView, "rating" | "goals" | "minutesPlayed" | "playerId">>(
  stats: readonly T[]
): T[] {
  return [...stats].sort(
    (a, b) =>
      b.rating - a.rating ||
      b.goals - a.goals ||
      b.minutesPlayed - a.minutesPlayed ||
      a.playerId.localeCompare(b.playerId)
  )
}

/**
 * Splits one match's rows into the two clubs that played it, by the
 * historical teamId on each row.
 *
 * A row whose teamId matches neither side is dropped rather than guessed
 * into one of them - it would mean data this screen has no way to interpret
 * correctly, and inventing a side for it would be worse than omitting it.
 *
 * Only players who actually took the pitch have rows at all (the engine
 * writes one only for `minutesPlayed > 0 || onPitch`), so what comes back is
 * exactly "who played" - never a padded squad list, never a zero-row for an
 * unused substitute.
 */
export function groupByHistoricalTeam<T extends Pick<PlayerMatchStatView, "teamId" | "rating" | "goals" | "minutesPlayed" | "playerId">>(
  stats: readonly T[],
  homeTeamId: string,
  awayTeamId: string
): { home: T[]; away: T[] } {
  return {
    home: sortPlayerStats(stats.filter((s) => s.teamId === homeTeamId)),
    away: sortPlayerStats(stats.filter((s) => s.teamId === awayTeamId)),
  }
}

/**
 * Visual band for a rating, for colour only. Deliberately a display
 * concern with no game meaning: calculateMatchRating remains the single
 * source of truth for what a rating IS, and nothing here feeds back into it.
 */
export type RatingBand = "excellent" | "good" | "average" | "poor"

export function ratingBand(rating: number): RatingBand {
  if (rating >= 8) return "excellent"
  if (rating >= 7) return "good"
  if (rating >= 6) return "average"
  return "poor"
}
