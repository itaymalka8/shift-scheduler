import type { PlayerPosition } from "./positions"

export interface FormationSlot {
  role: PlayerPosition
  x: number
  y: number
}

// Adding a formation later is just adding an entry here - nothing else in
// the system hardcodes the formation list. Coordinates are percentages of
// the attacking half-view pitch: x 0(left)..100(right), y 0(own goal)..100
// (opponent goal).
export const FORMATIONS = {
  "4-4-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "RM", x: 82, y: 55 },
    { role: "CM", x: 60, y: 52 },
    { role: "CM", x: 40, y: 52 },
    { role: "LM", x: 18, y: 55 },
    { role: "ST", x: 62, y: 82 },
    { role: "ST", x: 38, y: 82 },
  ],
  "4-3-3": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "CDM", x: 50, y: 45 },
    { role: "CM", x: 68, y: 55 },
    { role: "CM", x: 32, y: 55 },
    { role: "RW", x: 80, y: 80 },
    { role: "ST", x: 50, y: 85 },
    { role: "LW", x: 20, y: 80 },
  ],
  "4-2-3-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "CDM", x: 62, y: 42 },
    { role: "CDM", x: 38, y: 42 },
    { role: "RW", x: 78, y: 65 },
    { role: "CAM", x: 50, y: 62 },
    { role: "LW", x: 22, y: 65 },
    { role: "ST", x: 50, y: 85 },
  ],
  "4-1-4-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "CDM", x: 50, y: 38 },
    { role: "RM", x: 82, y: 60 },
    { role: "CM", x: 60, y: 58 },
    { role: "CM", x: 40, y: 58 },
    { role: "LM", x: 18, y: 60 },
    { role: "ST", x: 50, y: 85 },
  ],
  "4-3-2-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "CDM", x: 50, y: 42 },
    { role: "CM", x: 68, y: 52 },
    { role: "CM", x: 32, y: 52 },
    { role: "CAM", x: 64, y: 70 },
    { role: "CAM", x: 36, y: 70 },
    { role: "ST", x: 50, y: 87 },
  ],
  "4-1-2-1-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "CDM", x: 50, y: 38 },
    { role: "CM", x: 70, y: 55 },
    { role: "CM", x: 30, y: 55 },
    { role: "CAM", x: 50, y: 68 },
    { role: "ST", x: 62, y: 85 },
    { role: "ST", x: 38, y: 85 },
  ],
  "4-2-2-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "CDM", x: 62, y: 42 },
    { role: "CDM", x: 38, y: 42 },
    { role: "RM", x: 78, y: 65 },
    { role: "LM", x: 22, y: 65 },
    { role: "ST", x: 62, y: 85 },
    { role: "ST", x: 38, y: 85 },
  ],
  "4-5-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "RM", x: 86, y: 55 },
    { role: "CM", x: 66, y: 50 },
    { role: "CDM", x: 50, y: 45 },
    { role: "CM", x: 34, y: 50 },
    { role: "LM", x: 14, y: 55 },
    { role: "ST", x: 50, y: 85 },
  ],
  "4-4-1-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 82, y: 25 },
    { role: "CB", x: 62, y: 22 },
    { role: "CB", x: 38, y: 22 },
    { role: "LB", x: 18, y: 25 },
    { role: "RM", x: 82, y: 52 },
    { role: "CM", x: 60, y: 48 },
    { role: "CM", x: 40, y: 48 },
    { role: "LM", x: 18, y: 52 },
    { role: "CAM", x: 50, y: 70 },
    { role: "ST", x: 50, y: 87 },
  ],
  "3-5-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "CB", x: 70, y: 22 },
    { role: "CB", x: 50, y: 20 },
    { role: "CB", x: 30, y: 22 },
    { role: "RM", x: 88, y: 50 },
    { role: "CDM", x: 60, y: 45 },
    { role: "CM", x: 40, y: 52 },
    { role: "CM", x: 60, y: 58 },
    { role: "LM", x: 12, y: 50 },
    { role: "ST", x: 62, y: 82 },
    { role: "ST", x: 38, y: 82 },
  ],
  "3-4-3": [
    { role: "GK", x: 50, y: 8 },
    { role: "CB", x: 70, y: 22 },
    { role: "CB", x: 50, y: 20 },
    { role: "CB", x: 30, y: 22 },
    { role: "RM", x: 85, y: 52 },
    { role: "CM", x: 60, y: 50 },
    { role: "CM", x: 40, y: 50 },
    { role: "LM", x: 15, y: 52 },
    { role: "RW", x: 78, y: 82 },
    { role: "ST", x: 50, y: 86 },
    { role: "LW", x: 22, y: 82 },
  ],
  "3-4-2-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "CB", x: 70, y: 22 },
    { role: "CB", x: 50, y: 20 },
    { role: "CB", x: 30, y: 22 },
    { role: "RM", x: 85, y: 50 },
    { role: "CM", x: 60, y: 48 },
    { role: "CM", x: 40, y: 48 },
    { role: "LM", x: 15, y: 50 },
    { role: "CAM", x: 64, y: 70 },
    { role: "CAM", x: 36, y: 70 },
    { role: "ST", x: 50, y: 87 },
  ],
  "3-4-1-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "CB", x: 70, y: 22 },
    { role: "CB", x: 50, y: 20 },
    { role: "CB", x: 30, y: 22 },
    { role: "RM", x: 85, y: 50 },
    { role: "CM", x: 60, y: 48 },
    { role: "CM", x: 40, y: 48 },
    { role: "LM", x: 15, y: 50 },
    { role: "CAM", x: 50, y: 68 },
    { role: "ST", x: 62, y: 86 },
    { role: "ST", x: 38, y: 86 },
  ],
  "3-2-4-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "CB", x: 70, y: 22 },
    { role: "CB", x: 50, y: 20 },
    { role: "CB", x: 30, y: 22 },
    { role: "CDM", x: 62, y: 42 },
    { role: "CDM", x: 38, y: 42 },
    { role: "RM", x: 84, y: 66 },
    { role: "CAM", x: 62, y: 66 },
    { role: "CAM", x: 38, y: 66 },
    { role: "LM", x: 16, y: 66 },
    { role: "ST", x: 50, y: 87 },
  ],
  "3-1-4-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "CB", x: 70, y: 22 },
    { role: "CB", x: 50, y: 20 },
    { role: "CB", x: 30, y: 22 },
    { role: "CDM", x: 50, y: 38 },
    { role: "RM", x: 84, y: 58 },
    { role: "CM", x: 62, y: 56 },
    { role: "CM", x: 38, y: 56 },
    { role: "LM", x: 16, y: 58 },
    { role: "ST", x: 62, y: 85 },
    { role: "ST", x: 38, y: 85 },
  ],
  "5-3-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 88, y: 28 },
    { role: "CB", x: 66, y: 20 },
    { role: "CB", x: 50, y: 18 },
    { role: "CB", x: 34, y: 20 },
    { role: "LB", x: 12, y: 28 },
    { role: "CM", x: 68, y: 55 },
    { role: "CM", x: 50, y: 52 },
    { role: "CM", x: 32, y: 55 },
    { role: "ST", x: 62, y: 82 },
    { role: "ST", x: 38, y: 82 },
  ],
  "5-4-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 88, y: 28 },
    { role: "CB", x: 66, y: 20 },
    { role: "CB", x: 50, y: 18 },
    { role: "CB", x: 34, y: 20 },
    { role: "LB", x: 12, y: 28 },
    { role: "RM", x: 82, y: 55 },
    { role: "CM", x: 60, y: 52 },
    { role: "CM", x: 40, y: 52 },
    { role: "LM", x: 18, y: 55 },
    { role: "ST", x: 50, y: 84 },
  ],
  "5-2-3": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 88, y: 28 },
    { role: "CB", x: 66, y: 20 },
    { role: "CB", x: 50, y: 18 },
    { role: "CB", x: 34, y: 20 },
    { role: "LB", x: 12, y: 28 },
    { role: "CM", x: 62, y: 50 },
    { role: "CM", x: 38, y: 50 },
    { role: "RW", x: 78, y: 80 },
    { role: "ST", x: 50, y: 85 },
    { role: "LW", x: 22, y: 80 },
  ],
  "5-2-1-2": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 88, y: 28 },
    { role: "CB", x: 66, y: 20 },
    { role: "CB", x: 50, y: 18 },
    { role: "CB", x: 34, y: 20 },
    { role: "LB", x: 12, y: 28 },
    { role: "CM", x: 62, y: 48 },
    { role: "CM", x: 38, y: 48 },
    { role: "CAM", x: 50, y: 68 },
    { role: "ST", x: 62, y: 86 },
    { role: "ST", x: 38, y: 86 },
  ],
  "5-3-1-1": [
    { role: "GK", x: 50, y: 8 },
    { role: "RB", x: 88, y: 28 },
    { role: "CB", x: 66, y: 20 },
    { role: "CB", x: 50, y: 18 },
    { role: "CB", x: 34, y: 20 },
    { role: "LB", x: 12, y: 28 },
    { role: "CM", x: 68, y: 50 },
    { role: "CDM", x: 50, y: 45 },
    { role: "CM", x: 32, y: 50 },
    { role: "CAM", x: 50, y: 70 },
    { role: "ST", x: 50, y: 87 },
  ],
} as const satisfies Record<string, readonly FormationSlot[]>

