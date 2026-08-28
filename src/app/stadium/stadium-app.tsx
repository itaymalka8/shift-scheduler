"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Armchair, Crown, Layers, Loader2, Pencil, ShieldCheck, Star, Umbrella, Users } from "lucide-react"
import { useLocale, useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Stadium3DHero } from "@/components/stadium3d/Stadium3DHero"
import { formatMarketValue, formatMarketValueCompact } from "@/lib/players/currency"
import { SEAT_TYPES, TICKET_PRICES, CONSTRUCTION_COST_PER_SEAT, type SeatCounts, type SeatType } from "@/lib/stadium/config"
import { calculateConstructionCost, calculateConstructionTime, totalSeats } from "@/lib/stadium/construction"
import { getStadiumVisualTier, getStadiumVisualLevel } from "@/lib/stadium/metrics"

const SEAT_ICONS: Record<SeatType, React.ComponentType<{ className?: string }>> = {
  regular: Armchair,
  covered: Umbrella,
  premium: Star,
  vip: Crown,
}

function seatLabelKey(type: SeatType): TranslationKey {
  return `stadium.seatType.${type}` as TranslationKey
}

function formatDays(t: ReturnType<typeof useT>, days: number): string {
  return days === 1 ? t("stadium.oneDay") : t("stadium.days", { n: String(days) })
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-US")
}

interface LastMatch {
  opponentName: string
  playedAt: string
  attendance: number
  revenue: number
}

interface ActiveJob {
  id: string
  seatsAdded: number
  totalCost: number
  startedAt: string
  endsAt: string
}

export function StadiumApp({
  stadiumName,
  teamName,
  stadiumStyle,
  seats,
  capacity,
  stadiumValue,
  weeklyMaintenance,
  balance,
  lastMatch,
  matchHistory,
  seasonStats,
  showExpansionHint,
  activeJob,
  justCompletedCapacity,
}: {
  stadiumName: string
  teamName: string
  stadiumStyle: string | null
  seats: SeatCounts
  capacity: number
  stadiumValue: number
  weeklyMaintenance: number
  balance: number
  lastMatch: LastMatch | null
  matchHistory: LastMatch[]
  seasonStats: { avgAttendance: number; peakAttendance: number; avgOccupancyPercent: number; seasonRevenue: number }
  showExpansionHint: boolean
  activeJob: ActiveJob | null
  justCompletedCapacity: number | null
}) {
  const t = useT()
  const [view, setView] = useState<"main" | "upgrade">("main")
  const [name, setName] = useState(stadiumName)
  const [showCompletedBanner, setShowCompletedBanner] = useState(justCompletedCapacity !== null)

  const visualTier = getStadiumVisualTier(capacity)
  const lastMatchOccupancy = lastMatch && capacity > 0 ? Math.round((lastMatch.attendance / capacity) * 100) : null
  const lastMatchSoldOut = lastMatch ? lastMatch.attendance >= capacity : false

  return (
    <div className="space-y-6">
      {showCompletedBanner && justCompletedCapacity !== null && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-medium">{t("stadium.constructionCompletedTitle")}</p>
          <p>{t("stadium.constructionCompletedBody", { capacity: justCompletedCapacity.toLocaleString() })}</p>
          <button
            type="button"
            onClick={() => setShowCompletedBanner(false)}
            className="mt-1 text-xs underline text-emerald-700"
          >
            {t("stadium.dismiss")}
          </button>
        </div>
      )}

      {view === "main" ? (
        <MainView
          stadiumStyle={stadiumStyle}
          name={name}
          teamName={teamName}
          setName={setName}
          capacity={capacity}
          seats={seats}
          stadiumValue={stadiumValue}
          weeklyMaintenance={weeklyMaintenance}
          lastMatch={lastMatch}
          lastMatchOccupancy={lastMatchOccupancy}
          lastMatchSoldOut={lastMatchSoldOut}
          matchHistory={matchHistory}
          seasonStats={seasonStats}
          showExpansionHint={showExpansionHint}
          activeJob={activeJob}
          visualTier={visualTier}
          onUpgradeClick={() => setView("upgrade")}
        />
      ) : (
        <UpgradeView
          seats={seats}
          capacity={capacity}
          balance={balance}
          onBack={() => setView("main")}
          onStarted={() => setView("main")}
        />
      )}
    </div>
  )
}

