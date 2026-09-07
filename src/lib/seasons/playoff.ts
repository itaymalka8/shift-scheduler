/**
 * THE CHAMPIONSHIP PLAYOFF'S OWN SCORING AND RANKING.
 *
 * Pure: no database, no clock. The league's own table is not reused here
 * because a playoff is scored differently - but the RANKING ALGEBRA is
 * reused, unchanged, from ./champion.ts. Only the points rule is new.
 *
 * POINTS (the approved 3/2/1/0 system):
 *
 *   win in 90 minutes                      3
 *   level after 90, won the shootout       2
 *   level after 90, lost the shootout      1
 *   lost in 90 minutes                     0
 *
 * Every match distributes exactly 3 points, so this introduces no distortion
 * relative to the league's 3/1/0 - it simply says that winning inside the 90
 * is worth more than surviving penalties, which is the point of the system.
 *
 * GOAL STATISTICS ARE 90-MINUTE ONLY. Shootout scores decide the WINNER of a
 * match and are never added to goals for, goals against or goal difference.
 * A drawn 90 minutes therefore contributes 0 to both clubs' goal difference
 * no matter who won the penalties. A consequence worth naming: a club that
 * draws twice and wins both shootouts (4 points) finishes above one that wins
 * 1-0 and loses 0-1 (3 points). That is exactly what the system is for.
 */
import { leadersOf, type TitleOutcome, type TitleTableRow } from "./champion"

/** The maximum number of round-robin rounds before the knockout takes over. Also a database CHECK. */
export const MAX_ROUND_ROBIN_ROUNDS = 3

const WIN_90_POINTS = 3
const SHOOTOUT_WIN_POINTS = 2
const SHOOTOUT_LOSS_POINTS = 1

/** The minimum a playoff fixture must expose to be scored. */
export interface PlayoffFixture {
  homeTeamId: string
  awayTeamId: string
  /** The 90-minute score. Both null until the match has been simulated. */
  homeScore: number | null
  awayScore: number | null
  /** Both null unless the 90 minutes were level and penalties were taken. */
  homeShootoutScore: number | null
  awayShootoutScore: number | null
}

export type PlayoffMatchOutcome =
  | { kind: "decided"; winnerTeamId: string; loserTeamId: string; inNinety: true }
  | { kind: "decided"; winnerTeamId: string; loserTeamId: string; inNinety: false }
  /** No usable result: unplayed, or level with no shootout recorded. Fail closed. */
  | { kind: "unresolved" }

/**
 * Who won one playoff match, and whether they did it inside the 90 minutes.
 *
 * A level 90 with no shootout is UNRESOLVED, not a draw - a playoff match
 * cannot end level, so that state means the match is unfinished or the data
 * is broken, and either way no table may be built from it.
 */
export function playoffMatchOutcome(fixture: PlayoffFixture): PlayoffMatchOutcome {
  const { homeScore, awayScore, homeShootoutScore, awayShootoutScore } = fixture
  if (homeScore === null || awayScore === null) return { kind: "unresolved" }

  if (homeScore > awayScore) {
    return { kind: "decided", winnerTeamId: fixture.homeTeamId, loserTeamId: fixture.awayTeamId, inNinety: true }
  }
  if (awayScore > homeScore) {
    return { kind: "decided", winnerTeamId: fixture.awayTeamId, loserTeamId: fixture.homeTeamId, inNinety: true }
  }

  if (homeShootoutScore === null || awayShootoutScore === null) return { kind: "unresolved" }
  if (homeShootoutScore === awayShootoutScore) return { kind: "unresolved" }
  return homeShootoutScore > awayShootoutScore
    ? { kind: "decided", winnerTeamId: fixture.homeTeamId, loserTeamId: fixture.awayTeamId, inNinety: false }
    : { kind: "decided", winnerTeamId: fixture.awayTeamId, loserTeamId: fixture.homeTeamId, inNinety: false }
}

/** True when every supplied fixture has a usable result. A table may only be ranked when this holds. */
export function allResolved(fixtures: PlayoffFixture[]): boolean {
  return fixtures.every((f) => playoffMatchOutcome(f).kind === "decided")
}

/**
 * The playoff table over exactly `teamIds`.
 *
 * Produces the SAME TitleTableRow shape the league table uses, so leadersOf
 * and the remove-and-recompute recursion apply to it without modification.
 * Fixtures involving a club outside `teamIds` are skipped entirely, which is
 * what makes this same function serve both the full playoff table and a
 * head-to-head mini-table over a tied subset.
 */