export type FormationId = keyof typeof FORMATIONS
export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[]

export const DEFAULT_FORMATION: FormationId = "4-4-2"

/** A team may instead store its own slot layout - see CUSTOM_FORMATION_ID. */
export const CUSTOM_FORMATION_ID = "custom"

export function isFormationId(value: string | null | undefined): value is FormationId {
  return !!value && value in FORMATIONS
}

// --- Custom formations -------------------------------------------------------

// Legal y-bands a manager may place an outfield player in. The keeper is
// pinned to their own goal area, and the top of the pitch stops short of
// the opponent's six-yard box so a manager can't stack ten players in the
// box, per the product spec.
export const CUSTOM_FORMATION_ZONES = [
  { id: "defense", labelKey: "formation.zone.defense", minY: 15, maxY: 32 },
  { id: "deepMidfield", labelKey: "formation.zone.deepMidfield", minY: 32, maxY: 46 },
  { id: "midfield", labelKey: "formation.zone.midfield", minY: 46, maxY: 62 },
  { id: "attackingMidfield", labelKey: "formation.zone.attackingMidfield", minY: 62, maxY: 76 },
  { id: "attack", labelKey: "formation.zone.attack", minY: 76, maxY: 88 },
] as const

export const GOALKEEPER_SLOT: FormationSlot = { role: "GK", x: 50, y: 8 }
export const CUSTOM_OUTFIELD_MIN_Y = 15
export const CUSTOM_OUTFIELD_MAX_Y = 88
export const CUSTOM_MIN_X = 6
export const CUSTOM_MAX_X = 94

