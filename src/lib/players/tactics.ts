import type { AttributeKey } from "./attributes"

// Every tactical instruction the manager can give. The critical rule
// throughout: a tactic never grants a flat bonus. It only changes WHICH
// attributes matter, and how much, when the engine resolves an event - so
// a tactic is only as good as the players asked to execute it.

function makeOption<const T extends readonly string[]>(options: T, fallback: T[number]) {
  return {
    options,
    default: fallback,
    is: (value: string | null | undefined): value is T[number] =>
      !!value && (options as readonly string[]).includes(value),
  }
}

export const MENTALITY_OPTIONS = ["veryDefensive", "defensive", "balanced", "attacking", "veryAttacking"] as const
export type Mentality = (typeof MENTALITY_OPTIONS)[number]
export const DEFAULT_MENTALITY: Mentality = "balanced"
export const mentality = makeOption(MENTALITY_OPTIONS, DEFAULT_MENTALITY)
export const isMentality = mentality.is

export const TEMPO_OPTIONS = ["slow", "normal", "fast"] as const
export type Tempo = (typeof TEMPO_OPTIONS)[number]
export const DEFAULT_TEMPO: Tempo = "normal"
export const isTempo = makeOption(TEMPO_OPTIONS, DEFAULT_TEMPO).is

export const PRESSING_OPTIONS = ["low", "normal", "high"] as const
export type Pressing = (typeof PRESSING_OPTIONS)[number]
export const DEFAULT_PRESSING: Pressing = "normal"
export const isPressing = makeOption(PRESSING_OPTIONS, DEFAULT_PRESSING).is

export const WIDTH_OPTIONS = ["narrow", "balanced", "wide"] as const
export type Width = (typeof WIDTH_OPTIONS)[number]
export const DEFAULT_WIDTH: Width = "balanced"
export const isWidth = makeOption(WIDTH_OPTIONS, DEFAULT_WIDTH).is

export const ATTACKING_STYLE_OPTIONS = [
  "counterAttack",
  "shortPassing",
  "directPlay",
  "widePlay",
  "centralPlay",
  "possession",
] as const
export type AttackingStyle = (typeof ATTACKING_STYLE_OPTIONS)[number]
export const DEFAULT_ATTACKING_STYLE: AttackingStyle = "shortPassing"
export const isAttackingStyle = makeOption(ATTACKING_STYLE_OPTIONS, DEFAULT_ATTACKING_STYLE).is

export const DEFENSIVE_LINE_OPTIONS = ["low", "normal", "high"] as const
export type DefensiveLine = (typeof DEFENSIVE_LINE_OPTIONS)[number]
export const DEFAULT_DEFENSIVE_LINE: DefensiveLine = "normal"
export const isDefensiveLine = makeOption(DEFENSIVE_LINE_OPTIONS, DEFAULT_DEFENSIVE_LINE).is

export const CREATIVE_FREEDOM_OPTIONS = ["disciplined", "balanced", "expressive"] as const
export type CreativeFreedom = (typeof CREATIVE_FREEDOM_OPTIONS)[number]
export const DEFAULT_CREATIVE_FREEDOM: CreativeFreedom = "balanced"
export const isCreativeFreedom = makeOption(CREATIVE_FREEDOM_OPTIONS, DEFAULT_CREATIVE_FREEDOM).is

export const DRIBBLE_FREQUENCY_OPTIONS = ["rarely", "balanced", "often"] as const
export type DribbleFrequency = (typeof DRIBBLE_FREQUENCY_OPTIONS)[number]
export const DEFAULT_DRIBBLE_FREQUENCY: DribbleFrequency = "balanced"
export const isDribbleFrequency = makeOption(DRIBBLE_FREQUENCY_OPTIONS, DEFAULT_DRIBBLE_FREQUENCY).is

export const PASSING_TYPE_OPTIONS = ["short", "mixed", "long"] as const
export type PassingType = (typeof PASSING_TYPE_OPTIONS)[number]
export const DEFAULT_PASSING_TYPE: PassingType = "mixed"
export const isPassingType = makeOption(PASSING_TYPE_OPTIONS, DEFAULT_PASSING_TYPE).is

export const ATTACK_DIRECTION_OPTIONS = ["left", "center", "right", "balanced"] as const
export type AttackDirection = (typeof ATTACK_DIRECTION_OPTIONS)[number]
export const DEFAULT_ATTACK_DIRECTION: AttackDirection = "balanced"
export const isAttackDirection = makeOption(ATTACK_DIRECTION_OPTIONS, DEFAULT_ATTACK_DIRECTION).is

