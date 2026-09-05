/**
 * THE CANONICAL AVAILABILITY CONTRACT. Pure: no Prisma, no clock, no I/O.
 *
 * ONE function decides whether a player may be selected, and one function
 * decides what their status reads as. Every caller - the squad API, the match
 * snapshot, the lineup repair service, the preflight validator, the UI - asks
 * THESE, never their own version. Before this module the rule existed in
 * three places as `status === "available"` and the status itself had no
 * writer, so all three agreed only by accident.
 *
 * WHAT IS AUTHORITATIVE AND WHAT IS DERIVED.
 *
 * The AUTHORITY is three persisted facts:
 *
 *   careerStatus            RETIRED is permanent and outranks everything.
 *   injuryMatchesRemaining  club fixtures still to sit out, injured.
 *   suspensionMatches       club fixtures still to sit out, banned.
 *
 * Player.status is DERIVED PRESENTATION STATE. It is stored - a directory
 * that filters on availability should not have to recompute it per row, and
 * the squad screen has read it for a long time - but it is never the truth.
 * Every write that moves one of the three counters writes derivePlayerStatus
 * of the NEW counters in the SAME statement, so the pair cannot drift.
 *
 * THAT IS WHY `status = "available"` WITH `suspensionMatches > 0` IS NOT A
 * STATE THIS ARCHITECTURE ALLOWS, not even transiently: there is no window
 * between the two writes because there is only one write. A source guard
 * asserts that no module updates a counter without also updating status.
 *
 * PRECEDENCE, and why it is this order: retirement is not a condition you
 * recover from; an injury is a physical fact about the player; a suspension
 * is an administrative one. A player who is both injured and banned reads as
 * injured, because that is the thing that has to heal - and both counters
 * still tick down independently, so the ban is not silently extended.
 */
import type { PlayerStatus } from "./tiers"

export { type PlayerStatus, isPlayerStatus } from "./tiers"

/** Everything - and only what - availability is decided from. */
export interface PlayerAvailabilityFacts {
  careerStatus: string
  injuryMatchesRemaining: number
  suspensionMatches: number
}

/** The stored `status` a set of facts must carry. The ONLY producer of that column. */
export function derivePlayerStatus(facts: PlayerAvailabilityFacts): PlayerStatus {
  if (facts.careerStatus !== "ACTIVE") return "unavailable"
  if (facts.injuryMatchesRemaining > 0) return "injured"
  if (facts.suspensionMatches > 0) return "suspended"
  return "available"
}

/**
 * May this player be picked for the next match?
 *
 * Derived from the facts, never from the stored status - so a row whose
 * status somehow went stale (an old row, a hand-edit, a future bug) still
 * cannot smuggle a banned player into an XI.
 */
export function isSelectable(facts: PlayerAvailabilityFacts): boolean {
  return derivePlayerStatus(facts) === "available"
}

/**
 * The update fragment for a player whose counters just moved.
 *
 * Returned as one object so a caller physically cannot write a counter
 * without the status that goes with it - the synchronisation is in the
 * shape of the data, not in a rule somebody has to remember.
 */
export interface AvailabilityUpdate {
  injuryMatchesRemaining: number
  suspensionMatches: number
  status: PlayerStatus
  injuryStatus?: string | null
}

export function availabilityUpdate(
  facts: PlayerAvailabilityFacts,
  injuryStatus?: string | null
): AvailabilityUpdate {
  const update: AvailabilityUpdate = {
    injuryMatchesRemaining: facts.injuryMatchesRemaining,
    suspensionMatches: facts.suspensionMatches,
    status: derivePlayerStatus(facts),
  }
  // Cleared the moment the injury is over, so a healed player never carries a
  // description of a knock they no longer have.
  if (injuryStatus !== undefined) update.injuryStatus = injuryStatus
  else if (facts.injuryMatchesRemaining === 0) update.injuryStatus = null
  return update
}

/** Serving one club fixture: both counters step down by one, never below zero. */
export function serveOneFixture(facts: PlayerAvailabilityFacts): PlayerAvailabilityFacts {
  return {
    careerStatus: facts.careerStatus,
    injuryMatchesRemaining: Math.max(0, facts.injuryMatchesRemaining - 1),
    suspensionMatches: Math.max(0, facts.suspensionMatches - 1),
  }
}

/** True when serving a fixture would actually change something - the reason to write at all. */
export function hasSomethingToServe(facts: PlayerAvailabilityFacts): boolean {
  return facts.injuryMatchesRemaining > 0 || facts.suspensionMatches > 0
}

// --- THE LEGAL XI ---------------------------------------------------------

/**
 * WHAT GOALX CONSIDERS A LEGAL STARTING XI. There is no second definition.
 *
 *   - exactly as many starters as the formation has slots (11 for every
 *     shipped formation, and for a custom one whatever it declares - the
 *     formation is the authority on its own shape, not a hard-coded 11)
 *   - every slot filled exactly once, no gaps and no duplicates
 *   - every starter belongs to THIS club
 *   - every starter is ACTIVE
 *   - every starter is selectable under the contract above
 *
 * Anything that fails is a reason to repair, and if repair cannot fix it, a
 * reason to refuse to simulate - never a reason to play the match short.
 */
export type LineupIllegality =
  | "WRONG_STARTER_COUNT"
  | "DUPLICATE_PLAYER"
  | "SLOT_GAP"
  | "FOREIGN_PLAYER"
  | "UNAVAILABLE_PLAYER"

export interface LineupStarter extends PlayerAvailabilityFacts {
  playerId: string
  teamId: string | null
  slotIndex: number
}

export interface LineupLegality {
  legal: boolean
  problems: LineupIllegality[]
  /** The offending players, so a caller can report which ones rather than "something". */
  offenders: string[]
}

export function validateLineup(teamId: string, slotCount: number, starters: readonly LineupStarter[]): LineupLegality {
  const problems = new Set<LineupIllegality>()
  const offenders = new Set<string>()

  if (starters.length !== slotCount) problems.add("WRONG_STARTER_COUNT")

  const seenPlayers = new Set<string>()
  const seenSlots = new Set<number>()
  for (const starter of starters) {
    if (seenPlayers.has(starter.playerId)) {
      problems.add("DUPLICATE_PLAYER")
      offenders.add(starter.playerId)
    }
    seenPlayers.add(starter.playerId)

    if (seenSlots.has(starter.slotIndex) || starter.slotIndex < 0 || starter.slotIndex >= slotCount) {
      problems.add("SLOT_GAP")
      offenders.add(starter.playerId)
    }
    seenSlots.add(starter.slotIndex)

    if (starter.teamId !== teamId) {
      problems.add("FOREIGN_PLAYER")
      offenders.add(starter.playerId)
    }
    if (!isSelectable(starter)) {
      problems.add("UNAVAILABLE_PLAYER")
      offenders.add(starter.playerId)
    }
  }

  if (seenSlots.size !== slotCount) problems.add("SLOT_GAP")

  return { legal: problems.size === 0, problems: [...problems], offenders: [...offenders] }
}
