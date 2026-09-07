import {
  Shield,
  ShieldCheck,
  Trophy,
  Star,
  Zap,
  Flame,
  Crown,
  Swords,
  Target,
  Rocket,
  Gem,
  Award,
  Flag,
  CircleDot,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type CrestShapeId = "circle" | "shield" | "hexagon" | "pennant"

export const CREST_SHAPES: { id: CrestShapeId; label: string }[] = [
  { id: "shield", label: "מגן" },
  { id: "circle", label: "עיגול" },
  { id: "hexagon", label: "משושה" },
  { id: "pennant", label: "דגלון" },
]

export const DEFAULT_CREST_SHAPE: CrestShapeId = "shield"

export function isCrestShape(value: string | null | undefined): value is CrestShapeId {
  return CREST_SHAPES.some((s) => s.id === value)
}

// Normalized (0-1) path data, used as objectBoundingBox clipPaths so they scale to any size.
const SHAPE_PATHS: Record<Exclude<CrestShapeId, "circle">, string> = {
  shield:
    "M0.50 0.04 C0.66 0.04 0.82 0.09 0.92 0.16 L0.92 0.52 C0.92 0.74 0.74 0.90 0.50 0.97 C0.26 0.90 0.08 0.74 0.08 0.52 L0.08 0.16 C0.18 0.09 0.34 0.04 0.50 0.04 Z",
  hexagon:
    "M0.30 0.04 L0.70 0.04 Q0.80 0.04 0.85 0.13 L0.96 0.40 Q1.00 0.50 0.96 0.60 L0.85 0.87 Q0.80 0.96 0.70 0.96 L0.30 0.96 Q0.20 0.96 0.15 0.87 L0.04 0.60 Q0.00 0.50 0.04 0.40 L0.15 0.13 Q0.20 0.04 0.30 0.04 Z",
  pennant:
    "M0.50 0.04 C0.66 0.04 0.82 0.09 0.92 0.16 L0.92 0.58 L0.74 0.58 L0.50 0.96 L0.26 0.58 L0.08 0.58 L0.08 0.16 C0.18 0.09 0.34 0.04 0.50 0.04 Z",
}

/** Shared clip-path definitions - render once (in the root layout) so every crest badge on the page can reference them by a stable id. */
export function CrestDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        {(Object.keys(SHAPE_PATHS) as Array<keyof typeof SHAPE_PATHS>).map((shape) => (
          <clipPath key={shape} id={`crest-clip-${shape}`} clipPathUnits="objectBoundingBox">
            <path d={SHAPE_PATHS[shape]} />
          </clipPath>
        ))}
      </defs>
    </svg>
  )
}

function getShapeStyle(shape: CrestShapeId): React.CSSProperties {
  if (shape === "circle") return { borderRadius: "9999px" }
  return { clipPath: `url(#crest-clip-${shape})` }
}

export type CrestPatternId = "solid" | "split" | "stripes"

export const CREST_PATTERNS: { id: CrestPatternId; label: string }[] = [
  { id: "solid", label: "אחיד" },
  { id: "split", label: "חצי-חצי" },
  { id: "stripes", label: "פסים" },
]

export const DEFAULT_CREST_PATTERN: CrestPatternId = "solid"

export function isCrestPattern(value: string | null | undefined): value is CrestPatternId {
  return CREST_PATTERNS.some((p) => p.id === value)
}

function getPatternBackground(pattern: CrestPatternId, primary: string, secondary: string): string {
  if (pattern === "split") return `linear-gradient(to right, ${primary} 50%, ${secondary} 50%)`
  if (pattern === "stripes") {
    return `repeating-linear-gradient(to right, ${primary} 0, ${primary} 25%, ${secondary} 25%, ${secondary} 50%)`
  }
  return primary
}

export const CREST_ICON_OPTIONS: { id: string; icon: LucideIcon }[] = [
  { id: "shield", icon: Shield },
  { id: "shield-check", icon: ShieldCheck },
  { id: "trophy", icon: Trophy },
  { id: "star", icon: Star },
  { id: "zap", icon: Zap },
  { id: "flame", icon: Flame },
  { id: "crown", icon: Crown },
  { id: "swords", icon: Swords },
  { id: "target", icon: Target },
  { id: "rocket", icon: Rocket },
  { id: "gem", icon: Gem },
  { id: "award", icon: Award },
  { id: "flag", icon: Flag },
  { id: "circle-dot", icon: CircleDot },
]

