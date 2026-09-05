/**
 * A PLAYER'S CAREER, aggregated. Pure: no Prisma, no clock, no I/O.
 *
 * A READ MODEL over PlayerMatchStats, which is the canonical per-match player
 * record and the ONLY source here. Goals come from the goals column, ratings
 * from the rating column; MatchEvent is never consulted and no rating is ever
 * recomputed. Nothing below is stored, cached or derived from a second place -
 * two sources for one career would eventually disagree, and the disagreement
 * would be a lie about somebody's history.
 *
 * IDENTITY IS playerId AND NOTHING ELSE. Not the name, not the shirt number,
 * not the club. A player who is transferred, released or retired is the same
 * historical player, and every total here stays continuous across all three.
 *
 * HISTORICAL CLUB COMES FROM PlayerMatchStats.teamId - the club they played
 * THAT match for. Player.teamId is current ownership; it moves on a transfer
 * and would quietly hand a career to whoever bought the player afterwards.
 * This module is never given Player.teamId, so it cannot use it.
 *
 * PUBLIC ELIGIBILITY IS THE CALLER'S JOB. Deciding whether a match is
 * publicly finished needs a clock, and this module has none by design; the
 * reader filters in SQL before anything reaches here.
 */

/**
 * One canonical historical match record.
 *
 * ONE ROW IS ONE APPEARANCE - the database guarantees it with
 * @@unique([fixtureId, playerId]), and the engine writes a row only for a
 * player who actually took the pitch. So appearances are counted, never
 * DISTINCTed.
 *
 * A ROW WITH minutesPlayed = 0 IS STILL AN APPEARANCE. It is a stoppage-time
 * cameo whose minutes rounded down to zero, not an unused substitute - the
 * engine writes no row at all for someone who never came on - and filtering
 * on minutesPlayed > 0 would delete real appearances from real careers.
 */
