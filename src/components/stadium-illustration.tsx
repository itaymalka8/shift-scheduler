export function StadiumIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 220" className={className} aria-hidden>
      <defs>
        <linearGradient id="stadium-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#241a4d" />
          <stop offset="100%" stopColor="#120c2e" />
        </linearGradient>
        <linearGradient id="stadium-bowl-outer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e7e5f0" />
          <stop offset="100%" stopColor="#b9b6cc" />
        </linearGradient>
        <linearGradient id="stadium-bowl-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a4468" />
          <stop offset="100%" stopColor="#2e2a47" />
        </linearGradient>
        <linearGradient id="stadium-tier" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d3d1e0" />
          <stop offset="100%" stopColor="#a29fbb" />
        </linearGradient>
        <radialGradient id="stadium-pitch" cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#16a34a" />
        </radialGradient>
        <radialGradient id="stadium-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fef08a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fef08a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="220" fill="url(#stadium-sky)" rx="12" />

      {/* ground shadow */}
      <ellipse cx="200" cy="176" rx="150" ry="14" fill="#000000" opacity="0.35" />

      {/* floodlight towers */}
      {[
        { x: 42, y: 150, h: 70 },
        { x: 358, y: 150, h: 70 },
      ].map((f, i) => (
        <g key={i}>
          <circle cx={f.x} cy={f.y - f.h} r="22" fill="url(#stadium-glow)" />
          <line x1={f.x} y1={f.y} x2={f.x} y2={f.y - f.h} stroke="#6b6690" strokeWidth="3" />
          <rect x={f.x - 12} y={f.y - f.h - 10} width="24" height="10" rx="2" fill="#d8d6e6" />
        </g>
      ))}

      {/* outer bowl wall (gives the tiered / 3D depth) */}
      <path d="M 34 128 A 166 62 0 0 0 366 128 L 366 152 A 166 62 0 0 1 34 152 Z" fill="url(#stadium-bowl-wall)" />
      <ellipse cx="200" cy="128" rx="166" ry="62" fill="url(#stadium-bowl-outer)" />

      {/* middle tier ring */}
      <ellipse cx="200" cy="124" rx="132" ry="49" fill="url(#stadium-tier)" />

      {/* inner bowl (roof canopy accent) */}
      <path
        d="M 84 92 A 116 42 0 0 1 316 92"
        fill="none"
        stroke="#6C4FD9"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* pitch */}
      <ellipse cx="200" cy="120" rx="98" ry="36" fill="url(#stadium-pitch)" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <line x1="200" y1="84" x2="200" y2="156" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <ellipse cx="200" cy="120" rx="20" ry="9" fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2" />
      <ellipse cx="122" cy="120" rx="10" ry="16" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="2" />
      <ellipse cx="278" cy="120" rx="10" ry="16" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="2" />
    </svg>
  )
}
