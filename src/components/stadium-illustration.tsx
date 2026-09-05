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

/** Deterministic pseudo-random in [0,1) - a pure hash of `seed`, never
 *  Math.random(), so the crowd texture never re-shuffles or flickers when
 *  the component re-renders (e.g. every poll tick in the Match Center). */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
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

const DEFAULT_CROWD_PRIMARY = "#361D78"
const DEFAULT_CROWD_SECONDARY = "#5D4890"
const CALM_CROWD_PALETTE = ["#4B4468", "#635C82", "#8783A0", "#3A3555", "#6E6790"]

function buildUltrasPalette(primary: string, secondary: string): string[] {
  return [primary, secondary, "#F5F1FF", primary, secondary, "#2A1650"]
}

// A grid of many thumbnail-sized instances (the style picker) must stay
// cheap, so the total dot count is capped regardless of tier count/capacity
// rather than growing unbounded with `growth`.
const TOTAL_CROWD_DOT_BUDGET = 130

function ovalCrowdDots(
  rxIn: number,
  ryIn: number,
  rxOut: number,
  ryOut: number,
  count: number,
  seedBase: number,
): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = seededRandom(seedBase + i * 7.13) * Math.PI * 2
    const depth = seededRandom(seedBase + i * 3.7 + 50)
    const rx = lerp(rxIn, rxOut, depth)
    const ry = lerp(ryIn, ryOut, depth)
    return { x: 200 + Math.cos(angle) * rx, y: 124 + Math.sin(angle) * ry }
  })
}

function rectCrowdDots(
  hwIn: number,
  hhIn: number,
  hwOut: number,
  hhOut: number,
  count: number,
  seedBase: number,
): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const t = seededRandom(seedBase + i * 7.13)
    const depth = seededRandom(seedBase + i * 3.7 + 50)
    const hw = lerp(hwIn, hwOut, depth)
    const hh = lerp(hhIn, hhOut, depth)
    const p = pointOnRectPerimeter(hw, hh, t)
    return { x: 200 + p.x, y: 120 + p.y }
  })
}

