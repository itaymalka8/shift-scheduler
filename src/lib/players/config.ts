import type { PlayerPosition } from "./positions"

// Every number that shapes a generated squad lives here, in one place - a
// future balance pass (more/fewer players, a wider quality band, a
// different age curve) is a config edit, never a hunt through generation
// code or UI components for a hardcoded constant.

// --- Squad composition -----------------------------------------------------

export type BroadPositionGroup = "GK" | "CB" | "FB" | "MF" | "ATT"

// Which granular positions (see positions.ts) a broad group draws from, and
// the relative weight each gets when the group's slot count is distributed
// across them. Weights are proportions, not literal counts, so they still
// make sense if squadSize or a group's count changes later.
export const BROAD_GROUP_POSITIONS: Record<BroadPositionGroup, { position: PlayerPosition; weight: number }[]> = {
  GK: [{ position: "GK", weight: 1 }],
  CB: [{ position: "CB", weight: 1 }],
  FB: [
    { position: "RB", weight: 1 },
    { position: "LB", weight: 1 },
  ],
  MF: [
    { position: "CDM", weight: 1 },
    { position: "CM", weight: 2 },
    { position: "CAM", weight: 1 },
    { position: "RM", weight: 1 },
    { position: "LM", weight: 1 },
  ],
  ATT: [
    { position: "RW", weight: 1 },
    { position: "ST", weight: 2 },
    { position: "LW", weight: 1 },
  ],
}

// Reverse lookup of the table above - which broad group a granular position
// belongs to, used by the market-value position multiplier.
export const POSITION_TO_BROAD_GROUP: Record<PlayerPosition, BroadPositionGroup> = {
  GK: "GK",
  CB: "CB",
  RB: "FB",
  LB: "FB",
  CDM: "MF",
  CM: "MF",
  CAM: "MF",
  RM: "MF",
  LM: "MF",
  RW: "ATT",
  LW: "ATT",
  ST: "ATT",
}

// A flexible player's primary position is drawn from this pool - positions
// whose natural secondaries (see SECONDARY_POSITIONS in positions.ts) already
// cross into a different broad group, so "flexible" means genuinely useful
// in two different parts of the pitch, not just two nearby positions.
export const FLEXIBLE_PRIMARY_POOL: PlayerPosition[] = ["RB", "LB", "CDM", "CAM", "RM", "LM"]

export interface SquadCompositionConfig {
  squadSize: number
  groups: Record<BroadPositionGroup, number>
  flexibleCount: number
}

// 2 GK + 4 CB + 4 FB + 6 MF + 4 ATT + 2 flexible = 22.
export const DEFAULT_SQUAD_COMPOSITION: SquadCompositionConfig = {
  squadSize: 22,
  groups: { GK: 2, CB: 4, FB: 4, MF: 6, ATT: 4 },
  flexibleCount: 2,
}

// --- Player tiers ------------------------------------------------------------

export type PlayerTierId = "low" | "weak" | "squad" | "starter" | "quality" | "star" | "superstar"

export interface PlayerTierConfig {
  id: PlayerTierId
  min: number
  max: number
  labelKey: string
  cardStyle: string
}

// Overall -> tier thresholds, and the card treatment for each - both live
// together since a tier's whole identity (label + how its card looks) is one
// balance/design decision, not two.
export const PLAYER_TIERS: PlayerTierConfig[] = [
  { id: "low", min: 0, max: 49, labelKey: "player.tier.low", cardStyle: "plain-gray" },
  { id: "weak", min: 50, max: 59, labelKey: "player.tier.weak", cardStyle: "gray-outline" },
  { id: "squad", min: 60, max: 69, labelKey: "player.tier.squad", cardStyle: "clean-light" },
  { id: "starter", min: 70, max: 79, labelKey: "player.tier.starter", cardStyle: "purple-subtle" },
  { id: "quality", min: 80, max: 89, labelKey: "player.tier.quality", cardStyle: "purple-rich" },
  { id: "star", min: 90, max: 94, labelKey: "player.tier.star", cardStyle: "premium" },
  { id: "superstar", min: 95, max: 100, labelKey: "player.tier.superstar", cardStyle: "prestige" },
]

// --- New-team quality target --------------------------------------------------

