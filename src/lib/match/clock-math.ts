import { MATCH_REAL_DURATION_MINUTES, MATCH_SIMULATED_MINUTES } from "./timing"

// Re-expressed in seconds purely for clock display precision - the minute
// constants themselves are untouched (see timing.ts, not modified here).
export const MATCH_REAL_DURATION_SECONDS = MATCH_REAL_DURATION_MINUTES * 60
export const MATCH_SIMULATED_SECONDS = MATCH_SIMULATED_MINUTES * 60
const SIM_SECONDS_PER_REAL_SECOND = MATCH_SIMULATED_SECONDS / MATCH_REAL_DURATION_SECONDS // 9

/**
 * The match's exact simulated-time position (0..5400 seconds), derived
 * directly from elapsed real time since kickoff - `effectiveNowMs` is
 * expected to already be clock-skew-corrected (server-relative), not the
 * client's raw Date.now().
 *
 * Deliberately independent of the API's integer `minute` field (see
 * src/lib/match/timing.ts's getSimulatedMinute, which floors to a whole
 * minute for event-visibility filtering only). A visual clock re-anchored
 * to that integer on every poll would visibly jump backward: e.g. a client
 * already showing 31:42 would snap to 31:00 the moment a poll returns
 * minute=31. Because this function is a pure, strictly increasing function
 * of real elapsed time, that regression can't happen here - resyncing the
 * clock-skew offset on every poll only ever refines the estimate of "now",
 * never restarts or truncates the elapsed time itself.
 */
export function computeSimulatedSeconds(scheduledAtMs: number, effectiveNowMs: number): number {
  const elapsedRealSeconds = (effectiveNowMs - scheduledAtMs) / 1000
  if (elapsedRealSeconds <= 0) return 0
  return Math.min(MATCH_SIMULATED_SECONDS, elapsedRealSeconds * SIM_SECONDS_PER_REAL_SECOND)
}

/** "MM:SS" out of 90:00, from a simulated-seconds value (0..5400). */
export function formatClockFromSeconds(simSeconds: number): string {
  const clamped = Math.max(0, Math.min(MATCH_SIMULATED_SECONDS, simSeconds))
  const totalSeconds = Math.floor(clamped)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/**
 * Client/server clock-skew offset (ms), estimated from one request's
 * round-trip using the midpoint method: the server is assumed to have
 * generated `serverNowMs` roughly halfway through the request, so that
 * instant is compared against the CLIENT clock's own midpoint between
 * sending the request and receiving the response - not against
 * `responseReceivedAt` alone. Comparing against the raw receipt time would
 * bake the full one-way network delay into the offset (worse the slower
 * the connection); the midpoint assumption cancels that out as long as the
 * outbound and inbound legs are roughly symmetric, which is why this
 * estimate stays accurate whether the round trip took 100ms or 1000ms.
 */
export function computeClockOffsetMs(requestStartedAtMs: number, responseReceivedAtMs: number, serverNowMs: number): number {
  const clientMidpointMs = requestStartedAtMs + (responseReceivedAtMs - requestStartedAtMs) / 2
  return serverNowMs - clientMidpointMs
}

/**
 * The value actually shown on screen, one further clamp beyond
 * computeSimulatedSeconds: while LIVE, the displayed clock must never move
 * backward between two renders (a resync that slightly revises the
 * clock-skew estimate must never look like time reversing), so it's
 * floored at whatever was already on screen. SCHEDULED is always exactly
 * 00:00 and FINISHED is always exactly 90:00, regardless of the raw
 * candidate value - neither state's badge is allowed to show a mid-match
 * time.
 */
export function clampForDisplay(
  candidateSeconds: number,
  lastDisplayedSeconds: number,
  status: "scheduled" | "live" | "finished"
): number {
  if (status === "scheduled") return 0
  if (status === "finished") return MATCH_SIMULATED_SECONDS
  return Math.min(MATCH_SIMULATED_SECONDS, Math.max(candidateSeconds, lastDisplayedSeconds))
}
