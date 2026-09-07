"use client"

import Link from "next/link"

import { useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import {
  formatRating,
  groupByHistoricalTeam,
  isGoalkeeper,
  passAccuracy,
  ratingBand,
  type PlayerMatchStatView,
} from "@/lib/match/player-stats-view"
import type { MatchTeamView } from "./types"

/**
 * How each player performed, for a FINISHED match only.
 *
 * Rendered solely when the Match Center's status is "finished" - and even if
 * that check were somehow bypassed, the data would not be here: the server
 * never reads PlayerMatchStats outside its finished-only branch, so
 * `playerStats` is null in every other state.
 *
 * Read-only, like the rest of the archive: no fetching, no polling, no
 * writes. It renders exactly the rows the API returned - the engine only
 * writes a row for a player who took the pitch, so an unused substitute is
 * absent rather than shown as a line of zeroes.
 */

const RATING_BAND_CLASS: Record<ReturnType<typeof ratingBand>, string> = {
  excellent: "bg-emerald-400/20 text-emerald-200",
  good: "bg-[var(--goalx-lavender)]/25 text-white",
  average: "bg-white/12 text-white/80",
  poor: "bg-amber-500/20 text-amber-200",
}

/** Columns that survive on a phone: who played, how they did, and what it cost. */
function MobileCells({ stat }: { stat: PlayerMatchStatView }) {
  return (
    <>
      <td className="px-2 py-2 text-center tabular-nums">{stat.goals}</td>
      <td className="px-2 py-2 text-center tabular-nums">{stat.assists}</td>
      <td className="px-2 py-2 text-center tabular-nums text-white/60">{stat.minutesPlayed}&apos;</td>
    </>
  )
}

/**
 * Everything else - each cell hidden below the sm breakpoint, so the phone
 * view is the same table with fewer columns rather than a second component
 * to keep in sync. What remains visible still scrolls inside the table's own
 * container, never the page.
 */
function DesktopCells({ stat }: { stat: PlayerMatchStatView }) {
  const accuracy = passAccuracy(stat)
  const keeper = isGoalkeeper(stat)
  const cell = "hidden px-2 py-2 text-center tabular-nums sm:table-cell"

  return (
    <>
      {/* Saves for a keeper, shots for everyone else - mutually exclusive,
          so neither column is a run of meaningless zeroes. */}
      <td className={cell}>{keeper ? stat.saves : stat.shots}</td>
      <td className={`${cell} text-white/60`}>{keeper ? "—" : stat.shotsOnTarget}</td>
      <td className={cell}>
        {accuracy === null ? (
          // No passes attempted: the measurement does not exist for this
          // player, and printing 0% would read as a failure rather than an
          // absence.
          <span className="text-white/35">—</span>
        ) : (
          <>
            {accuracy}%
            <span className="ms-1 text-[11px] text-white/45">
              {stat.passesCompleted}/{stat.passesAttempted}
            </span>
          </>
        )}
      </td>
      <td className={cell}>{stat.keyPasses}</td>
      <td className={cell}>
        {stat.dribblesCompleted}
        <span className="text-white/45">/{stat.dribblesAttempted}</span>
      </td>
      <td className={cell}>{stat.tackles}</td>
      <td className={cell}>{stat.interceptions}</td>
      <td className={cell}>{stat.aerialDuelsWon}</td>
      <td className={cell}>{stat.fouls}</td>
    </>
  )
}

function Cards({ stat }: { stat: PlayerMatchStatView }) {
  if (!stat.yellowCards && !stat.redCards) return <span className="text-white/25">—</span>
  return (
    <span className="inline-flex items-center gap-1">
      {stat.yellowCards > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <span className="inline-block h-3 w-2 rounded-[1px] bg-yellow-400" />
          {stat.yellowCards > 1 && <span className="text-[11px] tabular-nums">{stat.yellowCards}</span>}
        </span>
      )}
      {stat.redCards > 0 && <span className="inline-block h-3 w-2 rounded-[1px] bg-red-500" />}
    </span>
  )
}