export interface QualityConfig {
  overallRange: { min: number; max: number }
  potentialRange: { min: number; max: number }
  newTeamTargetQuality: number
  newTeamQualityVariance: number
  // Tier bands a new team's 22 slots are drawn from, and how many of each -
  // counts must sum to squadSize. This is what stops every new squad from
  // reading as 22 near-identical players: some slots are deliberately
  // strong, most are mid-table, a few are weak or raw youngsters.
  newTeamTierDistribution: { tier: PlayerTierId; count: number }[]
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  overallRange: { min: 0, max: 100 },
  potentialRange: { min: 0, max: 100 },
  newTeamTargetQuality: 1320,
  newTeamQualityVariance: 20, // final sum always lands in [1300, 1340]
  newTeamTierDistribution: [
    { tier: "quality", count: 2 }, // 2 leading players
    { tier: "starter", count: 5 }, // 5 good starting-XI players
    { tier: "squad", count: 7 }, // 7 squad players
    { tier: "weak", count: 5 }, // 5 weaker players
    { tier: "low", count: 3 }, // 3 raw, young-potential players
  ],
}

// --- Age ----------------------------------------------------------------------

export interface AgeBandConfig {
  min: number
  max: number
  weight: number
  // Max potential-over-overall gap a player from this band can roll - younger
  // bands get a wider gap so raw talents with a real ceiling can appear.
  maxPotentialGap: number
}

export const DEFAULT_AGE_BANDS: AgeBandConfig[] = [
  { min: 18, max: 21, weight: 0.25, maxPotentialGap: 28 },
  { min: 22, max: 25, weight: 0.3, maxPotentialGap: 16 },
  { min: 26, max: 29, weight: 0.3, maxPotentialGap: 6 },
  { min: 30, max: 33, weight: 0.15, maxPotentialGap: 1 },
]

// --- Preferred foot -------------------------------------------------------------

export const PREFERRED_FOOT_WEIGHTS: { foot: "right" | "left" | "both"; weight: number }[] = [
  { foot: "right", weight: 0.72 },
  { foot: "left", weight: 0.21 },
  { foot: "both", weight: 0.07 },
]

// --- Nationality ----------------------------------------------------------------

// Domestic-league launch: every generated player is Israeli for now. A
// future international-signing feature just widens this list.
export const DEFAULT_NATIONALITY_POOL: string[] = ["IL"]

// --- Market value -----------------------------------------------------------------

export interface MarketValueConfig {
  // Base value curve by overall: base = baseUnit * (overall / baseOverall) ^ exponent
  baseUnit: number
  baseOverall: number
  exponent: number
  // Age multiplier by band (index-aligned with ageCurveBands) - peak value
  // around a player's prime, discounted young (despite potential) and old.
  ageCurveBands: { maxAge: number; multiplier: number }[]
  potentialGapWeight: number // extra multiplier per point of (potential - overall)
  positionMultiplier: Record<BroadPositionGroup, number>
  tierMultiplier: Record<PlayerTierId, number>
  fitnessFloor: number // multiplier applied at 0 fitness; scales linearly to 1 at 100 fitness
  roundingUnit: number // final value rounds to the nearest multiple of this
}

export const DEFAULT_MARKET_VALUE_CONFIG: MarketValueConfig = {
  baseUnit: 900_000,
  baseOverall: 60,
  exponent: 4.2,
  ageCurveBands: [
    { maxAge: 20, multiplier: 0.85 },
    { maxAge: 23, multiplier: 1.0 },
    { maxAge: 29, multiplier: 1.15 },
    { maxAge: 32, multiplier: 0.9 },
    { maxAge: 99, multiplier: 0.65 },
  ],
  potentialGapWeight: 0.035,
  positionMultiplier: { GK: 0.75, CB: 0.85, FB: 0.9, MF: 1.0, ATT: 1.2 },
  tierMultiplier: {
    low: 0.9,
    weak: 0.95,
    squad: 1.0,
    starter: 1.05,
    quality: 1.15,
    star: 1.35,
    superstar: 1.7,
  },
  fitnessFloor: 0.7,
  roundingUnit: 10_000,
}

export const GAME_CURRENCY_SYMBOL = "₪"

// --- The one bundle generation code actually consumes ------------------------

export interface SquadGenerationConfig {
  composition: SquadCompositionConfig
  quality: QualityConfig
  ageBands: AgeBandConfig[]
  marketValue: MarketValueConfig
}

export const DEFAULT_SQUAD_GENERATION_CONFIG: SquadGenerationConfig = {
  composition: DEFAULT_SQUAD_COMPOSITION,
  quality: DEFAULT_QUALITY_CONFIG,
  ageBands: DEFAULT_AGE_BANDS,
  marketValue: DEFAULT_MARKET_VALUE_CONFIG,
}
