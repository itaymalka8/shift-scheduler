/**
 * THE ROSTER FLOOR - the one place that decides whether a club can carry a
 * season, and the minimum number of players it is missing if it cannot.
 *
 * Pure. No Prisma, no clock, no I/O. It takes five integers and returns
 * arithmetic, so it can be called from inside any transaction that has
 * already taken its own locks, and unit-tested without a database.
 *
 * ================== THE FLOOR IS A MINIMUM, NOT A TARGET ==================
 *
 * 16 is the fewest players a club may carry, not the size replenishment
 * fills a squad to. A club with 16 players and no goalkeeper is short by two
 * even though it clears the count, and one with 12 perfectly-shaped players
 * is short by four even though every position is covered. The two questions
 * are different and neither caps the other, so the answer is the LARGER of
 * the two requirements - never their sum, because a generated goalkeeper
 * also increments the total.
 *
 * ========================== WHY 16, NOT 11 ================================
 *
 * 11 is the legal-XI minimum (Phase 3L) - it answers "can THIS match be
 * simulated". This answers "can this club survive a Mon/Wed/Sat season".
 * Against the engine's own numbers - 3 fixtures a week, 0.1 injuries per
 * side per match with a 1.75-match expected duration, and a full-90 costing
 * 15.5 fitness against 12 restored - the realistic bad week is 3-4 injuries
 * plus a suspension. 16 - 5 = 11: sixteen is exactly the point at which the
 * worst ordinary week still fields a legal XI, and it leaves six slots below
 * the 22 cap for youth and transfers to matter.
 */
import { MAX_ACTIVE_ROSTER_SIZE } from "./roster"
import { PLAYER_POSITIONS, POSITION_GROUP, type PlayerPosition, type PositionGroup } from "./positions"

/** Fewest ACTIVE owned players a club may carry into a season. */
export const MIN_ACTIVE_ROSTER = 16

/**
 * Per-group minimums. Keyed by the EXISTING POSITION_GROUP partition
 * (GK / DF / MF / FW) rather than a second naming of the same four buckets -
 * there is one partition of the twelve positions in this codebase and this
 * module reuses it.
 *
 * Two goalkeepers, not one, because SECONDARY_POSITIONS.GK is empty and no
 * outfield position lists GK as a secondary: a goalkeeper is the only
 * genuinely unsubstitutable role in the game. With one, a single injury
 * (1-4 matches) puts an outfielder in goal, where the engine rates him
 * through effectiveWeighted's fallback of 45 on every keeper attribute.
 */
export const GROUP_MINIMUM: Record<PositionGroup, number> = {
  GK: 2,
  DF: 4,
  MF: 4,
  FW: 2,
}

/** Iteration order for everything in this module - deterministic, never a Map order. */
export const ROSTER_GROUPS: readonly PositionGroup[] = ["GK", "DF", "MF", "FW"] as const

/**
 * The vocabulary a rejected transaction reports back. Deliberately the
 * product's words (DEF/MID/ATT) rather than the code's internal group keys,
 * so an error message never leaks an internal identifier.
 */
export type RosterFloorConstraint = "TOTAL" | "GK" | "DEF" | "MID" | "ATT"

const CONSTRAINT_OF_GROUP: Record<PositionGroup, RosterFloorConstraint> = {
  GK: "GK",
  DF: "DEF",
  MF: "MID",
  FW: "ATT",
}

export interface RosterCounts {
  total: number
  GK: number
  DF: number
  MF: number
  FW: number
}

export class UnknownPlayerPositionError extends Error {
  constructor(readonly position: string) {
    super(`Player position "${position}" belongs to no roster group`)
    this.name = "UnknownPlayerPositionError"
  }
}

/**
 * The group a position belongs to, or a thrown error.
 *
 * Player.primaryPosition is a String column, so a value that is not one of
 * the twelve canonical positions is reachable at runtime even though
 * POSITION_GROUP is exhaustive at compile time. Such a player must never be
 * silently dropped from the counts - that would let a club pass a coverage
 * floor it does not meet. It fails loudly instead.
 */
export function rosterGroupOf(position: string): PositionGroup {
  const group = (POSITION_GROUP as Record<string, PositionGroup | undefined>)[position]
  if (!group) throw new UnknownPlayerPositionError(position)
  return group
}

/**
 * Proves the four groups PARTITION the twelve positions - every position in
 * exactly one group, every group non-empty, and no group outside the four.
 *
 * This is what makes `gk + df + mf + fw === total` an identity rather than
 * an assumption, and the whole minimal-additions proof rests on it. A future
 * position added to PlayerPosition without a POSITION_GROUP entry is already
 * a compile error; one added to a FIFTH group would pass the compiler and is
 * caught here.
 */
export function assertPositionPartition(): void {
  const seen = new Set<PlayerPosition>()
  for (const position of PLAYER_POSITIONS) {
    const group = rosterGroupOf(position)
    if (!ROSTER_GROUPS.includes(group)) {
      throw new Error(`Position ${position} maps to group ${group}, which is not a roster group`)
    }
    if (seen.has(position)) throw new Error(`Position ${position} appears twice in PLAYER_POSITIONS`)
    seen.add(position)
  }
  for (const group of ROSTER_GROUPS) {
    if (!PLAYER_POSITIONS.some((position) => rosterGroupOf(position) === group)) {
      throw new Error(`Roster group ${group} has no positions`)
    }
  }
}

export const EMPTY_ROSTER_COUNTS: RosterCounts = { total: 0, GK: 0, DF: 0, MF: 0, FW: 0 }

