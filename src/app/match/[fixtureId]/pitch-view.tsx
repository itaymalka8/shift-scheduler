"use client"

import { useEffect, useMemo, useState } from "react"
import { useT } from "@/lib/i18n/locale-context"
import {
  buildPitchMarkings,
  HALF_LENGTH,
  HALF_WIDTH,
  LINE_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
  SPOT_RADIUS,
  type Arc,
  type Point,
  type Rect,
} from "@/lib/stadium/pitch-geometry"
import { iconForEvent, colorForEvent, zoneForEvent, type MatchEventView } from "./event-meta"

interface ActivePing {
  key: string
  xPct: number
  yPct: number
  type: string
  outcome: string | null
}

const PING_LIFETIME_MS = 1600

// The SVG is drawn in PITCH METERS, with the viewBox set to the real pitch so
// every marking below can be written in the same units pitch-geometry.ts uses.
// Nothing here is positioned in pixels: the browser scales the whole thing.
const VIEW_X = -HALF_LENGTH
const VIEW_Y = -HALF_WIDTH

/** Pitch space (y up) -> SVG space (y down), still in meters. */
function sy(y: number): number {
  return -y
}

function rectAttrs(r: Rect) {
  return { x: r.cx - r.width / 2, y: sy(r.cy + r.height / 2), width: r.width, height: r.height }
}

/** An arc as an SVG path. Angles are pitch-space (y up), so they flip with the axis. */
function arcPath(a: Arc): string {
  const start = { x: a.cx + Math.cos(a.startAngle) * a.radius, y: a.cy + Math.sin(a.startAngle) * a.radius }
  const end = { x: a.cx + Math.cos(a.endAngle) * a.radius, y: a.cy + Math.sin(a.endAngle) * a.radius }
  const largeArc = Math.abs(a.endAngle - a.startAngle) > Math.PI ? 1 : 0
  // Sweep flips because the y axis is inverted between pitch space and SVG.
  return `M ${start.x} ${sy(start.y)} A ${a.radius} ${a.radius} 0 ${largeArc} 0 ${end.x} ${sy(end.y)}`
}

/**
 * The tactical pitch. Its geometry is the regulation one from
 * pitch-geometry.ts - the same module the 3D stadium's surface is built from
 * and the same one the geometry tests assert - so the halfway line, circle,
 * boxes, arcs and spots are all exactly where they are on a real pitch,
 * scaled rather than redrawn by eye.
 *
 * MatchEvent carries no coordinates, so this never claims tracked positions:
 * it pulses a coarse ZONE (see event-meta.ts) when an event is revealed, which
 * is the honest amount of detail the data supports.
 */
