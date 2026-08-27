import {
  Shield,
  ShieldCheck,
  Trophy,
  Star,
  Zap,
  Flame,
  Crown,
  Swords,
  CircleDot,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface CrestPreset {
  id: string
  label: string
  icon: LucideIcon
  color: string
}

export const CREST_PRESETS: CrestPreset[] = [
  { id: "shield-indigo", label: "מגן אינדיגו", icon: Shield, color: "#3B2F7A" },
  { id: "shield-violet", label: "מגן סגול", icon: ShieldCheck, color: "#6C4FD9" },
  { id: "trophy-amber", label: "גביע ענבר", icon: Trophy, color: "#D97706" },
  { id: "star-rose", label: "כוכב אדום", icon: Star, color: "#E11D48" },
  { id: "zap-sky", label: "ברק תכלת", icon: Zap, color: "#0284C7" },
  { id: "flame-orange", label: "להבה כתומה", icon: Flame, color: "#EA580C" },
  { id: "crown-emerald", label: "כתר ירוק", icon: Crown, color: "#059669" },
  { id: "swords-slate", label: "חרבות אפור", icon: Swords, color: "#334155" },
  { id: "dot-fuchsia", label: "עיגול פוקסיה", icon: CircleDot, color: "#C026D3" },
]

export const DEFAULT_CREST_PRESET = CREST_PRESETS[0].id

export function getCrestPreset(id: string | null | undefined): CrestPreset {
  return CREST_PRESETS.find((p) => p.id === id) ?? CREST_PRESETS[0]
}

interface TeamCrestProps {
  preset?: string | null
  imageUrl?: string | null
  size?: number
  className?: string
}

export function TeamCrest({ preset, imageUrl, size = 64, className }: TeamCrestProps) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt="סמל הקבוצה"
        width={size}
        height={size}
        className={cn("rounded-full object-cover border border-border", className)}
        style={{ width: size, height: size }}
      />
    )
  }

  const crest = getCrestPreset(preset)
  const Icon = crest.icon

  return (
    <div
      className={cn("flex items-center justify-center rounded-full border border-white/10", className)}
      style={{ width: size, height: size, backgroundColor: crest.color }}
    >
      <Icon color="white" size={Math.round(size * 0.55)} strokeWidth={2} />
    </div>
  )
}
