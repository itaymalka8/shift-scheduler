/**
 * WHICH TABLE POSITIONS MEAN DIFFERENT THINGS - the whole basis for deciding
 * when a tie is worth a match and when it is just a tie.
 *
 * Pure: no Prisma, no clock, no config lookup beyond the tier constants it is
 * handed. Every rule below is the approved Phase 3Q sporting contract,
 * expressed once so that the ranking resolver, the boundary machinery and the
 * movement calculation cannot each hold a slightly different copy of it.
 *
 * THE RULE THAT MATTERS: a fixture is created ONLY when the clubs that are
 * level would otherwise receive DIFFERENT sporting outcomes. Two clubs tied
 * for 18th both go down whatever happens between them, so nothing is played -
 * this game does not manufacture a full table order it has no use for. Two
 * clubs tied for 3rd in a tier 2 group are contesting a different playoff
 * opponent, which IS a different outcome, so they play.
 */

/** Tier 1's last safe position. 17th, 18th, 19th and 20th go down. */
export const TIER1_LAST_SAFE_RANK = 16

/** How many clubs leave tier 1, and therefore how many arrive. */
export const RELEGATION_COUNT = 4

/** Tier 2's promotion places: 1 automatic, then the 2v3 cross-group bracket. */
export const TIER2_AUTO_PROMOTION_RANK = 1
export const TIER2_PLAYOFF_HIGH_RANK = 2
export const TIER2_PLAYOFF_LOW_RANK = 3

/** Clubs promoted from tier 2 in total: A1, B1 and the two bracket winners. */
export const PROMOTION_COUNT = 4

/** Every league division of a country's pyramid, as the movement code sees it. */
export interface DivisionShape {
  divisionId: string
  tier: number
  /** "" for a single-division tier; "A"/"B" for tier 2's parallel groups. */
  group: string
}

/**
 * The ranks whose ties must be settled on the field, for one division.
 *
 * Each entry is the LAST RANK OF THE UPPER OUTCOME CLASS - so 16 names the
 * safe|relegated line, and 2 names the line between "plays B3" and "plays B2".
 * Rank 1 is deliberately ABSENT from every list: the title boundary is owned
 * by the existing championship machinery (resolveDivisionTitle ->
 * ensureTitleDecider / ensureChampionshipPlayoff), and a tier 2 group's rank 1
 * is simultaneously its title and its automatic promotion - ONE tie, ONE
 * fixture. Listing it here would create a second decider for the same tie.
 */
export function boundaryRanksFor(division: DivisionShape): number[] {
  if (division.tier === 1) return [TIER1_LAST_SAFE_RANK]
  if (division.tier === 2) return [TIER2_PLAYOFF_HIGH_RANK, TIER2_PLAYOFF_LOW_RANK]
  // No tier 3 exists, so nothing is relegated out of tier 2 and no other tier
  // has an outcome boundary to defend. A tier added later declares its own.
  return []
}

/**
 * Does a group of clubs occupying consecutive ranks straddle a boundary?
 *
 * `firstRank` is the best position the tied group occupies (1-based); the
 * group fills `firstRank .. firstRank + size - 1`. A boundary at rank r sits
 * BETWEEN r and r + 1, so the group straddles it when it contains both.
 */
export function straddlesBoundary(firstRank: number, size: number, boundaryRank: number): boolean {
  const lastRank = firstRank + size - 1
  return firstRank <= boundaryRank && lastRank > boundaryRank
}

/**
 * How many of a tied group's clubs take the upper side of a boundary.
 *
 * The clubs above the group already hold `firstRank - 1` of the upper places,
 * so the group is playing for the rest. Never negative, never more than the
 * group holds - a group that does not straddle the boundary is not asked.
 */
export function slotsAboveBoundary(firstRank: number, size: number, boundaryRank: number): number {
  const taken = firstRank - 1
  return Math.min(Math.max(boundaryRank - taken, 0), size)
}
