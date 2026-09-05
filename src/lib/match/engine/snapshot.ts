import type { PlayerAttributes } from "@/lib/players/attributes"
import type { PlayerPosition } from "@/lib/players/positions"
import type { TeamTactics } from "@/lib/players/tactics"
import type { FormationSlot } from "@/lib/players/formations"

/**
 * A frozen picture of both teams at kickoff. The engine reads ONLY this -
 * so a squad or tactics change made after a match has started can never
 * retroactively alter that match's simulation.
 */

export interface SnapshotPlayer {
  id: string
  name: string
  primaryPosition: PlayerPosition
  secondaryPositions: PlayerPosition[]
  /** The slot in the formation this player starts in; null for bench. */
  slotIndex: number | null
  /** The role of that slot - what they're actually being asked to play. */
  assignedRole: PlayerPosition | null
  attributes: PlayerAttributes
  /** Cached Overall, for display only - never used to resolve an event. */
  overall: number
  fitness: number
}

export interface SnapshotTeam {
  teamId: string
  name: string
  starters: SnapshotPlayer[]
  bench: SnapshotPlayer[]
  formationSlots: FormationSlot[]
  tactics: TeamTactics
  captainId: string | null
  penaltyTakerId: string | null
  freeKickTakerId: string | null
  cornerTakerId: string | null
}

export interface MatchSnapshot {
  fixtureId: string
  seed: string
  home: SnapshotTeam
  away: SnapshotTeam
  /** Home crowd context. Inert when neutralVenue is true - see below. */
  attendance: number
  stadiumCapacity: number
  fanType: "calm" | "ultras"
  /**
   * A neutral ground: NEITHER side gets home advantage.
   *
   * Only a championship decider sets this. It is the whole of "neutral
   * venue" as far as the simulation is concerned, because home advantage in
   * this engine is exactly two things and both are gated on `side.isHome`:
   * the flat config.homeAdvantage multiplier, and the home crowd effect.
   * With this true, neither is applied, so `home`/`away` become nothing but
   * database roles and the crowd fields above have no sporting effect.
   *
   * Optional, and absent means false, so every existing snapshot and every
   * league fixture behaves exactly as before - byte-identical for a given
   * seed. There is a test asserting precisely that.
   */
  neutralVenue?: boolean
}
