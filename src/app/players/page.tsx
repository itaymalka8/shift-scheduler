import Link from "next/link"
import { cookies } from "next/headers"
import { Search, Users } from "lucide-react"
import {
  DEFAULT_LOCALE,
  getTranslator,
  isLocale,
  pluralise,
  type TranslationKey,
  type Translator,
} from "@/lib/i18n/translations"
import { getCountryName } from "@/lib/countries"
import {
  DIRECTORY_STATUSES,
  MAX_SEARCH_LENGTH,
  directoryHref,
  hasActiveFilters,
  parseDirectoryParams,
} from "@/lib/players/directory"
import { loadDirectoryFacets, loadPlayerDirectory, type DirectoryPlayer } from "@/lib/players/directory-queries"
import { TeamCrest } from "@/components/team-crest"

export const dynamic = "force-dynamic"

/**
 * THE PLAYER DIRECTORY - a way to find somebody, and nothing more.
 *
 * CURRENT STATE ONLY. Every column it reads, filters and shows is current:
 * position, nationality, club, career status, overall. It computes no career
 * figure and imports no history: the row links to /players/[playerId], which
 * is where a career lives. Two pages owning career logic would eventually
 * disagree about somebody's history.
 *
 * NOT A RANKING. The order is alphabetical by surname - the way a directory
 * is ordered - deliberately not by `overall`, which would turn a neutral
 * lookup page into a rating board.
 *
 * THE CONTROLS ARE A PLAIN GET FORM. No client component, no JavaScript
 * required, and every view is a real URL that can be shared, bookmarked and
 * reloaded. Submitting the form IS navigation, which is also what makes the
 * back button behave.
 */