function TeamTable({ teamName, stats }: { teamName: string; stats: PlayerMatchStatView[] }) {
  const t = useT()

  if (stats.length === 0) {
    return (
      <div>
        <h4 className="mb-2 text-sm font-semibold text-white/85">{teamName}</h4>
        <p className="text-xs text-white/50">{t("match.playerStats.none")}</p>
      </div>
    )
  }

  const desktopHeaders: TranslationKey[] = [
    "match.playerStats.shots",
    "match.playerStats.onTarget",
    "match.playerStats.passAccuracy",
    "match.playerStats.keyPasses",
    "match.playerStats.dribbles",
    "match.playerStats.tackles",
    "match.playerStats.interceptions",
    "match.playerStats.aerials",
    "match.playerStats.fouls",
  ]

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-white/85">{teamName}</h4>
      {/* The scroll lives here, on the table's own wrapper - the page itself
          never scrolls horizontally. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-full text-xs text-white/85">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-white/45">
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("match.playerStats.player")}
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                {t("match.playerStats.rating")}
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                {t("match.playerStats.goals")}
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                {t("match.playerStats.assists")}
              </th>
              <th scope="col" className="px-2 py-2 text-center font-medium">
                {t("match.playerStats.minutes")}
              </th>
              {desktopHeaders.map((key) => (
                <th key={key} scope="col" className="hidden px-2 py-2 text-center font-medium sm:table-cell">
                  {t(key)}
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-center font-medium">
                {t("match.playerStats.cards")}
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((stat) => (
              <tr key={stat.playerId} className="border-b border-white/5 last:border-0">
                <th scope="row" className="px-2 py-2 text-start font-normal">
                  <span className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-end text-[11px] tabular-nums text-white/40">{stat.shirtNumber}</span>
                    {/* The stats row already carries the canonical playerId -
                        PlayerMatchStats.playerId, a real foreign key - so the
                        name links straight to that profile. No name lookup,
                        no id fabricated from a name. Only the NAME is the
                        link: the row is a table of numbers and wrapping the
                        whole thing would swallow nothing useful but would
                        make every cell look clickable. */}
                    <Link
                      href={`/players/${stat.playerId}`}
                      className="truncate font-medium text-white underline-offset-2 hover:underline"
                    >
                      {stat.firstName} {stat.lastName}
                    </Link>
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/60">
                      {stat.primaryPosition}
                    </span>
                  </span>
                </th>
                <td className="px-2 py-2 text-center">
                  <span
                    className={`inline-block min-w-[2.5rem] rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${RATING_BAND_CLASS[ratingBand(stat.rating)]}`}
                  >
                    {formatRating(stat.rating)}
                  </span>
                </td>
                <MobileCells stat={stat} />
                <DesktopCells stat={stat} />
                <td className="px-2 py-2 text-center">
                  <Cards stat={stat} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PlayerStats({
  playerStats,
  homeTeam,
  awayTeam,
}: {
  playerStats: PlayerMatchStatView[] | null
  homeTeam: MatchTeamView
  awayTeam: MatchTeamView
}) {
  const t = useT()

  // Null in every non-finished state (the server never reads the rows then),
  // and an empty array for a finished fixture the scheduler never simulated -
  // both mean "nothing to show", so neither renders a panel.
  if (!playerStats || playerStats.length === 0) return null

  const { home, away } = groupByHistoricalTeam(playerStats, homeTeam.id, awayTeam.id)

  return (
    <div className="goalx-glass-panel rounded-2xl p-3 sm:p-4">
      <h3 className="mb-3 text-sm font-semibold text-white/75">{t("match.playerStats.title")}</h3>
      <div className="flex flex-col gap-5">
        <TeamTable teamName={homeTeam.name} stats={home} />
        <TeamTable teamName={awayTeam.name} stats={away} />
      </div>
    </div>
  )
}
