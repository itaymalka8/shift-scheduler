"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { clampForDisplay, computeSimulatedSeconds } from "@/lib/match/clock-math"

const TICK_MS = 250

/**
 * A smooth, monotonically-forward match clock (in simulated seconds,
 * 0..5400). Visual precision comes directly from (scheduledAt,
 * clockOffsetMs) - `clockOffsetMs` is a request-midpoint-corrected
 * client/server clock-skew estimate refreshed on every poll (see
 * clock-math.ts's computeClockOffsetMs and match-center.tsx's poll loop) -
 * never from the API's integer `minute` field, which stays reserved for
 * event-visibility filtering only (see route.ts / timing.ts).
 *
 * `status` drives an extra display-only clamp (clampForDisplay):
 * scheduled is always exactly 00:00, finished is always exactly 90:00, and
 * while live the clock can never move backward between two renders - a
 * resync that slightly revises the skew estimate only ever refines the
 * offset, it must never make the displayed clock visibly reverse.
 */
export function useMatchClock(scheduledAt: string | null, clockOffsetMs: number, status: "scheduled" | "live" | "finished"): number {
  const scheduledAtMsRef = useRef<number | null>(null)
  const offsetRef = useRef(clockOffsetMs)
  const lastDisplayedRef = useRef(0)

  useEffect(() => {
    scheduledAtMsRef.current = scheduledAt ? new Date(scheduledAt).getTime() : null
    offsetRef.current = clockOffsetMs
  }, [scheduledAt, clockOffsetMs])

  // scheduledAtMsRef/offsetRef/lastDisplayedRef are refs (stable identity,
  // read fresh on every call) - only `status` is a real closure dependency,
  // so this stays referentially stable across the 250ms ticks below and
  // only changes identity when scheduled/live/finished actually changes.
  const compute = useCallback(() => {
    const scheduledAtMs = scheduledAtMsRef.current
    const raw = scheduledAtMs == null ? 0 : computeSimulatedSeconds(scheduledAtMs, Date.now() + offsetRef.current)
    const clamped = clampForDisplay(raw, lastDisplayedRef.current, status)
    lastDisplayedRef.current = clamped
    return clamped
  }, [status])

  const [simSeconds, setSimSeconds] = useState(compute)

  useEffect(() => {
    setSimSeconds(compute())
    if (status !== "live") return
    const id = setInterval(() => setSimSeconds(compute()), TICK_MS)
    return () => clearInterval(id)
  }, [scheduledAt, clockOffsetMs, status, compute])

  return simSeconds
}

/** "1:23:45" / "12:03" style countdown-to-kickoff readout from milliseconds remaining. */
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** Local, API-free countdown to a kickoff instant - ticks every second, no polling involved. */
export function useCountdown(target: string | null): number {
  const [msRemaining, setMsRemaining] = useState(() => (target ? new Date(target).getTime() - Date.now() : 0))

  useEffect(() => {
    if (!target) return
    const targetMs = new Date(target).getTime()
    const update = () => setMsRemaining(Math.max(0, targetMs - Date.now()))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [target])

  return msRemaining
}
