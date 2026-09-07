import Link from "next/link"
import { TeamCrest } from "@/components/team-crest"
import type { Translator } from "@/lib/i18n/translations"
import type { FixtureListStatus } from "@/lib/match/fixture-status"
import { cn } from "@/lib/utils"

export interface MatchCardTeam {
  id: string
  name: string
  crestShape: string | null
  crestPattern: string | null
  crestIcon: string | null
  crestColor: string | null
  crestSecondaryColor: string | null
  crestBorderColor: string | null
  crestImageUrl: string | null
}

/**
 * Everything the card renders, resolved on the server. `score` is already
 * the revealed value (see revealFinalScore) - null means "must not be
 * shown", so this component has no way to leak a stored-but-not-yet-visible
 * result even if it wanted to.
 */
export interface MatchCardFixture {
  id: string
  matchday: number
  seasonNumber: number
  scheduledAt: Date | null
  status: FixtureListStatus
  homeTeam: MatchCardTeam
  awayTeam: MatchCardTeam
  isHome: boolean
  score: { home: number; away: number } | null
}

const STATUS_LABEL_KEY = {
  scheduled: "matches.statusScheduled",
  live: "matches.statusLive",
  finished: "matches.statusFinished",
  awaitingProcessing: "matches.statusAwaitingProcessing",
} as const

const CTA_LABEL_KEY = {
  scheduled: "matches.ctaDetails",
  live: "matches.ctaWatchLive",
  finished: "matches.ctaViewMatch",
  // No result to view, but the Match Center is still the honest place to
  // land - it reports the same unprocessed state rather than inventing one.
  awaitingProcessing: "matches.ctaViewMatch",
} as const

function Crest({ team }: { team: MatchCardTeam }) {
  return (
    <TeamCrest
      shape={team.crestShape}
      pattern={team.crestPattern}
      color={team.crestColor}
      secondaryColor={team.crestSecondaryColor}
      borderColor={team.crestBorderColor}
      icon={team.crestIcon}
      imageUrl={team.crestImageUrl}
      size={28}
    />
  )
}

function StatusChip({ status, t }: { status: FixtureListStatus; t: Translator }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        status === "live" && "bg-red-500 text-white",
        status === "finished" && "bg-muted text-muted-foreground",
        status === "scheduled" && "bg-primary/10 text-primary",
        status === "awaitingProcessing" && "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      )}
    >
      {status === "live" && <span className="size-1.5 animate-pulse rounded-full bg-white" />}
      {t(STATUS_LABEL_KEY[status])}
    </span>
  )
}

/**
 * One fixture, as a compact result-table row rather than a decorated card:
 * a manager scanning a season wants twenty of these to read at a glance on
 * a phone, so the crest/name/score line keeps a fixed rhythm and the meta
 * line underneath carries matchday, date, kickoff and home/away.
 */
export function MatchCard({
  fixture,
  dateLocale,
  t,
}: {
  fixture: MatchCardFixture
  dateLocale: string
  t: Translator
}) {
  const { homeTeam, awayTeam, score, status, isHome } = fixture
  const dateLabel = fixture.scheduledAt
    ? fixture.scheduledAt.toLocaleDateString(dateLocale, { day: "numeric", month: "short" })
    : null
  const timeLabel = fixture.scheduledAt
    ? fixture.scheduledAt.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })
    : null

  return (
    <li className="rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-accent/40">
      <Link href={`/match/${fixture.id}?from=matches`} className="flex flex-col gap-2">
        {/* Meta line: where this match sits in the season. */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{t("league.matchday", { n: String(fixture.matchday) })}</span>
            <span aria-hidden>·</span>
            <span
              className={cn(
                "rounded px-1 font-semibold",
                isHome ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {isHome ? t("matches.homeLabel") : t("matches.awayLabel")}
            </span>
          </span>
          <StatusChip status={status} t={t} />
        </div>

        {/* The match itself: two clubs and, when it is allowed, the score. */}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Crest team={homeTeam} />
            <span className="min-w-0 truncate text-sm font-semibold">{homeTeam.name}</span>
          </div>

          <div className="shrink-0 px-1 font-mono text-base font-bold tabular-nums">
            {score ? (
              <span>
                {score.home}
                <span className="mx-0.5 text-muted-foreground">:</span>
                {score.away}
              </span>
            ) : (
              <span className="text-muted-foreground">{t("matches.noScoreYet")}</span>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-row-reverse items-center gap-2">
            <Crest team={awayTeam} />
            <span className="min-w-0 truncate text-end text-sm font-semibold">{awayTeam.name}</span>
          </div>
        </div>

        {/* Footer line: kickoff and the call to action. */}
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {dateLabel && <span>{dateLabel}</span>}
            {timeLabel && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{timeLabel}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{t("matches.season", { n: String(fixture.seasonNumber) })}</span>
          </span>
          <span
            className={cn(
              "shrink-0 font-semibold",
              status === "live" ? "text-red-600 dark:text-red-400" : "text-primary"
            )}
          >
            {t(CTA_LABEL_KEY[status])}
          </span>
        </div>
      </Link>
    </li>
  )
}
