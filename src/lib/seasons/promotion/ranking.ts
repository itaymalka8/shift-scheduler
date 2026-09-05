/**
 * THE FULL DIVISION RANKING - the thing this codebase did not have.
 *
 * champion.ts answers exactly one question, "who is first", and answers it
 * beautifully: points, goal difference, goals scored, then head-to-head over
 * the tied group with REMOVE AND RECOMPUTE, then a match. Promotion and
 * relegation need the same rigour applied at rank 16 and rank 3, so this
 * module reuses that machinery rather than restating it. buildTitleTable,
 * leadersOf and the recursion below are the SAME functions the title uses;
 * nothing here re-implements a points rule.
 *
 * WHAT MUST NEVER RANK A CLUB, and how each is excluded:
 *
 *   Team.name / localeCompare  never read; no name reaches this module.
 *                              computeStandings falls through to a name for
 *                              DISPLAY order, which is fine for a screen and
 *                              fatal for a relegation - a club's name is
 *                              mutable (a takeover rewrites it) and
 *                              localeCompare depends on the runtime's ICU
 *                              default, so two environments could relegate
 *                              two different clubs.
 *   teamId                     never compared. It appears only as a map key
 *                              and inside the returned groups.
 *   joinedAt / database order   never read. The caller may pass fixtures and
 *                              clubs in any order; every fold here is
 *                              order-independent.
 *   isBot / userId / balance    never read. A bot and a human on the same
 *                              points go down or stay up identically.
 *
 * A GROUP THAT SURVIVES ALL SIX CRITERIA IS A GENUINE TIE, and this module
 * says so by returning it as a tied group rather than inventing an order.
 * Whether that tie is worth playing for is outcomes.ts's question, not this
 * one's: this module reports the truth of the table, including the parts of
 * it that the table cannot separate.
 */
import { buildTitleTable, leadersOf, resolveHeadToHead, type TitleFixture, type TitleTableRow } from "../champion"

/**
 * One rung of the final ranking.
 *
 * `teamIds` holds ONE club when the criteria separated it, and several when
 * they did not. `firstRank` is the best position the rung occupies (1-based),
 * so a two-club tie at the top has firstRank 1 and occupies ranks 1 and 2.
 *
 * The clubs inside a tied rung are returned in NO MEANINGFUL ORDER. Any order
 * would be a lie about the fact that nothing separated them, and the one
 * thing a caller must never do is read the first element as "the higher".
 */
export interface RankingRung {
  firstRank: number
  teamIds: string[]
  /** How the rung above was separated from this one, for the audit trail. */
  via: "table" | "headToHead" | "tied"
}

/**
 * The division's clubs in finishing order, as far as the statistical chain
 * can take them.
 *
 * The algorithm is exactly the title's, applied repeatedly: take the leaders
 * of what is left, try to separate them head-to-head, emit, remove, repeat.
 * Termination is guaranteed because every pass emits at least one club and
 * therefore shrinks the remaining set.
 */
export function rankDivision(teamIds: string[], fixtures: TitleFixture[]): RankingRung[] {
  const countable = fixtures.filter((f) => f.homeScore !== null && f.awayScore !== null)

  // THE LEAGUE TABLE IS BUILT ONCE, OVER THE WHOLE DIVISION.
  //
  // This is not a detail. buildTitleTable only counts a fixture when BOTH its
  // clubs are in scope, so rebuilding it over "the clubs still to be placed"
  // would silently delete the champion's results from everybody else's
  // record - 4th place would be decided by a table that never happened.
  // Placing a club removes it from contention, never from history.
  const fullTable = new Map<string, TitleTableRow>()
  for (const row of buildTitleTable(teamIds, countable)) fullTable.set(row.teamId, row)

  const rungs: RankingRung[] = []
  let remaining = [...teamIds]
  let rank = 1

  while (remaining.length > 0) {
    const table: TitleTableRow[] = remaining.map((id) => fullTable.get(id)!).filter(Boolean)
    const leaders = leadersOf(table)

    if (leaders.length === 1) {
      rungs.push({ firstRank: rank, teamIds: [leaders[0].teamId], via: "table" })
      remaining = remaining.filter((id) => id !== leaders[0].teamId)
      rank += 1
      continue
    }

    // Level on points, goal difference and goals scored. Head-to-head is the
    // same remove-and-recompute procedure the title uses, and it is used here
    // for exactly the reason it exists there: an eliminated club's results
    // must not decide a place between two clubs still competing for it.
    const tiedIds = leaders.map((row) => row.teamId)
    const separated = separateGroup(tiedIds, countable)
    for (const step of separated) {
      rungs.push({ firstRank: rank, teamIds: step.teamIds, via: step.via })
      rank += step.teamIds.length
    }
    const placed = new Set(separated.flatMap((step) => step.teamIds))
    remaining = remaining.filter((id) => !placed.has(id))
  }

  return rungs
}

/**
 * Order a group that the full table could not separate, using head-to-head.
 *
 * Returns the group split into rungs, best first. A sub-group that head-to-head
 * also cannot separate comes back as one rung marked "tied" - the honest
 * answer, and the only input the boundary machinery ever acts on.
 */
function separateGroup(
  tiedTeamIds: string[],
  fixtures: TitleFixture[]
): { teamIds: string[]; via: "headToHead" | "tied" }[] {
  if (tiedTeamIds.length <= 1) {
    return [{ teamIds: [...tiedTeamIds], via: "headToHead" }]
  }

  const outcome = resolveHeadToHead(tiedTeamIds, fixtures)
  if (outcome.kind === "decider") {
    // Every criterion exhausted. These clubs are genuinely level.
    return [{ teamIds: [...tiedTeamIds], via: "tied" }]
  }
  if (outcome.kind === "empty") {
    return [{ teamIds: [...tiedTeamIds], via: "tied" }]
  }

  // One club came out on top of the mini-table. Place it, then start the
  // whole procedure again over the rest - which is what "remove and
  // recompute" means, and why the winner's results cannot go on influencing
  // the clubs it left behind.
  const winner = outcome.teamId
  const rest = tiedTeamIds.filter((id) => id !== winner)
  return [{ teamIds: [winner], via: "headToHead" }, ...separateGroup(rest, fixtures)]
}

/**
 * The finishing order as a flat list of clubs, 1-based by index.
 *
 * ONLY SAFE ON A FULLY SEPARATED RANKING. A tied rung has no order inside it,
 * so flattening one would invent the very thing this module refuses to
 * invent; callers must resolve boundaries first and pass the resolved
 * ranking, or ask `tiedRungs` and act on that instead.
 */
export function flattenRanking(rungs: RankingRung[]): string[] {
  for (const rung of rungs) {
    if (rung.teamIds.length > 1) {
      throw new Error(
        `Cannot flatten a ranking with an unresolved tie at rank ${rung.firstRank} (${rung.teamIds.length} clubs level)`
      )
    }
  }
  return rungs.map((rung) => rung.teamIds[0])
}

/** Every rung the statistical chain could not separate. */
export function tiedRungs(rungs: RankingRung[]): RankingRung[] {
  return rungs.filter((rung) => rung.teamIds.length > 1)
}

/** The rung occupying a given 1-based rank, or null if the ranking is shorter. */
export function rungAtRank(rungs: RankingRung[], rank: number): RankingRung | null {
  for (const rung of rungs) {
    if (rank >= rung.firstRank && rank < rung.firstRank + rung.teamIds.length) return rung
  }
  return null
}
