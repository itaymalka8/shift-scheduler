/**
 * Reading a championship playoff and answering the only two questions the
 * season lifecycle asks of it: is it settled, and if not, what must happen
 * next.
 *
 * Pure apart from the types it borrows - it is handed a loaded PlayoffState
 * and returns a decision, so the orchestrator does the writing and this does
 * the thinking.
 */
import { MAX_ROUND_ROBIN_ROUNDS, resolvePlayoffRound } from "./playoff"
import { fixturesOfRound, knockoutSurvivors, latestRound, roundIsComplete, type PlayoffState } from "./playoffs"
import { playoffMatchOutcome } from "./playoff"

export type PlayoffDecision =
  /** A champion. decidedAt/decidedByFixtureId identify the fixture it is dated from. */
  | { kind: "champion"; teamId: string; decidedAt: Date; decidedByFixtureId: string }
  /** Nothing to do: fixtures exist that have not been played out yet. */
  | { kind: "waiting"; reason: string }
  /** The next round robin round must be created for these clubs. */
  | { kind: "needRoundRobin"; round: number; teamIds: string[] }
  /** Round 3 ended level: enter the knockout with these entrants. */
  | { kind: "needKnockout"; entrants: string[] }
  /** The next knockout round must be created, in the persisted bracket's order. */
  | { kind: "needKnockoutRound"; round: number; survivorsInBracketOrder: string[] }
  /** The data cannot answer the question. Never guess - report and hold. */
  | { kind: "blocked"; reason: string }

/**
 * The deciding fixture of a completed round.
 *
 * The champion is already known by the time this runs - it was decided by the
 * table, not by this function. All that remains is choosing WHICH row of the
 * round to record as the title's provenance, and the answer is the last one to
 * kick off. If several kicked off together, the fixture id breaks the tie:
 * a purely technical selection among simultaneous rows, made AFTER the
 * sporting outcome is settled, which is the only place an id is ever allowed
 * near a championship.
 */
export function decidingFixtureOfRound(
  fixtures: { id: string; scheduledAt: Date | null }[]
): { id: string; scheduledAt: Date } | null {
  let best: { id: string; scheduledAt: Date } | null = null
  for (const fixture of fixtures) {
    if (!fixture.scheduledAt) continue
    if (!best) {
      best = { id: fixture.id, scheduledAt: fixture.scheduledAt }
      continue
    }
    const later = fixture.scheduledAt.getTime() > best.scheduledAt.getTime()
    const sameInstantLowerId =
      fixture.scheduledAt.getTime() === best.scheduledAt.getTime() && fixture.id < best.id
    if (later || sameInstantLowerId) best = { id: fixture.id, scheduledAt: fixture.scheduledAt }
  }
  return best
}

/**
 * What this playoff needs next.
 *
 * A round is only ever evaluated once EVERY fixture in it has finished - the
 * spec's simplification, and a considerable one: there is no mathematical
 * clinch detection, no "can anyone still catch them" search, and therefore no
 * way for a subtle arithmetic error to crown the wrong club early.
 */
export function decidePlayoff(state: PlayoffState, now: Date): PlayoffDecision {
  const knockoutRound = latestRound(state, "KNOCKOUT")

  // --- KNOCKOUT, once entered, is the only thing that matters ------------
  if (knockoutRound > 0) {
    const draw = state.knockoutDraw
    if (!draw) {
      return { kind: "blocked", reason: "knockout fixtures exist but no draw is persisted" }
    }
    const current = fixturesOfRound(state, "KNOCKOUT", knockoutRound)
    if (!roundIsComplete(current, now)) {
      return { kind: "waiting", reason: `knockout round ${knockoutRound} is still being played` }
    }

    // Byes only apply to round 1; later rounds are always a clean power of two.
    const byes = knockoutRound === 1 ? draw.byes : []
    const survivors = knockoutSurvivors(draw, current, byes)

    if (survivors.length === 1) {
      const deciding = decidingFixtureOfRound(current)
      if (!deciding) return { kind: "blocked", reason: "the final has no kickoff to date the title from" }
      return {
        kind: "champion",
        teamId: survivors[0],
        decidedAt: deciding.scheduledAt,
        decidedByFixtureId: deciding.id,
      }
    }
    if (survivors.length < 1) {
      return { kind: "blocked", reason: `knockout round ${knockoutRound} produced no survivors` }
    }
    return { kind: "needKnockoutRound", round: knockoutRound + 1, survivorsInBracketOrder: survivors }
  }

  // --- ROUND ROBIN --------------------------------------------------------
  const round = latestRound(state, "ROUND_ROBIN")
  if (round === 0) {
    return { kind: "blocked", reason: "the playoff exists but has no fixtures" }
  }

  const current = fixturesOfRound(state, "ROUND_ROBIN", round)
  if (!roundIsComplete(current, now)) {
    return { kind: "waiting", reason: `round-robin round ${round} is still being played` }
  }

  const teamIds = [...new Set(current.flatMap((f) => [f.homeTeamId, f.awayTeamId]))]
  const outcome = resolvePlayoffRound(teamIds, current)

  if (outcome.kind === "resolved") {
    const deciding = decidingFixtureOfRound(current)
    if (!deciding) return { kind: "blocked", reason: "the resolving round has no kickoff to date the title from" }
    return {
      kind: "champion",
      teamId: outcome.teamId,
      decidedAt: deciding.scheduledAt,
      decidedByFixtureId: deciding.id,
    }
  }

  if (outcome.kind !== "decider") {
    return { kind: "blocked", reason: "the completed round could not be ranked" }
  }

  // Still level. Another round for the remaining subset - or, once the cap is
  // reached, the knockout, which is what makes termination guaranteed.
  if (round < MAX_ROUND_ROBIN_ROUNDS) {
    return { kind: "needRoundRobin", round: round + 1, teamIds: outcome.tiedTeamIds }
  }
  return { kind: "needKnockout", entrants: outcome.tiedTeamIds }
}

/** Every club that won a match in a round - used by the verifier and by tests. */
export function winnersOf(fixtures: { homeTeamId: string; awayTeamId: string; homeScore: number | null; awayScore: number | null; homeShootoutScore: number | null; awayShootoutScore: number | null }[]): string[] {
  const out: string[] = []
  for (const fixture of fixtures) {
    const outcome = playoffMatchOutcome(fixture)
    if (outcome.kind === "decided") out.push(outcome.winnerTeamId)
  }
  return out
}
