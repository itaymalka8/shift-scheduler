import Link from "next/link"
import { cookies } from "next/headers"
import { Trophy, Timer, Medal, Building2, Target, Star } from "lucide-react"
import { DEFAULT_LOCALE, getTranslator, isLocale, pluralise, type Translator } from "@/lib/i18n/translations"
import { loadHallOfFame } from "@/lib/halloffame/queries"
import { loadPlayerHallOfFame } from "@/lib/halloffame/player-queries"
import type { PlayerEntry } from "@/lib/halloffame/players"
import type { BoardCut, RankedEntry, SharedPlace } from "@/lib/halloffame/leaderboards"
import { TeamCrest } from "@/components/team-crest"

export const dynamic = "force-dynamic"

/**
 * THE HALL OF FAME - a read model over history, and nothing else.
 *
 * Every figure comes from TeamEra, SeasonChampion and finished Fixture rows,
 * ranked by the pure layer. This file renders; it does not decide. It never
 * re-sorts a board it was handed, and it renders `row.rank` rather than a
 * position in an array - a tie shares a rank, and an index cannot express that.
 *
 * ONE `now` for the whole page, taken here and passed down, so a tenure and a
 * win rate on the same screen were measured from the same instant.
 */
export default async function HallOfFamePage() {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  const now = new Date()
  // Both read models are measured from the SAME instant, so a manager's win
  // rate and a player's appearance count on one screen describe one moment.
  const [board, players] = await Promise.all([loadHallOfFame(now), loadPlayerHallOfFame(now)])

  const numbers = new Intl.NumberFormat(locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB")
  const percent = new Intl.NumberFormat(locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  })
  // Counted nouns go through the locale's own plural rules - "1 titles" is
  // wrong in English, and Hebrew's dual and Arabic's six categories are wrong
  // in their own ways.
  const count = (key: string, n: number) => pluralise(locale, t, key, n, numbers.format(n))
  const days = (ms: number) => count("hof.days", Math.max(0, Math.floor(ms / 86_400_000)))
  // Two decimals is display only. The RANK was already decided on the
  // unrounded mean, so two players who both show 7.45 may legitimately hold
  // different ranks - which is honest, where inventing a tie would not be.
  const ratings = new Intl.NumberFormat(locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  /**
   * A shared place the board could not list: "3rd - 844 players on 2
   * appearances". The whole group or none of it; see boardTop.
   */
  const sharedPlace = (place: SharedPlace, metric: string) =>
    t("hof.sharedPlace", {
      rank: numbers.format(place.rank),
      players: count("hof.players", place.players),
      metric,
    })

  /**
   * A player row. No href: there is no player profile route yet, so the row
   * carries its own context instead of promising a page that does not exist.
   */
  const playerRow = (entry: PlayerEntry, metric: string, extra?: string) => {
    const position = t(`squad.position.${entry.player.primaryPosition}` as Parameters<typeof t>[0])
    const club = entry.historicalClub?.name
    const retired = entry.player.careerStatus === "RETIRED" ? t("hof.retired") : null
    return {
      key: entry.player.playerId,
      // The board stays compact and the profile holds the detail; this is the
      // link between them, and playerId is the only thing that addresses it.
      href: `/players/${entry.player.playerId}`,
      label: `${entry.player.firstName} ${entry.player.lastName}`,
      metric,
      context: [position, club, extra, retired].filter(Boolean).join(" · "),
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold sm:text-2xl">{t("hof.title")}</h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("hof.subtitle")}</p>
          </div>
          <Link href="/dashboard" className="shrink-0 text-sm text-primary hover:underline">
            {t("hof.backToDashboard")}
          </Link>
        </div>

        {/* MANAGER HONOURS */}
        <Section icon={<Trophy className="size-4" aria-hidden />} title={t("hof.sectionManagerHonours")}>
          <Board
            title={t("hof.mostChampionshipsManager")}
            empty={t("hof.emptyChampionships")}
            rows={board.managerChampionships}
            t={t}
            render={(row) => ({
              key: row.entry.manager.userId,
              href: `/managers/${row.entry.manager.userId}`,
              label: row.entry.manager.name ?? t("manager.unnamed"),
              metric: count("hof.titles", row.value),
            })}
          />
        </Section>

        {/* MANAGER PERFORMANCE */}
        <Section icon={<Medal className="size-4" aria-hidden />} title={t("hof.sectionManagerPerformance")}>
          <Board
            title={t("hof.mostWins")}
            empty={t("hof.empty")}
            rows={board.mostWins}
            t={t}
            render={(row) => ({
              key: row.entry.manager.userId,
              href: `/managers/${row.entry.manager.userId}`,
              label: row.entry.manager.name ?? t("manager.unnamed"),
              metric: count("hof.wins", row.value),
              context: count("hof.matches", row.entry.record.matches),
            })}
          />
          <Board
            title={t("hof.mostMatches")}
            empty={t("hof.empty")}
            rows={board.mostMatches}
            t={t}
            render={(row) => ({
              key: row.entry.manager.userId,
              href: `/managers/${row.entry.manager.userId}`,
              label: row.entry.manager.name ?? t("manager.unnamed"),
              metric: count("hof.matches", row.value),
              context: count("hof.wins", row.entry.record.wins),
            })}
          />
          <Board
            title={t("hof.bestWinRate")}
            note={t("hof.winRateMinimum", { min: String(board.minimumMatchesForWinRate) })}
            empty={t("hof.empty")}
            rows={board.bestWinRate}
            t={t}
            render={(row) => ({
              key: row.entry.manager.userId,
              href: `/managers/${row.entry.manager.userId}`,
              label: row.entry.manager.name ?? t("manager.unnamed"),
              metric: percent.format(row.value),
              context: count("hof.matches", row.entry.record.matches),
            })}
          />
        </Section>

        {/* MANAGER LONGEVITY */}
        <Section icon={<Timer className="size-4" aria-hidden />} title={t("hof.sectionManagerLongevity")}>
          <Board
            title={t("hof.longestTenure")}
            empty={t("hof.empty")}
            rows={board.longestTenures}
            t={t}
            render={(row) => ({
              key: row.entry.eraId,
              href: `/managers/${row.entry.manager.userId}`,
              label: row.entry.manager.name ?? t("manager.unnamed"),
              metric: days(row.value),
              context: row.entry.ongoing ? `${row.entry.club.name} · ${t("hof.ongoing")}` : row.entry.club.name,
              crest: row.entry.club,
            })}
          />
          <Board
            title={t("hof.mostClubs")}
            empty={t("hof.empty")}
            rows={board.mostClubsManaged}
            t={t}
            render={(row) => ({
              key: row.entry.manager.userId,
              href: `/managers/${row.entry.manager.userId}`,
              label: row.entry.manager.name ?? t("manager.unnamed"),
              metric: count("hof.clubs", row.value),
            })}
          />
        </Section>

        {/* PLAYER HONOURS */}
        <Section icon={<Target className="size-4" aria-hidden />} title={t("hof.sectionPlayerHonours")}>
          <Board
            title={t("hof.mostGoals")}
            empty={t("hof.emptyPlayers")}
            rows={players.mostGoals}
            t={t}
            render={(row) => playerRow(row.entry, count("hof.goals", row.value))}
            renderShared={(p) => sharedPlace(p, count("hof.goals", p.value))}
          />
          <Board
            title={t("hof.mostAssists")}
            empty={t("hof.emptyPlayers")}
            rows={players.mostAssists}
            t={t}
            render={(row) => playerRow(row.entry, count("hof.assists", row.value))}
            renderShared={(p) => sharedPlace(p, count("hof.assists", p.value))}
          />
        </Section>

        {/* PLAYER CAREERS */}
        <Section icon={<Star className="size-4" aria-hidden />} title={t("hof.sectionPlayerCareers")}>
          <Board
            title={t("hof.mostAppearances")}
            empty={t("hof.emptyPlayers")}
            rows={players.mostAppearances}
            t={t}
            render={(row) => playerRow(row.entry, count("hof.appearances", row.value))}
            renderShared={(p) => sharedPlace(p, count("hof.appearances", p.value))}
          />
          <Board
            title={t("hof.bestAverageRating")}
            note={t("hof.ratingMinimum", { min: String(players.minimumAppearancesForRating) })}
            empty={t("hof.emptyRating", { min: String(players.minimumAppearancesForRating) })}
            rows={players.bestAverageRating}
            t={t}
            render={(row) =>
              playerRow(row.entry, ratings.format(row.value), count("hof.appearances", row.entry.career.appearances))
            }
            renderShared={(p) => sharedPlace(p, ratings.format(p.value))}
          />
        </Section>

        {/* CLUB HONOURS */}
        <Section icon={<Building2 className="size-4" aria-hidden />} title={t("hof.sectionClubHonours")}>
          <Board
            title={t("hof.mostChampionshipsClub")}
            empty={t("hof.emptyChampionships")}
            rows={board.clubChampionships}
            t={t}
            render={(row) => ({
              key: row.entry.club.id,
              href: `/clubs/${row.entry.club.id}`,
              label: row.entry.club.name,
              metric: count("hof.titles", row.value),
              crest: row.entry.club,
            })}
          />
        </Section>

        <p className="text-center text-[11px] text-muted-foreground">
          {t("hof.boardSize", { n: String(players.places) })} · {t("hof.tieNote")}
        </p>
      </main>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground sm:text-base">
        {icon}
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

interface RowView {
  key: string
  /**
   * Optional so a board can carry a row with nowhere to go. Every row on this
   * page now has a destination - managers, clubs and, since the player profile
   * route exists, players - but a row that looks clickable and goes nowhere is
   * worse than one that does not, so the unlinked rendering stays available
   * rather than being replaced by a dead Link.
   */
  href?: string
  label: string
  metric: string
  context?: string
  crest?: {
    name: string
    crestShape: string | null
    crestPattern: string | null
    crestIcon: string | null
    crestColor: string | null
    crestSecondaryColor: string | null
    crestBorderColor: string | null
    crestImageUrl: string | null
  }
}

/**
 * One leaderboard.
 *
 * `rows` arrives already ranked and already ordered; this renders it as given.
 * The number in the rank column is `row.rank`, so two tied entries both show
 * the same number and the entry after them shows the number that skips - which
 * is the whole visible difference between sharing a rank and being sorted.
 */
function Board<T>({
  title,
  note,
  empty,
  rows,
  render,
  renderShared,
  t,
}: {
  title: string
  note?: string
  empty: string
  /**
   * A plain ranked list (the manager boards, which are small enough to show
   * whole) or a cut one (the player boards, which are not - see boardTop).
   */
  rows: RankedEntry<T>[] | BoardCut<T>
  render: (row: RankedEntry<T>) => RowView
  /** How to describe a shared place too crowded to list. Cut boards only. */
  renderShared?: (place: SharedPlace) => string
  t: Translator
}) {
  const board: BoardCut<T> = Array.isArray(rows) ? { rows, shared: [] } : rows
  return (
    <div className="goalx-broadcast-panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
        {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
      </div>

      {board.rows.length === 0 && board.shared.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="divide-y">
          {board.rows.map((row) => {
            const view = render(row)
            const body = (
              <>
                <span
                  className="w-6 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground"
                  aria-label={`${t("hof.colRank")} ${row.rank}`}
                >
                  {row.rank}
                </span>
                {view.crest ? (
                  <TeamCrest
                    shape={view.crest.crestShape}
                    pattern={view.crest.crestPattern}
                    icon={view.crest.crestIcon}
                    color={view.crest.crestColor}
                    secondaryColor={view.crest.crestSecondaryColor}
                    borderColor={view.crest.crestBorderColor}
                    imageUrl={view.crest.crestImageUrl}
                    size={28}
                    className="shrink-0"
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{view.label}</span>
                  {view.context ? (
                    <span className="block truncate text-[11px] text-muted-foreground">{view.context}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{view.metric}</span>
              </>
            )
            return (
              <li key={view.key}>
                {view.href ? (
                  <Link
                    href={view.href}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {/* A place shared by more players than the board can list. Described,
          never truncated: naming an arbitrary few of them would break the
          tie the shared rank exists to express. */}
      {board.shared.length > 0 && renderShared ? (
        <ul className="divide-y border-t">
          {board.shared.map((place) => (
            <li key={place.rank} className="px-4 py-2.5 text-xs text-muted-foreground">
              {renderShared(place)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
