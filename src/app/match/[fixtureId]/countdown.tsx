"use client"

import { TeamCrest } from "@/components/team-crest"
import { useT, useLocale } from "@/lib/i18n/locale-context"
import { StadiumBackdrop } from "./stadium-backdrop"
import { useCountdown, formatCountdown } from "./use-match-clock"
import type { HomeMatchTeamView, MatchTeamView } from "./types"

export function Countdown({ homeTeam, awayTeam, scheduledAt }: { homeTeam: HomeMatchTeamView; awayTeam: MatchTeamView; scheduledAt: string | null }) {
  const t = useT()
  const { locale } = useLocale()
  const msRemaining = useCountdown(scheduledAt)

  return (
    <div className="flex flex-col gap-4">
      <StadiumBackdrop homeTeam={homeTeam} celebrating={false} />

      <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-6 text-center">
        <div className="flex items-center justify-center gap-4 sm:gap-8">
          <div className="flex flex-col items-center gap-1.5">
            <TeamCrest
              shape={homeTeam.crestShape}
              pattern={homeTeam.crestPattern}
              color={homeTeam.crestColor}
              secondaryColor={homeTeam.crestSecondaryColor}
              borderColor={homeTeam.crestBorderColor}
              icon={homeTeam.crestIcon}
              imageUrl={homeTeam.crestImageUrl}
              size={64}
            />
            <span className="text-sm font-semibold">{homeTeam.name}</span>
          </div>
          <span className="text-lg font-bold text-muted-foreground">VS</span>
          <div className="flex flex-col items-center gap-1.5">
            <TeamCrest
              shape={awayTeam.crestShape}
              pattern={awayTeam.crestPattern}
              color={awayTeam.crestColor}
              secondaryColor={awayTeam.crestSecondaryColor}
              borderColor={awayTeam.crestBorderColor}
              icon={awayTeam.crestIcon}
              imageUrl={awayTeam.crestImageUrl}
              size={64}
            />
            <span className="text-sm font-semibold">{awayTeam.name}</span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-3xl font-extrabold tabular-nums sm:text-4xl">
            {t("match.kickoffIn", { time: formatCountdown(msRemaining) })}
          </span>
        </div>

        {scheduledAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(scheduledAt).toLocaleString(locale, { weekday: "long", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  )
}