export function StadiumIllustration({
  style,
  capacity = MIN_STADIUM_CAPACITY,
  crowdStyle,
  primaryColor,
  secondaryColor,
  animated = false,
  className,
}: {
  style?: string | null
  capacity?: number
  /** Drives crowd density/palette/movement. Omit for a neutral crowd. */
  crowdStyle?: "calm" | "ultras" | null
  /** Tints the crowd + LED perimeter strip - defaults to the GoalX brand purple. */
  primaryColor?: string | null
  secondaryColor?: string | null
  /** Gates CSS-animated crowd motion. Keep false for grids of many
   *  simultaneous instances (a style picker); true for a single hero
   *  instance (Match Center, a selected-style preview). */
  animated?: boolean
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

  const primary = primaryColor || DEFAULT_CROWD_PRIMARY
  const secondary = secondaryColor || DEFAULT_CROWD_SECONDARY
  const isUltras = crowdStyle === "ultras"
  const hasCrowd = crowdStyle != null
  const crowdPalette = isUltras ? buildUltrasPalette(primary, secondary) : CALM_CROWD_PALETTE
  const crowdMotionClass = !animated ? "" : isUltras ? "animate-goalx-crowd-ultras" : "animate-goalx-crowd-calm"

  // Perspective pitch: narrower at the far (top) touchline, wider at the
  // near (bottom) one, so it reads as viewed from an elevated stand rather
  // than a flat top-down rectangle.
  const pitchTopY = 120 - pitchRy
  const pitchBottomY = 120 + pitchRy
  const pitchTopHalf = pitchRx * (cfg.intimate ? 0.68 : 0.62)
  const pitchBottomHalf = pitchRx * 1.08
  const halfWidthAt = (y: number) => lerp(pitchTopHalf, pitchBottomHalf, (y - pitchTopY) / (pitchBottomY - pitchTopY))

  const centerLineHalf = halfWidthAt(120)
  const farPenaltyDepth = pitchRy * 0.32
  const nearPenaltyDepth = pitchRy * 0.5
  const farPenaltyOuterHalf = halfWidthAt(pitchTopY + farPenaltyDepth) * 0.46
  const nearPenaltyOuterHalf = halfWidthAt(pitchBottomY - nearPenaltyDepth) * 0.5

  return (
    <svg viewBox="0 0 400 220" className={className} aria-hidden>
      <defs>
        <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e1142" />
          <stop offset="100%" stopColor="#0d0720" />
        </linearGradient>
        <linearGradient id={`bowl-outer-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cfg.id === "historic" ? "#e8dcc4" : "#e7e5f0"} />
          <stop offset="100%" stopColor={cfg.id === "historic" ? "#b8a97e" : "#b9b6cc"} />
        </linearGradient>
        <linearGradient id={`bowl-wall-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#372a5c" />
          <stop offset="100%" stopColor="#1b1436" />
        </linearGradient>
        <linearGradient id={`tier-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cfg.id === "historic" ? "#d8caa0" : "#d3d1e0"} />
          <stop offset="100%" stopColor={cfg.id === "historic" ? "#a3936a" : "#a29fbb"} />
        </linearGradient>
        <linearGradient id={`pitch-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3fae6a" />
          <stop offset="55%" stopColor="#2f9c58" />
          <stop offset="100%" stopColor="#227a45" />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fef08a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`pitch-sheen-${uid}`} cx="50%" cy="18%" r="65%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="220" fill={`url(#sky-${uid})`} rx="12" />

      {/* Evening atmosphere: a few faint stars above the bowl. */}
      {[
        { x: 44, y: 20, r: 0.9 },
        { x: 96, y: 34, r: 0.6 },
        { x: 300, y: 22, r: 0.7 },
        { x: 352, y: 40, r: 0.9 },
        { x: 200, y: 16, r: 0.6 },
      ].map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity="0.5" />
      ))}

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
          const color = hasCrowd ? crowdPalette[i % crowdPalette.length] : cfg.accent
          return <rect key={i} x={x - 3} y={y - 2.5} width="6" height="5" rx="1" fill={color} opacity="0.9" />
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
            const fNext = Math.min(1, (i + 1) / tiers)
            const hw = lerp(bowlRx + 10, pitchRx + 10, f)
            const hh = lerp(bowlRy, pitchRy + 10, f)
            const hwNext = lerp(bowlRx + 10, pitchRx + 10, fNext)
            const hhNext = lerp(bowlRy, pitchRy + 10, fNext)
            const dotCount = hasCrowd && i < tiers ? Math.round(TOTAL_CROWD_DOT_BUDGET / tiers) : 0
            const dots = dotCount > 0 ? rectCrowdDots(hwNext, hhNext, hw, hh, dotCount, i * 97 + 11) : []
            return (
              <g key={i}>
                <rect
                  x={200 - hw}
                  y={120 - hh}
                  width={hw * 2}
                  height={hh * 2}
                  rx="14"
                  fill={i % 2 === 0 ? `url(#bowl-outer-${uid})` : `url(#tier-${uid})`}
                  stroke="#000000"
                  strokeOpacity="0.22"
                  strokeWidth="1.5"
                />
                {dots.map((d, di) => (
                  <circle
                    key={di}
                    cx={d.x}
                    cy={d.y}
                    r="1.3"
                    fill={crowdPalette[di % crowdPalette.length]}
                    opacity="0.85"
                    className={crowdMotionClass}
                    style={animated ? { animationDelay: `${(di % 12) * 0.11}s`, transformOrigin: `${d.x}px ${d.y}px` } : undefined}
                  />
                ))}
              </g>
            )
          })}
          {/* Tunnel entrances - two dark notches at the base of the near stand. */}
          <rect x={200 - 22} y={120 + bowlRy - wallHeight * 0.15} width="14" height={wallHeight * 0.75} rx="2" fill="#0d0720" opacity="0.7" />
          <rect x={200 + 8} y={120 + bowlRy - wallHeight * 0.15} width="14" height={wallHeight * 0.75} rx="2" fill="#0d0720" opacity="0.7" />
        </>
      ) : (
        <>
          <path
            d={`M ${200 - bowlRx} 128 A ${bowlRx} ${bowlRy} 0 0 0 ${200 + bowlRx} 128 L ${200 + bowlRx} ${128 + wallHeight} A ${bowlRx} ${bowlRy} 0 0 1 ${200 - bowlRx} ${128 + wallHeight} Z`}
            fill={`url(#bowl-wall-${uid})`}
          />
          {Array.from({ length: tiers + 1 }).map((_, i) => {
            const f = i / tiers
            const fNext = Math.min(1, (i + 1) / tiers)
            const rx = lerp(bowlRx, pitchRx + 6, f)
            const ry = lerp(bowlRy, pitchRy + 6, f)
            const rxNext = lerp(bowlRx, pitchRx + 6, fNext)
            const ryNext = lerp(bowlRy, pitchRy + 6, fNext)
            const dotCount = hasCrowd && i < tiers ? Math.round(TOTAL_CROWD_DOT_BUDGET / tiers) : 0
            const dots = dotCount > 0 ? ovalCrowdDots(rxNext, ryNext, rx, ry, dotCount, i * 97 + 11) : []
            return (
              <g key={i}>
                <ellipse
                  cx="200"
                  cy={i === 0 ? 128 : 124}
                  rx={rx}
                  ry={ry}
                  fill={i % 2 === 0 ? `url(#bowl-outer-${uid})` : `url(#tier-${uid})`}
                  stroke="#000000"
                  strokeOpacity="0.22"
                  strokeWidth="1.5"
                />
                {dots.map((d, di) => (
                  <circle
                    key={di}
                    cx={d.x}
                    cy={d.y}
                    r="1.3"
                    fill={crowdPalette[di % crowdPalette.length]}
                    opacity="0.85"
                    className={crowdMotionClass}
                    style={animated ? { animationDelay: `${(di % 12) * 0.11}s`, transformOrigin: `${d.x}px ${d.y}px` } : undefined}
                  />
                ))}
              </g>
            )
          })}
          {/* Tunnel entrances - two dark notches at the base of the near stand. */}
          <rect x={200 - 22} y={128 + wallHeight * 0.2} width="14" height={wallHeight * 0.7} rx="2" fill="#0d0720" opacity="0.7" />
          <rect x={200 + 8} y={128 + wallHeight * 0.2} width="14" height={wallHeight * 0.7} rx="2" fill="#0d0720" opacity="0.7" />
        </>
      )}

      {isUltras &&
        !seatMode &&
        [
          { x: 200 - bowlRx * 0.42, y: 132 },
          { x: 200, y: 128 },
          { x: 200 + bowlRx * 0.42, y: 132 },
        ].map((f, i) => (
          <path
            key={i}
            d={`M${f.x} ${f.y + 9} Q${f.x - 7} ${f.y - 3} ${f.x} ${f.y - 11} Q${f.x + 7} ${f.y - 3} ${f.x} ${f.y + 9} Z`}
            fill={i % 2 === 0 ? primary : secondary}
            opacity="0.92"
            className={animated ? "animate-goalx-flag-wave" : undefined}
            style={animated ? { animationDelay: `${i * 0.3}s`, transformOrigin: `${f.x}px ${f.y + 6}px` } : undefined}
          />
        ))}

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
            {/* Glass roof mullions - a modern/retractable structural detail. */}
            {Array.from({ length: 9 }).map((_, i) => {
              const t = i / 8
              const x = lerp(66, 334, t)
              return <line key={i} x1={x} y1={108} x2={lerp(50, 350, t)} y2={96} stroke={cfg.accent} strokeWidth="1" opacity="0.35" />
            })}
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

      {/* Pitch - drawn as a perspective trapezoid (narrower far edge, wider
          near edge) rather than a flat top-down rectangle. */}
      <path
        d={`M ${200 - pitchTopHalf} ${pitchTopY} L ${200 + pitchTopHalf} ${pitchTopY} L ${200 + pitchBottomHalf} ${pitchBottomY} L ${200 - pitchBottomHalf} ${pitchBottomY} Z`}
        fill={`url(#pitch-${uid})`}
        stroke="#ffffff"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      <path
        d={`M ${200 - pitchTopHalf} ${pitchTopY} L ${200 + pitchTopHalf} ${pitchTopY} L ${200 + pitchBottomHalf} ${pitchBottomY} L ${200 - pitchBottomHalf} ${pitchBottomY} Z`}
        fill={`url(#pitch-sheen-${uid})`}
      />
      {/* Mowing stripes for a broadcast-pitch feel. */}
      {Array.from({ length: 6 }).map((_, i) => {
        const y0 = lerp(pitchTopY, pitchBottomY, i / 6)
        const y1 = lerp(pitchTopY, pitchBottomY, (i + 1) / 6)
        if (i % 2 !== 0) return null
        return (
          <path
            key={i}
            d={`M ${200 - halfWidthAt(y0)} ${y0} L ${200 + halfWidthAt(y0)} ${y0} L ${200 + halfWidthAt(y1)} ${y1} L ${200 - halfWidthAt(y1)} ${y1} Z`}
            fill="#ffffff"
            opacity="0.05"
          />
        )
      })}
      {/* Halfway line + center circle (squashed to match the perspective). */}
      <line x1="200" y1={pitchTopY} x2="200" y2={pitchBottomY} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <ellipse cx="200" cy="120" rx={centerLineHalf * 0.34} ry="8" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      {/* Far (top) penalty box. */}
      <path
        d={`M ${200 - farPenaltyOuterHalf} ${pitchTopY} L ${200 + farPenaltyOuterHalf} ${pitchTopY} L ${200 + farPenaltyOuterHalf * 0.86} ${pitchTopY + farPenaltyDepth} L ${200 - farPenaltyOuterHalf * 0.86} ${pitchTopY + farPenaltyDepth} Z`}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="1.5"
      />
      {/* Near (bottom) penalty box - larger, per the perspective. */}
      <path
        d={`M ${200 - nearPenaltyOuterHalf * 0.82} ${pitchBottomY - nearPenaltyDepth} L ${200 + nearPenaltyOuterHalf * 0.82} ${pitchBottomY - nearPenaltyDepth} L ${200 + nearPenaltyOuterHalf} ${pitchBottomY} L ${200 - nearPenaltyOuterHalf} ${pitchBottomY} Z`}
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="1.5"
      />

      {/* LED perimeter strip along the near touchline - tinted by the club's
          own colors (or the GoalX brand purple by default). */}
      {Array.from({ length: 10 }).map((_, i) => {
        const t0 = i / 10
        const t1 = (i + 1) / 10
        const x0 = lerp(200 - pitchBottomHalf, 200 + pitchBottomHalf, t0)
        const x1 = lerp(200 - pitchBottomHalf, 200 + pitchBottomHalf, t1)
        return (
          <rect
            key={i}
            x={x0}
            y={pitchBottomY + 2}
            width={x1 - x0 - 1}
            height="3.5"
            fill={i % 2 === 0 ? primary : secondary}
            opacity="0.9"
          />
        )
      })}
    </svg>
  )
}
