import type { PlayerPosition } from "./positions"

export interface FormationSlot {
  role: PlayerPosition
  x: number
  y: number
}

// Adding a formation later is just adding an entry here - nothing else in
// the system hardcodes the formation list.
export type FormationId = "4-4-2" | "4-3-3" | "4-2-3-1" | "3-5-2" | "5-3-2"

export const FORMATIONS: Record<FormationId, FormationSlot[]> = {
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
}

export const DEFAULT_FORMATION: FormationId = "4-4-2"

export function isFormationId(value: string | null | undefined): value is FormationId {
  return !!value && value in FORMATIONS
}
