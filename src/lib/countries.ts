import countries from "i18n-iso-countries"
import en from "i18n-iso-countries/langs/en.json"
import he from "i18n-iso-countries/langs/he.json"
import ar from "i18n-iso-countries/langs/ar.json"
import type { Locale } from "@/lib/i18n/translations"

countries.registerLocale(en)
countries.registerLocale(he)
countries.registerLocale(ar)

// Countries with an active league engine at launch. Everyone else can still
// register and pick their real country - they just don't have a running
// league yet. Note: "England" has no ISO 3166-1 code of its own (only the
// United Kingdom, GB, does) - GB stands in for it here.
export const LAUNCH_COUNTRY_CODES = ["IL", "GR", "GB"] as const

export function isLaunchCountry(code: string | null | undefined): boolean {
  return !!code && (LAUNCH_COUNTRY_CODES as readonly string[]).includes(code)
}

export interface CountryOption {
  code: string
  name: string
  isLaunchCountry: boolean
}

export function getCountryOptions(locale: Locale): CountryOption[] {
  const names = countries.getNames(locale, { select: "official" })
  return Object.entries(names)
    .map(([code, name]) => ({ code, name, isLaunchCountry: isLaunchCountry(code) }))
    .sort((a, b) => {
      if (a.isLaunchCountry !== b.isLaunchCountry) return a.isLaunchCountry ? -1 : 1
      return a.name.localeCompare(b.name, locale)
    })
}

export function getCountryName(code: string | null | undefined, locale: Locale): string | null {
  if (!code) return null
  return countries.getName(code, locale, { select: "official" }) ?? code
}
