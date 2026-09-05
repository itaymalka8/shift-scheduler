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
  // WHAT THIS MATCH IS, decided from FixtureStage and from nothing else.
  //
  // A PROMOTION_PLAYOFF fixture is stored on season N's TIER 1 Division even
  // though its four clubs are still tier 2 members - a Fixture must belong to
  // a competition of its season, and this is the promotion playoff TO tier 1.
  // So divisionId cannot be read as "which competition this is", and a banner
  // that fell through to the championship copy would tell a manager they were
  // playing an ordinary Ligat Ha'al league match. FixtureStage is
  // authoritative here.
  const title =
    data.stage === "PROMOTION_PLAYOFF"
      ? t("match.promotion.title")
      : data.stage === "BOUNDARY_DECIDER"
        ? t("match.boundary.title")
        : playoff
          ? t("match.playoff.title")
          : t("match.decider.title")
  // The round label is fixture metadata, public from creation like the stage
  // itself: it says which tie this is, never how any of them went.
  const round = data.stage === "BOUNDARY_DECIDER"
    ? data.boundaryRound !== null
      ? t("match.boundary.round", { round: String(data.boundaryRound) })
      : null
    : playoff
    ? playoff.phase === "ROUND_ROBIN"
      ? t("match.playoff.roundRobin", { round: String(playoff.round) })
      : playoff.isFinal
        ? t("match.playoff.final")
        : t("match.playoff.knockout", { round: String(playoff.round) })
    : null

  // A shootout only ever names the winner of THIS tie. In a playoff that is
  // not the same thing as naming the champion, so the copy differs: the
  // decider says "are champions", a playoff tie says "go through".
  // A shootout only ever names the winner of THIS tie, and what winning it
  // MEANS differs per competition: a title decider crowns a champion, a
  // championship playoff tie sends a club through, a promotion playoff
  // promotes, a boundary decider settles a league position. Saying the wrong
  // one is not a cosmetic slip - it announces a title that was not won.
  const winnerLine = (team: string) => {
    if (data.stage === "PROMOTION_PLAYOFF") return t("match.promotion.wonBy", { team })
    if (data.stage === "BOUNDARY_DECIDER") return t("match.boundary.wonBy", { team })
    if (playoff && !playoff.isFinal) return t("match.playoff.wonBy", { team })
    return t("match.decider.wonBy", { team })
  }

  const shootoutLine = shootout
    ? `${t("match.decider.penalties", { home: String(shootout.home), away: String(shootout.away) })}${
        winnerName ? ` — ${winnerLine(winnerName)}` : ""
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
