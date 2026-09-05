import type { FixtureStage } from "@/generated/prisma"
import type { MatchEventView } from "./event-meta"
import type { PlayerMatchStatView } from "@/lib/match/player-stats-view"

export type { PlayerMatchStatView }

export interface MatchTeamView {
  id: string
  name: string
  crestShape: string | null
  crestPattern: string | null
  crestIcon: string | null
  crestColor: string | null
  crestSecondaryColor: string | null
  crestBorderColor: string | null
  crestImageUrl: string | null
}

export interface HomeMatchTeamView extends MatchTeamView {
  stadiumStyle: string | null
  crowdStyle: string | null
  stadiumCapacity: number | null
}

export interface LiveTeamStatsView {
  corners: number
  fouls: number
  yellowCards: number
  redCards: number
  goals: number
  substitutions: number
}

export interface FinalStatsView {
  homeScore: number
  awayScore: number
  // Shaped like src/lib/match/engine/engine.ts's EngineTeamStats - passed
  // through as opaque JSON from Fixture.homeStats/awayStats, only ever
  // fetched once the match is finished (see the API route).
  home: Record<string, number> | null
  away: Record<string, number> | null
}

// Response shape of POST /api/matches/[fixtureId]/ensure-simulated -
// deliberately carries no score/stats/events, only operational status.
export interface EnsureSimulatedResponse {
  ready: boolean
  alreadySimulated: boolean
  reason?: string
}

export interface MatchApiResponse {
  status: "scheduled" | "live" | "finished"
  minute: number
  scheduledAt: string | null
  // Server clock at the moment this response was built - used client-side
  // only to correct for local clock skew when driving the smooth match
  // clock (see use-match-clock.ts). Never used for event visibility.
  serverNow: string
  // True once the engine has actually run for this fixture (Cron, or the
  // client's own kickoff-activation POST) - lets the client tell "live but
  // waiting on simulation" apart from "live and simulated" without any
  // score/stat ever being exposed for that purpose.
  simulationReady: boolean
  homeTeam: HomeMatchTeamView
  awayTeam: MatchTeamView
  liveScore: { home: number; away: number } | null
  events: MatchEventView[]
  liveStats: { home: LiveTeamStatsView; away: LiveTeamStatsView } | null
  finalStats: FinalStatsView | null
  // Per-player statistics for a FINISHED match, and null in every other
  // state. The contract is deliberately three-valued in only two ways:
  //
  //   scheduled -> null      (query never issued)
  //   live      -> null      (query never issued)
  //   finished  -> array     (possibly empty, if the fixture was never
  //                           simulated - an honest "no data", never
  //                           fabricated rows)
  //
  // A live response cannot carry these because the server never reads them
  // while live: the query sits inside the route's finished-only branch, so
  // the rows never enter the process at all. See the route for why partial
  // reveal is impossible - PlayerMatchStats has no minute dimension.
  playerStats: PlayerMatchStatView[] | null
  /**
   * Which competition this fixture is. Public from creation - a manager sees
   * "Championship Decider" in their fixture list days ahead - so unlike
   * anything about the result it is safe before kickoff.
   */
  // The competition this match belongs to, and the ONLY thing that may say
  // so. A PROMOTION_PLAYOFF fixture is filed on the tier 1 Division even
  // though its four clubs are tier 2 members, so divisionId cannot be read as
  // "which competition" - FixtureStage can, and is.
  stage: FixtureStage
  boundaryRank: number | null
  boundaryRound: number | null
  /** A decider and a playoff tie are played on neutral turf: neither club is hosting. */
  neutralVenue: boolean
  /**
   * Which tie of a multi-club championship playoff this is, or null for every
   * other match.
   *
   * Fixture metadata, not a result: the phase and round exist from the moment
   * the round is created, and `isFinal` is "this knockout round has one tie",
   * which is a property of the bracket rather than of anything that happened
   * in it. Nothing here narrows who won.
   */
  playoff: { phase: "ROUND_ROBIN" | "KNOCKOUT"; round: number; isFinal: boolean } | null
  /**
   * The penalty shootout, when a decider needed one. Null for every league
   * match, for a decider settled inside 90 minutes, and - critically - for
   * ANY match that is not yet finished.
   *
   * Same structural guarantee as playerStats: the columns are selected only
   * inside the route's finished-only branch, so a shootout result cannot
   * leak while the match is live. It is the single most spoiling number in
   * the game, because it names the champion.
   */
  shootout: { home: number; away: number } | null
}
