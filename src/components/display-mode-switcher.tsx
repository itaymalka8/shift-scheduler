"use client"

import { useT } from "@/lib/i18n/locale-context"
import { type DisplayMode } from "@/lib/display-mode"
import { useDisplayMode } from "@/lib/display-mode-context"
import { cn } from "@/lib/utils"

const MODES: DisplayMode[] = ["auto", "mobile", "desktop"]

export function DisplayModeSwitcher({
  className,
  variant = "light",
}: {
  className?: string
  variant?: "light" | "dark"
}) {
  const t = useT()
  const { displayMode, setDisplayMode } = useDisplayMode()

  return (
    <div className={cn("flex items-center gap-1 text-sm", className)}>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setDisplayMode(mode)}
          className={cn(
            "px-2 py-1 rounded-md transition-colors",
            displayMode === mode
              ? "bg-primary text-primary-foreground font-medium"
              : variant === "dark"
                ? "text-white/70 hover:bg-white/10 hover:text-white"
                : "text-muted-foreground hover:bg-muted"
          )}
        >
          {t(`display.mode.${mode}` as const)}
        </button>
      ))}
    </div>
  )
}
