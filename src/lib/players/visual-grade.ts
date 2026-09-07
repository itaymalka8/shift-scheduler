// A purely cosmetic read of Overall - not the existing 7-step tier system
// (src/lib/players/tiers.ts's getPlayerTier, still used unchanged by
// PlayerCard/BenchChip/PlayerSquadRow). This one exists only to decorate
// the pitch mini card's frame with a Bronze/Silver/Gold treatment; it
// never touches Overall itself, never affects the match engine, and has
// no bearing on a player's actual rating.
export type PlayerVisualGrade = "bronze" | "silver" | "gold"

export function getPlayerVisualGrade(overall: number): PlayerVisualGrade {
  if (overall >= 80) return "gold"
  if (overall >= 60) return "silver"
  return "bronze"
}

export interface VisualGradeStyle {
  /** The mini card's own frame - border + a metallic backdrop that only
   *  ever shows in the small gaps around the jersey silhouette (the
   *  jersey itself is drawn on top, fully opaque), never a tint over the
   *  shirt colors the manager chose. */
  cardBorder: string
  cardBackground: string
  cardShadow: string
  /** The Overall-number pill - the single element meant to read the grade
   *  most directly (see product spec: "Overall 84 sits inside a Gold
   *  badge"). */
  badge: string
}

// One entry per grade, every visual concern in one place - adding a future
// grade (e.g. a fourth tier above Gold) means adding one more entry here,
// never touching PitchPlayerCard's JSX.
export const PLAYER_VISUAL_GRADE_CONFIG: Record<PlayerVisualGrade, VisualGradeStyle> = {
  bronze: {
    cardBorder: "border-2 border-[#8a5a35]",
    cardBackground: "bg-gradient-to-br from-[#7c4f2c] via-[#a97b48] to-[#7c4f2c]",
    cardShadow: "shadow-[0_2px_5px_rgba(90,58,24,0.35)]",
    badge: "bg-gradient-to-b from-[#c99361] to-[#8a5a35] text-[#2e1c0c] border border-[#6b431f]",
  },
  silver: {
    cardBorder: "border-2 border-[#9aa3af]",
    cardBackground: "bg-gradient-to-br from-[#e9edf1] via-[#c3c9d1] to-[#e9edf1] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
    cardShadow: "shadow-[0_2px_5px_rgba(90,100,115,0.3)]",
    badge: "bg-gradient-to-b from-[#f1f3f5] to-[#aab1ba] text-[#1c2026] border border-[#8b93a0]",
  },
  gold: {
    cardBorder: "border-2 border-[#c99a2e]",
    cardBackground: "bg-gradient-to-br from-[#f6dd9a] via-[#d9a83e] to-[#f6dd9a] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]",
    cardShadow: "shadow-[0_3px_7px_rgba(178,133,20,0.45)]",
    badge: "bg-gradient-to-b from-[#ffe9a8] to-[#b8860b] text-[#2b1c00] border border-[#8f6a06]",
  },
}
