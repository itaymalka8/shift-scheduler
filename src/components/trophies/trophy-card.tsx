import Link from "next/link"
import { Trophy } from "lucide-react"
import { TeamCrest } from "@/components/team-crest"
import type { ChampionshipView } from "@/lib/trophies/championship"
import type { Translator } from "@/lib/i18n/translations"

/**
 * One championship, in both cabinets.
 *
 * The club name printed here is the HISTORICAL one whenever the row carries a
 * snapshot. When it does not - a row written before the snapshot existed - the
 * card falls back to the club's current name and says so in a footnote rather
 * than passing the fallback off as a record.
 */
export function TrophyCard({
  trophy,
  t,
  footer,
}: {
  trophy: ChampionshipView
  t: Translator
  /** Manager attribution, in the club cabinet. Omitted in a manager's own. */
  footer?: React.ReactNode
}) {
  const decision =
    trophy.decision === "PLAYOFF"
      ? t("trophy.wonInPlayoff")
      : trophy.decision === "DECIDER"
        ? t("trophy.wonInDecider")
        : t("trophy.wonOnTable")

  const round =
    trophy.decision === "PLAYOFF" && trophy.playoffRound !== null
      ? trophy.playoffPhase === "KNOCKOUT"
        ? t("trophy.playoffKnockout", { round: String(trophy.playoffRound) })
        : t("trophy.playoffRoundRobin", { round: String(trophy.playoffRound) })
      : null

  return (
    <li className="goalx-broadcast-panel flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <TeamCrest
          shape={trophy.crest.shape}
          pattern={trophy.crest.pattern}
          icon={trophy.crest.icon}
          color={trophy.crest.color}
          secondaryColor={trophy.crest.secondaryColor}
          borderColor={trophy.crest.borderColor}
          imageUrl={trophy.crest.imageUrl}
          size={44}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Trophy className="size-4 shrink-0 text-amber-500" aria-hidden />
            <span className="truncate">{trophy.clubName}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("trophy.season", { season: String(trophy.seasonNumber) })} ·{" "}
            {t("trophy.tier", { tier: String(trophy.divisionTier) })}
            {trophy.divisionGroup ? trophy.divisionGroup : ""} · {trophy.countryCode}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">{decision}</span>
        {round && <span className="text-muted-foreground">{round}</span>}
        {trophy.shootout && (
          <span className="tabular-nums text-muted-foreground">
            {t("trophy.penalties", {
              home: String(trophy.shootout.home),
              away: String(trophy.shootout.away),
            })}
          </span>
        )}
        {trophy.decidedByFixtureId && (
          // Reuses Match Center - there is no second match viewer.
          <Link href={`/match/${trophy.decidedByFixtureId}`} className="text-primary hover:underline">
            {t("trophy.viewMatch")}
          </Link>
        )}
      </div>

      {footer}

      {!trophy.clubNameIsHistorical && (
        // Honest about the fallback: this is not the name it was won under,
        // it is simply the only name that exists for this row.
        <p className="text-[11px] text-muted-foreground/80">({t("trophy.nameFallbackNote")})</p>
      )}
    </li>
  )
}
