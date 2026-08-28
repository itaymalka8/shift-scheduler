// The single Game Balance Config. Every number the match engine uses lives
// here - no magic constants buried inside engine functions - so the whole
// game can be rebalanced without touching engine logic.

export interface GameBalanceConfig {
  /** Possession sequences attempted per simulated match, before tempo adjusts it. */
  basePossessionsPerMatch: number
  tempoPossessionModifier: Record<"slow" | "normal" | "fast", number>

  /** Home advantage, applied as a small multiplier to the home side's effective ability. */
  homeAdvantage: number

  /** How strongly the two sides' phase qualities translate into winning a duel. */
  contestSharpness: number

  /** Controlled randomness: every contest gets a roll in [-range, +range] added to its odds. */
  randomnessRange: number

  /** Probability an attacking sequence survives each stage, at parity. */
  baseAdvanceChance: number
  baseChanceConversion: Record<ChanceQuality, number>
  /** Share of shots that at least hit the target, at parity. */
  baseOnTargetChance: number

  /** Chance an attacking sequence ends in a set piece rather than open play. */
  cornerChance: number
  freeKickChance: number
  penaltyChance: number

  /** Fouls/cards. */
  baseFoulChance: number
  yellowCardChanceOnFoul: number
  redCardChanceOnFoul: number
  secondYellowIsRed: boolean

  /** Injuries. */
  baseInjuryChancePerMatch: number

  /** Offside. */
  baseOffsideChance: number
  offsideTrapBonus: number

  /** Energy drain per possession, before per-player modifiers. */
  baseEnergyDrainPerPossession: number
  pressingEnergyMultiplier: Record<"low" | "normal" | "high", number>
  tempoEnergyMultiplier: Record<"slow" | "normal" | "fast", number>
  /** How much Stamina offsets energy drain (0 = none, 1 = fully). */
  staminaEnergyProtection: number
  /** How far low energy can drag an attribute down, as a fraction. */
  maxFatiguePenalty: number

  /** Crowd. */
  crowd: CrowdConfig

  /** Momentum. */
  momentumDecay: number
  momentumGoalSwing: number
  momentumConcedeSwing: number
  momentumRedCardSwing: number
  momentumMissedPenaltySwing: number
  /** Deliberately small - momentum must never become the dominant factor. */
  maxMomentumEffect: number

  /** Captain influence, only applied in pressure moments. */
  captainMaxEffect: number

  /** How far being a man down actually degrades a team, per missing player. */
  playerShortPenalty: number

  /** How much position mismatch costs a player, at worst. */
  maxPositionMismatchPenalty: number

  /** How strongly tactical fit and tactical interaction move phase quality. */
  maxTacticalFitEffect: number
  maxTacticalInteractionEffect: number

  /** Mentality's structural effect: attacking commits more bodies forward. */
  mentalityAttackWeight: Record<Mentality5, number>
  mentalityDefenseWeight: Record<Mentality5, number>
}

export type Mentality5 = "veryDefensive" | "defensive" | "balanced" | "attacking" | "veryAttacking"

export type ChanceQuality = "lowQuality" | "mediumQuality" | "highQuality" | "oneOnOne" | "header" | "longShot" | "setPiece"

export interface CrowdConfig {
  /** Max effective-ability swing the crowd can produce, either way. */
  maxEffect: number
  /** How much a full stadium counts vs an empty one. */
  attendanceWeight: number
  ultrasMultiplier: number
  calmMultiplier: number
  /** Crowd influence ramps up in the closing stages. */
  lateMatchMinute: number
  lateMatchMultiplier: number
  /** Extra push when the home side is behind and needs one. */
  trailingBoost: number
  /** Per-match chance of a fan incident for an ultras crowd, before modifiers. */
  ultrasIncidentBaseChance: number
  incidentFineMin: number
  incidentFineMax: number
}

export const DEFAULT_GAME_BALANCE_CONFIG: GameBalanceConfig = {
  basePossessionsPerMatch: 108,
  tempoPossessionModifier: { slow: 0.88, normal: 1, fast: 1.14 },

  homeAdvantage: 1.085,

  contestSharpness: 0.055,
  randomnessRange: 0.16,

  baseAdvanceChance: 0.5,
  baseChanceConversion: {
    lowQuality: 0.07,
    mediumQuality: 0.16,
    highQuality: 0.34,
    oneOnOne: 0.5,
    header: 0.21,
    longShot: 0.08,
    setPiece: 0.14,
  },
  baseOnTargetChance: 0.42,

  cornerChance: 0.16,
  freeKickChance: 0.05,
  penaltyChance: 0.0045,

  baseFoulChance: 0.2,
  yellowCardChanceOnFoul: 0.14,
  redCardChanceOnFoul: 0.0012,
  secondYellowIsRed: true,

  baseInjuryChancePerMatch: 0.1,

  baseOffsideChance: 0.045,
  offsideTrapBonus: 0.03,

  baseEnergyDrainPerPossession: 0.62,
  pressingEnergyMultiplier: { low: 0.85, normal: 1, high: 1.28 },
  tempoEnergyMultiplier: { slow: 0.9, normal: 1, fast: 1.18 },
  staminaEnergyProtection: 0.45,
  maxFatiguePenalty: 0.25,

  crowd: {
    maxEffect: 0.05,
    attendanceWeight: 0.7,
    ultrasMultiplier: 1,
    calmMultiplier: 0.35,
    lateMatchMinute: 75,
    lateMatchMultiplier: 1.6,
    trailingBoost: 1.4,
    ultrasIncidentBaseChance: 0.035,
    incidentFineMin: 15_000,
    incidentFineMax: 60_000,
  },

  momentumDecay: 0.93,
  momentumGoalSwing: 0.35,
  momentumConcedeSwing: -0.28,
  momentumRedCardSwing: -0.4,
  momentumMissedPenaltySwing: -0.25,
  maxMomentumEffect: 0.035,

  captainMaxEffect: 0.04,

  playerShortPenalty: 0.085,

  maxPositionMismatchPenalty: 0.28,

  maxTacticalFitEffect: 0.16,
  maxTacticalInteractionEffect: 0.1,

  mentalityAttackWeight: {
    veryDefensive: 0.78,
    defensive: 0.89,
    balanced: 1,
    attacking: 1.11,
    veryAttacking: 1.22,
  },
  mentalityDefenseWeight: {
    veryDefensive: 1.2,
    defensive: 1.1,
    balanced: 1,
    attacking: 0.91,
    veryAttacking: 0.82,
  },
}
