/**
 * Relative luminance -> readable text color. Used wherever text has to sit
 * directly on a manager-chosen kit color (the pitch mini card here) and
 * needs to stay legible regardless of how light or dark that color is.
 */
export function getReadableTextColor(hex: string): "#111827" | "#FFFFFF" {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? "#111827" : "#FFFFFF"
}
