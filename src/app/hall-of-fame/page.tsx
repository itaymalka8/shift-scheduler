import Link from "next/link"
import { cookies } from "next/headers"
import { Trophy, Timer, Medal, Building2 } from "lucide-react"
import { DEFAULT_LOCALE, getTranslator, isLocale, pluralise, type Translator } from "@/lib/i18n/translations"
import { loadHallOfFame } from "@/lib/halloffame/queries"
import type { RankedEntry } from "@/lib/halloffame/leaderboards"
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
  const board = await loadHallOfFame(now)

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

        <p className="text-center text-[11px] text-muted-foreground">{t("hof.tieNote")}</p>
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
  href: string
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
  t,
}: {
  title: string
  note?: string
  empty: string
  rows: RankedEntry<T>[]
  render: (row: RankedEntry<T>) => RowView
  t: Translator
}) {
  return (
    <div className="goalx-broadcast-panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
        {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="divide-y">
          {rows.map((row) => {
            const view = render(row)
            return (
              <li key={view.key}>
                <Link href={view.href} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50">
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
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
