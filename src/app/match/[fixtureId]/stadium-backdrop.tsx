"use client"

import { useMemo } from "react"
import { StadiumIllustration } from "@/components/stadium-illustration"
import { cn } from "@/lib/utils"
import type { HomeMatchTeamView } from "./types"

/**
 * Ambient stadium banner behind the Match Center - reuses the existing
 * StadiumIllustration (the club's real stadiumStyle + capacity) unmodified,
 * and layers a lightweight crowd/flag overlay on top rather than building a
 * second, heavier stadium renderer. Everything here is CSS transform/
 * opacity animation on plain SVG/div shapes - no Three.js, no canvas, no
 * per-frame JS - so it stays cheap on mobile even during a goal celebration.
 */
export function StadiumBackdrop({ homeTeam, celebrating }: { homeTeam: HomeMatchTeamView; celebrating: boolean }) {
  const ultras = homeTeam.crowdStyle === "ultras"
  const accent = homeTeam.crestColor ?? "#6C4FD9"
  const accent2 = homeTeam.crestSecondaryColor ?? "#F97316"

  const crowdDots = useMemo(() => {
    const count = ultras ? 46 : 34
    return Array.from({ length: count }, (_, i) => {
      const t = i / count
      // Spread along the near stand only (the bottom arc of the bowl) -
      // this is ambiance behind the scoreboard, not a full 360 crowd.
      const x = 8 + t * 84
      const y = 78 + Math.sin(t * Math.PI) * 10
      return { id: i, x, y, color: i % 3 === 0 ? accent : i % 3 === 1 ? accent2 : "#e5e7eb" }
    })
  }, [ultras, accent, accent2])

  const flags = useMemo(() => {
    if (!ultras) return []
    return Array.from({ length: 6 }, (_, i) => ({ id: i, x: 14 + i * 14, delay: (i % 3) * 0.35 }))
  }, [ultras])

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <StadiumIllustration style={homeTeam.stadiumStyle} capacity={homeTeam.stadiumCapacity ?? 1000} className="w-full" />

      <svg viewBox="0 0 400 220" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {crowdDots.map((d) => (
          <circle
            key={d.id}
            cx={d.x * 4}
            cy={d.y * 1}
            r="2.1"
            fill={d.color}
            className={ultras ? "animate-goalx-crowd-ultras" : "animate-goalx-crowd-calm"}
            style={{ animationDelay: `${(d.id % 10) * 0.13}s`, transformOrigin: `${d.x * 4}px ${d.y}px` }}
          />
        ))}

        {flags.map((f) => (
          <rect
            key={f.id}
            x={f.x * 4 - 5}
            y={64}
            width="10"
            height="7"
            rx="1"
            fill={f.id % 2 === 0 ? accent : accent2}
            className="animate-goalx-flag-wave"
            style={{ animationDelay: `${f.delay}s`, transformOrigin: `${f.x * 4}px 68px` }}
          />
        ))}
      </svg>

      {celebrating && (
        <div
          className="pointer-events-none absolute inset-0 animate-goalx-crowd-flash"
          style={{ background: `radial-gradient(circle at 50% 70%, ${accent}55, transparent 70%)` }}
        />
      )}

      <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/40 to-transparent")} />
    </div>
  )
}
