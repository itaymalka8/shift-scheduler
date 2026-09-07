import { getSimulatedMinute, hasKickedOff, isMatchFinished } from "./timing"

/**
 * What a fixture is, from the point of view of anything that lists fixtures.
 *
 * Deliberately derived from the SAME canonical clock helpers the live match
 * API and computeStandings already use (hasKickedOff / isMatchFinished in
 * ./timing.ts) rather than from playedAt, because those two answer different
 * questions and confusing them is a spoiler:
 *
 * The engine writes the whole match - final score included - in one shot the
 * instant it runs (see src/lib/match/simulate.ts), which is at kickoff, not
 * at full time. So `playedAt != null` means "the result exists in the
 * database", NOT "the match is over for the viewer". A fixture that kicked
 * off two minutes ago is already simulated and already has its final score
 * stored, while the 10-real-minute live window still has 8 minutes to run.
 *
 *  - scheduled           kickoff is still in the future.
 *  - live                kicked off, the live window has not played out yet.
 *  - finished            live window played out AND a stored result exists.
 *  - awaitingProcessing  live window played out but nothing was ever
 *                        simulated (the scheduler never picked it up). There
 *                        is no result to show and inventing 0:0 would be a
 *                        lie, so this is its own state.
 */
export type FixtureListStatus = "scheduled" | "live" | "finished" | "awaitingProcessing"

/** The minimum a fixture must expose to be classified - notably NOT its score. */
export interface FixtureTimingFacts {
  scheduledAt: Date | null
  playedAt: Date | null
}

export function getFixtureListStatus(fixture: FixtureTimingFacts, now: Date = new Date()): FixtureListStatus {
  if (!hasKickedOff(fixture.scheduledAt, now)) return "scheduled"
  if (!isMatchFinished(fixture.scheduledAt, now)) return "live"
  return fixture.playedAt ? "finished" : "awaitingProcessing"
}

/**
 * The Upcoming tab: matches still ahead of the viewer. A live match belongs
 * here (it is the opposite of a result - it is the one match you can still
 * go and watch happen), never in Results.
 */
export function belongsInUpcoming(fixture: FixtureTimingFacts, now: Date = new Date()): boolean {
  const status = getFixtureListStatus(fixture, now)
  return status === "scheduled" || status === "live"
}

/**
 * The Results tab: matches whose live window has played out. Includes
 * awaitingProcessing, because chronologically that match is in the past and
 * hiding it entirely would leave a hole in a club's season - but it carries
 * no score (see revealFinalScore), it is labelled as unprocessed instead.
 */
export function belongsInResults(fixture: FixtureTimingFacts, now: Date = new Date()): boolean {
  const status = getFixtureListStatus(fixture, now)
  return status === "finished" || status === "awaitingProcessing"
}

/**
 * The ONE place a stored score is allowed to become a displayable score.
 *
 * Returns null for anything that is not `finished` - so a live match whose
 * final score is already sitting in Fixture.homeScore/awayScore cannot leak
 * through a list, exactly as the match API refuses to select those columns
 * outside its own finished-gated query.
 */
export function revealFinalScore(
  fixture: FixtureTimingFacts & { homeScore: number | null; awayScore: number | null },
  now: Date = new Date()
): { home: number; away: number } | null {
  if (getFixtureListStatus(fixture, now) !== "finished") return null
  if (fixture.homeScore == null || fixture.awayScore == null) return null
  return { home: fixture.homeScore, away: fixture.awayScore }
}

/**
 * How many of a fixture's 90 minutes may be revealed right now: 0 before
 * kickoff, the live clock's floored minute while live, 90 once the window
 * has played out. This is the same value the match API filters events on
 * (`minute <= cap`), restated here so a caller can reason about visibility
 * without re-deriving it.
 */
export function revealedMinuteCap(scheduledAt: Date | null, now: Date = new Date()): number {
  return getSimulatedMinute(scheduledAt, now)
}
