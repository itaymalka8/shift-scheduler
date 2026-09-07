/**
 * The era-boundary rule and the manager record derived from it. Pure: no
 * database, no clock of its own, no I/O - so every edge of the boundary is
 * decided by a test rather than by argument.
 *
 * THE CANONICAL RULE. A match belongs to the era that owned the club at
 * `Fixture.scheduledAt` - kickoff - and never at `playedAt`.
 *
 * playedAt is when the ENGINE ran, which is a scheduling detail: the
 * scheduler may pick a fixture up late, or (after an outage) hours after
 * its kickoff, and a fixture that was never simulated has no playedAt at
 * all. Attributing by playedAt would hand a match to whoever happened to
 * own the club when a background job got round to it. scheduledAt is when
 * the match was actually managed, so that is the instant that decides.
 *
 * The window is HALF-OPEN: [startedAt, endedAt).
 *
 *     startedAt <= scheduledAt  AND  (endedAt is null OR scheduledAt < endedAt)
 *
 * Half-open is what makes the boundary unambiguous. A takeover writes the
 * outgoing era's endedAt and the incoming era's startedAt as the SAME
 * instant, so a match kicking off exactly then belongs to the new manager
 * and to exactly one era - never to both, never to neither.
 */
import { isMatchFinished } from "../match/timing"

export type TeamEraType = "BOT" | "HUMAN"

/** The minimum an era must expose to decide ownership - notably not its type or user. */
export interface EraWindow {
  teamId: string
  startedAt: Date
  endedAt: Date | null
}

/** The minimum a fixture must expose to be attributed. Scores are deliberately separate (see FixtureResult). */
export interface AttributableFixture {
  homeTeamId: string
  awayTeamId: string
  scheduledAt: Date | null
  playedAt: Date | null
}

/**
 * Does this instant fall inside the era's half-open window?
 *
 * An unscheduled fixture (scheduledAt = null) belongs to no era: without a
 * kickoff there is no moment to attribute it to, and picking one would be
 * an invention.
 */
export function instantBelongsToEra(instant: Date | null, era: EraWindow): boolean {
  if (!instant) return false
  if (instant.getTime() < era.startedAt.getTime()) return false
  if (era.endedAt !== null && instant.getTime() >= era.endedAt.getTime()) return false
  return true
}

/** Whether this club played in this fixture at all - either side of it. */
export function fixtureInvolvesTeam(fixture: AttributableFixture, teamId: string): boolean {
  return fixture.homeTeamId === teamId || fixture.awayTeamId === teamId
}

/** The full attribution test: the club played in it, and kickoff falls inside the era. */
export function fixtureBelongsToEra(fixture: AttributableFixture, era: EraWindow): boolean {
  return fixtureInvolvesTeam(fixture, era.teamId) && instantBelongsToEra(fixture.scheduledAt, era)
}

export interface FixtureResult extends AttributableFixture {
  homeScore: number | null
  awayScore: number | null
}

export interface ManagerRecord {
  matches: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
}

export const EMPTY_MANAGER_RECORD: ManagerRecord = {
  matches: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
}

/**
 * Is this fixture allowed to enter a managerial record yet?
 *
 * Two conditions, and BOTH are required. `isMatchFinished` (the same
 * canonical clock helper computeStandings and the Match Center use) says
 * the 10-real-minute live window has fully played out; a stored result says
 * the engine actually ran. The engine writes the whole match - final score
 * included - at kickoff, so a fixture two minutes into its live window
 * already has homeScore/awayScore sitting in the database. Counting on
 * playedAt alone would put a match still being watched into the record, and
 * a record is a score: "played 5, won 3" published mid-match tells the
 * viewer the result of a match they are watching.
 */
export function countsTowardRecord(fixture: FixtureResult, now: Date = new Date()): boolean {
  if (!isMatchFinished(fixture.scheduledAt, now)) return false
  if (!fixture.playedAt) return false
  return fixture.homeScore !== null && fixture.awayScore !== null
}

/**
 * The managerial record for one era, from fixtures the caller supplies.
 *
 * Fixtures that do not belong to the era, or that are not finished, are
 * skipped rather than partially counted - so a manager who took over
 * mid-season starts at 0/0/0 with the club's earlier results untouched and
 * uncounted, exactly as the design requires.
 *
 * Takes `now` explicitly (defaulting to the real clock) so a caller renders
 * a whole page from ONE instant, and so tests can stand at any point in a
 * match's live window.
 */
export function computeManagerRecord(era: EraWindow, fixtures: FixtureResult[], now: Date = new Date()): ManagerRecord {
  const record: ManagerRecord = { ...EMPTY_MANAGER_RECORD }

  for (const fixture of fixtures) {
    if (!fixtureBelongsToEra(fixture, era)) continue
    if (!countsTowardRecord(fixture, now)) continue

    const isHome = fixture.homeTeamId === era.teamId
    const goalsFor = (isHome ? fixture.homeScore : fixture.awayScore) as number
    const goalsAgainst = (isHome ? fixture.awayScore : fixture.homeScore) as number

    record.matches += 1
    record.goalsFor += goalsFor
    record.goalsAgainst += goalsAgainst
    if (goalsFor > goalsAgainst) record.wins += 1
    else if (goalsFor === goalsAgainst) record.draws += 1
    else record.losses += 1
  }

  return record
}
