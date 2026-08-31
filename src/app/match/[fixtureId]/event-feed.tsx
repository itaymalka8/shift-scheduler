"use client"

import { useT } from "@/lib/i18n/locale-context"
import { describeEvent, iconForEvent, colorForEvent, type MatchEventView } from "./event-meta"
import type { MatchTeamView } from "./types"
import { cn } from "@/lib/utils"

/** Newest first - the convention every live-score app uses, each row still carries its own minute so order stays unambiguous either way. */
export function EventFeed({
  events,
  homeTeam,
  awayTeam,
  newestEventId,
}: {
  events: MatchEventView[]
  homeTeam: MatchTeamView
  awayTeam: MatchTeamView
  newestEventId: string | null
}) {
  const t = useT()
  const teamName = (teamId: string) => (teamId === homeTeam.id ? homeTeam.name : awayTeam.name)
  const ordered = [...events].sort((a, b) => b.minute - a.minute || b.id.localeCompare(a.id))

  return (
    <div className="rounded-2xl border bg-card p-3 sm:p-4">
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t("match.feedTitle")}</h3>
      {ordered.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("match.feedEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {ordered.map((event) => {
            const Icon = iconForEvent(event.type)
            const { key, vars } = describeEvent(event, teamName)
            const isHome = event.teamId === homeTeam.id
            return (
              <li
                key={event.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
                  event.id === newestEventId && "animate-goalx-feed-in bg-primary/5"
                )}
              >
                <span className="w-8 shrink-0 text-end text-xs font-semibold tabular-nums text-muted-foreground">{event.minute}&apos;</span>
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-muted", colorForEvent(event.type, event.outcome))}>
                  <Icon className="size-3.5" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t(key, vars)}</span>
                <span className={cn("shrink-0 text-xs text-muted-foreground", isHome ? "" : "text-end")}>{teamName(event.teamId)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
