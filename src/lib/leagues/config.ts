import type { Locale } from "@/lib/i18n/translations"

export type LocalizedName = Record<Locale, string>

export interface LeagueTierConfig {
  tier: number
  key: string
  groups: readonly string[] // one entry per parallel division in this tier; a single "null-group" tier uses [null]
  groupSize: number
  names: LocalizedName
  /** Per-group display name suffix (e.g. "North"/"South"), or null when the tier has a single division. */
  groupNames: Record<string, LocalizedName> | null
}

// Israel's pyramid, as far as it's been designed so far. Tiers 3-6 come
// later - see the plan discussion before this was built.
//
// Promotion between tier 2 and tier 1 (confirmed with the user, not the
// obvious "2nd/3rd cross" reading of the original brief - the 3rd-vs-4th
// pairing below is deliberate, not a typo):
//   - The winner of division A and the winner of division B are promoted
//     automatically (2 spots).
//   - Playoff: 3rd place of A vs 4th place of B, and 3rd place of B vs 4th
//     place of A; both winners are promoted (2 more spots).
//   - That's 4 promoted teams, matching tier 1's 4 relegated teams.
// Tier 2's own relegation (to a tier 3 that doesn't exist yet) isn't defined
// yet, so no one relegates out of it for now.
//
// This rule isn't executed anywhere yet - there's no season-end job because
// there's no match simulation yet to actually finish a season. It's recorded
// here so the eventual season-end code has a single place to read it from.
export const ISRAEL_LEAGUE_TIERS: LeagueTierConfig[] = [
  {
    tier: 1,
    key: "ligat-haal",
    groups: [""],
    groupSize: 20,
    names: { he: "ליגת העל", en: "Ligat Ha'al", ar: "الدوري الممتاز" },
    groupNames: null,
  },
  {
    tier: 2,
    key: "liga-leumit",
    groups: ["A", "B"],
    groupSize: 20,
    names: { he: "ליגה לאומית", en: "Liga Leumit", ar: "الدوري الوطني" },
    groupNames: {
      A: { he: "צפון", en: "North", ar: "الشمال" },
      B: { he: "דרום", en: "South", ar: "الجنوب" },
    },
  },
]

// New real signups start at the bottom of whatever's been built so far.
export const NEW_SIGNUP_TIER = 2

export function getLeagueTiers(countryCode: string): LeagueTierConfig[] {
  return countryCode === "IL" ? ISRAEL_LEAGUE_TIERS : []
}

export function getDivisionName(tierConfig: LeagueTierConfig, group: string, locale: Locale): string {
  const tierName = tierConfig.names[locale]
  const groupName = tierConfig.groupNames?.[group]?.[locale]
  return groupName ? `${tierName} - ${groupName}` : tierName
}
