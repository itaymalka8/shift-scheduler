"use client"

import { useEffect, useState } from "react"
import { useLocale, useT } from "@/lib/i18n/locale-context"

interface MatchData {
  status: "scheduled" | "live" | "finished"
  minute: number
  scheduledAt: string | null
  homeTeam: { id: string; name: string }
  awayTeam: { id: string; name: string }
  homeScore: number
  awayScore: number
  events: { minute: number; teamId: string }[]
}

const POLL_INTERVAL_MS = 4000

export function MatchLiveView({ fixtureId }: { fixtureId: string }) {
  const t = useT()
  const { locale } = useLocale()
  const [data, setData] = useState<MatchData | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined

    async function poll() {
      const res = await fetch(`/api/matches/${fixtureId}`)
      if (!res.ok || cancelled) return
      const body = (await res.json()) as MatchData
      if (cancelled) return
      setData(body)
      if (body.status === "finished" && timer) clearInterval(timer)
    }

    poll()
    timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [fixtureId])

  if (!data) {
    return <p className="text-muted-foreground text-center">...</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 text-center">
        <div className="flex-1 font-semibold">{data.homeTeam.name}</div>
        <div className="px-4">
          <div className="text-4xl font-bold tabular-nums">
            {data.homeScore} - {data.awayScore}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {data.status === "scheduled" &&
              (data.scheduledAt
                ? t("match.scheduledFor", {
                    date: new Date(data.scheduledAt).toLocaleString(locale, {
                      weekday: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })
                : t("match.scheduled"))}
            {data.status === "live" && t("match.liveMinute", { minute: String(data.minute) })}
            {data.status === "finished" && t("match.fullTime")}
          </div>
        </div>
        <div className="flex-1 font-semibold">{data.awayTeam.name}</div>
      </div>

      <div className="space-y-1">
        {data.events.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">{t("match.noGoalsYet")}</p>
        ) : (
          data.events.map((e, i) => (
            <div key={i} className="flex items-center justify-center gap-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{e.minute}&apos;</span>
              <span>⚽ {e.teamId === data.homeTeam.id ? data.homeTeam.name : data.awayTeam.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
