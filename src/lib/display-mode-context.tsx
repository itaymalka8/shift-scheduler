"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { DISPLAY_MODE_COOKIE, type DisplayMode } from "./display-mode"

function setDisplayModeCookie(mode: DisplayMode) {
  document.cookie = `${DISPLAY_MODE_COOKIE}=${mode}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
}

interface DisplayModeContextValue {
  displayMode: DisplayMode
  setDisplayMode: (mode: DisplayMode) => void
}

const DisplayModeContext = createContext<DisplayModeContextValue | null>(null)

export function DisplayModeProvider({
  initialDisplayMode,
  children,
}: {
  initialDisplayMode: DisplayMode
  children: React.ReactNode
}) {
  const [displayMode, setDisplayModeState] = useState<DisplayMode>(initialDisplayMode)

  const setDisplayMode = useCallback(
    (next: DisplayMode) => {
      if (next === displayMode) return
      setDisplayModeState(next)
      setDisplayModeCookie(next)
      // The <meta name="viewport"> tag this drives (see generateViewport in
      // the root layout) is only ever read reliably by the browser while
      // parsing the initial HTML - mutating it after the fact from a
      // client component is exactly the "quirky" case that made the
      // product spec explicitly allow one reload here. A full navigation
      // reload (not router.refresh(), which only re-runs React's render)
      // is what actually gets a fresh viewport meta tag parsed pre-layout,
      // the same way a browser's own "Request Desktop Site" toggle works.
      window.location.reload()
    },
    [displayMode]
  )

  const value = useMemo(() => ({ displayMode, setDisplayMode }), [displayMode, setDisplayMode])

  return <DisplayModeContext.Provider value={value}>{children}</DisplayModeContext.Provider>
}

export function useDisplayMode() {
  const ctx = useContext(DisplayModeContext)
  if (!ctx) throw new Error("useDisplayMode must be used within a DisplayModeProvider")
  return ctx
}
