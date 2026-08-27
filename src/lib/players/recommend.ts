import { FORMATIONS, type FormationId } from "./formations"
import { getPositionFit, isPlayerPosition } from "./positions"

export interface RecommendCandidate {
  id: string
  position: string
  rating: number
  fitness: number
  availability: string
}

export interface RecommendedAssignment {
  slotIndex: number
  playerId: string
}

/**
 * Greedily fills each formation slot (in formation order - GK, then defense,
 * then midfield, then attack) with the best remaining candidate: natural fit
 * beats secondary fit beats unsuitable, and within the same fit tier, higher
 * rating*fitness wins - with a small bonus for `preferredIds` (pass the
 * currently-starting XI when switching formations, so a player keeps a spot
 * if there's a reasonable one, without overriding a genuinely better fit).
 * Falls back to unavailable players only if there genuinely aren't enough
 * available ones, so a lineup is always produced.
 */
export function computeRecommendedLineup(
  formation: FormationId,
  players: RecommendCandidate[],
  preferredIds: Set<string> = new Set()
): RecommendedAssignment[] {
  const available = players.filter((p) => p.availability === "available")
  const pool = available.length >= FORMATIONS[formation].length ? available : players

  const remaining = new Map(pool.map((p) => [p.id, p]))
  const assignments: RecommendedAssignment[] = []

  FORMATIONS[formation].forEach((slot, slotIndex) => {
    let best: RecommendCandidate | null = null
    let bestScore = -Infinity

    for (const candidate of remaining.values()) {
      const naturalPosition = isPlayerPosition(candidate.position) ? candidate.position : slot.role
      const fit = getPositionFit(naturalPosition, slot.role)
      const fitScore = fit === "natural" ? 2 : fit === "secondary" ? 1 : 0
      const preferredBonus = preferredIds.has(candidate.id) ? 5 : 0
      const score = fitScore * 1000 + preferredBonus * 10 + candidate.rating * (candidate.fitness / 100)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }

    if (best) {
      assignments.push({ slotIndex, playerId: best.id })
      remaining.delete(best.id)
    }
  })

  return assignments
}
