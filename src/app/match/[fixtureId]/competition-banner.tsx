"use client"

import { useT } from "@/lib/i18n/locale-context"
import type { MatchApiResponse } from "./types"

/**
 * The three things a championship match has to say for itself: what it is,
 * where it is played, and how it was won.
 *
 * Deliberately a thin strip above the existing Match Center rather than a
 * second page - a decider and a playoff tie are normal matches played under
 * the normal engine, and the whole point of using Fixture for them was that
 * everything else (timeline, stats, the pitch, the archive) works unchanged.
 *
 * The penalty line renders ONLY from `data.shootout`, which the server
 * populates inside its finished-only branch. There is no client-side "hide
 * while live" here on purpose: while the match is live the field is null
 * because the columns were never read, so there is nothing to hide.
 */
export function CompetitionBanner({ data }: { data: MatchApiResponse }) {
  const t = useT()
  if (data.stage === "LEAGUE") return null

  const shootout = data.status === "finished" ? data.shootout : null
  const homeWon = shootout ? shootout.home > shootout.away : false
  const winnerName = shootout ? (homeWon ? data.homeTeam.name : data.awayTeam.name) : null

  const playoff = data.playoff
  const title = playoff ? t("match.playoff.title") : t("match.decider.title")
  // The round label is fixture metadata, public from creation like the stage
  // itself: it says which tie this is, never how any of them went.
  const round = playoff
    ? playoff.phase === "ROUND_ROBIN"
      ? t("match.playoff.roundRobin", { round: String(playoff.round) })
      : playoff.isFinal
        ? t("match.playoff.final")
        : t("match.playoff.knockout", { round: String(playoff.round) })
    : null

  // A shootout only ever names the winner of THIS tie. In a playoff that is
  // not the same thing as naming the champion, so the copy differs: the
  // decider says "are champions", a playoff tie says "go through".
  const shootoutLine = shootout
    ? `${t("match.decider.penalties", { home: String(shootout.home), away: String(shootout.away) })}${
        winnerName
          ? ` — ${playoff && !playoff.isFinal ? t("match.playoff.wonBy", { team: winnerName }) : t("match.decider.wonBy", { team: winnerName })}`
          : ""
      }`
    : null

  return (
    <div className="goalx-broadcast-panel flex flex-col gap-1 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          {title}
        </span>
        {round && <span className="text-xs font-medium text-foreground/80">{round}</span>}
        {data.neutralVenue && (
          <span className="text-xs text-muted-foreground">{t("match.decider.neutralVenue")}</span>
        )}
      </div>
      {shootoutLine && <p className="text-sm font-medium tabular-nums">{shootoutLine}</p>}
    </div>
  )
}
