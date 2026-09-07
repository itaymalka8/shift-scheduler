/**
 * SETTLING A TIE ON THE FIELD - the mechanism, as pure arithmetic.
 *
 * A tie that survives points, goal difference, goals scored and all three
 * head-to-head criteria is a genuine sporting tie. If its clubs would all
 * receive the SAME outcome, nothing is played: this game does not manufacture
 * a full table order it has no use for. If they would receive DIFFERENT
 * outcomes - promotion or a playoff place, safety or relegation - the tie is
 * settled by playing, never by a database identifier.
 *
 * ONE MECHANISM, OF WHICH THE TWO-CLUB CASE IS THE BASE CASE.
 *
 *   ROUNDS 1..3   a neutral round robin among the clubs still level. Ranked
 *                 with buildPlayoffTable (3 for a win in 90, 2 for a shootout
 *                 win, 1 for a shootout loss) and leadersOf - the SAME
 *                 functions the championship playoff uses. Clubs the round
 *                 separates are placed and take no part in later rounds:
 *                 their results must not decide a place between clubs still
 *                 competing for it. With two clubs a "round robin" is one
 *                 match, which is exactly the neutral decider the contract
 *                 asks for.
 *
 *   ROUND 4+      the terminal ladder, reached only when three rounds have
 *                 proved the clubs indistinguishable. One drawn pairing at a
 *                 time; the winner takes the higher place, the loser drops to
 *                 contest the next. m clubs are fully ordered in m-1 matches,
 *                 so termination is arithmetic rather than hope.
 *
 * Every match is non-LEAGUE, so competition.ts gives it a neutral venue, no
 * club finances and a shootout when the 90 minutes are level - by
 * construction, not by a list. A boundary fixture therefore cannot end
 * drawn, which is why the ladder always terminates.
 *
 * Pure: no Prisma, no clock, no randomness of its own. The draw is seeded by
 * the caller from the division's own immutable league record.
 */
import { buildPlayoffTable, playoffMatchOutcome, MAX_ROUND_ROBIN_ROUNDS, type PlayoffFixture } from "../playoff"
import { leadersOf } from "../champion"
import { SeededRandom } from "@/lib/match/engine/rng"

/**
 * One boundary fixture, as this module needs to read it.
 *
 * scheduledAt/playedAt are carried but never interpreted here: whether a match
 * has publicly finished is a clock question, and this module owns no clock.
 * The caller supplies a `finished` predicate over these fields.
 */
export interface BoundaryFixture extends PlayoffFixture {
  boundaryRound: number
  scheduledAt: Date | null
  playedAt: Date | null
}

/** What the boundary mechanism wants to happen next. */
export type BoundaryDecision =
  /** Settled. `order` is the tied group in finishing order, best first. */
  | { kind: "settled"; order: string[] }
  /** Fixtures exist for the current round and have not all finished. */
  | { kind: "waiting"; round: number }
  /** Create a neutral round robin among these clubs. */
  | { kind: "needRoundRobin"; round: number; teamIds: string[] }
  /** Create one ladder match between exactly these two clubs. */
  | { kind: "needLadderMatch"; round: number; teamIds: [string, string] }
  /** The data cannot answer the question. Never guess - report and hold. */
  | { kind: "blocked"; reason: string }

/** Every unordered pair of a group, in a stable, order-independent listing. */
export function roundRobinPairs(teamIds: string[]): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) pairs.push([teamIds[i], teamIds[j]])
  }
  return pairs
}

/** How many matches one round robin over `n` clubs is. */
export function roundRobinSize(n: number): number {
  return (n * (n - 1)) / 2
}

/**
 * Order the clubs a round separated, and report who is still level.
 *
 * Uses leadersOf over the playoff table repeatedly - the same
 * remove-and-recompute shape as everywhere else in this codebase. Because a
 * boundary match cannot end drawn, every fixture contributes a decided result
 * or the round is not complete and this is not called.
 */
