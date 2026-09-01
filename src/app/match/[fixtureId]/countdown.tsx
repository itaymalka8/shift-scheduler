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
    <div className="goalx-broadcast-panel">
      {/* Same scene as a live match - an empty ground before kickoff, with the
          fixture billed over it as a broadcast pre-match graphic. */}
      <div className="relative aspect-[3/4] w-full sm:aspect-[16/10] lg:aspect-[16/9]">
        <StadiumBackdrop homeTeam={homeTeam} celebrating={false} />

        <div className="absolute inset-0 z-10 flex flex-col items-center justify-end gap-3 p-4 text-center text-white sm:gap-4 sm:p-6">
          <div className="flex items-center justify-center gap-4 sm:gap-10">
            <div className="flex min-w-0 flex-col items-center gap-1.5">
              <TeamCrest
                shape={homeTeam.crestShape}
                pattern={homeTeam.crestPattern}
                color={homeTeam.crestColor}
                secondaryColor={homeTeam.crestSecondaryColor}
                borderColor={homeTeam.crestBorderColor}
                icon={homeTeam.crestIcon}
                imageUrl={homeTeam.crestImageUrl}
                size={56}
              />
              <span className="line-clamp-2 max-w-28 text-sm font-bold drop-shadow-lg sm:max-w-40">{homeTeam.name}</span>
            </div>
            <span className="text-sm font-bold uppercase tracking-[0.3em] text-white/45">{t("match.vs")}</span>
            <div className="flex min-w-0 flex-col items-center gap-1.5">
              <TeamCrest
                shape={awayTeam.crestShape}
                pattern={awayTeam.crestPattern}
                color={awayTeam.crestColor}
                secondaryColor={awayTeam.crestSecondaryColor}
                borderColor={awayTeam.crestBorderColor}
                icon={awayTeam.crestIcon}
                imageUrl={awayTeam.crestImageUrl}
                size={56}
              />
              <span className="line-clamp-2 max-w-28 text-sm font-bold drop-shadow-lg sm:max-w-40">{awayTeam.name}</span>
            </div>
          </div>

          <div className="w-full max-w-lg rounded-xl border border-white/12 bg-[#0B0917]/72 px-4 py-3 backdrop-blur-md">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/50">
              {t("match.kickoffLabel")}
            </div>
            <div
              className="font-mono font-black leading-none tabular-nums text-white"
              style={{ fontSize: "clamp(2rem, 7vw, 3.25rem)" }}
            >
              {formatCountdown(msRemaining)}
            </div>
            {scheduledAt && (
              <div className="mt-1 text-xs text-white/60">
                {new Date(scheduledAt).toLocaleString(locale, { weekday: "long", hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
