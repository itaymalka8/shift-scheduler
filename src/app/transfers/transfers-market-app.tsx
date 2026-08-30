"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Clock } from "lucide-react"
import { useLocale, useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import { getCountryName } from "@/lib/countries"
import { getFitnessLevel } from "@/lib/players/tiers"
import { TeamCrest } from "@/components/team-crest"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface MarketPlayer {
  id: string
  firstName: string
  lastName: string
  age: number
  overall: number
  primaryPosition: string
  secondaryPositions: string[]
  marketValue: number
  weeklySalary: number
  nationality: string
  preferredFoot: "left" | "right" | "both"
  fitness: number
}

interface MarketSellingTeam {
  id: string
  name: string
  crestShape: string | null
  crestPattern: string | null
  crestIcon: string | null
  crestColor: string | null
  crestSecondaryColor: string | null
  crestBorderColor: string | null
  crestImageUrl: string | null
}

interface MarketListing {
  id: string
  askingPrice: number
  expiresAt: string
  createdAt: string
  isOwnListing: boolean
  player: MarketPlayer
  sellingTeam: MarketSellingTeam
}

interface MarketPage {
  items: MarketListing[]
  nextCursor: string | null
}

type LoadState = "loading" | "error" | "loaded"

function positionLabelKey(position: string): TranslationKey {
  return `squad.position.${position}` as TranslationKey
}

async function fetchMarketPage(cursor: string | null): Promise<MarketPage> {
  const params = new URLSearchParams()
  if (cursor) params.set("cursor", cursor)
  const res = await fetch(`/api/transfers/listings${params.toString() ? `?${params.toString()}` : ""}`)
  if (!res.ok) {
    throw new Error(`request failed with status ${res.status}`)
  }
  return (await res.json()) as MarketPage
}

/**
 * Read-only transfer market feed. Talks to exactly one endpoint -
 * GET /api/transfers/listings - and never issues a mutation of any kind
 * (no POST/PATCH/DELETE anywhere in this file). "Load more" appends the
 * next cursor page onto the existing list; it never re-fetches or discards
 * pages already shown.
 */
export function TransfersMarketApp() {
  const t = useT()
  const { locale } = useLocale()
  const [state, setState] = useState<LoadState>("loading")
  const [items, setItems] = useState<MarketListing[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Guards against a slow fetch resolving after the component has already
  // unmounted (e.g. fast client-side navigation away from the page).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadInitial = useCallback(() => {
    setState("loading")
    fetchMarketPage(null)
      .then((page) => {
        if (!mountedRef.current) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setState("loaded")
      })
      .catch(() => {
        if (!mountedRef.current) return
        setState("error")
      })
  }, [])

  useEffect(() => {
    loadInitial()
    // Intentionally runs once on mount only - "retry" re-invokes the same
    // function from the error state's button, not from this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadMore = useCallback(() => {
    if (loadingMore || !nextCursor) return
    setLoadingMore(true)
    fetchMarketPage(nextCursor)
      .then((page) => {
        if (!mountedRef.current) return
        // Appended, never replacing - previously loaded cards stay exactly
        // where they are.
        setItems((prev) => [...prev, ...page.items])
        setNextCursor(page.nextCursor)
      })
      .catch(() => {
        // A failed "load more" leaves the already-loaded cards in place;
        // the button simply re-enables so the user can try again, rather
        // than losing everything already shown.
      })
      .finally(() => {
        if (mountedRef.current) setLoadingMore(false)
      })
  }, [loadingMore, nextCursor])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("transfers.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("transfers.subtitle")}</p>
      </div>

      {state === "loading" && <MarketSkeleton />}

      {state === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t("transfers.errorTitle")}</p>
          <Button variant="outline" onClick={loadInitial}>
            {t("transfers.retry")}
          </Button>
        </div>
      )}

      {state === "loaded" && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium text-muted-foreground">{t("transfers.emptyTitle")}</p>
        </div>
      )}

      {state === "loaded" && items.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} locale={locale} t={t} />
            ))}
          </div>

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button onClick={loadMore} disabled={loadingMore} variant="secondary">
                {loadingMore && <Loader2 className="me-2 size-4 animate-spin" />}
                {loadingMore ? t("transfers.loadingMore") : t("transfers.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MarketSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      ))}
    </div>
  )
}

// A plain per-render computation, not a self-updating timer - it reflects
// "now" as of whenever the component last rendered (initial load, a
// load-more, or a retry), never ticking on its own.
function formatExpiry(expiresAt: string, locale: string): string {
  const target = new Date(expiresAt)
  const diffMs = target.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60000)

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute")
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour")
  }
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) {
    return rtf.format(diffDays, "day")
  }
  // Far enough out (or already long past, which shouldn't normally happen
  // for an active listing) that a relative phrase stops being useful -
  // fall back to a plain friendly date.
  return target.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
}

function ListingCard({
  listing,
  locale,
  t,
}: {
  listing: MarketListing
  locale: string
  t: (key: TranslationKey, vars?: Record<string, string>) => string
}) {
  const { player, sellingTeam } = listing
  const fitnessLevel = getFitnessLevel(player.fitness)
  const countryName = getCountryName(player.nationality, locale as "he" | "en" | "ar") ?? player.nationality
  const expiresAbsolute = new Date(listing.expiresAt).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TeamCrest
            shape={sellingTeam.crestShape}
            pattern={sellingTeam.crestPattern}
            icon={sellingTeam.crestIcon}
            color={sellingTeam.crestColor}
            secondaryColor={sellingTeam.crestSecondaryColor}
            borderColor={sellingTeam.crestBorderColor}
            imageUrl={sellingTeam.crestImageUrl}
            size={28}
          />
          <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{sellingTeam.name}</span>
        </div>
        {listing.isOwnListing && (
          // Text label, not color alone, so the "this is yours" signal
          // never depends on distinguishing a color.
          <Badge variant="secondary" className="shrink-0">
            {t("transfers.ownListing")}
          </Badge>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">
            {player.firstName} {player.lastName}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t(positionLabelKey(player.primaryPosition))}</span>
            {player.secondaryPositions.length > 0 && <span className="truncate">({player.secondaryPositions.map((p) => t(positionLabelKey(p))).join(", ")})</span>}
          </div>
        </div>
        <span
          className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-lg font-extrabold text-primary"
          aria-label={t("transfers.overallAriaLabel", { value: String(player.overall) })}
        >
          {player.overall}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Row label={t("squad.colAge")} value={String(player.age)} />
        <Row label={t("squad.colNationality")} value={countryName} />
        <Row label={t("squad.colFoot")} value={t(`squad.foot.${player.preferredFoot}` as TranslationKey)} />
        <Row
          label={t("squad.colFitness")}
          value={t(`squad.fitness.${fitnessLevel}` as TranslationKey)}
        />
      </dl>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-xs">
        <Row label={t("transfers.marketValue")} value={player.marketValue.toLocaleString(locale)} />
        <Row label={t("transfers.weeklySalary")} value={player.weeklySalary.toLocaleString(locale)} />
      </div>

      <div className="flex items-end justify-between gap-2 border-t pt-2">
        <div>
          <div className="text-[11px] text-muted-foreground">{t("transfers.askingPrice")}</div>
          <div className="text-xl font-extrabold text-primary">{listing.askingPrice.toLocaleString(locale)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={expiresAbsolute}>
          <Clock className="size-3.5" />
          {formatExpiry(listing.expiresAt, locale)}
        </div>
      </div>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground">{value}</dd>
    </div>
  )
}
