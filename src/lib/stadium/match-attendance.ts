/**
 * ONE ATTENDANCE ROLL PER FIXTURE - the single authority for how many people
 * were in the ground, and therefore for the gate, the match-day costs, and the
 * crowd the engine simulated.
 *
 * THE DEFECT THIS REPLACES. Attendance was rolled twice for every fixture, by
 * two subsystems that did not know about each other: the match snapshot rolled
 * it to store the crowd and to charge the home club's match expenses, and the
 * settlement rolled it AGAIN to compute ticket revenue. Both used
 * Math.random(), so the two draws were unrelated. On Production, zero of the
 * ninety played fixtures could reproduce their own stored gate from their own
 * stored attendance; the reconstruction error ran from -71,100 to +86,520 per
 * match. Every fixture's ledger disagreed with its own crowd.
 *
 * THE FIX IS STRUCTURAL, NOT ARITHMETICAL. There is now one call, in
 * buildMatchSnapshot, and its full result travels on the snapshot. Settlement
 * does not roll attendance - it cannot, because it is not given the means to.
 * A subsystem that wants the crowd reads the number the snapshot already
 * carries.
 *
 * SEEDED, LIKE EVERY OTHER MATCH ROLL. The draw comes from the fixture's own
 * matchSeed, salted, exactly as the shootout and the fan-incident rolls
 * already are - so rebuilding a snapshot reproduces the same crowd instead of
 * inventing a new one, and a match is fully reproducible from its seed.
 *
 * WHAT IS GATED ON THE BOUNDARY AND WHAT IS NOT. The STRUCTURE above is
 * unconditional: rolling once, from the seed, and reusing the result changes
 * no expected value - it removes an internal inconsistency and makes matches
 * reproducible, neither of which is an economic lever. The ECONOMICS are
 * gated: which quality formula the crowd judges, and which neutral it is
 * judged against, change only at the activation boundary, because those are
 * the calibrated model and the calibrated model is what the boundary
 * authorises.
 */
import { SeededRandom } from "@/lib/match/engine/rng"
import { economyEraAt } from "@/lib/economy/activation"
import { calculateTeamTotalQuality } from "@/lib/players/quality"
import { calculateAttendance, type AttendanceResult } from "./attendance"
import { calculateAttendanceQuality } from "./attendance-quality"
import { DEFAULT_STADIUM_CONFIG, type SeatCounts, type StadiumConfig } from "./config"

export interface MatchAttendanceInput {
  /** The fixture's own matchSeed - the same string the engine simulates from. */
  seed: string
  /** The home club's owned, career-ACTIVE squad. */
  homePlayers: readonly { overall: number }[]
  /** Seats AS OF KICKOFF, already corrected by readSeatsAsOf - not as of now. */
  seats: SeatCounts
  /**
   * The league's median attendance quality for this season, from
   * readLeagueNeutralQuality. Ignored before the activation boundary, where
   * the fixed config neutral is still the authority.
   */
  neutralQuality: number
  /**
   * The home club's attendance quality AS OF KICKOFF, read from
   * TeamEconomicState. Supplied by every caller that settles money; omitted
   * only by the /economy preview, which has no fixture instant to read history
   * at and writes nothing. When present it wins over `homePlayers`, because
   * `homePlayers` is the squad NOW and a late settlement must not be priced on
   * a squad the club acquired after kickoff.
   */
  homeQuality?: number
  /** The economic instant this fixture belongs to - its kickoff, never `now`. */
  at: Date
}

/**
 * The salt. A distinct stream from the match itself, so adding or removing an
 * attendance draw can never shift the sequence the engine consumes and
 * silently change every simulated result.
 */
export function attendanceSeed(matchSeed: string): string {
  return `${matchSeed}-attendance`
}

export function resolveMatchAttendance(
  input: MatchAttendanceInput,
  config: StadiumConfig = DEFAULT_STADIUM_CONFIG,
  activationStart?: Date
): AttendanceResult {
  const roll = new SeededRandom(attendanceSeed(input.seed)).next()
  const phase3r = economyEraAt(input.at, activationStart) === "phase3r"

  return calculateAttendance(
    { isHome: true },
    {
      teamTotalQuality: phase3r
        ? // HISTORY WHEN THE SETTLEMENT HAS IT, live players only as a preview
          // fallback - the same split `roll` already makes. A fixture settled
          // late must be priced on the squad that existed at KICKOFF, and only
          // TeamEconomicState can answer that; the /economy page's "what would
          // a typical matchday look like" preview has no fixture and settles
          // no money, so it is allowed to ask about the squad as it stands now.
          (input.homeQuality ?? calculateAttendanceQuality(input.homePlayers))
        : calculateTeamTotalQuality([...input.homePlayers]),
    },
    { seats: input.seats },
    config,
    { roll, neutralQuality: phase3r ? input.neutralQuality : undefined }
  )
}