export const FULLBACK_OVERLAP_OPTIONS = ["rarely", "normal", "often"] as const
export type FullbackOverlaps = (typeof FULLBACK_OVERLAP_OPTIONS)[number]
export const DEFAULT_FULLBACK_OVERLAPS: FullbackOverlaps = "normal"
export const isFullbackOverlaps = makeOption(FULLBACK_OVERLAP_OPTIONS, DEFAULT_FULLBACK_OVERLAPS).is

/** Everything the manager has set, as the engine consumes it. */
export interface TeamTactics {
  mentality: Mentality
  tempo: Tempo
  pressing: Pressing
  width: Width
  attackingStyle: AttackingStyle
  defensiveLine: DefensiveLine
  offsideTrap: boolean
  creativeFreedom: CreativeFreedom
  dribbleFrequency: DribbleFrequency
  passingType: PassingType
  attackDirection: AttackDirection
  fullbackOverlaps: FullbackOverlaps
}

export const DEFAULT_TACTICS: TeamTactics = {
  mentality: DEFAULT_MENTALITY,
  tempo: DEFAULT_TEMPO,
  pressing: DEFAULT_PRESSING,
  width: DEFAULT_WIDTH,
  attackingStyle: DEFAULT_ATTACKING_STYLE,
  defensiveLine: DEFAULT_DEFENSIVE_LINE,
  offsideTrap: false,
  creativeFreedom: DEFAULT_CREATIVE_FREEDOM,
  dribbleFrequency: DEFAULT_DRIBBLE_FREQUENCY,
  passingType: DEFAULT_PASSING_TYPE,
  attackDirection: DEFAULT_ATTACK_DIRECTION,
  fullbackOverlaps: DEFAULT_FULLBACK_OVERLAPS,
}

/** Normalizes a Team row's nullable tactic columns into a complete TeamTactics. */
export function readTeamTactics(team: {
  mentality?: string | null
  tempo?: string | null
  pressing?: string | null
  width?: string | null
  attackingStyle?: string | null
  defensiveLine?: string | null
  offsideTrap?: boolean | null
  creativeFreedom?: string | null
  dribbleFrequency?: string | null
  passingType?: string | null
  attackDirection?: string | null
  fullbackOverlaps?: string | null
}): TeamTactics {
  return {
    mentality: isMentality(team.mentality) ? team.mentality : DEFAULT_MENTALITY,
    tempo: isTempo(team.tempo) ? team.tempo : DEFAULT_TEMPO,
    pressing: isPressing(team.pressing) ? team.pressing : DEFAULT_PRESSING,
    width: isWidth(team.width) ? team.width : DEFAULT_WIDTH,
    attackingStyle: isAttackingStyle(team.attackingStyle) ? team.attackingStyle : DEFAULT_ATTACKING_STYLE,
    defensiveLine: isDefensiveLine(team.defensiveLine) ? team.defensiveLine : DEFAULT_DEFENSIVE_LINE,
    offsideTrap: team.offsideTrap ?? false,
    creativeFreedom: isCreativeFreedom(team.creativeFreedom) ? team.creativeFreedom : DEFAULT_CREATIVE_FREEDOM,
    dribbleFrequency: isDribbleFrequency(team.dribbleFrequency) ? team.dribbleFrequency : DEFAULT_DRIBBLE_FREQUENCY,
    passingType: isPassingType(team.passingType) ? team.passingType : DEFAULT_PASSING_TYPE,
    attackDirection: isAttackDirection(team.attackDirection) ? team.attackDirection : DEFAULT_ATTACK_DIRECTION,
    fullbackOverlaps: isFullbackOverlaps(team.fullbackOverlaps) ? team.fullbackOverlaps : DEFAULT_FULLBACK_OVERLAPS,
  }
}

// --- Which attributes each tactical choice actually depends on ----------------
// This is the whole point of the system: a tactic is a statement about which
// of your players' attributes are about to be tested, not a bonus.

