// A fixture's 90 simulated minutes play out over 10 real minutes starting
// at kickoff (scheduledAt) - so 1 real minute = 9 simulated minutes.
export const MATCH_REAL_DURATION_MINUTES = 10
export const MATCH_SIMULATED_MINUTES = 90

/** How many of the 90 simulated minutes have elapsed, given real elapsed time since kickoff. 0 before kickoff, 90 once the real duration has passed. */
export function getSimulatedMinute(scheduledAt: Date | null, now: Date = new Date()): number {
  if (!scheduledAt || now < scheduledAt) return 0
  const elapsedRealMinutes = (now.getTime() - scheduledAt.getTime()) / 60000
  const simulated = elapsedRealMinutes * (MATCH_SIMULATED_MINUTES / MATCH_REAL_DURATION_MINUTES)
  return Math.min(MATCH_SIMULATED_MINUTES, Math.floor(simulated))
}

export function hasKickedOff(scheduledAt: Date | null, now: Date = new Date()): boolean {
  return !!scheduledAt && scheduledAt.getTime() <= now.getTime()
}

/** True once the live 10-real-minute window has fully played out (so it's safe to count in standings). */
export function isMatchFinished(scheduledAt: Date | null, now: Date = new Date()): boolean {
  return getSimulatedMinute(scheduledAt, now) >= MATCH_SIMULATED_MINUTES
}
