/**
 * Who takes the penalties, decided from what the match actually produced.
 *
 * Pure, and deliberately separate from the shootout itself: WHO steps up is
 * a football question about the eleven still on the pitch, while WHETHER a
 * kick goes in is a seeded roll. Keeping them apart means the ordering rule
 * can be argued about and tested without touching the randomness.
 *
 * THE ELEVEN AT THE FINAL WHISTLE, exactly. EngineResult.finalOnPitch
 * reports it directly, so nothing here approximates. Deriving it from
 * PlayerMatchStats instead would be wrong: a player substituted in the 60th
 * minute and one who played the full match both have minutesPlayed > 0, so
 * minutes alone would hand a penalty to someone who is in the dressing room.
 * Players sent off are already excluded by the engine.
 *
 * ORDER, and why it is this order:
 *
 *   1. The club's DESIGNATED penalty taker, if they are still on. This is
 *      not invented for the shootout - Team.penaltyTakerId is an existing
 *      product concept the manager sets on the tactics screen, and it is
 *      already carried in the snapshot. A manager who nominated a penalty
 *      taker expects them to take the first one.
 *   2. Everyone else by the `penalties` attribute, highest first - a
 *      deterministic reading of "your best takers go first".
 *   3. playerId ascending, as the final tie-break ONLY.
 *
 * That last step is a TECHNICAL tie-break between two players who are
 * genuinely identical on the only attribute that matters here. It decides
 * an ordering inside one club, never which club wins anything - the
 * championship is decided by the seeded kicks, and `teamId` and player names
 * appear nowhere in that. A name-based tie-break would have been unstable
 * (names are mutable) and locale-dependent, which is exactly what the
 * championship rules forbid.
 */
import type { ShootoutKeeper, ShootoutPlayer, ShootoutSide } from "./shootout"

export const GOALKEEPER_POSITION = "GK"

/** The minimum a player must expose to be ordered. No name, no club ownership. */
export interface TakerCandidate {
  playerId: string
  primaryPosition: string
  penalties: number | null
  penaltySaving: number | null
}

/**
 * Orders the players still on the pitch into a taking order.
 *
 * The goalkeeper is not excluded - a keeper may take a penalty, and in a
 * long sudden death they eventually do. They simply sort where their
 * `penalties` attribute puts them, which is normally last.
 */
export function orderTakers(candidates: TakerCandidate[], designatedTakerId: string | null): ShootoutPlayer[] {
  const ordered = [...candidates].sort((a, b) => {
    if (designatedTakerId) {
      if (a.playerId === designatedTakerId) return -1
      if (b.playerId === designatedTakerId) return 1
    }
    const bySkill = (b.penalties ?? 0) - (a.penalties ?? 0)
    if (bySkill !== 0) return bySkill
    // Technical only - see the header. Two players equal on `penalties`
    // need SOME stable order, and an id is the one attribute that cannot
    // change underneath a replay.
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
  })
  return ordered.map((p) => ({ playerId: p.playerId, penalties: p.penalties }))
}

/**
 * The keeper facing the kicks: the goalkeeper still on the pitch.
 *
 * Null when there is none - a keeper sent off with no substitutions left
 * happens. The shootout treats that as an outfield player in goal at the
 * neutral default rather than as a free goal.
 */
export function pickKeeper(candidates: TakerCandidate[]): ShootoutKeeper | null {
  const keepers = candidates
    .filter((p) => p.primaryPosition === GOALKEEPER_POSITION)
    .sort((a, b) => {
      const bySkill = (b.penaltySaving ?? 0) - (a.penaltySaving ?? 0)
      if (bySkill !== 0) return bySkill
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
    })
  const keeper = keepers[0]
  return keeper ? { playerId: keeper.playerId, penaltySaving: keeper.penaltySaving } : null
}

/** One side's shootout line-up, from the players who finished the match. */
export function buildShootoutSide(
  teamId: string,
  candidates: TakerCandidate[],
  designatedTakerId: string | null
): ShootoutSide {
  return {
    teamId,
    takers: orderTakers(candidates, designatedTakerId),
    keeper: pickKeeper(candidates),
  }
}
