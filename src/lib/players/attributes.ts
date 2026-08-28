// Every attribute the product spec calls for, grouped exactly as the
// player-profile screen groups them. This is the single source of truth for
// "what attributes exist" - generation, Overall calculation, and the UI all
// read from here instead of repeating the list.

export const ATTACKING_ATTRIBUTES = ["shooting", "finishing", "longShots", "heading", "attackingPositioning"] as const
export const TECHNICAL_ATTRIBUTES = [
  "passing",
  "longPassing",
  "vision",
  "technique",
  "creativity",
  "dribbling",
  "ballControl",
  "crossing",
  "freeKicks",
  "penalties",
  "corners",
] as const
export const DEFENSIVE_ATTRIBUTES = [
  "tackling",
  "marking",
  "defensivePositioning",
  "interceptions",
  "aerialDuels",
] as const
export const PHYSICAL_ATTRIBUTES = ["pace", "acceleration", "strength", "stamina", "agility", "balance", "jumping"] as const
export const MENTAL_ATTRIBUTES = [
  "leadership",
  "composure",
  "decisions",
  "anticipation",
  "teamwork",
  "workRate",
  "concentration",
  "aggression",
  "experience",
  "secondBallAwareness",
] as const

export const OUTFIELD_ATTRIBUTES = [
  ...ATTACKING_ATTRIBUTES,
  ...TECHNICAL_ATTRIBUTES,
  ...DEFENSIVE_ATTRIBUTES,
  ...PHYSICAL_ATTRIBUTES,
  ...MENTAL_ATTRIBUTES,
] as const

export const GOALKEEPING_ATTRIBUTES = [
  "goalkeeping",
  "reflexes",
  "handling",
  "diving",
  "oneOnOne",
  "aerialAbility",
  "goalkeeperPositioning",
  "distribution",
  "penaltySaving",
] as const

// The subset of outfield/general attributes a goalkeeper still carries -
// passing/technique are populated for a keeper (they matter for playing out
// from the back) but don't feed GK Overall; composure/concentration/
// leadership do feed it - see position-weights.ts.
export const GOALKEEPER_SHARED_ATTRIBUTES = ["passing", "technique", "composure", "concentration", "leadership"] as const

export type AttackingAttribute = (typeof ATTACKING_ATTRIBUTES)[number]
export type TechnicalAttribute = (typeof TECHNICAL_ATTRIBUTES)[number]
export type DefensiveAttribute = (typeof DEFENSIVE_ATTRIBUTES)[number]
export type PhysicalAttribute = (typeof PHYSICAL_ATTRIBUTES)[number]
export type MentalAttribute = (typeof MENTAL_ATTRIBUTES)[number]
export type OutfieldAttribute = (typeof OUTFIELD_ATTRIBUTES)[number]
export type GoalkeepingAttribute = (typeof GOALKEEPING_ATTRIBUTES)[number]

export type AttributeKey = OutfieldAttribute | GoalkeepingAttribute

/** A player's full attribute set - every field 1-100, or null where genuinely not applicable to their role. */
export type PlayerAttributes = Partial<Record<AttributeKey, number | null>>

export const ATTRIBUTE_CATEGORIES = [
  { id: "attacking", labelKey: "attribute.category.attacking", keys: ATTACKING_ATTRIBUTES },
  { id: "technical", labelKey: "attribute.category.technical", keys: TECHNICAL_ATTRIBUTES },
  { id: "defensive", labelKey: "attribute.category.defensive", keys: DEFENSIVE_ATTRIBUTES },
  { id: "physical", labelKey: "attribute.category.physical", keys: PHYSICAL_ATTRIBUTES },
  { id: "mental", labelKey: "attribute.category.mental", keys: MENTAL_ATTRIBUTES },
] as const

export const GOALKEEPER_ATTRIBUTE_CATEGORIES = [
  { id: "goalkeeping", labelKey: "attribute.category.goalkeeping", keys: GOALKEEPING_ATTRIBUTES },
  { id: "technical", labelKey: "attribute.category.technical", keys: ["passing", "technique"] as const },
  { id: "mental", labelKey: "attribute.category.mental", keys: ["composure", "concentration", "leadership"] as const },
] as const

export function attributeLabelKey(key: AttributeKey): string {
  return `attribute.${key}`
}

// --- Score tiers (per-attribute display color, distinct from PLAYER_TIERS
// which grades a whole player's Overall) ---------------------------------

export interface AttributeScoreTier {
  min: number
  max: number
  labelKey: string
  colorClass: string
}

export const ATTRIBUTE_SCORE_TIERS: AttributeScoreTier[] = [
  { min: 1, max: 39, labelKey: "attribute.tier.veryWeak", colorClass: "bg-muted-foreground/40" },
  { min: 40, max: 54, labelKey: "attribute.tier.weak", colorClass: "bg-muted-foreground/60" },
  { min: 55, max: 64, labelKey: "attribute.tier.average", colorClass: "bg-slate-400" },
  { min: 65, max: 74, labelKey: "attribute.tier.good", colorClass: "bg-sky-500" },
  { min: 75, max: 84, labelKey: "attribute.tier.veryGood", colorClass: "bg-primary" },
  { min: 85, max: 94, labelKey: "attribute.tier.excellent", colorClass: "bg-primary" },
  { min: 95, max: 100, labelKey: "attribute.tier.elite", colorClass: "bg-amber-500" },
]

export function getAttributeScoreTier(score: number): AttributeScoreTier {
  const tier = ATTRIBUTE_SCORE_TIERS.find((t) => score >= t.min && score <= t.max)
  return tier ?? ATTRIBUTE_SCORE_TIERS[0]
}

const ALL_ATTRIBUTE_KEYS: AttributeKey[] = [...OUTFIELD_ATTRIBUTES, ...GOALKEEPING_ATTRIBUTES]

/** Picks every attribute field off a Prisma Player row into one PlayerAttributes object. */
export function extractPlayerAttributes(row: Record<string, unknown>): PlayerAttributes {
  const attributes: PlayerAttributes = {}
  for (const key of ALL_ATTRIBUTE_KEYS) {
    const value = row[key]
    attributes[key] = typeof value === "number" ? value : null
  }
  return attributes
}
