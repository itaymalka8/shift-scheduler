import type { MatchEventView } from "./event-meta"

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

export interface MatchApiResponse {
  status: "scheduled" | "live" | "finished"
  minute: number
  scheduledAt: string | null
  // Server clock at the moment this response was built - used client-side
  // only to correct for local clock skew when driving the smooth match
  // clock (see use-match-clock.ts). Never used for event visibility.
  serverNow: string
  homeTeam: HomeMatchTeamView
  awayTeam: MatchTeamView
  liveScore: { home: number; away: number } | null
  events: MatchEventView[]
  liveStats: { home: LiveTeamStatsView; away: LiveTeamStatsView } | null
  finalStats: FinalStatsView | null
}
