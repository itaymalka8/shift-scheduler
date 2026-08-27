export type StadiumStyleId =
  | "classic-bowl"
  | "modern-arena"
  | "four-stand"
  | "athletics"
  | "boutique"
  | "retractable"
  | "historic"
  | "coastal"

interface StadiumStyleConfig {
  id: StadiumStyleId
  shape: "oval" | "rect"
  roof: "none" | "partial" | "full"
  track: boolean
  intimate?: boolean
  accent: string
}

export const STADIUM_STYLES: StadiumStyleConfig[] = [
  { id: "classic-bowl", shape: "oval", roof: "partial", track: false, accent: "#6C4FD9" },
  { id: "modern-arena", shape: "oval", roof: "full", track: false, accent: "#38BDF8" },
  { id: "four-stand", shape: "rect", roof: "partial", track: false, accent: "#EF4444" },
  { id: "athletics", shape: "oval", roof: "none", track: true, accent: "#F97316" },
  { id: "boutique", shape: "oval", roof: "none", track: false, intimate: true, accent: "#22C55E" },
  { id: "retractable", shape: "oval", roof: "full", track: false, accent: "#06B6D4" },
  { id: "historic", shape: "oval", roof: "none", track: false, accent: "#B45309" },
  { id: "coastal", shape: "oval", roof: "partial", track: false, accent: "#0D9488" },
]

export const DEFAULT_STADIUM_STYLE: StadiumStyleId = "classic-bowl"
export const MIN_STADIUM_CAPACITY = 100
export const MAX_STADIUM_CAPACITY = 30000
// Below this, there's no real "bowl" yet - just a fence of individually
// countable seats around the pitch.
const SEAT_MODE_THRESHOLD = 300

export function isStadiumStyle(value: string | null | undefined): value is StadiumStyleId {
  return STADIUM_STYLES.some((s) => s.id === value)
}

function getStadiumStyleConfig(id?: string | null): StadiumStyleConfig {
  return STADIUM_STYLES.find((s) => s.id === id) ?? STADIUM_STYLES[0]
}

