"use client"

import { useT } from "@/lib/i18n/locale-context"
import type { MatchApiResponse } from "./types"

/**
 * The two things a championship decider has to say for itself: what it is,
 * and how it was won.
 *
 * Deliberately a thin strip above the existing Match Center rather than a
 * second page - a decider is a normal match played under the normal engine,
 * and the whole point of using Fixture for it was that everything else
 * (timeline, stats, the pitch, the archive) works unchanged.
 *
 * The penalty line renders ONLY from `data.shootout`, which the server
 * populates inside its finished-only branch. There is no client-side "hide
 * while live" here on purpose: while the match is live the field is null
 * because the columns were never read, so there is nothing to hide.
 */
export function DeciderBanner({ data }: { data: MatchApiResponse }) {
  const t = useT()
  if (data.stage !== "TITLE_DECIDER") return null

  const shootout = data.status === "finished" ? data.shootout : null
  const homeWon = shootout ? shootout.home > shootout.away : false
  const winnerName = shootout ? (homeWon ? data.homeTeam.name : data.awayTeam.name) : null

  return (
    <div className="goalx-broadcast-panel flex flex-col gap-1 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          {t("match.decider.title")}
        </span>
        <span className="text-xs text-muted-foreground">{t("match.decider.neutralVenue")}</span>
      </div>
      {shootout && (
        <p className="text-sm font-medium tabular-nums">
          {t("match.decider.penalties", {
            home: String(shootout.home),
            away: String(shootout.away),
          })}
          {winnerName ? ` — ${t("match.decider.wonBy", { team: winnerName })}` : ""}
        </p>
      )}
    </div>
  )
}