const CREST_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  CREST_ICON_OPTIONS.map((o) => [o.id, o.icon])
)

export const DEFAULT_CREST_ICON = CREST_ICON_OPTIONS[0].id

export function isCrestIcon(value: string | null | undefined): boolean {
  return !!value && value in CREST_ICON_MAP
}

function getCrestIconComponent(id?: string | null): LucideIcon {
  return (id && CREST_ICON_MAP[id]) || CREST_ICON_MAP[DEFAULT_CREST_ICON]
}

export const CREST_COLORS = [
  "#3B2F7A",
  "#6C4FD9",
  "#0284C7",
  "#0D9488",
  "#059669",
  "#65A30D",
  "#D97706",
  "#EA580C",
  "#DC2626",
  "#E11D48",
  "#C026D3",
  "#334155",
  "#FFFFFF",
  "#111827",
]

export const DEFAULT_CREST_COLOR = CREST_COLORS[0]
export const DEFAULT_CREST_SECONDARY_COLOR = "#FFFFFF"
export const DEFAULT_CREST_BORDER_COLOR = "#FFFFFF"

export function isCrestColor(value: string | null | undefined): boolean {
  return !!value && CREST_COLORS.includes(value)
}

function getContrastIconColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? "#111827" : "#FFFFFF"
}

interface TeamCrestProps {
  shape?: string | null
  pattern?: string | null
  color?: string | null
  secondaryColor?: string | null
  borderColor?: string | null
  icon?: string | null
  imageUrl?: string | null
  size?: number
  className?: string
}

export function TeamCrest({
  shape,
  pattern,
  color,
  secondaryColor,
  borderColor,
  icon,
  imageUrl,
  size = 64,
  className,
}: TeamCrestProps) {
  const resolvedShape = isCrestShape(shape) ? shape : DEFAULT_CREST_SHAPE
  const shapeStyle = getShapeStyle(resolvedShape)
  const borderWidth = Math.max(2, Math.round(size * 0.06))
  // A faint neutral outline drawn beneath the chosen border color, so a white/light
  // border or fill never disappears against a light page background.
  const outlineWidth = Math.max(1, Math.round(size * 0.015))

  if (imageUrl) {
    const resolvedBorder = isCrestColor(borderColor) ? (borderColor as string) : DEFAULT_CREST_BORDER_COLOR
    return (
      <div
        className={cn("relative shrink-0", className)}
        style={{ width: size, height: size, backgroundColor: "rgba(0,0,0,0.15)", ...shapeStyle }}
      >
        <div
          className="absolute"
          style={{ inset: outlineWidth, backgroundColor: resolvedBorder, ...shapeStyle }}
        >
          <div className="absolute" style={{ inset: borderWidth - outlineWidth, ...shapeStyle }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="סמל הקבוצה" className="w-full h-full object-cover" />
          </div>
        </div>
      </div>
    )
  }

  const resolvedPattern = isCrestPattern(pattern) ? pattern : DEFAULT_CREST_PATTERN
  const resolvedPrimary = isCrestColor(color) ? (color as string) : DEFAULT_CREST_COLOR
  const resolvedSecondary = isCrestColor(secondaryColor) ? (secondaryColor as string) : DEFAULT_CREST_SECONDARY_COLOR
  const resolvedBorder = isCrestColor(borderColor) ? (borderColor as string) : DEFAULT_CREST_BORDER_COLOR
  const Icon = getCrestIconComponent(icon)
  const iconColor = getContrastIconColor(resolvedPrimary)

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size, backgroundColor: "rgba(0,0,0,0.15)", ...shapeStyle }}
    >
      <div
        className="absolute"
        style={{ inset: outlineWidth, backgroundColor: resolvedBorder, ...shapeStyle }}
      >
        <div
          className="absolute"
          style={{
            inset: borderWidth - outlineWidth,
            background: getPatternBackground(resolvedPattern, resolvedPrimary, resolvedSecondary),
            ...shapeStyle,
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon color={iconColor} size={Math.round(size * 0.42)} strokeWidth={2.25} />
        </div>
      </div>
    </div>
  )
}
