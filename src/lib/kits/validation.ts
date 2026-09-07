// Server-side truth for what counts as a valid kit color - the client's
// color picker only ever offers values from this same pattern, but a
// request is never trusted just because it came from that UI.
export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value)
}
