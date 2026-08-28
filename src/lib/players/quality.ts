// A squad's quality/value are always derived from its players, never stored
// as a standalone number - so they can never drift out of sync with an
// actual squad change. Call these wherever a total is displayed.

export interface QualityPlayer {
  overall: number
}

export interface ValuePlayer {
  marketValue: number
}

/** Sum of every squad player's overall - the whole squad's "Total Quality". */
export function calculateTeamTotalQuality(players: QualityPlayer[]): number {
  return players.reduce((sum, p) => sum + p.overall, 0)
}

/** Sum of every squad player's market value - the whole squad's transfer worth. */
export function calculateSquadMarketValue(players: ValuePlayer[]): number {
  return players.reduce((sum, p) => sum + p.marketValue, 0)
}
