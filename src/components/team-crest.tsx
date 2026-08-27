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

export type CrestShapeId = "circle" | "shield" | "hexagon" | "squircle"

export const CREST_SHAPES: { id: CrestShapeId; label: string }[] = [
  { id: "circle", label: "עיגול" },
  { id: "shield", label: "מגן" },
  { id: "hexagon", label: "משושה" },
  { id: "squircle", label: "ריבוע מעוגל" },
]

export const DEFAULT_CREST_SHAPE: CrestShapeId = "circle"

export function isCrestShape(value: string | null | undefined): value is CrestShapeId {
  return CREST_SHAPES.some((s) => s.id === value)
}

function getShapeClassName(shape: CrestShapeId): string {
  if (shape === "circle") return "rounded-full"
  if (shape === "squircle") return "rounded-2xl"
  return ""
}

function getShapeStyle(shape: CrestShapeId): React.CSSProperties {
  switch (shape) {
    case "shield":
      return { clipPath: "polygon(0% 0%, 100% 0%, 100% 55%, 50% 100%, 0% 55%)" }
    case "hexagon":
      return { clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)" }
    default:
      return {}
  }
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
]

export const DEFAULT_CREST_COLOR = CREST_COLORS[0]

export function isCrestColor(value: string | null | undefined): boolean {
  return !!value && CREST_COLORS.includes(value)
}

interface TeamCrestProps {
  shape?: string | null
  icon?: string | null
  color?: string | null
  imageUrl?: string | null
  size?: number
  className?: string
}

export function TeamCrest({ shape, icon, color, imageUrl, size = 64, className }: TeamCrestProps) {
  const resolvedShape = isCrestShape(shape) ? shape : DEFAULT_CREST_SHAPE
  const shapeClassName = getShapeClassName(resolvedShape)
  const shapeStyle = getShapeStyle(resolvedShape)

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt="סמל הקבוצה"
        width={size}
        height={size}
        className={cn("object-cover border border-border", shapeClassName, className)}
        style={{ width: size, height: size, ...shapeStyle }}
      />
    )
  }

  const Icon = getCrestIconComponent(icon)
  const resolvedColor = isCrestColor(color) ? (color as string) : DEFAULT_CREST_COLOR

  return (
    <div
      className={cn("flex items-center justify-center border border-white/10", shapeClassName, className)}
      style={{ width: size, height: size, backgroundColor: resolvedColor, ...shapeStyle }}
    >
      <Icon color="white" size={Math.round(size * 0.5)} strokeWidth={2} />
    </div>
  )
}
