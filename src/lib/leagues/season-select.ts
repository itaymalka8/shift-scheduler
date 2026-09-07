/**
 * Which season a season-scoped screen should show. Pure and side-effect
 * free so the rule is testable on its own, away from the page that uses it.
 */
export interface SelectableSeason {
  id: string
  number: number
  isActive: boolean
}

/**
 * Resolution order:
 *  1. The explicitly requested season, if it is one of this club's own.
 *     An unknown or stale id falls through rather than erroring or showing
 *     an empty screen - a bookmarked link to a season the club never played
 *     should land on something sensible.
 *  2. The country's active season, which is where a manager almost always
 *     wants to be.
 *  3. Failing both, the highest-numbered season available (a country mid
 *     handover has no active season for a moment - see activateNextSeason).
 */
export function resolveSelectedSeason<T extends SelectableSeason>(seasons: T[], requestedId?: string | null): T | null {
  if (seasons.length === 0) return null
  if (requestedId) {
    const requested = seasons.find((season) => season.id === requestedId)
    if (requested) return requested
  }
  return seasons.find((season) => season.isActive) ?? [...seasons].sort((a, b) => b.number - a.number)[0] ?? null
}
