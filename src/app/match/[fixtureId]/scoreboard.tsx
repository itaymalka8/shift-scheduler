"use client"

import { TeamCrest } from "@/components/team-crest"
import { useT } from "@/lib/i18n/locale-context"
import { formatClockFromSeconds } from "@/lib/match/clock-math"
import type { MatchTeamView } from "./types"
import { cn } from "@/lib/utils"

function CrestFor({ team, size }: { team: MatchTeamView; size: number }) {
  return (
    <TeamCrest
      shape={team.crestShape}
      pattern={team.crestPattern}
      color={team.crestColor}
      secondaryColor={team.crestSecondaryColor}
      borderColor={team.crestBorderColor}
      icon={team.crestIcon}
      imageUrl={team.crestImageUrl}
      size={size}
    />
  )
}

export function Scoreboard({
  homeTeam,
  awayTeam,
  status,
  clockSeconds,
  homeScore,
  awayScore,
  justScored,
}: {
  homeTeam: MatchTeamView
  awayTeam: MatchTeamView
  status: "scheduled" | "live" | "finished"
  clockSeconds: number
  homeScore: number | null
  awayScore: number | null
  justScored: "home" | "away" | null
}) {
  const t = useT()

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card/95 px-3 py-4 shadow-sm sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-2 sm:gap-6">
        <TeamColumn name={homeTeam.name} crest={<CrestFor team={homeTeam} size={56} />} pulsing={justScored === "home"} />

        <div className="flex flex-col items-center gap-1.5 px-1">
          {status !== "scheduled" && (
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide",
                status === "live" ? "bg-red-500/15 text-red-600" : "bg-muted text-muted-foreground"
              )}
            >
              {status === "live" && <span className="size-1.5 animate-pulse rounded-full bg-red-500" />}
              {status === "live" ? t("match.badgeLive") : t("match.badgeFullTime")}
            </div>
          )}

          <div
            className={cn(
              "text-3xl font-extrabold tabular-nums transition-transform sm:text-5xl",
              justScored && "scale-110"
            )}
          >
            {status === "scheduled" ? "—" : homeScore} <span className="text-muted-foreground">:</span> {status === "scheduled" ? "—" : awayScore}
          </div>

          {status === "live" && (
            <div className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {formatClockFromSeconds(clockSeconds)}
            </div>
          )}
        </div>

        <TeamColumn name={awayTeam.name} crest={<CrestFor team={awayTeam} size={56} />} pulsing={justScored === "away"} />
      </div>
    </div>
  )
}

function TeamColumn({ name, crest, pulsing }: { name: string; crest: React.ReactNode; pulsing: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      <div className={cn(pulsing && "animate-goalx-scorer-pulse")}>{crest}</div>
      <div className="line-clamp-2 text-xs font-semibold sm:text-sm">{name}</div>
    </div>
  )
}
