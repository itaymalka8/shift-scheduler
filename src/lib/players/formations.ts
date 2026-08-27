export type PlayerPosition = "GK" | "DF" | "MF" | "FW"

export interface FormationSlot {
  position: PlayerPosition
  x: number
  y: number
}

export type FormationId = "4-4-2" | "4-3-3" | "3-5-2" | "4-5-1" | "3-4-3"

export const FORMATIONS: Record<FormationId, FormationSlot[]> = {
  "4-4-2": [
    { position: "GK", x: 50, y: 8 },
    { position: "DF", x: 15, y: 25 },
    { position: "DF", x: 38, y: 25 },
    { position: "DF", x: 62, y: 25 },
    { position: "DF", x: 85, y: 25 },
    { position: "MF", x: 15, y: 55 },
    { position: "MF", x: 38, y: 55 },
    { position: "MF", x: 62, y: 55 },
    { position: "MF", x: 85, y: 55 },
    { position: "FW", x: 35, y: 80 },
    { position: "FW", x: 65, y: 80 },
  ],
  "4-3-3": [
    { position: "GK", x: 50, y: 8 },
    { position: "DF", x: 15, y: 25 },
    { position: "DF", x: 38, y: 25 },
    { position: "DF", x: 62, y: 25 },
    { position: "DF", x: 85, y: 25 },
    { position: "MF", x: 25, y: 50 },
    { position: "MF", x: 50, y: 50 },
    { position: "MF", x: 75, y: 50 },
    { position: "FW", x: 20, y: 80 },
    { position: "FW", x: 50, y: 80 },
    { position: "FW", x: 80, y: 80 },
  ],
  "3-5-2": [
    { position: "GK", x: 50, y: 8 },
    { position: "DF", x: 25, y: 25 },
    { position: "DF", x: 50, y: 25 },
    { position: "DF", x: 75, y: 25 },
    { position: "MF", x: 10, y: 52 },
    { position: "MF", x: 30, y: 52 },
    { position: "MF", x: 50, y: 52 },
    { position: "MF", x: 70, y: 52 },
    { position: "MF", x: 90, y: 52 },
    { position: "FW", x: 35, y: 80 },
    { position: "FW", x: 65, y: 80 },
  ],
  "4-5-1": [
    { position: "GK", x: 50, y: 8 },
    { position: "DF", x: 15, y: 25 },
    { position: "DF", x: 38, y: 25 },
    { position: "DF", x: 62, y: 25 },
    { position: "DF", x: 85, y: 25 },
    { position: "MF", x: 10, y: 52 },
    { position: "MF", x: 30, y: 52 },
    { position: "MF", x: 50, y: 52 },
    { position: "MF", x: 70, y: 52 },
    { position: "MF", x: 90, y: 52 },
    { position: "FW", x: 50, y: 82 },
  ],
  "3-4-3": [
    { position: "GK", x: 50, y: 8 },
    { position: "DF", x: 25, y: 25 },
    { position: "DF", x: 50, y: 25 },
    { position: "DF", x: 75, y: 25 },
    { position: "MF", x: 15, y: 52 },
    { position: "MF", x: 38, y: 52 },
    { position: "MF", x: 62, y: 52 },
    { position: "MF", x: 85, y: 52 },
    { position: "FW", x: 20, y: 80 },
    { position: "FW", x: 50, y: 80 },
    { position: "FW", x: 80, y: 80 },
  ],
}

export const DEFAULT_FORMATION: FormationId = "4-4-2"

export function isFormationId(value: string | null | undefined): value is FormationId {
  return !!value && value in FORMATIONS
}

export const TACTIC_STYLES = ["defensive", "balanced", "attacking"] as const
export type TacticStyle = (typeof TACTIC_STYLES)[number]

export function isTacticStyle(value: string | null | undefined): value is TacticStyle {
  return !!value && (TACTIC_STYLES as readonly string[]).includes(value)
}
