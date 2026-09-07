export interface SeasonActiveFlag {
  countryCode: string
  isActive: boolean
}

/**
 * Countries with more than one Season row marked isActive at once. The
 * partial unique index (Season_countryCode_active_key, added in
 * 20260901180307_add_season_lifecycle_youth_foundation) makes this
 * impossible going forward for any row written after that migration - but
 * this check exists because Production could already contain rows that
 * predate it, and the migration adding that index would fail outright if
 * so. A non-empty result here is a genuine blocker: either the migration
 * hasn't been applied yet, or the index creation itself failed.
 */
export function findDuplicateActiveSeasons(seasons: SeasonActiveFlag[]): string[] {
  const counts = new Map<string, number>()
  for (const season of seasons) {
    if (!season.isActive) continue
    counts.set(season.countryCode, (counts.get(season.countryCode) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([countryCode]) => countryCode)
}
