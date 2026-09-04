"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Scoreboard } from "./scoreboard"
import { StadiumBackdrop } from "./stadium-backdrop"
import { PitchView } from "./pitch-view"
import { EventFeed } from "./event-feed"
import { LiveStats } from "./live-stats"
import { PlayerStats } from "./player-stats"
import { DeciderBanner } from "./decider-banner"
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
    return <div className="goalx-broadcast-panel animate-pulse p-8 text-center text-sm text-white/60">...</div>
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

      {/* Only rendered for a TITLE_DECIDER - a no-op strip for every other
          match, so the Match Center is unchanged for the other 1,140. */}
      <DeciderBanner data={data} />

      <div className="goalx-broadcast-panel">
        {/* The hero IS the scene: the stadium fills a broadcast-shaped frame
            and the scoreboard is composited onto it, the way a live feed
            carries its graphics - not stacked underneath as a separate card. */}
        <div className="relative aspect-[4/5] w-full sm:aspect-[16/10] lg:aspect-[16/9]">
          <StadiumBackdrop homeTeam={data.homeTeam} celebrating={celebrating} />

          <div className="absolute inset-x-0 bottom-0 z-10">
            <Scoreboard
              homeTeam={data.homeTeam}
              awayTeam={data.awayTeam}
              status={data.status}
              clockSeconds={clockSeconds}
              homeScore={homeScore}
              awayScore={awayScore}
              justScored={justScored}
            />
          </div>
        </div>

        {/* 60/40 on desktop: the pitch is the centre of the screen and the
            feed still gets enough width for a line of commentary to read
            without wrapping every few words. On mobile everything stacks in
            watching order - ground, score, pitch, then the numbers and the
            story of the match. */}
        <div className="grid grid-cols-1 items-start gap-4 px-3 pb-4 pt-4 sm:px-6 sm:pb-6 lg:grid-cols-[3fr_2fr] lg:gap-6">
          <div className="flex flex-col gap-4">
            <PitchView
              latestEvents={newEvents}
              homeTeamId={data.homeTeam.id}
              homeTeamName={data.homeTeam.name}
              awayTeamName={data.awayTeam.name}
            />
            <LiveStats liveStats={data.liveStats} finalStats={data.status === "finished" ? data.finalStats : null} />
            {/* Per-player statistics: the archive layer over data written at
                simulation time. Finished only - and the server never even
                reads the rows in any other state, so this is a second lock
                on a door that is already shut, not the only one. */}
            {data.status === "finished" && (
              <PlayerStats playerStats={data.playerStats} homeTeam={data.homeTeam} awayTeam={data.awayTeam} />
            )}
          </div>
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
