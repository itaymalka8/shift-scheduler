interface CrowdIllustrationProps {
  style: "calm" | "ultras"
  className?: string
}

const ROWS = 3
const COLS = 9

const CALM_COLORS = ["#64748B", "#94A3B8", "#475569", "#78716C"]
const ULTRAS_COLORS = ["#DC2626", "#EA580C", "#F59E0B", "#B91C1C"]

export function CrowdIllustration({ style, className }: CrowdIllustrationProps) {
  const isUltras = style === "ultras"
  const colors = isUltras ? ULTRAS_COLORS : CALM_COLORS
  const gradientId = `crowd-bg-${style}`

  const people: { x: number; y: number; color: string; armsUp: boolean }[] = []
  let seed = 0
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      seed++
      people.push({
        x: 14 + col * 26 + (row % 2 === 1 ? 13 : 0),
        y: 26 + row * 22,
        color: colors[seed % colors.length],
        armsUp: isUltras ? seed % 3 !== 0 : false,
      })
    }
  }

  return (
    <svg viewBox="0 0 240 96" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          {isUltras ? (
            <>
              <stop offset="0%" stopColor="#7C2D12" />
              <stop offset="100%" stopColor="#1C0A05" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#1E293B" />
              <stop offset="100%" stopColor="#0B1220" />
            </>
          )}
        </linearGradient>
      </defs>

      <rect width="240" height="96" fill={`url(#${gradientId})`} rx="10" />

      {isUltras &&
        [
          { x: 36, y: 16 },
          { x: 118, y: 10 },
          { x: 196, y: 18 },
        ].map((f, i) => (
          <path
            key={i}
            d={`M${f.x} ${f.y + 10} Q${f.x - 6} ${f.y - 2} ${f.x} ${f.y - 10} Q${f.x + 6} ${f.y - 2} ${f.x} ${f.y + 10} Z`}
            fill="#FBBF24"
            opacity={0.9}
          />
        ))}

      {people.map((p, i) => (
        <g key={i}>
          {p.armsUp && (
            <path
              d={`M${p.x - 6} ${p.y + 1} L${p.x - 3} ${p.y - 7} M${p.x + 6} ${p.y + 1} L${p.x + 3} ${p.y - 7}`}
              stroke={p.color}
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
          <circle cx={p.x} cy={p.y} r="4" fill={p.color} />
          <rect x={p.x - 5} y={p.y + 3} width="10" height="9" rx="3" fill={p.color} opacity="0.85" />
        </g>
      ))}
    </svg>
  )
}