export function buildPlayoffTable(teamIds: string[], fixtures: PlayoffFixture[]): TitleTableRow[] {
  const rows = new Map<string, TitleTableRow>()
  for (const teamId of teamIds) {
    rows.set(teamId, { teamId, played: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0 })
  }

  for (const fixture of fixtures) {
    const home = rows.get(fixture.homeTeamId)
    const away = rows.get(fixture.awayTeamId)
    if (!home || !away) continue

    const outcome = playoffMatchOutcome(fixture)
    if (outcome.kind !== "decided") continue

    home.played++
    away.played++

    // NINETY-MINUTE GOALS ONLY. homeShootoutScore/awayShootoutScore decided
    // the winner above and stop there - they never reach a goal column.
    home.goalsFor += fixture.homeScore as number
    home.goalsAgainst += fixture.awayScore as number
    away.goalsFor += fixture.awayScore as number
    away.goalsAgainst += fixture.homeScore as number

    const winner = outcome.winnerTeamId === fixture.homeTeamId ? home : away
    const loser = outcome.winnerTeamId === fixture.homeTeamId ? away : home
    if (outcome.inNinety) {
      winner.points += WIN_90_POINTS
    } else {
      winner.points += SHOOTOUT_WIN_POINTS
      loser.points += SHOOTOUT_LOSS_POINTS
    }
  }

  for (const row of rows.values()) row.goalDiff = row.goalsFor - row.goalsAgainst
  return Array.from(rows.values())
}

/**
 * Head-to-head over a tied playoff subset: REMOVE AND RECOMPUTE, the same
 * rule the league table already uses and for the same reason - a club that
 * has already dropped out of contention must not decide the title between
 * clubs that have not.
 */
export function resolvePlayoffHeadToHead(tiedTeamIds: string[], fixtures: PlayoffFixture[]): TitleOutcome {
  if (tiedTeamIds.length === 0) return { kind: "empty" }
  if (tiedTeamIds.length === 1) return { kind: "resolved", teamId: tiedTeamIds[0], via: "headToHead" }

  const leaders = leadersOf(buildPlayoffTable(tiedTeamIds, fixtures))
  if (leaders.length === 1) return { kind: "resolved", teamId: leaders[0].teamId, via: "headToHead" }
  if (leaders.length === tiedTeamIds.length) return { kind: "decider", tiedTeamIds: [...tiedTeamIds] }

  return resolvePlayoffHeadToHead(
    leaders.map((row) => row.teamId),
    fixtures
  )
}

/**
 * The champion of a completed playoff round, or the clubs still level.
 *
 * `fixtures` must be EVERY fixture of the round, and every one of them must be
 * resolved - a round is ranked only once it has finished completely, never
 * part-way through.
 */
export function resolvePlayoffRound(teamIds: string[], fixtures: PlayoffFixture[]): TitleOutcome {
  if (teamIds.length === 0 || fixtures.length === 0) return { kind: "empty" }
  if (!allResolved(fixtures)) return { kind: "empty" }

  const leaders = leadersOf(buildPlayoffTable(teamIds, fixtures))
  if (leaders.length === 0) return { kind: "empty" }
  if (leaders.length === 1) return { kind: "resolved", teamId: leaders[0].teamId, via: "table" }

  return resolvePlayoffHeadToHead(
    leaders.map((row) => row.teamId),
    fixtures
  )
}

/**
 * Every unordered pairing of a round robin: each club against each other
 * club exactly once.
 *
 * Ordered so that no club appears twice in the same slot index, which is what
 * lets the scheduler put slot k of every pairing on the same matchday without
 * a club ever playing twice in one round slot. The circle method the league
 * schedule already uses, taken single-leg.
 */
export function roundRobinPairings(teamIds: string[]): { homeTeamId: string; awayTeamId: string; slot: number }[] {
  if (teamIds.length < 2) return []
  const BYE = "__BYE__"
  const arr = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, BYE]
  const n = arr.length
  const slots = n - 1
  const half = n / 2
  const out: { homeTeamId: string; awayTeamId: string; slot: number }[] = []

  for (let slot = 0; slot < slots; slot++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i]
      const b = arr[n - 1 - i]
      if (a === BYE || b === BYE) continue
      // Alternate technical home/away across slots, purely so a fixture list
      // does not show one club "at home" in every match. Neutral venue, so
      // this carries no sporting or financial meaning at all.
      out.push(slot % 2 === 0 ? { homeTeamId: a, awayTeamId: b, slot: slot + 1 } : { homeTeamId: b, awayTeamId: a, slot: slot + 1 })
    }
    const last = arr.pop() as string
    arr.splice(1, 0, last)
  }
  return out
}