function orderByRound(teamIds: string[], fixtures: PlayoffFixture[]): { placed: string[]; stillLevel: string[] } {
  const placed: string[] = []
  let remaining = [...teamIds]

  while (remaining.length > 0) {
    const leaders = leadersOf(buildPlayoffTable(remaining, fixtures))
    if (leaders.length === 0) break
    if (leaders.length === remaining.length) {
      // Nothing separated at all. Everything still on the table is level.
      return { placed, stillLevel: remaining }
    }
    if (leaders.length === 1) {
      placed.push(leaders[0].teamId)
      remaining = remaining.filter((id) => id !== leaders[0].teamId)
      continue
    }
    // A group at the top that this round could not split, with clubs below
    // it that it did. The split ones are placed later; these stay level.
    return { placed, stillLevel: leaders.map((row) => row.teamId) }
  }

  return { placed, stillLevel: [] }
}

/**
 * What must happen next for one boundary.
 *
 * `tiedTeamIds` is the group the statistical chain left level, in no
 * meaningful order. `fixtures` is every BOUNDARY_DECIDER fixture already
 * created for THIS boundary, whatever round it belongs to. `finished` reports
 * whether a fixture has publicly finished - the caller owns the clock.
 */
export function decideBoundary(
  tiedTeamIds: string[],
  fixtures: BoundaryFixture[],
  finished: (fixture: BoundaryFixture) => boolean,
  drawSeed: string
): BoundaryDecision {
  if (tiedTeamIds.length <= 1) return { kind: "settled", order: [...tiedTeamIds] }

  const byRound = new Map<number, BoundaryFixture[]>()
  for (const fixture of fixtures) {
    const bucket = byRound.get(fixture.boundaryRound) ?? []
    bucket.push(fixture)
    byRound.set(fixture.boundaryRound, bucket)
  }

  const order: string[] = []
  let level = [...tiedTeamIds]
  let round = 1

  // Replay the rounds that exist, in order, so a resumed run reaches the same
  // state a continuous one would. Nothing is remembered between ticks: the
  // fixtures ARE the memory.
  for (; ; round++) {
    if (level.length <= 1) {
      order.push(...level)
      return { kind: "settled", order }
    }

    const roundFixtures = byRound.get(round) ?? []
    const isLadder = round > MAX_ROUND_ROBIN_ROUNDS
    const expected = isLadder ? 1 : roundRobinSize(level.length)

    if (roundFixtures.length === 0) {
      if (isLadder) {
        const [home, away] = drawLadderPair(level, drawSeed, round)
        return { kind: "needLadderMatch", round, teamIds: [home, away] }
      }
      return { kind: "needRoundRobin", round, teamIds: [...level] }
    }

    if (roundFixtures.length !== expected) {
      return {
        kind: "blocked",
        reason: `boundary round ${round} has ${roundFixtures.length} fixture(s), expected ${expected} for ${level.length} club(s) still level`,
      }
    }

    if (!roundFixtures.every((f) => finished(f) && playoffMatchOutcome(f).kind === "decided")) {
      return { kind: "waiting", round }
    }

    if (isLadder) {
      // One match, one place fixed. The winner takes the best place still
      // available; the loser drops into the next contest.
      const outcome = playoffMatchOutcome(roundFixtures[0])
      if (outcome.kind !== "decided") {
        return { kind: "blocked", reason: `ladder round ${round} produced no winner` }
      }
      order.push(outcome.winnerTeamId)
      level = level.filter((id) => id !== outcome.winnerTeamId)
      continue
    }

    const result = orderByRound(level, roundFixtures)
    order.push(...result.placed)
    if (result.stillLevel.length === 0) {
      return { kind: "settled", order }
    }
    if (result.stillLevel.length === level.length && result.placed.length === 0) {
      // Wholly indistinguishable again. Keep going: rounds 2 and 3 are more
      // football, and only after three of them does the ladder take over.
      level = result.stillLevel
      continue
    }
    level = result.stillLevel
  }
}

/**
 * The two clubs a ladder round pairs.
 *
 * The entrant list is canonicalised by teamId before shuffling - a technical
 * device, stated openly, exactly as the championship draw does - and the
 * shuffle then destroys any correlation between id order and who plays. The
 * round number is folded into the seed so consecutive ladder rounds do not
 * draw the same pairing from the same sequence.
 */
export function drawLadderPair(level: string[], drawSeed: string, round: number): [string, string] {
  if (level.length < 2) {
    throw new Error(`A ladder match needs two clubs, got ${level.length}`)
  }
  const rng = new SeededRandom(`${drawSeed}|ladder|${round}`)
  const shuffled = [...level].sort()
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return [shuffled[0], shuffled[1]]
}
