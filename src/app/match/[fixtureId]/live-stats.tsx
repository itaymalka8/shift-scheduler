"use client"

import { useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import type { FinalStatsView, LiveTeamStatsView } from "./types"

interface Row {
  labelKey: TranslationKey
  home: number
  away: number
  suffix?: string
}

function StatRow({ labelKey, home, away, suffix }: Row) {
  const t = useT()
  const total = home + away || 1
  const homePct = (home / total) * 100

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm font-semibold tabular-nums text-white">
        <span>{home}{suffix}</span>
        <span className="text-white/60">{t(labelKey)}</span>
        <span>{away}{suffix}</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/12">
        <div className="bg-[var(--goalx-lavender)] transition-[width] duration-500" style={{ width: `${homePct}%` }} />
        <div className="flex-1 bg-[var(--goalx-secondary)]/60 transition-[width] duration-500" />
      </div>
    </div>
  )
}

/**
 * V1 statistics: only what's honestly derivable from revealed MatchEvents
 * while live (see live-view.ts). No possession row (never event-based in
 * the engine), and no Shots / Shots on Target row - the engine can skip
 * emitting a "save" event in a rare no-goalkeeper edge case, so an
 * event-reconstructed count of either could silently undercount. All three
 * appear once the match is finished, straight from the engine's own final
 * EngineTeamStats instead of being reconstructed from events.
 */
export function LiveStats({
  liveStats,
  finalStats,
}: {
  liveStats: { home: LiveTeamStatsView; away: LiveTeamStatsView } | null
  finalStats: FinalStatsView | null
}) {
  const t = useT()

  if (finalStats?.home && finalStats?.away) {
    const h = finalStats.home
    const a = finalStats.away
    return (
      <div className="goalx-glass-panel rounded-2xl p-3 sm:p-4">
        <h3 className="mb-3 text-sm font-semibold text-white/75">{t("match.statsTitle")}</h3>
        <div className="flex flex-col gap-3">
          <StatRow labelKey="match.stat.possession" home={h.possessionPercent ?? 0} away={a.possessionPercent ?? 0} suffix="%" />
          <StatRow labelKey="match.stat.shots" home={h.shots ?? 0} away={a.shots ?? 0} />
          <StatRow labelKey="match.stat.shotsOnTarget" home={h.shotsOnTarget ?? 0} away={a.shotsOnTarget ?? 0} />
          <StatRow labelKey="match.stat.corners" home={h.corners ?? 0} away={a.corners ?? 0} />
          <StatRow labelKey="match.stat.fouls" home={h.fouls ?? 0} away={a.fouls ?? 0} />
          <StatRow labelKey="match.stat.yellowCards" home={h.yellowCards ?? 0} away={a.yellowCards ?? 0} />
          <StatRow labelKey="match.stat.redCards" home={h.redCards ?? 0} away={a.redCards ?? 0} />
          <StatRow labelKey="match.stat.substitutions" home={h.substitutions ?? 0} away={a.substitutions ?? 0} />
        </div>
      </div>
    )
  }

  if (!liveStats) return null

  const { home, away } = liveStats
  return (
    <div className="goalx-glass-panel rounded-2xl p-3 sm:p-4">
      <h3 className="mb-3 text-sm font-semibold text-white/75">{t("match.statsTitle")}</h3>
      <div className="flex flex-col gap-3">
        <StatRow labelKey="match.stat.goals" home={home.goals} away={away.goals} />
        <StatRow labelKey="match.stat.corners" home={home.corners} away={away.corners} />
        <StatRow labelKey="match.stat.fouls" home={home.fouls} away={away.fouls} />
        <StatRow labelKey="match.stat.yellowCards" home={home.yellowCards} away={away.yellowCards} />
        <StatRow labelKey="match.stat.redCards" home={home.redCards} away={away.redCards} />
        <StatRow labelKey="match.stat.substitutions" home={home.substitutions} away={away.substitutions} />
      </div>
    </div>
  )
}
