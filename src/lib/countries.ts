import countries from "i18n-iso-countries"
import en from "i18n-iso-countries/langs/en.json"
import he from "i18n-iso-countries/langs/he.json"
import ar from "i18n-iso-countries/langs/ar.json"
import type { Locale } from "@/lib/i18n/translations"

countries.registerLocale(en)
countries.registerLocale(he)
countries.registerLocale(ar)

export interface CountryOption {
  code: string
  name: string
}

export function getCountryOptions(locale: Locale): CountryOption[] {
  const names = countries.getNames(locale, { select: "official" })
  return Object.entries(names)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
}

export function getCountryName(code: string | null | undefined, locale: Locale): string | null {
  if (!code) return null
  return countries.getName(code, locale, { select: "official" }) ?? code
}
