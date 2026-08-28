"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { AlertCircle } from "lucide-react"
import { useT } from "@/lib/i18n/locale-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type GoalXLoadingMode = "login" | "createClub"

export interface GoalXLoadingScreenProps {
  mode: GoalXLoadingMode
  /** 0-100. The caller owns how this is computed (real backend progress, or a capped-until-success estimate) - this component only ever renders it. */
  progress: number
  /** Already-localized current step text (e.g. "מתחברים לחשבון") - varies too much by mode/step to own here. */
  status: string
  /** Set to show the error state instead of progress. Already-localized. */
  error?: string | null
  onRetry?: () => void
  onBack?: () => void
}

const RING_SIZE = 132
const RING_STROKE = 6
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

// If neither progress nor status has moved in this long, and we're not done
// or errored, show the "taking longer than usual" reassurance instead of
// leaving the user staring at a frozen-looking number.
const SLOW_HINT_DELAY_MS = 6000

/**
 * The one loading screen for any full-page async wait in the app (currently
 * sign-in and club creation - see the mode union). Renders whatever
 * progress/status it's given; owns only its own presentation and the
 * generic "this is taking a while" / error affordances that are the same
 * regardless of what's actually loading.
 */
export function GoalXLoadingScreen({ mode, progress, status, error, onRetry, onBack }: GoalXLoadingScreenProps) {
  const t = useT()
  const clamped = Math.max(0, Math.min(100, Math.round(progress)))
  const isDone = clamped >= 100 && !error

  const [showSlowHint, setShowSlowHint] = useState(false)
  const lastChangeRef = useRef({ progress, status, at: Date.now() })

  useEffect(() => {
    if (progress !== lastChangeRef.current.progress || status !== lastChangeRef.current.status) {
      lastChangeRef.current = { progress, status, at: Date.now() }
      setShowSlowHint(false)
    }
  }, [progress, status])

  useEffect(() => {
    if (error || isDone) {
      setShowSlowHint(false)
      return
    }
    const elapsed = Date.now() - lastChangeRef.current.at
    const timer = setTimeout(() => setShowSlowHint(true), Math.max(0, SLOW_HINT_DELAY_MS - elapsed))
    return () => clearTimeout(timer)
  }, [progress, status, error, isDone])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden px-6"
      style={{
        background:
          "radial-gradient(circle at 50% 20%, oklch(0.96 0.015 292) 0%, oklch(0.98 0.005 292) 55%, oklch(0.98 0.005 292) 100%)",
      }}
    >
      {error ? (
        <div className="flex max-w-xs flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="size-8 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <p className="text-lg font-semibold text-foreground">{t("loading.error.title")}</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <div className="mt-2 flex w-full gap-2">
            {onBack && (
              <Button variant="outline" className="flex-1" onClick={onBack}>
                {t("loading.back")}
              </Button>
            )}
            {onRetry && (
              <Button className="flex-1" onClick={onRetry}>
                {t("loading.retry")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6">
          <div className="relative flex items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              className="-rotate-90"
              aria-hidden="true"
            >
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="var(--muted)"
                strokeWidth={RING_STROKE}
              />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped / 100)}
                style={{ transition: "stroke-dashoffset 500ms cubic-bezier(0.4, 0, 0.2, 1)" }}
              />
            </svg>
            <div
              className={cn(
                "absolute flex size-20 items-center justify-center rounded-full bg-card shadow-sm",
                "motion-safe:animate-[goalx-loading-pulse_2.2s_ease-in-out_infinite]"
              )}
            >
              <Image src="/logo.png" alt="GoalX Manager" width={56} height={56} className="rounded-full" priority />
            </div>
          </div>

          <div className="text-center">
            <p className="text-4xl font-bold tabular-nums text-primary" aria-hidden="true">
              {clamped}%
            </p>
          </div>

          <div className="min-h-10 max-w-xs text-center" aria-live="polite" role="status">
            <p className="text-sm font-medium text-foreground">{isDone ? t("loading.ready") : status}</p>
            {showSlowHint && !isDone && (
              <p className="mt-1 text-xs text-muted-foreground">{t("loading.slow")}</p>
            )}
          </div>
        </div>
      )}
      {/* mode is currently only read by callers picking the status sequence,
          but kept as a real prop (not inferred) so a future third mode can't
          silently fall back to the wrong copy. */}
      <span className="sr-only">{mode}</span>
    </div>
  )
}
