"use client"

import { useEffect, useState } from "react"
import { iconForEvent, colorForEvent, zoneForEvent, type MatchEventView } from "./event-meta"

interface ActivePing {
  key: string
  xPct: number
  yPct: number
  type: string
  outcome: string | null
}

const PING_LIFETIME_MS = 1600

/**
 * A simplified vertical pitch. MatchEvent carries no coordinates, so this
 * never claims 22 tracked players or exact ball positions - it only shows a
 * brief pulse in a coarse zone (see event-meta.ts's zoneForEvent) whenever
 * a new event is revealed, which is the honest amount of detail the data
 * actually supports.
 */
export function PitchView({ latestEvents, homeTeamId }: { latestEvents: MatchEventView[]; homeTeamId: string }) {
  const [pings, setPings] = useState<ActivePing[]>([])

  useEffect(() => {
    if (latestEvents.length === 0) return
    const next = latestEvents.map((e) => {
      const { xPct, yPct } = zoneForEvent(e, homeTeamId)
      return { key: e.id, xPct, yPct, type: e.type, outcome: e.outcome }
    })
    setPings((prev) => [...prev, ...next])
    const timer = setTimeout(() => {
      setPings((prev) => prev.filter((p) => !next.some((n) => n.key === p.key)))
    }, PING_LIFETIME_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestEvents is a fresh array each poll; we only care about its contents, diffed by the parent before it reaches us.
  }, [latestEvents])

  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl border bg-gradient-to-b from-emerald-600 to-emerald-700 sm:aspect-[3/4]">
      <PitchMarkings />

      {pings.map((p) => {
        const Icon = iconForEvent(p.type)
        return (
          <div
            key={p.key}
            className="absolute -translate-x-1/2 -translate-y-1/2 animate-goalx-pitch-ping"
            style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
          >
            <span className={`flex size-9 items-center justify-center rounded-full bg-white shadow-lg ${colorForEvent(p.type, p.outcome)}`}>
              <Icon className="size-4.5" strokeWidth={2.5} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PitchMarkings() {
  return (
    <svg viewBox="0 0 100 150" className="absolute inset-0 h-full w-full opacity-70" aria-hidden>
      <rect x="2" y="2" width="96" height="146" fill="none" stroke="white" strokeWidth="1" />
      <line x1="2" y1="75" x2="98" y2="75" stroke="white" strokeWidth="1" />
      <circle cx="50" cy="75" r="10" fill="none" stroke="white" strokeWidth="1" />
      <circle cx="50" cy="75" r="0.8" fill="white" />
      <rect x="22" y="2" width="56" height="18" fill="none" stroke="white" strokeWidth="1" />
      <rect x="22" y="130" width="56" height="18" fill="none" stroke="white" strokeWidth="1" />
      <rect x="38" y="2" width="24" height="7" fill="none" stroke="white" strokeWidth="1" />
      <rect x="38" y="141" width="24" height="7" fill="none" stroke="white" strokeWidth="1" />
    </svg>
  )
}
