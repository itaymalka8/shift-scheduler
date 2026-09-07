"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LOCALE_DIR, getTranslator, type Locale, type Translator } from "./translations"

const LOCALE_COOKIE = "goalx-locale"

function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: React.ReactNode
}) {
  const router = useRouter()
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next)
      setLocaleCookie(next)
      document.documentElement.lang = next
      document.documentElement.dir = LOCALE_DIR[next]
      // Server components (e.g. the dashboard) render their text from the
      // cookie at request time, so refresh them to pick up the new locale.
      router.refresh()
    },
    [router]
  )

  const t = useMemo(() => getTranslator(locale), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider")
  return ctx
}

export function useT() {
  return useLocale().t
}
