"use client"

import { useEffect, useRef, useState } from "react"
import { useLocale, useT } from "@/lib/i18n/locale-context"
import { getCityDisplayName } from "@/lib/city-translations"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const MAX_RESULTS = 50

export function CitySelect({
  countryCode,
  value,
  onChange,
  id,
}: {
  countryCode: string | undefined
  value: string
  onChange: (city: string) => void
  id?: string
}) {
  const t = useT()
  const { locale } = useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const [cities, setCities] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState(() => getCityDisplayName(countryCode, value, locale))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setQuery(getCityDisplayName(countryCode, value, locale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, countryCode, locale])

  useEffect(() => {
    setCities([])
    if (!countryCode) return
    setLoading(true)
    fetch(`/api/cities?country=${encodeURIComponent(countryCode)}`)
      .then((res) => res.json())
      .then((body) => setCities(body.cities ?? []))
      .finally(() => setLoading(false))
  }, [countryCode])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const options = cities.map((city) => ({ city, label: getCityDisplayName(countryCode, city, locale) }))
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())).slice(0, MAX_RESULTS)
    : options.slice(0, MAX_RESULTS)

  const disabled = !countryCode

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        placeholder={disabled ? t("team.cityNeedsCountry") : t("team.cityPlaceholder")}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
      />
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {loading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">...</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t("team.cityNoResults")}</div>
          ) : (
            filtered.map(({ city, label }) => (
              <button
                key={city}
                type="button"
                onClick={() => {
                  onChange(city)
                  setQuery(label)
                  setOpen(false)
                }}
                className={cn(
                  "block w-full text-start px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
                  city === value && "bg-accent/60"
                )}
              >
                {label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
