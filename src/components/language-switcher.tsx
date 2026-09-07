"use client"

import { useLocale } from "@/lib/i18n/locale-context"
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/translations"
import { cn } from "@/lib/utils"

export function LanguageSwitcher({
  className,
  variant = "light",
}: {
  className?: string
  variant?: "light" | "dark"
}) {
  const { locale, setLocale } = useLocale()

  return (
    <div className={cn("flex items-center gap-1 text-sm", className)}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={cn(
            "px-2 py-1 rounded-md transition-colors",
            locale === l
              ? "bg-primary text-primary-foreground font-medium"
              : variant === "dark"
                ? "text-white/70 hover:bg-white/10 hover:text-white"
                : "text-muted-foreground hover:bg-muted"
          )}
        >
          {LOCALE_LABEL[l]}
        </button>
      ))}
    </div>
  )
}