/** The attributes an attacking style leans on, and how heavily. */
export const ATTACKING_STYLE_ATTRIBUTES: Record<AttackingStyle, Partial<Record<AttributeKey, number>>> = {
  counterAttack: {
    pace: 20,
    acceleration: 18,
    passing: 14,
    vision: 12,
    decisions: 12,
    attackingPositioning: 10,
    ballControl: 7,
    finishing: 7,
  },
  shortPassing: {
    passing: 22,
    technique: 18,
    ballControl: 16,
    vision: 14,
    decisions: 12,
    composure: 10,
    teamwork: 8,
  },
  directPlay: {
    longPassing: 22,
    passing: 12,
    strength: 16,
    heading: 16,
    aerialDuels: 14,
    attackingPositioning: 12,
    secondBallAwareness: 8,
  },
  widePlay: {
    crossing: 18,
    pace: 15,
    acceleration: 12,
    dribbling: 15,
    technique: 10,
    stamina: 8,
    // A cross is only worth as much as whoever is waiting on the end of it -
    // strong crossing with nobody dangerous in the box shouldn't be a
    // winning formula, per the product spec's explicit note.
    heading: 12,
    jumping: 5,
    attackingPositioning: 5,
  },
  centralPlay: {
    passing: 18,
    vision: 16,
    technique: 14,
    creativity: 14,
    ballControl: 12,
    dribbling: 10,
    composure: 8,
    decisions: 8,
  },
  possession: {
    passing: 20,
    technique: 17,
    ballControl: 16,
    composure: 13,
    decisions: 12,
    teamwork: 12,
    stamina: 10,
  },
}

export const PRESSING_ATTRIBUTES: Record<Exclude<Pressing, "normal">, Partial<Record<AttributeKey, number>>> = {
  high: { stamina: 20, workRate: 20, pace: 15, acceleration: 12, aggression: 11, anticipation: 12, teamwork: 10 },
  low: { defensivePositioning: 25, marking: 22, concentration: 20, anticipation: 18, teamwork: 15 },
}

export const DEFENSIVE_LINE_ATTRIBUTES: Record<Exclude<DefensiveLine, "normal">, Partial<Record<AttributeKey, number>>> = {
  // A high line lives or dies on defenders who can actually cover the space
  // behind it - slow center backs must genuinely be exposed.
  high: { pace: 26, acceleration: 20, anticipation: 20, defensivePositioning: 20, goalkeeperPositioning: 14 },
  low: { defensivePositioning: 24, marking: 22, tackling: 18, aerialDuels: 14, concentration: 12, strength: 10 },
}

export const OFFSIDE_TRAP_ATTRIBUTES: Partial<Record<AttributeKey, number>> = {
  defensivePositioning: 26,
  anticipation: 24,
  concentration: 22,
  teamwork: 18,
  leadership: 10,
}

export const CREATIVE_FREEDOM_ATTRIBUTES: Record<Exclude<CreativeFreedom, "balanced">, Partial<Record<AttributeKey, number>>> = {
  // Freedom only pays off for players who can handle it - creativity without
  // the technique to execute it is turnovers, per spec.
  expressive: { creativity: 22, technique: 20, vision: 18, dribbling: 15, decisions: 15, composure: 10 },
  disciplined: { teamwork: 30, decisions: 25, concentration: 25, defensivePositioning: 20 },
}

export const DRIBBLE_ATTRIBUTES: Partial<Record<AttributeKey, number>> = {
  dribbling: 24,
  technique: 20,
  ballControl: 18,
  agility: 14,
  acceleration: 12,
  // Knowing WHEN to take someone on matters as much as being able to.
  decisions: 12,
}

export const PASSING_TYPE_ATTRIBUTES: Record<Exclude<PassingType, "mixed">, Partial<Record<AttributeKey, number>>> = {
  long: { longPassing: 30, vision: 25, technique: 23, composure: 22 },
  short: { passing: 28, technique: 25, ballControl: 24, composure: 23 },
}

export const FULLBACK_OVERLAP_ATTRIBUTES: Partial<Record<AttributeKey, number>> = {
  stamina: 22,
  pace: 18,
  crossing: 18,
  ballControl: 14,
  workRate: 16,
  decisions: 12,
}

export const WIDTH_ATTRIBUTES: Record<Exclude<Width, "balanced">, Partial<Record<AttributeKey, number>>> = {
  wide: { crossing: 25, dribbling: 22, pace: 22, stamina: 16, acceleration: 15 },
  narrow: { passing: 24, technique: 22, vision: 20, composure: 18, dribbling: 16 },
}

export const TEMPO_ATTRIBUTES: Record<Exclude<Tempo, "normal">, Partial<Record<AttributeKey, number>>> = {
  fast: { technique: 22, passing: 22, decisions: 20, stamina: 18, ballControl: 18 },
  slow: { composure: 26, passing: 24, technique: 22, decisions: 20, teamwork: 8 },
}