function MainView({
  stadiumStyle,
  name,
  teamName,
  setName,
  capacity,
  seats,
  stadiumValue,
  weeklyMaintenance,
  lastMatch,
  lastMatchOccupancy,
  lastMatchSoldOut,
  matchHistory,
  seasonStats,
  showExpansionHint,
  activeJob,
  visualTier,
  onUpgradeClick,
}: {
  stadiumStyle: string | null
  name: string
  teamName: string
  setName: (name: string) => void
  capacity: number
  seats: SeatCounts
  stadiumValue: number
  weeklyMaintenance: number
  lastMatch: LastMatch | null
  lastMatchOccupancy: number | null
  lastMatchSoldOut: boolean
  matchHistory: LastMatch[]
  seasonStats: { avgAttendance: number; peakAttendance: number; avgOccupancyPercent: number; seasonRevenue: number }
  showExpansionHint: boolean
  activeJob: ActiveJob | null
  visualTier: string
  onUpgradeClick: () => void
}) {
  const t = useT()
  const { locale } = useLocale()
  const visualLevel = getStadiumVisualLevel(capacity)
  const hasMatchData = matchHistory.length > 0
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(name)
  const [savingName, setSavingName] = useState(false)

  const daysLeft = activeJob ? Math.max(0, Math.ceil((new Date(activeJob.endsAt).getTime() - Date.now()) / 86_400_000)) : 0
  const progressPercent = activeJob
    ? Math.min(
        100,
        Math.max(
          0,
          ((Date.now() - new Date(activeJob.startedAt).getTime()) /
            (new Date(activeJob.endsAt).getTime() - new Date(activeJob.startedAt).getTime())) *
            100
        )
      )
    : 0

  async function saveName() {
    const trimmed = nameDraft.trim()
    if (!trimmed) return
    setSavingName(true)
    try {
      const res = await fetch("/api/stadium", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        const body = await res.json()
        setName(body.name)
        setEditingName(false)
      }
    } finally {
      setSavingName(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Hero + key stats: side by side from lg:, stacked (hero first) below it */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="goalx-hero-gradient overflow-hidden rounded-2xl p-4 sm:p-6">
          <div className="overflow-hidden rounded-xl shadow-lg">
            <Stadium3DHero capacity={capacity} className="block h-72 w-full sm:h-80 lg:h-[440px]" />
          </div>
          <div className="mt-4 text-white">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold sm:text-2xl">{name}</h1>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(name)
                  setEditingName(true)
                }}
                className="text-white/60 hover:text-white"
                aria-label={t("stadium.editName")}
              >
                <Pencil className="size-4" />
              </button>
            </div>
            <p className="text-sm text-white/70">{teamName}</p>
            <p className="mt-2 text-sm font-medium text-white/90">
              {t("stadium.capacity")} · {capacity.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-lg font-bold text-primary">{capacity.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{t("stadium.capacity")}</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-lg font-bold text-primary">
                {lastMatch ? lastMatch.attendance.toLocaleString() : "—"}
              </div>
              <div className="text-xs text-muted-foreground">{t("stadium.lastHomeMatch")}</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-lg font-bold text-primary">
                {lastMatch ? formatMarketValue(lastMatch.revenue) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">{t("stadium.revenueFromCrowd")}</div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3">
              <div className="text-lg font-bold text-primary">{t("stadium.levelValue", { n: String(visualLevel) })}</div>
              <div className="text-xs text-muted-foreground">{t(`stadium.tier.${visualTier}` as TranslationKey)}</div>
            </div>
          </div>

          <div className="mt-4">
            {lastMatch && lastMatchOccupancy !== null ? (
              <>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t("stadium.occupancy")}</span>
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    {lastMatchOccupancy}%
                    {lastMatchSoldOut && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        {t("stadium.soldOut")}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, lastMatchOccupancy)}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t("stadium.fanDataEmpty")}</p>
            )}
          </div>

          {showExpansionHint && !activeJob && (
            <p className="mt-4 rounded-lg bg-primary/5 p-3 text-sm text-primary">{t("stadium.expansionHint")}</p>
          )}
        </div>
      </div>

      {/* Stands */}
      <div className="rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="mb-3 text-sm font-semibold">{t("stadium.standsTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEAT_TYPES.map((type) => {
            const Icon = SEAT_ICONS[type]
            const count = seats[type]
            const percent = capacity > 0 ? Math.round((count / capacity) * 100) : 0
            return (
              <div key={type} className="rounded-lg bg-muted/40 p-3 text-center">
                <Icon className="mx-auto mb-1 size-5 text-primary" />
                <div className="text-sm font-bold">{count.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">{t(seatLabelKey(type))}</div>
                <div className="text-xs text-muted-foreground">{percent}%</div>
                <div className="mt-2 space-y-0.5 border-t pt-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center justify-center gap-1">
                    <Layers className="size-3" />
                    {t("stadium.standLevelLabel")}: {t("stadium.comingSoon")}
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <ShieldCheck className="size-3" />
                    {t("stadium.standStatusLabel")}: {t("stadium.standStatusActive")}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Upgrades */}
      <div className="rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="text-sm font-semibold">{t("stadium.upgradesTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("stadium.upgradeRationale")}</p>

        {activeJob ? (
          <div className="mt-4 rounded-lg bg-muted/40 p-3">
            <p className="text-sm font-medium">{t("stadium.constructionInProgressTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("stadium.constructionNewSeats", { n: activeJob.seatsAdded.toLocaleString() })}
              {" · "}
              {formatMarketValue(activeJob.totalCost)}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {daysLeft === 0 ? t("stadium.constructionEndsToday") : t("stadium.constructionEndsIn", { days: String(daysLeft) })}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <StatRow label={t("stadium.currentCapacity")} value={capacity.toLocaleString()} />
              <StatRow label={t("stadium.afterUpgrade")} value="—" />
              <StatRow label={t("stadium.totalCost")} value="—" />
              <StatRow label={t("stadium.buildTime")} value="—" />
            </div>
            <Button className="mt-4 w-full" size="lg" onClick={onUpgradeClick}>
              {t("stadium.upgradeButton")}
            </Button>
          </>
        )}
      </div>

      {/* Fan data */}
      <div className="rounded-2xl border bg-card p-4 sm:p-6">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <Users className="size-4 text-primary" />
          {t("stadium.fanDataTitle")}
        </h2>
        {hasMatchData ? (
          <div className="grid grid-cols-2 gap-3 text-center">
            <StatRow label={t("stadium.avgHomeCrowd")} value={seasonStats.avgAttendance.toLocaleString()} />
            <StatRow label={t("stadium.statsAvgOccupancy")} value={`${seasonStats.avgOccupancyPercent}%`} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("stadium.fanDataEmpty")}</p>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("stadium.statsTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <StatRow label={t("stadium.capacity")} value={capacity.toLocaleString()} />
          <StatRow label={t("stadium.statsAvgAttendance")} value={seasonStats.avgAttendance.toLocaleString()} />
          <StatRow label={t("stadium.statsPeak")} value={seasonStats.peakAttendance.toLocaleString()} />
          <StatRow label={t("stadium.statsAvgOccupancy")} value={`${seasonStats.avgOccupancyPercent}%`} />
          <StatRow label={t("stadium.statsSeasonRevenue")} value={formatMarketValueCompact(seasonStats.seasonRevenue)} />
          <StatRow label={t("stadium.statsWeeklyMaintenance")} value={formatMarketValue(weeklyMaintenance)} />
          <StatRow label={t("stadium.stadiumValue")} value={formatMarketValueCompact(stadiumValue)} />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("stadium.historyTitle")}</h2>
        {matchHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("stadium.historyEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {matchHistory.map((m) => {
              const occupancy = capacity > 0 ? Math.round((m.attendance / capacity) * 100) : 0
              return (
                <li key={m.playedAt + m.opponentName} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
                  <div>
                    <div className="font-medium">{m.opponentName}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(m.playedAt, locale)}</div>
                  </div>
                  <div className="text-end">
                    <div>{m.attendance.toLocaleString()} · {occupancy}%</div>
                    <div className="text-xs text-muted-foreground">{formatMarketValue(m.revenue)}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <Dialog open={editingName} onOpenChange={setEditingName}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("stadium.editNameTitle")}</DialogTitle>
          </DialogHeader>
          <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingName(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={saveName} disabled={savingName || !nameDraft.trim()}>
              {savingName && <Loader2 className="me-2 size-4 animate-spin" />}
              {t("stadium.editNameSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function UpgradeView({
  seats,
  capacity,
  balance,
  onBack,
  onStarted,
}: {
  seats: SeatCounts
  capacity: number
  balance: number
  onBack: () => void
  onStarted: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [additions, setAdditions] = useState<SeatCounts>({ regular: 0, covered: 0, premium: 0, vip: 0 })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; balance?: number; required?: number } | null>(null)

  const totalNew = totalSeats(additions)
  const totalCost = useMemo(() => calculateConstructionCost(additions), [additions])
  const buildDays = useMemo(() => calculateConstructionTime(totalNew), [totalNew])
  const newCapacity = capacity + totalNew

  function setQuantity(type: SeatType, value: number) {
    const n = Math.max(0, Math.min(50_000, Math.round(value) || 0))
    setAdditions((prev) => ({ ...prev, [type]: n }))
  }

  async function confirmAndStart() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/stadium/construction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(additions),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        if (body?.error === "INSUFFICIENT_FUNDS") {
          setError({ message: t("stadium.insufficientFundsTitle"), balance: body.balance, required: body.required })
        } else {
          setError({ message: t("error.UNKNOWN_ERROR") })
        }
        setConfirmOpen(false)
        return
      }
      setConfirmOpen(false)
      onStarted()
      // The active job (and its progress bar) is server-rendered from the
      // Stadium/ConstructionJob rows - refresh so the main view reflects it
      // immediately instead of showing the stale "no job" props from the
      // initial page load.
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  const endDate = new Date(Date.now() + buildDays * 86_400_000)

  return (
    <div className="space-y-4 pb-28">
      <button type="button" onClick={onBack} className="text-sm text-primary hover:underline">
        &larr; {t("stadium.back")}
      </button>

      <h1 className="text-xl font-bold">{t("stadium.upgradeTitle")}</h1>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{error.message}</p>
          {error.balance !== undefined && (
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <div>
                {t("stadium.currentBalance")}: {formatMarketValue(error.balance)}
              </div>
              {error.required !== undefined && (
                <div>
                  {t("stadium.missingAmount")}: {formatMarketValue(error.required - error.balance)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {SEAT_TYPES.map((type) => {
          const Icon = SEAT_ICONS[type]
          const rowCost = additions[type] * CONSTRUCTION_COST_PER_SEAT[type]
          return (
            <div key={type} className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex items-center gap-2">
                <Icon className="size-4 text-primary" />
                <span className="font-medium">{t(seatLabelKey(type))}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">{t("stadium.upgradeExisting")}</div>
                  <div className="font-medium">{seats[type].toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("stadium.upgradeAdd")}</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(type, additions[type] - 100)}
                      className="flex size-6 items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={additions[type]}
                      onChange={(e) => setQuantity(type, Number(e.target.value))}
                      className="w-16 rounded border bg-background px-1 py-0.5 text-center text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(type, additions[type] + 100)}
                      className="flex size-6 items-center justify-center rounded border text-muted-foreground hover:bg-accent"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("stadium.upgradeCost")}</div>
                  <div className="font-medium">{formatMarketValue(rowCost)}</div>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("stadium.pricePerSeat")}: {formatMarketValue(CONSTRUCTION_COST_PER_SEAT[type])}
              </p>
            </div>
          )
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-card p-4 shadow-lg">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <StatRow label={t("stadium.currentCapacity")} value={capacity.toLocaleString()} />
          <StatRow label={t("stadium.afterUpgrade")} value={newCapacity.toLocaleString()} />
          <StatRow label={t("stadium.totalCost")} value={formatMarketValue(totalCost)} />
          <StatRow label={t("stadium.buildTime")} value={totalNew > 0 ? formatDays(t, buildDays) : "-"} />
        </div>
        <Button className="mx-auto mt-3 block w-full max-w-3xl" disabled={totalNew === 0} onClick={() => setConfirmOpen(true)}>
          {t("stadium.startConstruction")}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("stadium.confirmTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t("stadium.confirmBody", { amount: formatMarketValue(totalCost) })}</p>
          <div className="space-y-1 text-sm">
            <StatRow label={t("stadium.confirmNewCapacity")} value={newCapacity.toLocaleString()} />
            <StatRow label={t("stadium.confirmCompletionDate")} value={endDate.toLocaleDateString()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmAndStart} disabled={submitting}>
              {submitting && <Loader2 className="me-2 size-4 animate-spin" />}
              {t("stadium.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