/**
 * Counts a squad by group.
 *
 * The caller decides the population and it is always the same one: players
 * this club OWNS whose careerStatus is ACTIVE. Fitness, injuryMatchesRemaining,
 * suspensionMatches and Player.status are NOT inputs - temporary
 * unavailability is Phase 3L's territory and must never cause a permanent
 * player to be created.
 */
export function countRoster(players: readonly { primaryPosition: string }[]): RosterCounts {
  const counts: RosterCounts = { ...EMPTY_ROSTER_COUNTS }
  for (const player of players) {
    counts[rosterGroupOf(player.primaryPosition)]++
    counts.total++
  }
  return counts
}

/** How many players short each group is. Zero where the minimum is met. */
export function rosterDeficits(counts: RosterCounts): Record<PositionGroup, number> {
  return {
    GK: Math.max(0, GROUP_MINIMUM.GK - counts.GK),
    DF: Math.max(0, GROUP_MINIMUM.DF - counts.DF),
    MF: Math.max(0, GROUP_MINIMUM.MF - counts.MF),
    FW: Math.max(0, GROUP_MINIMUM.FW - counts.FW),
  }
}

export function positionalAdditions(counts: RosterCounts): number {
  const deficits = rosterDeficits(counts)
  return ROSTER_GROUPS.reduce((sum, group) => sum + deficits[group], 0)
}

export function countAdditions(counts: RosterCounts): number {
  return Math.max(0, MIN_ACTIVE_ROSTER - counts.total)
}

/**
 * THE MINIMUM NUMBER OF PLAYERS THAT MUST BE ADDED. Max, never sum.
 *
 * Adding k players, each placed in any group, satisfies the whole invariant
 * if and only if k >= positionalAdditions (enough to cover every group
 * minimum) AND k >= 16 - total (enough to reach the count floor). Both are
 * necessary, together they are sufficient - a positional addition also
 * increments the total, and a depth addition can go in any group - so the
 * least such k is their maximum. Summing them would double-count every
 * generated player.
 */
export function requiredAdditions(counts: RosterCounts): number {
  return Math.max(positionalAdditions(counts), countAdditions(counts))
}

/** Which floors this roster fails, in a stable order. Empty means it passes. */
export function failedConstraints(counts: RosterCounts): RosterFloorConstraint[] {
  const failed: RosterFloorConstraint[] = []
  if (counts.total < MIN_ACTIVE_ROSTER) failed.push("TOTAL")
  const deficits = rosterDeficits(counts)
  for (const group of ROSTER_GROUPS) {
    if (deficits[group] > 0) failed.push(CONSTRAINT_OF_GROUP[group])
  }
  return failed
}

export function meetsRosterFloor(counts: RosterCounts): boolean {
  return failedConstraints(counts).length === 0
}

export function withinCap(counts: RosterCounts): boolean {
  return counts.total <= MAX_ACTIVE_ROSTER_SIZE
}

/**
 * False for a club whose shape cannot be fixed without breaking the cap -
 * e.g. 22 players and no goalkeeper, which would need 24.
 *
 * The caller FAILS CLOSED on false. It must never exceed the cap, relax a
 * coverage rule, or remove an existing player to make room: releasing a
 * footballer is a sporting act, and the continuity mechanism never takes
 * one on a manager's behalf.
 *
 * The state is unreachable once the voluntary-departure guard ships:
 * retirement is the only involuntary loss, and each retirement that creates
 * a deficit also frees the slot needed to fill it (deficits <= retirees,
 * total drops by exactly the same number). It is still checked, because a
 * proof about future states is not a defined behaviour for a legacy one.
 */
export function isResolvableWithinCap(counts: RosterCounts): boolean {
  return counts.total + requiredAdditions(counts) <= MAX_ACTIVE_ROSTER_SIZE
}

/**
 * Depth cycle used only once every positional minimum is already met and the
 * club is still short of 16. DF, MF, DF, MF, FW is the 2:2:1 outfield shape
 * of 4-4-2 - the default formation - so depth arrives in the proportions the
 * club will actually field.
 *
 * NO GOALKEEPER APPEARS HERE. A third keeper is a wasted roster slot and a
 * wasted wage; goalkeepers are only ever generated to close an actual
 * deficit.
 */
export const DEPTH_CYCLE: readonly PositionGroup[] = ["DF", "MF", "DF", "MF", "FW"] as const

/**
 * The ordered list of groups to generate into - exactly requiredAdditions
 * long.
 *
 * Deficits first and goalkeepers before everything else, because a keeper is
 * the only role no other player can cover. Then defenders, midfielders,
 * attackers, then depth. The order is fixed and never data-dependent, so two
 * runs over the same roster produce the same plan.
 */
export function planAdditions(counts: RosterCounts): PositionGroup[] {
  const total = requiredAdditions(counts)
  const deficits = rosterDeficits(counts)
  const plan: PositionGroup[] = []
  for (const group of ROSTER_GROUPS) {
    for (let i = 0; i < deficits[group]; i++) plan.push(group)
  }
  let depthIndex = 0
  while (plan.length < total) {
    plan.push(DEPTH_CYCLE[depthIndex % DEPTH_CYCLE.length])
    depthIndex++
  }
  return plan
}

/** The counts this club would have if one owned ACTIVE player left. */
export function countsAfterDeparture(counts: RosterCounts, primaryPosition: string): RosterCounts {
  const group = rosterGroupOf(primaryPosition)
  return {
    ...counts,
    total: counts.total - 1,
    [group]: counts[group] - 1,
  }
}

/** Applying a plan, for tests and for asserting the post-generation state. */
export function countsAfterAdditions(counts: RosterCounts, plan: readonly PositionGroup[]): RosterCounts {
  const next: RosterCounts = { ...counts }
  for (const group of plan) {
    next[group]++
    next.total++
  }
  return next
}
