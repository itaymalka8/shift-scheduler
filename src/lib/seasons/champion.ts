/**
 * WHO WON THE DIVISION - decided here, once, and never by recomputation.
 *
 * Pure: no database, no clock of its own, no I/O. Every edge of the
 * tie-breaking chain is settled by a test rather than by argument, and the
 * same inputs always produce the same champion - which is the whole point,
 * since this answer is about to be written down permanently.
 *
 * THE APPROVED CHAMPIONSHIP CHAIN, in order:
 *
 *   1. Points
 *   2. Goal difference
 *   3. Goals scored
 *   4. Head-to-head points
 *   5. Head-to-head goal difference
 *   6. Head-to-head goals scored
 *   7. A championship decider match
 *
 * WHAT IS NOT IN THAT CHAIN, and must never be:
 *
 *   - Team.name. computeStandings falls through to it for DISPLAY order,
 *     and that is fine for a table on a screen - but a club's name is
 *     mutable (a human takeover rewrites it in src/app/api/register/route.ts,
 *     the bot renamer rewrites it in src/lib/leagues/seed.ts), so a title
 *     decided by name could change retroactively when a club is renamed.
 *   - localeCompare, whose result depends on the runtime's ICU default, so
 *     two environments could disagree about who is champion.
 *   - teamId. It is stable and deterministic, which makes it a fine
 *     TECHNICAL ordering key, and Phase 2C will use it to decide which club
 *     is nominally "home" in a neutral-venue decider. It carries no sporting
 *     meaning whatsoever and must never decide a championship.
 *
 * A tie that survives all six criteria is a genuine sporting tie, and this
 * module says so - it returns the tied set and asks for a decider, rather
 * than inventing a winner out of a database identifier.
 */

/** The minimum a fixture must expose to be counted. Deliberately not the whole row. */
export interface TitleFixture {
  homeTeamId: string
  awayTeamId: string
  homeScore: number | null
  awayScore: number | null
}

/** One club's aggregate over some set of matches - the league table's row, or a mini-table's. */
export interface TitleTableRow {
  teamId: string
  played: number
  points: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
}

export type TitleOutcome =
  /** One club is clear. `via` records which criterion separated them, for the audit trail. */
  | { kind: "resolved"; teamId: string; via: "table" | "headToHead" }
  /** Still level after every criterion. These clubs must play a decider. */
  | { kind: "decider"; tiedTeamIds: string[] }
  /** No club has played a countable match - crown nobody rather than invent a champion. */
  | { kind: "empty" }

const WIN_POINTS = 3
const DRAW_POINTS = 1

/** A fixture only counts once it has a stored result on both sides. Callers filter for "finished" before this. */
function hasResult(fixture: TitleFixture): fixture is TitleFixture & { homeScore: number; awayScore: number } {
  return fixture.homeScore !== null && fixture.awayScore !== null
}

/**
 * Aggregates a set of fixtures into a table over exactly `teamIds`.
 *
 * Fixtures involving a club outside `teamIds` are skipped entirely rather
 * than half-counted - which is what makes this same function serve both the
 * full division table and a head-to-head mini-table, with no second copy of
 * the points rules to drift out of step.
 */
export function buildTitleTable(teamIds: string[], fixtures: TitleFixture[]): TitleTableRow[] {
  const rows = new Map<string, TitleTableRow>()
  for (const teamId of teamIds) {
    rows.set(teamId, { teamId, played: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0 })
  }

  for (const fixture of fixtures) {
    if (!hasResult(fixture)) continue
    const home = rows.get(fixture.homeTeamId)
    const away = rows.get(fixture.awayTeamId)
    // Both sides must be in scope. For the mini-table this is exactly the
    // "only games played between the tied teams" rule, expressed once.
    if (!home || !away) continue

    home.played++
    away.played++
    home.goalsFor += fixture.homeScore
    home.goalsAgainst += fixture.awayScore
    away.goalsFor += fixture.awayScore
    away.goalsAgainst += fixture.homeScore

    if (fixture.homeScore > fixture.awayScore) {
      home.points += WIN_POINTS
    } else if (fixture.homeScore < fixture.awayScore) {
      away.points += WIN_POINTS
    } else {
      home.points += DRAW_POINTS
      away.points += DRAW_POINTS
    }
  }

  for (const row of rows.values()) row.goalDiff = row.goalsFor - row.goalsAgainst
  return Array.from(rows.values())
}

/** The three ranking numbers, in chain order. Identical for the full table and a mini-table. */
function rankingKey(row: TitleTableRow): [number, number, number] {
  return [row.points, row.goalDiff, row.goalsFor]
}

