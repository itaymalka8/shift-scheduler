"use client"

import Link from "next/link"
import { useT } from "@/lib/i18n/locale-context"
import {
  describeEvent,
  emphasisForEvent,
  iconForEvent,
  colorForEvent,
  type EventEmphasis,
  type MatchEventView,
} from "./event-meta"
import type { MatchTeamView } from "./types"
import { cn } from "@/lib/utils"

/**
 * How each level of emphasis is drawn. A goal gets a lit background, a full
 * accent bar and the largest type; the routine run of fouls and throw-ins
 * recedes to a quiet line. Everything is one shared scale, so adding an event
 * type only means giving it a level in emphasisForEvent.
 */
const EMPHASIS_STYLES: Record<EventEmphasis, { row: string; text: string; icon: string; minute: string }> = {
  headline: {
    row: "border-s-2 border-emerald-400 bg-emerald-400/12 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
    text: "text-[15px] font-bold text-white",
    icon: "size-8 bg-emerald-400/20",
    minute: "text-sm font-bold text-white",
  },
  high: {
    row: "border-s-2 border-red-400/80 bg-red-400/10 py-2",
    text: "text-sm font-semibold text-white",
    icon: "size-7 bg-red-400/15",
    minute: "text-sm font-semibold text-white/85",
  },
  medium: {
    row: "bg-white/[0.05] py-1.5",
    text: "text-sm font-medium text-white/95",
    icon: "size-6 bg-white/10",
    minute: "text-xs font-semibold text-white/70",
  },
  low: {
    row: "py-1",
    text: "text-[13px] text-white/70",
    icon: "size-5 bg-white/[0.07]",
    minute: "text-xs text-white/50",
  },
}

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
    <div className="goalx-glass-panel rounded-2xl p-3 sm:p-4">
      <h3 className="mb-2.5 text-sm font-semibold text-white/75">{t("match.feedTitle")}</h3>
      {ordered.length === 0 ? (
        <p className="py-4 text-center text-sm text-white/60">{t("match.feedEmpty")}</p>
      ) : (
        // Capped height with its own scroll: a 90-minute feed is 90+ rows, and
        // letting it set the page height leaves the broadcast column stranded
        // beside a mile of empty space.
        <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto pe-1 lg:max-h-[38rem]">
          {ordered.map((event) => {
            const Icon = iconForEvent(event.type)
            const { key, vars } = describeEvent(event, teamName)
            const style = EMPHASIS_STYLES[emphasisForEvent(event.type, event.outcome)]
            return (
              <li
                key={event.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2",
                  style.row,
                  event.id === newestEventId && "animate-goalx-feed-in"
                )}
              >
                <span className={cn("w-8 shrink-0 text-end tabular-nums", style.minute)}>{event.minute}&apos;</span>
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-full",
                    style.icon,
                    colorForEvent(event.type, event.outcome)
                  )}
                >
                  <Icon className="size-[55%]" strokeWidth={2.5} />
                </span>
                {/* The description is ONE interpolated translated sentence
                    ("{player} scores"), and the placeholder sits in a
                    different position in Hebrew and Arabic - so the name is
                    not surgically extracted and wrapped. The whole sentence
                    becomes the link instead, which reads the same in every
                    direction and needs no string surgery.

                    Linked ONLY when the id resolved to a real player: an
                    event whose playerId names nobody (MatchEvent.playerId is
                    a bare column with no foreign key) keeps its text and gets
                    no link, and an event with no player at all - a corner -
                    never had one. No id is ever inferred from a name. */}
                {event.playerId && event.playerName ? (
                  <Link
                    href={`/players/${event.playerId}`}
                    className={cn("min-w-0 flex-1 truncate underline-offset-2 hover:underline", style.text)}
                  >
                    {t(key, vars)}
                  </Link>
                ) : (
                  <span className={cn("min-w-0 flex-1 truncate", style.text)}>{t(key, vars)}</span>
                )}
                <span className="shrink-0 text-xs text-white/55">{teamName(event.teamId)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
