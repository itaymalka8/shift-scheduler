import type { GameBalanceConfig } from "./config"

export interface CrowdMatchState {
  minute: number
  homeGoals: number
  awayGoals: number
}

/**
 * The home crowd's influence on their own team, as a small multiplier
 * around 1. Deliberately capped hard (see CrowdConfig.maxEffect): an
 * ultras crowd should make late pressure feel real, never turn a weak team
 * into a strong one.
 *
 * Ultras get most of their value exactly where the spec asks for it -
 * when the home side is behind, and in the closing stages.
 */
export function calculateCrowdEffect(
  state: CrowdMatchState,
  fanType: "calm" | "ultras",
  attendance: number,
  capacity: number,
  config: GameBalanceConfig
): number {
  const { crowd } = config
  const fullness = capacity > 0 ? Math.min(1, attendance / capacity) : 0
  const attendanceFactor = 1 - crowd.attendanceWeight + crowd.attendanceWeight * fullness

  let intensity = fanType === "ultras" ? crowd.ultrasMultiplier : crowd.calmMultiplier
  intensity *= attendanceFactor

  if (state.minute >= crowd.lateMatchMinute) intensity *= crowd.lateMatchMultiplier
  if (state.homeGoals < state.awayGoals) intensity *= crowd.trailingBoost

  return 1 + crowd.maxEffect * Math.min(1, intensity)
}

/** Whether an ultras crowd caused a chargeable incident at this match. */
export function rollFanIncident(
  fanType: "calm" | "ultras",
  context: { lost: boolean; cardsAgainst: number; important: boolean },
  config: GameBalanceConfig,
  roll: number
): boolean {
  if (fanType !== "ultras") return false
  let chance = config.crowd.ultrasIncidentBaseChance
  if (context.lost) chance *= 1.5
  if (context.important) chance *= 1.4
  chance *= 1 + context.cardsAgainst * 0.12
  return roll < chance
}

export function fanIncidentFine(config: GameBalanceConfig, roll: number): number {
  const { incidentFineMin, incidentFineMax } = config.crowd
  const raw = incidentFineMin + roll * (incidentFineMax - incidentFineMin)
  return Math.round(raw / 1000) * 1000
}

/**
 * Momentum swings with the flow of the match but decays quickly and is
 * capped very low - it colors a match, it never decides one.
 */
export class Momentum {
  private value = 0

  constructor(private readonly config: GameBalanceConfig) {}

  decay(): void {
    this.value *= this.config.momentumDecay
  }

  scored(): void {
    this.value += this.config.momentumGoalSwing
  }

  conceded(): void {
    this.value += this.config.momentumConcedeSwing
  }

  redCard(): void {
    this.value += this.config.momentumRedCardSwing
  }

  missedPenalty(): void {
    this.value += this.config.momentumMissedPenaltySwing
  }

  /** Multiplier form, for feeding into a team's effective-ability multiplier. */
  multiplier(): number {
    const clamped = Math.max(-1, Math.min(1, this.value))
    return 1 + clamped * this.config.maxMomentumEffect
  }
}