/**
 * Derives the position role for a freely-placed outfield slot from where
 * the manager actually dropped it - so a custom formation's players still
 * get real roles (and therefore real position-suitability checks) rather
 * than being untyped dots on a pitch.
 */
export function deriveRoleFromPosition(x: number, y: number): PlayerPosition {
  const isWide = x >= 72 || x <= 28
  const isRight = x >= 72

  if (y < 32) {
    if (isWide) return isRight ? "RB" : "LB"
    return "CB"
  }
  if (y < 46) return "CDM"
  if (y < 62) {
    if (isWide) return isRight ? "RM" : "LM"
    return "CM"
  }
  if (y < 76) {
    if (isWide) return isRight ? "RW" : "LW"
    return "CAM"
  }
  if (isWide) return isRight ? "RW" : "LW"
  return "ST"
}

export function isValidCustomSlot(x: number, y: number): boolean {
  return x >= CUSTOM_MIN_X && x <= CUSTOM_MAX_X && y >= CUSTOM_OUTFIELD_MIN_Y && y <= CUSTOM_OUTFIELD_MAX_Y
}

/** Validates and normalizes a stored custom formation into 11 usable slots. */
export function parseCustomFormation(value: unknown): FormationSlot[] | null {
  if (!Array.isArray(value) || value.length !== 10) return null
  const slots: FormationSlot[] = [GOALKEEPER_SLOT]
  for (const entry of value) {
    const x = Number((entry as { x?: unknown })?.x)
    const y = Number((entry as { y?: unknown })?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !isValidCustomSlot(x, y)) return null
    slots.push({ role: deriveRoleFromPosition(x, y), x, y })
  }
  return slots
}

/** The slot layout a team actually plays, named formation or custom. */
export function resolveFormationSlots(formation: string | null, customFormation: unknown): FormationSlot[] {
  if (formation === CUSTOM_FORMATION_ID) {
    const custom = parseCustomFormation(customFormation)
    if (custom) return custom
  }
  return [...FORMATIONS[isFormationId(formation) ? formation : DEFAULT_FORMATION]]
}