export interface CareerMatchRecord {
  fixtureId: string
  /** The club they played this match FOR. Never their current club. */
  teamId: string
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

/** Every counting stat, summed. Ratings are handled separately - a mean is not a sum. */
export interface CareerTotals {
  appearances: number
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
  /** Kept so averageRating is reproducible as ratingSum / appearances exactly. */
  ratingSum: number
  /**
   * The UNROUNDED arithmetic mean of the rating column. Null with no
   * appearances - a dash, never a 0.0 that would read as a terrible career.
   *
   * NEVER PERSISTED, and never rounded before it is stored here: formatting
   * happens in the page, after every comparison has already been made.
   */
  averageRating: number | null
}

export const EMPTY_CAREER_TOTALS: CareerTotals = {
  appearances: 0,
  minutesPlayed: 0,
  goals: 0,
  assists: 0,
  shots: 0,
  shotsOnTarget: 0,
  passesAttempted: 0,
  passesCompleted: 0,
  keyPasses: 0,
  dribblesAttempted: 0,
  dribblesCompleted: 0,
  tackles: 0,
  interceptions: 0,
  aerialDuelsWon: 0,
  fouls: 0,
  yellowCards: 0,
  redCards: 0,
  saves: 0,
  ratingSum: 0,
  averageRating: null,
}

/** Sums the supplied records into one set of totals. Never mutates its input. */
export function computeCareerTotals(records: readonly CareerMatchRecord[]): CareerTotals {
  const totals: CareerTotals = { ...EMPTY_CAREER_TOTALS }
  for (const r of records) {
    totals.appearances += 1
    totals.minutesPlayed += r.minutesPlayed
    totals.goals += r.goals
    totals.assists += r.assists
    totals.shots += r.shots
    totals.shotsOnTarget += r.shotsOnTarget
    totals.passesAttempted += r.passesAttempted
    totals.passesCompleted += r.passesCompleted
    totals.keyPasses += r.keyPasses
    totals.dribblesAttempted += r.dribblesAttempted
    totals.dribblesCompleted += r.dribblesCompleted
    totals.tackles += r.tackles
    totals.interceptions += r.interceptions
    totals.aerialDuelsWon += r.aerialDuelsWon
    totals.fouls += r.fouls
    totals.yellowCards += r.yellowCards
    totals.redCards += r.redCards
    totals.saves += r.saves
    totals.ratingSum += r.rating
  }
  totals.averageRating = totals.appearances > 0 ? totals.ratingSum / totals.appearances : null
  return totals
}

/**
 * A player's record AT ONE CLUB, with the dates that bound it.
 *
 * AGGREGATED BY Team.id, so a player who left a club and came back has ONE
 * row for it holding every appearance they ever made there. That is a
 * deliberate choice over splitting it into spells: a spell is a real thing
 * for a MANAGER, whose eras are recorded in TeamEra with their own start and
 * end dates, but nothing in this schema records when a player joined or left
 * a club. Splitting on a gap between appearances would be inferring spells
 * from silence - an injury, a suspension or a spell on the bench looks
 * identical to a transfer - and inventing a PlayerSpell entity to hold the
 * guess would make up history rather than read it. The match list below keeps
 * the true chronology, which is the part that is actually recorded.
 */
export interface CareerClubTotals {
  teamId: string
  totals: CareerTotals
  /** Kickoff of their earliest appearance for this club. */
  firstAppearanceAt: Date
  /** Kickoff of their latest. Equal to the first when they played once. */
  lastAppearanceAt: Date
}

/** A record paired with the kickoff of its fixture, which the pure layer cannot look up. */
export interface DatedCareerMatchRecord extends CareerMatchRecord {
  /** The fixture's kickoff. Never null: the reader only supplies scheduled fixtures. */
  kickoffAt: Date
}

/**
 * Every club the player turned out for, most recent last appearance first.
 *
 * ORDERED BY REAL PARTICIPATION, not by name and not by insertion order:
 * lastAppearanceAt descending, then firstAppearanceAt descending, then by the
 * immutable teamId so the order is total and stable. The club they played for
 * most recently is the club at the top, which is what a career reads like.
 */
export function computeClubTotals(records: readonly DatedCareerMatchRecord[]): CareerClubTotals[] {
  const byClub = new Map<string, DatedCareerMatchRecord[]>()
  for (const r of records) {
    const bucket = byClub.get(r.teamId)
    if (bucket) bucket.push(r)
    else byClub.set(r.teamId, [r])
  }

  const clubs: CareerClubTotals[] = []
  for (const [teamId, rows] of byClub) {
    let first = rows[0].kickoffAt
    let last = rows[0].kickoffAt
    for (const r of rows) {
      if (r.kickoffAt < first) first = r.kickoffAt
      if (r.kickoffAt > last) last = r.kickoffAt
    }
    clubs.push({ teamId, totals: computeCareerTotals(rows), firstAppearanceAt: first, lastAppearanceAt: last })
  }

  return clubs.sort(
    (a, b) =>
      b.lastAppearanceAt.getTime() - a.lastAppearanceAt.getTime() ||
      b.firstAppearanceAt.getTime() - a.firstAppearanceAt.getTime() ||
      a.teamId.localeCompare(b.teamId)
  )
}

/**
 * DERIVED PRESENTATION METRICS. Computed on read, never stored.
 *
 * Every one of them returns null rather than 0 on a zero denominator, because
 * "no shots attempted" and "0% accuracy" are different facts and printing the
 * second for the first would libel the player.
 */
export interface CareerRates {
  goalsPerAppearance: number | null
  assistsPerAppearance: number | null
  /** Per 90 MINUTES PLAYED, not per 90 of match time - a substitute is not credited with a full match. */
  goalsPer90: number | null
  assistsPer90: number | null
  /** Share of shots that were on target, 0..1. Null when they never shot. */
  shotAccuracy: number | null
  /** Share of passes completed, 0..1. Null when they never attempted one. */
  passAccuracy: number | null
}

const per = (value: number, denominator: number): number | null => (denominator > 0 ? value / denominator : null)

export function computeCareerRates(totals: CareerTotals): CareerRates {
  return {
    goalsPerAppearance: per(totals.goals, totals.appearances),
    assistsPerAppearance: per(totals.assists, totals.appearances),
    goalsPer90: per(totals.goals * 90, totals.minutesPlayed),
    assistsPer90: per(totals.assists * 90, totals.minutesPlayed),
    shotAccuracy: per(totals.shotsOnTarget, totals.shots),
    passAccuracy: per(totals.passesCompleted, totals.passesAttempted),
  }
}

/**
 * How few appearances still counts as a small sample, for a label beside the
 * average rating.
 *
 * DELIBERATELY NOT the Hall of Fame's threshold. That number decides who may
 * be RANKED on a public leaderboard, which is a competition rule. This one
 * decides nothing at all - the profile shows a career average after a single
 * appearance, because it is that player's real average and hiding it would
 * withhold true information about their own career. It only adds context.
 */
export const SMALL_SAMPLE_APPEARANCES = 5

export function isSmallSample(totals: CareerTotals): boolean {
  return totals.appearances > 0 && totals.appearances < SMALL_SAMPLE_APPEARANCES
}

export interface PlayerCareer {
  totals: CareerTotals
  rates: CareerRates
  clubs: CareerClubTotals[]
  /** Distinct clubs represented. Never their current club unless they played for it. */
  clubsRepresented: number
  smallSample: boolean
}

/** The whole career, from one set of eligible records. */
export function buildPlayerCareer(records: readonly DatedCareerMatchRecord[]): PlayerCareer {
  const totals = computeCareerTotals(records)
  const clubs = computeClubTotals(records)
  return {
    totals,
    rates: computeCareerRates(totals),
    clubs,
    clubsRepresented: clubs.length,
    smallSample: isSmallSample(totals),
  }
}
