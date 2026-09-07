// Fixtures kick off Monday/Wednesday/Saturday - 3 matchdays a week - at a
// fixed evening kickoff time.
const WEEK_PATTERN_DAYS = [0, 2, 5] // offsets from that week's Monday
const KICKOFF_HOUR = 19

/** The Monday (at kickoff time) to start a new season's schedule from - today if it's already Monday, otherwise the coming one. */
export function getSeasonStartMonday(from: Date = new Date()): Date {
  const date = new Date(from)
  const day = date.getDay() // 0=Sun..6=Sat
  const diffToMonday = (1 - day + 7) % 7
  date.setDate(date.getDate() + diffToMonday)
  date.setHours(KICKOFF_HOUR, 0, 0, 0)
  return date
}

/** Minimum gap between a season transition finishing and its first kickoff. */
export const NEXT_SEASON_MIN_LEAD_HOURS = 24

/**
 * The Monday to start the NEXT season from - never a kickoff in the past,
 * and never one so close that a manager has no time to react.
 *
 * getSeasonStartMonday alone is not safe here: called on a Monday after
 * 19:00 it returns that same Monday's 19:00, which has already gone. So
 * this searches forward from `referenceDate + minLeadHours` and, if that
 * still lands on or before the lead deadline, takes the following Monday.
 * The result always satisfies: firstKickoff >= referenceDate + minLeadHours.
 */
export function getNextSeasonStartMonday(
  referenceDate: Date = new Date(),
  minLeadHours: number = NEXT_SEASON_MIN_LEAD_HOURS
): Date {
  const earliest = new Date(referenceDate.getTime() + minLeadHours * 3600_000)
  const candidate = getSeasonStartMonday(earliest)
  if (candidate.getTime() >= earliest.getTime()) return candidate
  const nextWeek = new Date(candidate)
  nextWeek.setDate(nextWeek.getDate() + 7)
  return nextWeek
}

/** Kickoff date/time for a given 1-indexed matchday, following the Mon/Wed/Sat cadence from seasonStartMonday. */
export function computeMatchdayDate(seasonStartMonday: Date, matchday: number): Date {
  const index = matchday - 1
  const week = Math.floor(index / WEEK_PATTERN_DAYS.length)
  const dayInWeek = index % WEEK_PATTERN_DAYS.length
  const offsetDays = week * 7 + WEEK_PATTERN_DAYS[dayInWeek]
  const date = new Date(seasonStartMonday)
  date.setDate(date.getDate() + offsetDays)
  return date
}
