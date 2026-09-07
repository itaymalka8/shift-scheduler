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
    <div className="px-2 pb-2 sm:px-3 sm:pb-3">
      {/* Broadcast graphic: one low, wide bar composited over the scene -
          dark broadcast glass, not an opaque box, so the stadium stays
          visible behind it. */}
      <div className="mx-auto flex max-w-2xl items-stretch overflow-hidden rounded-lg border border-white/12 bg-[#0B0917]/70 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.9)] backdrop-blur-md">
        <TeamSide team={homeTeam} align="start" pulsing={justScored === "home"} />

        <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 bg-white/[0.06] px-3 py-1.5 sm:px-5">
          <div
            className={cn(
              "font-mono font-black leading-none tabular-nums text-white transition-transform",
              justScored && "scale-110"
            )}
            style={{ fontSize: "clamp(2.5rem, 8vw, 4rem)" }}
          >
            {status === "scheduled" ? "—" : homeScore}
            <span className="mx-1 text-white/40 sm:mx-2">:</span>
            {status === "scheduled" ? "—" : awayScore}
          </div>

          <div className="flex items-center gap-1.5">
            {status !== "scheduled" && (
              <span
                className={cn(
                  "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                  status === "live" ? "bg-red-500 text-white" : "bg-white/15 text-white/75"
                )}
              >
                {status === "live" && <span className="size-1.5 animate-pulse rounded-full bg-white" />}
                {status === "live" ? t("match.badgeLive") : t("match.badgeFullTime")}
              </span>
            )}
            {status === "live" && (
              <span className="font-mono text-base font-bold tabular-nums text-white sm:text-lg">
                {formatClockFromSeconds(clockSeconds)}
              </span>
            )}
          </div>
        </div>

        <TeamSide team={awayTeam} align="end" pulsing={justScored === "away"} />
      </div>
    </div>
  )
}

/**
 * One side of the bar: crest and club name. The name is allowed two lines and
 * truncates rather than wrapping into the score - long club names are the
 * normal case in this game, not the exception.
 */
function TeamSide({ team, align, pulsing }: { team: MatchTeamView; align: "start" | "end"; pulsing: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 sm:gap-2.5 sm:px-3",
        align === "end" && "flex-row-reverse"
      )}
    >
      <div className={cn("shrink-0", pulsing && "animate-goalx-scorer-pulse")}>
        <CrestFor team={team} size={34} />
      </div>
      <div
        className={cn(
          "line-clamp-2 min-w-0 text-xs font-semibold leading-tight text-white/80 sm:text-sm",
          align === "end" ? "text-end" : "text-start"
        )}
      >
        {team.name}
      </div>
    </div>
  )
}
