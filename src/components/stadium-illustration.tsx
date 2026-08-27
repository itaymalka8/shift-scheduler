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

export function isStadiumStyle(value: string | null | undefined): value is StadiumStyleId {
  return STADIUM_STYLES.some((s) => s.id === value)
}

function getStadiumStyleConfig(id?: string | null): StadiumStyleConfig {
  return STADIUM_STYLES.find((s) => s.id === id) ?? STADIUM_STYLES[0]
}

export function StadiumIllustration({
  style,
  className,
}: {
  style?: string | null
  className?: string
}) {
  const cfg = getStadiumStyleConfig(style)
  const uid = cfg.id
  const bowlRx = cfg.intimate ? 128 : 166
  const bowlRy = cfg.intimate ? 46 : 62
  const pitchRx = cfg.intimate ? 108 : 98
  const pitchRy = cfg.intimate ? 40 : 36

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

      <ellipse cx="200" cy="176" rx="150" ry="14" fill="#000000" opacity="0.35" />

      {[
        { x: 42, y: 150, h: 70 },
        { x: 358, y: 150, h: 70 },
      ].map((f, i) => (
        <g key={i}>
          <circle cx={f.x} cy={f.y - f.h} r="22" fill={`url(#glow-${uid})`} />
          <line x1={f.x} y1={f.y} x2={f.x} y2={f.y - f.h} stroke="#6b6690" strokeWidth="3" />
          <rect x={f.x - 12} y={f.y - f.h - 10} width="24" height="10" rx="2" fill="#d8d6e6" />
        </g>
      ))}

      {cfg.shape === "rect" ? (
        <>
          <rect x="34" y="66" width="332" height="112" rx="18" fill={`url(#bowl-wall-${uid})`} />
          <rect x="34" y="66" width="332" height="88" rx="18" fill={`url(#bowl-outer-${uid})`} />
          <rect x="60" y="80" width="280" height="66" rx="12" fill={`url(#tier-${uid})`} />
        </>
      ) : (
        <>
          <path
            d={`M 34 128 A ${bowlRx} ${bowlRy} 0 0 0 366 128 L 366 152 A ${bowlRx} ${bowlRy} 0 0 1 34 152 Z`}
            fill={`url(#bowl-wall-${uid})`}
          />
          <ellipse cx="200" cy="128" rx={bowlRx} ry={bowlRy} fill={`url(#bowl-outer-${uid})`} />
          <ellipse cx="200" cy="124" rx={bowlRx - 34} ry={bowlRy - 13} fill={`url(#tier-${uid})`} />
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

      {cfg.track && (
        <ellipse
          cx="200"
          cy="120"
          rx={pitchRx + 16}
          ry={pitchRy + 12}
          fill="none"
          stroke={cfg.accent}
          strokeWidth="10"
          opacity="0.85"
        />
      )}

      <ellipse
        cx="200"
        cy="120"
        rx={pitchRx}
        ry={pitchRy}
        fill={`url(#pitch-${uid})`}
        stroke="#ffffff"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      <line x1="200" y1={120 - pitchRy} x2="200" y2={120 + pitchRy} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <ellipse cx="200" cy="120" rx="20" ry="9" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <ellipse
        cx={200 - pitchRx + 22}
        cy="120"
        rx="10"
        ry="16"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="2"
      />
      <ellipse
        cx={200 + pitchRx - 22}
        cy="120"
        rx="10"
        ry="16"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="2"
      />
    </svg>
  )
}
