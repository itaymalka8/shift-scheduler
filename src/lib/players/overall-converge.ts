import { POSITION_ATTRIBUTE_WEIGHTS } from "./position-weights"
import { calculatePositionOverall } from "./overall"
import type { AttributeKey, PlayerAttributes } from "./attributes"
import type { PlayerPosition } from "./positions"

/**
 * Walks attribute points until the DERIVED Overall lands exactly on
 * `target`. generateAttributesForTargetOverall gets close but can miss by
 * several points either way, and where a generator has a hard ceiling that
 * matters: a miss upward would put a player above a band that is supposed to
 * be an invariant. Overall is never written to - only position-relevant
 * attributes move, +/-1 at a time, exactly as squad generation's own nudge
 * pass does, so the attributes and the Overall they grade out at stay
 * consistent by construction.
 *
 * Deterministic: a weight-descending round robin, tie-broken by attribute
 * name, so the same attributes and target always converge the same way.
 *
 * Lives here rather than inside one generator because two of them need it -
 * youth prospects and replenishment fallbacks - and a second copy would be a
 * second definition of what "hit this Overall exactly" means.
 */
export function convergeToTargetOverall(
  attributes: PlayerAttributes,
  position: PlayerPosition,
  target: number
): number {
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position]
  const keys = (Object.keys(weights) as AttributeKey[]).sort(
    (a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || a.localeCompare(b)
  )

  let overall = calculatePositionOverall(attributes, position)
  const maxSteps = keys.length * 40
  let steps = 0

  while (overall !== target && steps < maxSteps) {
    const key = keys[steps % keys.length]
    const value = attributes[key]
    steps++
    if (typeof value !== "number") continue
    if (overall < target && value < 100) attributes[key] = value + 1
    else if (overall > target && value > 1) attributes[key] = value - 1
    else continue
    overall = calculatePositionOverall(attributes, position)
  }

  return overall
}
