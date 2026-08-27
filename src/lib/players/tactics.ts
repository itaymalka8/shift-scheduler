export const MENTALITY_OPTIONS = ["defensive", "balanced", "attacking"] as const
export type Mentality = (typeof MENTALITY_OPTIONS)[number]
export const DEFAULT_MENTALITY: Mentality = "balanced"
export function isMentality(value: string | null | undefined): value is Mentality {
  return !!value && (MENTALITY_OPTIONS as readonly string[]).includes(value)
}

export const TEMPO_OPTIONS = ["slow", "normal", "fast"] as const
export type Tempo = (typeof TEMPO_OPTIONS)[number]
export const DEFAULT_TEMPO: Tempo = "normal"
export function isTempo(value: string | null | undefined): value is Tempo {
  return !!value && (TEMPO_OPTIONS as readonly string[]).includes(value)
}

export const PRESSING_OPTIONS = ["low", "normal", "high"] as const
export type Pressing = (typeof PRESSING_OPTIONS)[number]
export const DEFAULT_PRESSING: Pressing = "normal"
export function isPressing(value: string | null | undefined): value is Pressing {
  return !!value && (PRESSING_OPTIONS as readonly string[]).includes(value)
}

export const WIDTH_OPTIONS = ["narrow", "balanced", "wide"] as const
export type Width = (typeof WIDTH_OPTIONS)[number]
export const DEFAULT_WIDTH: Width = "balanced"
export function isWidth(value: string | null | undefined): value is Width {
  return !!value && (WIDTH_OPTIONS as readonly string[]).includes(value)
}
