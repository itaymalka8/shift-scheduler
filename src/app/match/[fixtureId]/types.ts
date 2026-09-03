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
}
