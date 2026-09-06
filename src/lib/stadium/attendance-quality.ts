/**
 * THE ATTENDANCE QUALITY MODEL - what a crowd is actually judging.
 *
 * THE FORMULA, AS DECIDED:
 *
 *     quality = SUM(max(overall, 40)) + (22 - squadSize) * 40
 *
 * implemented below in its equivalent floor-plus-surplus form:
 *
 *     quality = 22 * 40 + SUM(max(overall - 40, 0))
 *
 * The two are the same arithmetic, but only the second makes the product rule
 * self-evident, and the product rule is the whole reason this file exists.
 *
 * THE RULE: AN EMPTY ROSTER SLOT MUST NEVER BE WORTH MORE THAN THE PLAYER
 * REMOVED FROM IT. The previous model summed Overall against a fixed neutral,
 * so a club could raise its own attendance by releasing its worst player -
 * deleting a squad member made the crowd bigger. That is not a balance
 * complaint, it is a broken incentive: the cheapest way to fill a stadium was
 * to field fewer footballers.
 *
 * Here the floor `22 * 40` is a CONSTANT. It does not depend on the squad at
 * all, so removing a player can only ever subtract surplus and can never add
 * any. The three cases follow from that without needing to be enumerated in
 * code:
 *
 *   - release below Overall 40: surplus contribution was already 0, quality
 *     is unchanged;
 *   - release exactly Overall 40: contribution is 0, quality is unchanged;
 *   - release above Overall 40: quality falls by exactly (overall - 40), the
 *     surplus that player was carrying, and by nothing else.
 *
 * Wage savings may still make a release the right financial decision. That is
 * allowed and intended - management is supposed to involve trade-offs.
 * ATTENDANCE simply may never be the thing that rewards the deletion.
 *
 * WHY 40. It is not a tuning knob picked to make the numbers work: 40 is
 * FALLBACK_OVERALL_MIN, the floor of the replacement player the game already
 * generates for itself when a club cannot field a legal squad. The league can
 * always conjure a body at Overall 40, so an empty slot IS an Overall 40
 * player the club has not bothered to sign, and it is priced as one. Deriving
 * the constant from that generator rather than restating it keeps the two
 * from drifting apart.
 *
 * WHY 22. MAX_ACTIVE_ROSTER_SIZE - the roster cap, so a full squad has no
 * empty slots to price and the floor term is the same for every club in the
 * league. Squads above the cap cannot exist; if one somehow did, the floor
 * stays at the cap rather than growing, which is why the term is written as a
 * constant rather than as `squadSize * 40`.
 */
import { FALLBACK_OVERALL_MIN } from "@/lib/players/fallback-generator"
import { MAX_ACTIVE_ROSTER_SIZE } from "@/lib/players/roster"

/**
 * The replacement level: what an empty roster slot is worth, and the Overall
 * at or below which a player adds nothing a vacancy would not also add.
 */
export const REPLACEMENT_OVERALL = FALLBACK_OVERALL_MIN

/** The constant floor every club's attendance quality starts from. */
export const ATTENDANCE_QUALITY_FLOOR = MAX_ACTIVE_ROSTER_SIZE * REPLACEMENT_OVERALL

export interface AttendanceQualityPlayer {
  overall: number
}

/**
 * One club's attendance quality. Pass the club's OWNED, career-ACTIVE squad -
 * the same population payroll charges for, because the crowd is judging the
 * squad the club is paying for.
 */
export function calculateAttendanceQuality(players: readonly AttendanceQualityPlayer[]): number {
  let surplus = 0
  for (const player of players) surplus += Math.max(0, player.overall - REPLACEMENT_OVERALL)
  return ATTENDANCE_QUALITY_FLOOR + surplus
}

/**
 * The league's neutral - the quality an average club carries this season, and
 * the baseline every club's occupancy is measured against.
 *
 * A MEDIAN, NOT A MEAN, and not a fixed constant. The calibration proved a
 * fixed neutral cannot hold: over twenty seasons the league develops, so a
 * constant baseline lets every club drift above it at once and occupancy
 * climbs toward sold-out against a wage bill that has not moved. Re-anchoring
 * to the league's own median each season is what cut the worst achievable
 * stock deviation from 51.5% to 12.9% in the calibration, and it is why this
 * is a function of the league rather than a number in a config file.
 *
 * The median specifically, because it is the statistic a single runaway club
 * cannot move: one club buying a superteam should raise ITS occupancy, not
 * lower everybody else's.
 *
 * An empty league has no median; the floor is the only defensible answer, and
 * it makes every club exactly neutral rather than making the first club to
 * exist infinitely good.
 */
export function calculateLeagueNeutralQuality(clubQualities: readonly number[]): number {
  if (clubQualities.length === 0) return ATTENDANCE_QUALITY_FLOOR
  const sorted = [...clubQualities].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
