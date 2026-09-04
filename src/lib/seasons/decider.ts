/**
 * WHEN a championship decider kicks off, and WHO is nominally at home.
 *
 * Pure: no database, no clock of its own. Both answers must be identical
 * every time they are computed, because a decider that moved between two
 * orchestrator ticks would be a different match.
 */
import { computeMatchdayDate } from "@/lib/match/schedule"

/**
 * How far ahead of the decider managers get to prepare.
 *
 * Same 24 hours the next-season scheduler already guarantees before a new
 * season's first kickoff (NEXT_SEASON_MIN_LEAD_HOURS). A championship
 * decider is the most consequential match a club will ever play, so
 * dropping it on someone with an hour's notice - which is what could happen
 * if the orchestrator caught up after an outage - would be worse here than
 * anywhere else in the game.
 */
export const DECIDER_MIN_LEAD_HOURS = 24

/**
 * The technical home side: lower lexical teamId.
 *
 * A NEUTRAL VENUE, so this is a database role and nothing else. The engine
 * is told `neutralVenue: true`, which is what actually removes both halves
 * of home advantage - so being "home" here earns no crowd, no multiplier and
 * (see simulate.ts) no money. It exists only because Fixture has a
 * homeTeamId and an awayTeamId and one of them has to be filled in.
 *
 * Lexical id rather than a coin toss so the same tie always produces the
 * same fixture, and rather than club name because names are mutable. This
 * ordering has ZERO sporting meaning and never decides a championship - the
 * kicks do.
 */
export function technicalHomeAway(teamIds: string[]): { homeTeamId: string; awayTeamId: string } {
  if (teamIds.length !== 2) {
    throw new Error(`A title decider is played between exactly two clubs, got ${teamIds.length}.`)
  }
  const [first, second] = [...teamIds].sort()
  return { homeTeamId: first, awayTeamId: second }
}

export interface DeciderSchedule {
  scheduledAt: Date
  matchday: number
}

/**
 * The decider's kickoff, in the league's own rhythm.
 *
 * It takes the NEXT slot in the existing Mon/Wed/Sat 19:00 cadence after the
 * final league matchday - computed with the same computeMatchdayDate the
 * whole season is built from, anchored on the same season start - so to a
 * manager it simply looks like one more matchday, at the time matches always
 * kick off. Nothing new is invented about scheduling.
 *
 * If that slot is less than DECIDER_MIN_LEAD_HOURS away (a late orchestrator
 * run, or an outage), it steps forward slot by slot until it is far enough
 * out. That is what makes "never in the past" and "never a surprise" the
 * same rule rather than two.
 *
 * NOTE ON TIME ZONES: computeMatchdayDate uses the server's local clock,
 * which in Production is UTC, so league kickoffs are 19:00Z. That is the
 * existing convention for all 1,140 fixtures and this deliberately follows
 * it rather than introducing an Asia/Jerusalem rule for one fixture, which
 * would put the decider at a different wall-clock time from every other
 * match. Moving the whole league to Israel local time is a separate,
 * league-wide change.
 */
export function computeDeciderSchedule(
  seasonStartMonday: Date,
  lastLeagueMatchday: number,
  now: Date,
  minLeadHours: number = DECIDER_MIN_LEAD_HOURS
): DeciderSchedule {
  const earliest = now.getTime() + minLeadHours * 3600_000
  let matchday = lastLeagueMatchday + 1
  let scheduledAt = computeMatchdayDate(seasonStartMonday, matchday)
  // Bounded by construction: each step advances by at least a day, so this
  // reaches `earliest` in a small number of iterations however far behind
  // the orchestrator is.
  while (scheduledAt.getTime() < earliest) {
    matchday++
    scheduledAt = computeMatchdayDate(seasonStartMonday, matchday)
  }
  return { scheduledAt, matchday }
}

/**
 * Which club won the decider, from what is stored on the fixture.
 *
 * The 90 minutes decide it when they were not level. Only a draw hands it to
 * the shootout - and a shootout cannot itself be level, which the database
 * CHECK constraints also enforce.
 *
 * Returns null rather than guessing whenever the fixture cannot answer the
 * question: no score yet, or a draw with no shootout recorded. A null here
 * means no champion is written and the season stays ACTIVE - fail closed.
 */
export function deciderWinnerTeamId(fixture: {
  homeTeamId: string
  awayTeamId: string
  homeScore: number | null
  awayScore: number | null
  homeShootoutScore: number | null
  awayShootoutScore: number | null
}): string | null {
  const { homeScore, awayScore, homeShootoutScore, awayShootoutScore } = fixture
  if (homeScore == null || awayScore == null) return null
  if (homeScore > awayScore) return fixture.homeTeamId
  if (awayScore > homeScore) return fixture.awayTeamId

  // Level after 90 - only the shootout can settle it.
  if (homeShootoutScore == null || awayShootoutScore == null) return null
  if (homeShootoutScore === awayShootoutScore) return null
  return homeShootoutScore > awayShootoutScore ? fixture.homeTeamId : fixture.awayTeamId
}
