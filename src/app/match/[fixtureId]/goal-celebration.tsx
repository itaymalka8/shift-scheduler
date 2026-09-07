"use client"

import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n/locale-context"
import type { MatchEventView } from "./event-meta"

const CELEBRATION_MS = 2600

/** A brief, non-blocking celebration banner - deliberately short (per spec: no exaggerated/long animation). */
export function GoalCelebration({ event, scorerTeamName }: { event: MatchEventView | null; scorerTeamName: string }) {
  const t = useT()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!event) return
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), CELEBRATION_MS)
    return () => clearTimeout(timer)
  }, [event])

  if (!event || !visible) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 sm:top-6">
      <div className="animate-goalx-goal-banner flex flex-col items-center gap-0.5 rounded-2xl bg-gradient-to-r from-primary to-primary/80 px-6 py-3 text-center text-primary-foreground shadow-xl">
        <span className="text-xl font-extrabold tracking-wide sm:text-2xl">{t("match.goal")}</span>
        {event.playerName && <span className="text-sm font-semibold">{event.playerName}</span>}
        <span className="text-xs opacity-85">{scorerTeamName}</span>
        {event.secondaryPlayerName && (
          <span className="text-[11px] opacity-75">{t("match.assistBy", { player: event.secondaryPlayerName })}</span>
        )}
      </div>
    </div>
  )
}