function sameKey(a: TitleTableRow, b: TitleTableRow): boolean {
  const [ap, ad, af] = rankingKey(a)
  const [bp, bd, bf] = rankingKey(b)
  return ap === bp && ad === bd && af === bf
}

/**
 * The clubs at the very top of a table - one, if somebody is clear, or the
 * whole set that ties on points, goal difference AND goals scored.
 *
 * Returns them in no meaningful order: when there is more than one, they are
 * genuinely equal and any order here would be a lie about that.
 */
export function leadersOf(rows: TitleTableRow[]): TitleTableRow[] {
  if (rows.length === 0) return []
  let best = rows[0]
  for (const row of rows) {
    const [p, d, f] = rankingKey(row)
    const [bp, bd, bf] = rankingKey(best)
    if (p > bp || (p === bp && (d > bd || (d === bd && f > bf)))) best = row
  }
  return rows.filter((row) => sameKey(row, best))
}

/**
 * Head-to-head resolution over a tied group: REMOVE AND RECOMPUTE.
 *
 * A mini-table is built from the league matches played BETWEEN the tied
 * clubs only, and ranked by the same three criteria. If that separates a
 * single leader, they are champion. If it separates some clubs but not all,
 * the separated ones are dropped and a COMPLETELY FRESH mini-table is built
 * over just the clubs still level.
 *
 * Why recompute rather than keep the first mini-table authoritative:
 *
 *   A, B and C are tied. C finishes bottom of the mini-table and is out of
 *   contention. But C's results are still inside A's and B's mini-table
 *   totals - so if A beat C 5-0 while B beat C 1-0, and A drew with B twice,
 *   a frozen table crowns A purely because of what C did. C is not
 *   competing for anything. Its results must not decide the title between
 *   two clubs that are.
 *
 * Recomputing over {A, B} uses only A versus B - which is what "head to
 * head" means. This is also how real regulation works (UEFA Art. 20.02 and
 * most national leagues): the criteria are applied to the tied group, and if
 * a subset remains level the whole procedure restarts for that subset alone.
 *
 * TERMINATION is guaranteed. Each pass either returns, or recurses on a
 * strictly smaller group; the `leaders.length === tiedTeamIds.length` guard
 * catches the no-progress case immediately, so a group that separates
 * nothing goes straight to a decider instead of looping. With two clubs the
 * recomputed mini-table is identical to the first, so the guard fires on the
 * first pass.
 *
 * `fixtures` must contain LEAGUE fixtures only. A TITLE_DECIDER is excluded
 * by the caller, because letting a decider feed the calculation that
 * produced it would be circular.
 */
export function resolveHeadToHead(tiedTeamIds: string[], fixtures: TitleFixture[]): TitleOutcome {
  if (tiedTeamIds.length === 0) return { kind: "empty" }
  if (tiedTeamIds.length === 1) return { kind: "resolved", teamId: tiedTeamIds[0], via: "headToHead" }

  const leaders = leadersOf(buildTitleTable(tiedTeamIds, fixtures))

  if (leaders.length === 1) return { kind: "resolved", teamId: leaders[0].teamId, via: "headToHead" }

  // Nothing separated - every criterion is exhausted and these clubs are
  // genuinely level. This is the only path to a decider.
  if (leaders.length === tiedTeamIds.length) {
    return { kind: "decider", tiedTeamIds: [...tiedTeamIds] }
  }

  // Some clubs dropped out. Start again, over only those still level.
  return resolveHeadToHead(
    leaders.map((row) => row.teamId),
    fixtures
  )
}

/**
 * The division's champion, or the clubs that must play for it.
 *
 * `fixtures` is every countable LEAGUE fixture of the division - already
 * filtered by the caller for `stage = LEAGUE` and for having actually
 * finished (the caller owns the clock; this function must not).
 */
export function resolveDivisionTitle(teamIds: string[], fixtures: TitleFixture[]): TitleOutcome {
  const countable = fixtures.filter(hasResult)
  // A division nobody has played a match in has no champion. Returning the
  // first row of an all-zeroes table would be inventing one.
  if (teamIds.length === 0 || countable.length === 0) return { kind: "empty" }

  const leaders = leadersOf(buildTitleTable(teamIds, countable))
  if (leaders.length === 0) return { kind: "empty" }
  if (leaders.length === 1) return { kind: "resolved", teamId: leaders[0].teamId, via: "table" }

  return resolveHeadToHead(
    leaders.map((row) => row.teamId),
    countable
  )
}
