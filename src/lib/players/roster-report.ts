/**
 * READ-ONLY SUMMARIES OF A LEAGUE'S SQUAD SHAPE.
 *
 * The production audit needs to answer two questions before the season roll
 * ever runs: how old the league is (retirement is what empties squads), and
 * how much work the roster floor would have to do if it ran today. Both are
 * pure arithmetic over rows that have already been read, so they live here
 * where they can be tested, rather than inside a script that can only be
 * exercised by pointing it at a real database.
 *
 * Nothing in this file reads, writes, or knows about a database.
 */
import { MAX_ACTIVE_ROSTER_SIZE } from "./roster"
import { countRoster, isResolvableWithinCap, requiredAdditions, type RosterCounts } from "./roster-floor"

/** The ages the audit reports a headcount for, oldest last. */
export const AGE_THRESHOLDS: readonly number[] = [30, 34, 35, 36, 37, 38, 39, 40] as const

export interface AgeSummary {
  count: number
  min: number | null
  p25: number | null
  median: number | null
  p75: number | null
  p90: number | null
  max: number | null
  /** Headcount at or above each threshold, in AGE_THRESHOLDS order. */
  atOrAbove: { age: number; players: number; share: number }[]
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

/**
 * Age percentiles and threshold headcounts for a set of players. The caller
 * decides which players go in - the audit passes owned, career-ACTIVE ones,
 * because a retired or clubless player is not part of anybody's squad.
 */
export function summariseAges(ages: readonly number[]): AgeSummary {
  if (ages.length === 0) {
    return { count: 0, min: null, p25: null, median: null, p75: null, p90: null, max: null, atOrAbove: [] }
  }
  const sorted = [...ages].sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: sorted[0],
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    max: sorted[sorted.length - 1],
    atOrAbove: AGE_THRESHOLDS.map((age) => {
      const players = sorted.filter((value) => value >= age).length
      return { age, players, share: Math.round((players / sorted.length) * 1000) / 10 }
    }),
  }
}

export interface ClubRosterShape {
  teamId: string
  label: string
  counts: RosterCounts
  /** The minimum additions the floor would ask for, today. */
  needed: number
  /** False when the floor cannot be reached without breaching the cap. */
  resolvable: boolean
}

export interface RosterShapeSummary {
  clubs: ClubRosterShape[]
  clubsAtOrAboveFloor: number
  clubsBelowFloor: number
  playersThatWouldBeGenerated: number
  unresolvable: ClubRosterShape[]
  cap: number
}

/**
 * What the roster floor would do to a league if the season roll ran now.
 * This is a report, not a gate: it computes, prints and decides nothing.
 */
export function summariseRosterShape(
  clubs: readonly { teamId: string; label: string; squad: readonly { primaryPosition: string }[] }[]
): RosterShapeSummary {
  const shapes = clubs.map((club) => {
    const counts = countRoster(club.squad)
    return {
      teamId: club.teamId,
      label: club.label,
      counts,
      needed: requiredAdditions(counts),
      resolvable: isResolvableWithinCap(counts),
    }
  })
  const below = shapes.filter((shape) => shape.needed > 0)
  return {
    clubs: shapes,
    clubsAtOrAboveFloor: shapes.length - below.length,
    clubsBelowFloor: below.length,
    playersThatWouldBeGenerated: shapes.reduce((sum, shape) => sum + shape.needed, 0),
    unresolvable: shapes.filter((shape) => !shape.resolvable),
    cap: MAX_ACTIVE_ROSTER_SIZE,
  }
}
