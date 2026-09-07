// Minimal in-memory sliding-window limiter. Good enough for a single
// long-running Node process (this app runs as one persistent instance, not
// a horizontally-scaled/serverless fleet) - it resets on restart, which is
// an acceptable tradeoff without a shared store like Redis.
const attempts = new Map<string, number[]>()

const WINDOW_MS = 5 * 60 * 1000
const MAX_ATTEMPTS = 8

export function isRateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  attempts.set(key, recent)
  return recent.length >= MAX_ATTEMPTS
}

export function recordFailedAttempt(key: string): void {
  const recent = attempts.get(key) ?? []
  recent.push(Date.now())
  attempts.set(key, recent)
}

export function clearAttempts(key: string): void {
  attempts.delete(key)
}