export default async function PlayersDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  // Facets first: the query string cannot be validated without knowing which
  // clubs, positions and nationalities exist, so an unknown value is dropped
  // rather than passed to the database or echoed back into the page.
  const facets = await loadDirectoryFacets()
  const query = parseDirectoryParams(params, facets)
  const result = await loadPlayerDirectory(query, facets)

  const intlLocale = locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB"
  const numbers = new Intl.NumberFormat(intlLocale)
  const count = (key: string, n: number) => pluralise(locale, t, key, n, numbers.format(n))
  const position = (code: string) => t(`squad.position.${code}` as TranslationKey)
  const filtered = hasActiveFilters(query)

  // A filter with a single possible value filters nothing, so its control is
  // not rendered. Production has exactly one nationality today; the parameter
  // still works, and the control appears by itself the day a second one does.
  const showNationality = facets.nationalities.length > 1
  const { window: pageWindow } = result

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold sm:text-2xl">
              <Users className="size-5" aria-hidden />
              {t("players.title")}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("players.subtitle")}</p>
          </div>
          <Link href="/hall-of-fame" className="shrink-0 text-sm text-primary hover:underline">
            {t("nav.hallOfFame")}
          </Link>
        </div>

        {/* A plain GET form: every view is a URL, and it works without JS.
            `page` is deliberately absent, so changing a filter returns to
            page 1 rather than stranding the reader on a page that no longer
            exists in the narrowed result. */}
        <form method="get" action="/players" className="goalx-broadcast-panel space-y-3 p-4">
          <div className="flex gap-2">
            <label htmlFor="players-q" className="sr-only">
              {t("players.searchLabel")}
            </label>
            <input
              id="players-q"
              name="q"
              type="search"
              defaultValue={query.q}
              maxLength={MAX_SEARCH_LENGTH}
              placeholder={t("players.searchPlaceholder")}
              className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Search className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t("players.searchAction")}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Select name="position" label={t("players.anyPosition")} value={query.position ?? ""}>
              <option value="">{t("players.anyPosition")}</option>
              {facets.positions.map((code) => (
                <option key={code} value={code}>
                  {position(code)}
                </option>
              ))}
            </Select>

            <Select name="club" label={t("players.anyClub")} value={query.club ?? ""}>
              <option value="">{t("players.anyClub")}</option>
              {facets.clubs.map((club) => (
                <option key={club.id} value={club.id}>
                  {club.name}
                </option>
              ))}
            </Select>

            <Select name="status" label={t("players.filters")} value={query.status}>
              {DIRECTORY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`players.status.${status}` as TranslationKey)}
                </option>
              ))}
            </Select>

            {showNationality ? (
              <Select name="nationality" label={t("players.anyNationality")} value={query.nationality ?? ""}>
                <option value="">{t("players.anyNationality")}</option>
                {facets.nationalities.map((code) => (
                  <option key={code} value={code}>
                    {getCountryName(code, locale) ?? code}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>

          {filtered ? (
            <Link href="/players" className="inline-block text-xs text-primary hover:underline">
              {t("players.clearFilters")}
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{count("players.resultCount", result.total)}</span>
          {result.total > 0 ? (
            <span>
              {t("players.showing", {
                from: numbers.format(pageWindow.from),
                to: numbers.format(pageWindow.to),
                total: numbers.format(result.total),
              })}
            </span>
          ) : null}
        </div>

        {result.players.length === 0 ? (
          <div className="goalx-broadcast-panel space-y-2 p-6 text-center">
            {/* A page past the end is not an error and not a 404 - it is an
                empty page, and it says so with a way back rather than
                pretending the directory is empty. */}
            <p className="text-sm font-medium">
              {pageWindow.page > pageWindow.totalPages && result.total > 0
                ? t("players.pastLastPage")
                : t("players.empty")}
            </p>
            {pageWindow.page > pageWindow.totalPages && result.total > 0 ? (
              <Link href={directoryHref({ ...query, page: 1 })} className="text-sm text-primary hover:underline">
                {t("players.backToFirstPage")}
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">{t("players.emptyHint")}</p>
            )}
          </div>
        ) : (
          <ul className="goalx-broadcast-panel divide-y overflow-hidden">
            {result.players.map((player) => (
              <PlayerRow key={player.id} player={player} t={t} locale={locale} numbers={numbers} />
            ))}
          </ul>
        )}

        {pageWindow.totalPages > 1 ? (
          <nav className="flex items-center justify-between gap-3" aria-label={t("players.title")}>
            <PageLink
              href={directoryHref({ ...query, page: pageWindow.page - 1 })}
              label={t("players.previous")}
              disabled={!pageWindow.hasPrevious}
            />
            <span className="text-xs text-muted-foreground">
              {t("players.pageOf", {
                page: numbers.format(pageWindow.page),
                pages: numbers.format(pageWindow.totalPages),
              })}
            </span>
            <PageLink
              href={directoryHref({ ...query, page: pageWindow.page + 1 })}
              label={t("players.next")}
              disabled={!pageWindow.hasNext}
            />
          </nav>
        ) : null}
      </main>
    </div>
  )
}

/** A native select that submits with the form - no client state, no hydration. */
function Select({
  name,
  label,
  value,
  children,
}: {
  name: string
  label: string
  value: string
  children: React.ReactNode
}) {
  return (
    <>
      <label htmlFor={`players-${name}`} className="sr-only">
        {label}
      </label>
      <select
        id={`players-${name}`}
        name={name}
        defaultValue={value}
        className="h-9 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
    </>
  )
}

function PageLink({ href, label, disabled }: { href: string; label: string; disabled: boolean }) {
  if (disabled) {
    return <span className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground opacity-40">{label}</span>
  }
  return (
    <Link href={href} className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent/50">
      {label}
    </Link>
  )
}

/**
 * One directory row.
 *
 * Compact on purpose: a name, where they play, who for, and how good they are
 * today. No attribute wall, and nothing historical - the profile holds that,
 * and the whole row links to it by Player.id.
 */
function PlayerRow({
  player,
  t,
  locale,
  numbers,
}: {
  player: DirectoryPlayer
  t: Translator
  locale: "he" | "en" | "ar"
  numbers: Intl.NumberFormat
}) {
  const position = t(`squad.position.${player.primaryPosition}` as TranslationKey)
  const country = getCountryName(player.nationality, locale) ?? player.nationality
  const retired = player.careerStatus === "RETIRED"
  const where = player.club?.name ?? (retired ? t("players.retired") : t("players.freeAgent"))

  return (
    <li>
      <Link
        href={`/players/${player.id}`}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50"
      >
        {player.club ? (
          <TeamCrest
            shape={player.club.crestShape}
            pattern={player.club.crestPattern}
            icon={player.club.crestIcon}
            color={player.club.crestColor}
            secondaryColor={player.club.crestSecondaryColor}
            borderColor={player.club.crestBorderColor}
            imageUrl={player.club.crestImageUrl}
            size={28}
            className="shrink-0"
          />
        ) : (
          <span className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              {player.firstName} {player.lastName}
            </span>
            {retired ? (
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {t("players.retired")}
              </span>
            ) : null}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {position} · {country} · {where}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums">{numbers.format(player.overall)}</span>
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("players.overall")}
          </span>
        </span>
      </Link>
    </li>
  )
}

export const metadata = { title: "Players · GoalX" }
