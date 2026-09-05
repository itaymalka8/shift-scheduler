// Pure, DB-free helpers for turning already-simulated MatchEvents into a
// spoiler-safe live view. The whole match is computed at once at kickoff
// (see src/lib/match/simulate.ts) - these functions are what stand between
// that fact and a client ever seeing something that hasn't "happened" yet
// from the live clock's point of view, so every input here must already be
// pre-filtered to events whose minute has actually elapsed.

export interface LiveEventInput {
  type: string
  outcome: string | null
  teamId: string
}

export interface LiveTeamStats {
  corners: number
  fouls: number
  yellowCards: number
  redCards: number
  goals: number
  substitutions: number
}

/** A goal from open play, or a converted penalty - see engine.ts's own goal-counting convention. */
function isGoalEvent(e: Pick<LiveEventInput, "type" | "outcome">): boolean {
  return e.type === "goal" || (e.type === "penalty" && e.outcome === "scored")
}

/** Keeps only events that have actually happened by `currentMinute` - the one gate every live response must pass through. */
export function filterRevealedEvents<T extends { minute: number }>(events: T[], currentMinute: number): T[] {
  return events.filter((e) => e.minute <= currentMinute)
}

/**
 * The live score, computed strictly from goal events already revealed -
 * never from Fixture.homeScore/awayScore (which holds the FINAL result from
 * the moment the engine ran, long before the live clock catches up).
 */
export function computeLiveScore(
  revealedEvents: LiveEventInput[],
  homeTeamId: string,
  awayTeamId: string
): { home: number; away: number } {
  let home = 0
  let away = 0
  for (const e of revealedEvents) {
    if (!isGoalEvent(e)) continue
    if (e.teamId === homeTeamId) home++
    else if (e.teamId === awayTeamId) away++
  }
  return { home, away }
}

function emptyLiveStats(): LiveTeamStats {
  return { corners: 0, fouls: 0, yellowCards: 0, redCards: 0, goals: 0, substitutions: 0 }
}

/**
 * Team stats derivable *reliably* from revealed events alone - deliberately
 * excludes possession, which the engine only ever produces as a final
 * aggregate (never one event per possession), so there is no honest way to
 * derive a running possession percentage mid-match. See the Match Engine
 * audit for the exact event-to-stat mapping this implements.
 *
 * Neither "Shots" nor "Shots on Target" is exposed here - both are subject
 * to the identical gap: engine.ts's resolveShot only emits a "save" event
 * when the defending side actually has a goalkeeper on the pitch at that
 * moment (`if (keeper) { recordEvent(...) }`). In the rare case where a
 * team has none (sent off/injured with no fit substitute left), an
 * on-target-but-unconverted shot still increments the engine's own final
 * shots/shotsOnTarget counters, with NO corresponding MatchEvent at all -
 * so an event-reconstructed count of EITHER stat can silently undercount
 * in that scenario. Goals, Corners, Fouls, Yellow/Red Cards, and
 * Substitutions have no such gap: engine.ts always emits exactly one event
 * per occurrence for each of these, unconditionally. Both Shots and Shots
 * on Target remain available, exact, in the finished-match view
 * (finalStats, straight from the engine's own EngineTeamStats, never
 * reconstructed from events).
 */
export function computeLiveStats(
  revealedEvents: LiveEventInput[],
  homeTeamId: string,
  awayTeamId: string
): { home: LiveTeamStats; away: LiveTeamStats } {
  const home = emptyLiveStats()
  const away = emptyLiveStats()
  const statsFor = (teamId: string) => (teamId === homeTeamId ? home : teamId === awayTeamId ? away : null)

  for (const e of revealedEvents) {
    switch (e.type) {
      case "goal": {
        const s = statsFor(e.teamId)
        if (s) s.goals++
        break
      }
      case "penalty": {
        const s = statsFor(e.teamId)
        if (s && e.outcome === "scored") s.goals++
        break
      }
      case "corner": {
        const s = statsFor(e.teamId)
        if (s) s.corners++
        break
      }
      case "foul": {
        const s = statsFor(e.teamId)
        if (s) s.fouls++
        break
      }
      case "yellowCard": {
        const s = statsFor(e.teamId)
        if (s) s.yellowCards++
        break
      }
      case "redCard": {
        const s = statsFor(e.teamId)
        if (s) s.redCards++
        break
      }
      case "substitution": {
        const s = statsFor(e.teamId)
        if (s) s.substitutions++
        break
      }
      default:
        break
    }
  }

  return { home, away }
}