/** 0 at MIN_STADIUM_CAPACITY, 1 at MAX_STADIUM_CAPACITY, log-scaled so growth reads as steady. */
function getCapacityGrowth(capacity: number): number {
  const clamped = Math.min(MAX_STADIUM_CAPACITY, Math.max(MIN_STADIUM_CAPACITY, capacity))
  return (
    (Math.log(clamped) - Math.log(MIN_STADIUM_CAPACITY)) /
    (Math.log(MAX_STADIUM_CAPACITY) - Math.log(MIN_STADIUM_CAPACITY))
  )
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** Walks the perimeter of an axis-aligned rectangle (half-extents hw/hh) starting
 *  at the top-left corner and going clockwise; t is the fraction traveled (0..1). */
function pointOnRectPerimeter(hw: number, hh: number, t: number): { x: number; y: number } {
  const w = hw * 2
  const h = hh * 2
  const perimeter = 2 * (w + h)
  const d = ((t % 1) + 1) % 1 * perimeter
  if (d < w) return { x: -hw + d, y: -hh }
  if (d < w + h) return { x: hw, y: -hh + (d - w) }
  if (d < 2 * w + h) return { x: hw - (d - w - h), y: hh }
  return { x: -hw, y: hh - (d - 2 * w - h) }
}

export function StadiumIllustration({
  style,
  capacity = MIN_STADIUM_CAPACITY,
  className,
}: {
  style?: string | null
  capacity?: number
  className?: string
}) {
  const cfg = getStadiumStyleConfig(style)
  const uid = cfg.id
  const pitchRx = cfg.intimate ? 108 : 98
  const pitchRy = cfg.intimate ? 48 : 44

  const growth = getCapacityGrowth(capacity)
  const seatMode = capacity <= SEAT_MODE_THRESHOLD
  const seatCount = Math.round(lerp(12, 40, Math.min(1, capacity / SEAT_MODE_THRESHOLD)))
  const tiers = 1 + Math.round(growth * 3) // 1..4 tiers as capacity climbs toward 30,000

  const bowlBaseRx = pitchRx + 18
  const bowlBaseRy = pitchRy + 16
  const bowlMaxRx = cfg.intimate ? 136 : 166
  const bowlMaxRy = cfg.intimate ? 50 : 62
  const bowlRx = lerp(bowlBaseRx, bowlMaxRx, growth)
  const bowlRy = lerp(bowlBaseRy, bowlMaxRy, growth)
  const wallHeight = lerp(14, 40, growth)

  return (
    <svg viewBox="0 0 400 220" className={className} aria-hidden>
      <defs>
        <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#241a4d" />
          <stop offset="100%" stopColor="#120c2e" />
        </linearGradient>
        <linearGradient id={`bowl-outer-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cfg.id === "historic" ? "#e8dcc4" : "#e7e5f0"} />
          <stop offset="100%" stopColor={cfg.id === "historic" ? "#b8a97e" : "#b9b6cc"} />
        </linearGradient>
        <linearGradient id={`bowl-wall-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a4468" />
          <stop offset="100%" stopColor="#2e2a47" />
        </linearGradient>
        <linearGradient id={`tier-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cfg.id === "historic" ? "#d8caa0" : "#d3d1e0"} />
          <stop offset="100%" stopColor={cfg.id === "historic" ? "#a3936a" : "#a29fbb"} />
        </linearGradient>
        <radialGradient id={`pitch-${uid}`} cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#16a34a" />
        </radialGradient>
        <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fef08a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="220" fill={`url(#sky-${uid})`} rx="12" />

      {cfg.id === "coastal" && (
        <path d="M 0 190 Q 100 178 200 190 T 400 190 L 400 220 L 0 220 Z" fill="#0e7490" opacity="0.5" />
      )}

      <ellipse cx="200" cy="176" rx={lerp(80, 150, growth)} ry="14" fill="#000000" opacity="0.35" />

      {[
        { x: lerp(120, 42, growth), y: 150, h: lerp(40, 70, growth) },
        { x: lerp(280, 358, growth), y: 150, h: lerp(40, 70, growth) },
      ].map((f, i) => (
        <g key={i}>
          <circle cx={f.x} cy={f.y - f.h} r="22" fill={`url(#glow-${uid})`} />
          <line x1={f.x} y1={f.y} x2={f.x} y2={f.y - f.h} stroke="#6b6690" strokeWidth="3" />
          <rect x={f.x - 12} y={f.y - f.h - 10} width="24" height="10" rx="2" fill="#d8d6e6" />
        </g>
      ))}

      {seatMode ? (
        Array.from({ length: seatCount }).map((_, i) => {
          const { x: ox, y: oy } = pointOnRectPerimeter(pitchRx + 16, pitchRy + 14, i / seatCount)
          const x = 200 + ox
          const y = 120 + oy
          return <rect key={i} x={x - 3} y={y - 2.5} width="6" height="5" rx="1" fill={cfg.accent} opacity="0.9" />
        })
      ) : cfg.shape === "rect" ? (
        <>
          <rect
            x={200 - bowlRx - 10}
            y={120 - bowlRy}
            width={(bowlRx + 10) * 2}
            height={bowlRy * 2 + wallHeight}
            rx="18"
            fill={`url(#bowl-wall-${uid})`}
          />
          {Array.from({ length: tiers + 1 }).map((_, i) => {
            const f = i / tiers
            const w = lerp(bowlRx + 10, pitchRx + 10, f) * 2
            const h = lerp(bowlRy, pitchRy + 10, f) * 2
            return (
              <rect
                key={i}
                x={200 - w / 2}
                y={120 - h / 2}
                width={w}
                height={h}
                rx="14"
                fill={i % 2 === 0 ? `url(#bowl-outer-${uid})` : `url(#tier-${uid})`}
                stroke="#000000"
                strokeOpacity="0.22"
                strokeWidth="1.5"
              />
            )
          })}
        </>
      ) : (
        <>
          <path
            d={`M ${200 - bowlRx} 128 A ${bowlRx} ${bowlRy} 0 0 0 ${200 + bowlRx} 128 L ${200 + bowlRx} ${128 + wallHeight} A ${bowlRx} ${bowlRy} 0 0 1 ${200 - bowlRx} ${128 + wallHeight} Z`}
            fill={`url(#bowl-wall-${uid})`}
          />
          {Array.from({ length: tiers + 1 }).map((_, i) => {
            const f = i / tiers
            const rx = lerp(bowlRx, pitchRx + 6, f)
            const ry = lerp(bowlRy, pitchRy + 6, f)
            return (
              <ellipse
                key={i}
                cx="200"
                cy={i === 0 ? 128 : 124}
                rx={rx}
                ry={ry}
                fill={i % 2 === 0 ? `url(#bowl-outer-${uid})` : `url(#tier-${uid})`}
                stroke="#000000"
                strokeOpacity="0.22"
                strokeWidth="1.5"
              />
            )
          })}
        </>
      )}

      {cfg.roof !== "none" &&
        (cfg.roof === "full" ? (
          <>
            <path
              d="M 50 96 A 150 54 0 0 1 350 96"
              fill="none"
              stroke={cfg.accent}
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.85"
            />
            <path
              d="M 66 108 A 134 46 0 0 1 334 108"
              fill="none"
              stroke={cfg.accent}
              strokeWidth="4"
              strokeLinecap="round"
              opacity="0.5"
            />
          </>
        ) : (
          <path
            d="M 84 92 A 116 42 0 0 1 316 92"
            fill="none"
            stroke={cfg.accent}
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.85"
          />
        ))}

      {cfg.track &&
        (() => {
          const trackHalfH = pitchRy + 12
          const trackHalfW = pitchRx + 18
          return (
            <rect
              x={200 - trackHalfW}
              y={120 - trackHalfH}
              width={trackHalfW * 2}
              height={trackHalfH * 2}
              rx={trackHalfH}
              ry={trackHalfH}
              fill="none"
              stroke={cfg.accent}
              strokeWidth="10"
              opacity="0.85"
            />
          )
        })()}

      <rect
        x={200 - pitchRx}
        y={120 - pitchRy}
        width={pitchRx * 2}
        height={pitchRy * 2}
        fill={`url(#pitch-${uid})`}
        stroke="#ffffff"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      {/* corner arcs */}
      {[
        { cx: 200 - pitchRx, cy: 120 - pitchRy, d: "M -1 7 A 8 8 0 0 1 7 -1" },
        { cx: 200 + pitchRx, cy: 120 - pitchRy, d: "M -7 -1 A 8 8 0 0 1 1 7" },
        { cx: 200 + pitchRx, cy: 120 + pitchRy, d: "M 1 -7 A 8 8 0 0 1 -7 1" },
        { cx: 200 - pitchRx, cy: 120 + pitchRy, d: "M 7 1 A 8 8 0 0 1 -1 -7" },
      ].map((c, i) => (
        <path
          key={i}
          d={c.d}
          transform={`translate(${c.cx} ${c.cy})`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.6"
          strokeWidth="1.5"
        />
      ))}
      <line x1="200" y1={120 - pitchRy} x2="200" y2={120 + pitchRy} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <ellipse cx="200" cy="120" rx="20" ry="9" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <rect
        x={200 - pitchRx}
        y={120 - Math.min(pitchRy * 0.85, pitchRy - 4)}
        width="22"
        height={Math.min(pitchRy * 0.85, pitchRy - 4) * 2}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="2"
      />
      <rect
        x={200 + pitchRx - 22}
        y={120 - Math.min(pitchRy * 0.85, pitchRy - 4)}
        width="22"
        height={Math.min(pitchRy * 0.85, pitchRy - 4) * 2}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="2"
      />
    </svg>
  )
}
