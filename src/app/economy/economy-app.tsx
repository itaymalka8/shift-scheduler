"use client"

import { useState } from "react"
import { useLocale, useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatMarketValue, formatMarketValueCompact } from "@/lib/players/currency"

interface PlayerSalary {
  id: string
  name: string
  position: string
  overall: number
  weeklySalary: number
}

interface Transaction {
  id: string
  type: string
  amount: number
  description: string
  createdAt: string
}

function typeLabelKey(type: string): TranslationKey {
  return `economy.type.${type}` as TranslationKey
}

function positionLabelKey(position: string): TranslationKey {
  return `squad.position.${position}` as TranslationKey
}

export function EconomyApp({
  balance,
  totalWeeklyPlayerSalaries,
  nextPayrollDate,
  players,
  forecast,
  transactions,
}: {
  balance: number
  totalWeeklyPlayerSalaries: number
  nextPayrollDate: string
  players: PlayerSalary[]
  forecast: { expectedIncome: number; expectedExpenses: number; net: number }
  transactions: Transaction[]
}) {
  const t = useT()
  const { locale } = useLocale()
  const [showSalaries, setShowSalaries] = useState(false)

  const nextPaymentLabel = new Date(nextPayrollDate).toLocaleDateString(
    locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-US",
    { weekday: "long", day: "numeric", month: "numeric" }
  )

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 text-center">
        <div className="text-xs text-muted-foreground">{t("economy.balance")}</div>
        <div className={cn("text-2xl font-bold", balance < 0 ? "text-destructive" : "text-primary")}>
          {formatMarketValue(balance)}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowSalaries(true)}
        className="block w-full rounded-lg border bg-card p-4 text-start hover:bg-accent"
      >
        <div className="text-sm font-semibold">{t("economy.salariesTitle")}</div>
        <div className="mt-1 text-xl font-bold text-primary">
          {formatMarketValue(totalWeeklyPlayerSalaries)} <span className="text-sm font-normal text-muted-foreground">{t("economy.perWeek")}</span>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {t("economy.nextPayment")}: {nextPaymentLabel}
        </div>
      </button>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("economy.forecastTitle")}</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="font-bold text-emerald-600">{formatMarketValueCompact(forecast.expectedIncome)}</div>
            <div className="text-xs text-muted-foreground">{t("economy.expectedIncome")}</div>
          </div>
          <div>
            <div className="font-bold text-destructive">{formatMarketValueCompact(forecast.expectedExpenses)}</div>
            <div className="text-xs text-muted-foreground">{t("economy.expectedExpenses")}</div>
          </div>
          <div>
            <div className={cn("font-bold", forecast.net >= 0 ? "text-emerald-600" : "text-destructive")}>
              {forecast.net >= 0 ? "+" : ""}
              {formatMarketValueCompact(forecast.net)}
            </div>
            <div className="text-xs text-muted-foreground">{t("economy.expectedBalance")}</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t("economy.ledgerTitle")}</h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("economy.ledgerEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {transactions.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
                <div>
                  <div className="font-medium">{t(typeLabelKey(tx.type))}</div>
                  <div className="text-xs text-muted-foreground">{tx.description}</div>
                </div>
                <div className={cn("font-semibold", tx.amount >= 0 ? "text-emerald-600" : "text-destructive")}>
                  {tx.amount >= 0 ? "+" : ""}
                  {formatMarketValue(tx.amount)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={showSalaries} onOpenChange={setShowSalaries}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("economy.playerSalaryListTitle")}</DialogTitle>
          </DialogHeader>
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(positionLabelKey(p.position))} · {p.overall}
                  </div>
                </div>
                <div className="font-semibold text-primary">{formatMarketValue(p.weeklySalary)}</div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}