export function PitchView({
  latestEvents,
  homeTeamId,
  homeTeamName,
  awayTeamName,
}: {
  latestEvents: MatchEventView[]
  homeTeamId: string
  homeTeamName?: string
  awayTeamName?: string
}) {
  const t = useT()
  const [pings, setPings] = useState<ActivePing[]>([])
  const markings = useMemo(() => buildPitchMarkings(), [])

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
    <div className="relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_16px_50px_-20px_rgba(0,0,0,0.9)]">
      <svg
        viewBox={`${VIEW_X} ${VIEW_Y} ${PITCH_LENGTH} ${PITCH_WIDTH}`}
        className="block h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id="tactical-turf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#207A3A" />
            <stop offset="100%" stopColor="#0E3E1E" />
          </linearGradient>
          <radialGradient id="tactical-light" cx="50%" cy="45%" r="62%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x={VIEW_X} y={VIEW_Y} width={PITCH_LENGTH} height={PITCH_WIDTH} fill="url(#tactical-turf)" />

        {/* Mow bands, along the length like a real cut surface. */}
        {Array.from({ length: 12 }, (_, i) => (
          <rect
            key={i}
            x={VIEW_X + (i * PITCH_LENGTH) / 12}
            y={VIEW_Y}
            width={PITCH_LENGTH / 12}
            height={PITCH_WIDTH}
            fill={i % 2 === 0 ? "#FFFFFF" : "#000000"}
            opacity={i % 2 === 0 ? 0.05 : 0.07}
          />
        ))}
        <rect x={VIEW_X} y={VIEW_Y} width={PITCH_LENGTH} height={PITCH_WIDTH} fill="url(#tactical-light)" />

        <g fill="none" stroke="#EAF3EC" strokeOpacity="0.9" strokeWidth={LINE_WIDTH * 1.8}>
          {/* Boundary: inset by half a line so the paint sits inside the field. */}
          <rect
            x={VIEW_X + LINE_WIDTH}
            y={VIEW_Y + LINE_WIDTH}
            width={PITCH_LENGTH - LINE_WIDTH * 2}
            height={PITCH_WIDTH - LINE_WIDTH * 2}
          />
          <line
            x1={markings.halfwayLine[0].x}
            y1={sy(markings.halfwayLine[0].y)}
            x2={markings.halfwayLine[1].x}
            y2={sy(markings.halfwayLine[1].y)}
          />
          <circle cx={markings.centerCircle.cx} cy={sy(markings.centerCircle.cy)} r={markings.centerCircle.radius} />
          {markings.penaltyAreas.map((box, i) => (
            <rect key={`pa-${i}`} {...rectAttrs(box)} />
          ))}
          {markings.goalAreas.map((box, i) => (
            <rect key={`ga-${i}`} {...rectAttrs(box)} />
          ))}
          {markings.penaltyArcs.map((arc, i) => (
            <path key={`arc-${i}`} d={arcPath(arc)} />
          ))}
          {markings.cornerArcs.map((arc, i) => (
            <path key={`corner-${i}`} d={arcPath(arc)} />
          ))}
        </g>

        {/* Goals, drawn just outside each goal line. */}
        <g fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth={LINE_WIDTH * 2}>
          {markings.goals.map((goal, i) => {
            const end = i === 0 ? -1 : 1
            const x = goal.line[0].x
            const backX = x + end * goal.depth
            return (
              <rect
                key={`goal-${i}`}
                x={Math.min(x, backX)}
                y={sy(goal.line[1].y)}
                width={goal.depth}
                height={goal.line[1].y - goal.line[0].y}
              />
            )
          })}
        </g>

        {[markings.centerSpot, ...markings.penaltySpots].map((spot: Point, i) => (
          <circle key={`spot-${i}`} cx={spot.x} cy={sy(spot.y)} r={SPOT_RADIUS * 1.8} fill="#EAF3EC" opacity="0.85" />
        ))}
      </svg>

      {/* Attack direction: which way each side is playing. Absolute overlay so
          the SVG itself stays purely geometric. */}
      {(homeTeamName || awayTeamName) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
          <span className="flex items-center gap-1 truncate">
            <span aria-hidden>&larr;</span>
            <span className="max-w-24 truncate sm:max-w-32">{awayTeamName}</span>
          </span>
          <span className="flex items-center gap-1 truncate">
            <span className="max-w-24 truncate sm:max-w-32">{homeTeamName}</span>
            <span aria-hidden>&rarr;</span>
          </span>
        </div>
      )}

      {pings.map((p) => {
        const Icon = iconForEvent(p.type)
        return (
          <div
            key={p.key}
            className="absolute -translate-x-1/2 -translate-y-1/2 animate-goalx-pitch-ping"
            style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
          >
            <span
              className={`flex size-8 items-center justify-center rounded-full bg-white shadow-[0_6px_18px_rgba(0,0,0,0.7)] ring-2 ring-white/25 sm:size-9 ${colorForEvent(p.type, p.outcome)}`}
            >
              <Icon className="size-4" strokeWidth={2.5} />
            </span>
          </div>
        )
      })}

      <span className="sr-only">{t("match.statsTitle")}</span>
    </div>
  )
}
