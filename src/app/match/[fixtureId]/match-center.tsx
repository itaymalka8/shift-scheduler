"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Scoreboard } from "./scoreboard"
import { StadiumBackdrop } from "./stadium-backdrop"
import { PitchView } from "./pitch-view"
import { EventFeed } from "./event-feed"
import { LiveStats } from "./live-stats"
import { GoalCelebration } from "./goal-celebration"
import { Countdown } from "./countdown"
import { useMatchClock } from "./use-match-clock"
import { computeClockOffsetMs } from "@/lib/match/clock-math"
import { isGoalEvent, type MatchEventView } from "./event-meta"
import type { MatchApiResponse } from "./types"

const LIVE_POLL_MS = 3500
const SCHEDULED_POLL_MS = 15000
const CELEBRATION_MS = 2600

export function MatchCenter({ fixtureId }: { fixtureId: string }) {
  const [data, setData] = useState<MatchApiResponse | null>(null)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [newEvents, setNewEvents] = useState<MatchEventView[]>([])
  const [latestGoal, setLatestGoal] = useState<MatchEventView | null>(null)
  const [celebrating, setCelebrating] = useState(false)
  const seenEventIds = useRef<Set<string>>(new Set())
  const hasPolledOnce = useRef(false)

  const pollOnce = useCallback(async (): Promise<MatchApiResponse | null> => {
    const requestStartedAt = Date.now()
    const res = await fetch(`/api/matches/${fixtureId}`)
    const responseReceivedAt = Date.now()
    if (!res.ok) return null
    const body = (await res.json()) as MatchApiResponse

    // Request-midpoint clock-skew estimate (see clock-math.ts) - refreshed
    // on every poll, used only to drive the smooth visual clock, never for
    // event visibility (that stays server-side, from `minute`).
    setClockOffsetMs(computeClockOffsetMs(requestStartedAt, responseReceivedAt, new Date(body.serverNow).getTime()))

    // The very first poll can already find the match mid-way through (a
    // user opening the page mid-match must see the correct state
    // immediately, not replay every past event as if it just happened) -
    // so only poll #2 onward treats newly-seen events as "new".
    const isFirstPoll = !hasPolledOnce.current
    hasPolledOnce.current = true

    const fresh = isFirstPoll ? [] : body.events.filter((e) => !seenEventIds.current.has(e.id))
    for (const e of body.events) seenEventIds.current.add(e.id)

    setData(body)
    if (fresh.length > 0) {
      setNewEvents(fresh)
      const goal = [...fresh].reverse().find(isGoalEvent)
      if (goal) {
        setLatestGoal(goal)
        setCelebrating(true)
        setTimeout(() => setCelebrating(false), CELEBRATION_MS)
      }
    }

    return body
  }, [fixtureId])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const loop = async () => {
      const body = await pollOnce()
      if (cancelled || !body) return
      // Finished: stop polling entirely, per spec - no further timers.
      if (body.status === "finished") return
      const delay = body.status === "scheduled" ? SCHEDULED_POLL_MS : LIVE_POLL_MS
      timer = setTimeout(loop, delay)
    }
    loop()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [pollOnce])

  // Kickoff activation: nudges the fixture's simulation to happen the
  // moment kickoff arrives, instead of waiting up to ~2 minutes for the
  // next Cron tick (see render.yaml) - the Cron is untouched and keeps
  // running as the fallback for fixtures nobody is watching. Sent AT MOST
  // ONCE per page visit, from either of the two trigger sites below - a
  // failure here never breaks the screen, since normal GET polling (above)
  // continues regardless and will simply pick up the Cron's result once it
  // lands.
  const kickoffAttemptedRef = useRef(false)
  const triggerKickoffActivation = useCallback(async () => {
    if (kickoffAttemptedRef.current) return
    kickoffAttemptedRef.current = true
    try {
      await fetch(`/api/matches/${fixtureId}/ensure-simulated`, { method: "POST" })
    } catch {
      // Best-effort only - the Cron remains the fallback if this fails.
    } finally {
      // Re-poll immediately so the UI reflects the outcome without waiting
      // for the next scheduled tick.
      pollOnce()
    }
  }, [fixtureId, pollOnce])

  // Trigger site 1: countdown reaches kickoff while the user is watching a
  // still-scheduled match. Timed directly off scheduledAt (not the 15s
  // scheduled-poll cadence), so it fires within moments of kickoff.
  const status = data?.status
  const scheduledAt = data?.scheduledAt
  const simulationReady = data?.simulationReady
  useEffect(() => {
    if (status !== "scheduled" || !scheduledAt) return
    const msUntilKickoff = new Date(scheduledAt).getTime() - Date.now()
    const timer = setTimeout(triggerKickoffActivation, Math.max(0, msUntilKickoff))
    return () => clearTimeout(timer)
  }, [status, scheduledAt, triggerKickoffActivation])

  // Trigger site 2: the user arrives (or a poll lands) already live, but
  // the engine hasn't run yet - fires once immediately, never re-fires on
  // subsequent polls (kickoffAttemptedRef already guards that).
  useEffect(() => {
    if (status !== "live" || simulationReady) return
    triggerKickoffActivation()
  }, [status, simulationReady, triggerKickoffActivation])

  const clockSeconds = useMatchClock(data?.scheduledAt ?? null, clockOffsetMs, data?.status ?? "scheduled")

  if (!data) {
    return <div className="animate-pulse rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">...</div>
  }

  if (data.status === "scheduled") {
    return <Countdown homeTeam={data.homeTeam} awayTeam={data.awayTeam} scheduledAt={data.scheduledAt} />
  }

  const homeScore = data.status === "finished" && data.finalStats ? data.finalStats.homeScore : (data.liveScore?.home ?? 0)
  const awayScore = data.status === "finished" && data.finalStats ? data.finalStats.awayScore : (data.liveScore?.away ?? 0)
  const justScored = celebrating && latestGoal ? (latestGoal.teamId === data.homeTeam.id ? "home" : "away") : null

  return (
    <div className="flex flex-col gap-4">
      <GoalCelebration
        event={celebrating ? latestGoal : null}
        scorerTeamName={latestGoal?.teamId === data.homeTeam.id ? data.homeTeam.name : data.awayTeam.name}
      />

      <StadiumBackdrop homeTeam={data.homeTeam} celebrating={celebrating} />

      <Scoreboard
        homeTeam={data.homeTeam}
        awayTeam={data.awayTeam}
        status={data.status}
        clockSeconds={clockSeconds}
        homeScore={homeScore}
        awayScore={awayScore}
        justScored={justScored}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <PitchView latestEvents={newEvents} homeTeamId={data.homeTeam.id} />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <LiveStats liveStats={data.liveStats} finalStats={data.status === "finished" ? data.finalStats : null} />
          <EventFeed
            events={data.events}
            homeTeam={data.homeTeam}
            awayTeam={data.awayTeam}
            newestEventId={newEvents.at(-1)?.id ?? null}
          />
        </div>
      </div>
    </div>
  )
}
