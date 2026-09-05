import Link from "next/link"
import { cookies } from "next/headers"
import { Activity, ArrowLeftRight, Building2, Search, Shirt, User } from "lucide-react"
import {
  DEFAULT_LOCALE,
  getTranslator,
  isLocale,
  type TranslationKey,
  type Translator,
} from "@/lib/i18n/translations"
import { getCountryName } from "@/lib/countries"
import { attributeLabelKey, getAttributeScoreTier } from "@/lib/players/attributes"
import {
  ABILITY_METRICS,
  CAREER_METRIC_GROUPS,
  buildAbilityRows,
  buildComparisonRows,
  clearHref,
  compareAttributes,
  isSameSelection,
  parseComparisonParams,
  selectHref,
  showsGoalkeeping,
  type ComparisonParams,
  type ComparisonRow,
  type ComparisonSlot,
  type MetricMeta,
} from "@/lib/players/comparison"
import { loadComparison, type ComparisonSide } from "@/lib/players/comparison-queries"
import { searchPlayersForSelection, type DirectoryPlayer } from "@/lib/players/directory-queries"
import { MAX_SEARCH_LENGTH } from "@/lib/players/directory"
import type { ProfileClub, ProfileClubCareer, PlayerCurrentState } from "@/lib/players/profile"
import { TeamCrest } from "@/components/team-crest"

export const dynamic = "force-dynamic"

/**
 * TWO PLAYERS, SIDE BY SIDE.
 *
 * WHAT THIS PAGE IS: evidence, arranged. It shows what each player is TODAY
 * and what each player HAS DONE, keeps those two things in separate blocks
 * that are separately labelled, and stops there.
 *
 * WHAT IT IS NOT: a verdict. Nothing on this page is scored, weighted or
 * totalled. The only judgement it makes is per row, from a hand-written
 * direction contract (see comparison.ts) - and for most rows that contract
 * says "neither", which is why most rows carry no highlight at all. A page
 * that painted every larger number green would be telling the reader that the
 * player with more red cards is the better footballer.
 *
 * EVERY CAREER NUMBER COMES FROM loadPlayerProfile - the same reader, the same
 * anti-spoiler gate and the same PlayerMatchStats.teamId attribution as the
 * Player Profile. This page owns no historical rule of its own.
 *
 * THE SELECTORS ARE PLAIN GET FORMS over a bounded server-side search. No
 * client component, no API route, no list of 1320 players anywhere near the
 * browser - and every state of this page is a real URL that can be shared,
 * bookmarked and reloaded.
 *
 * ONE `now` for the whole render, so both careers were measured from the same
 * instant.
 */
export default async function ComparePlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  const params = parseComparisonParams(raw)
  // THE SAME PLAYER TWICE IS NOT A COMPARISON. B is dropped before the read
  // rather than after it, so the same career is never loaded twice and the
  // page asks for a different player instead of solemnly reporting that
  // somebody equals themselves.
  const same = isSameSelection(params)

  const now = new Date()
  const data = await loadComparison(params.a, same ? null : params.b, now)

  // A slot searches only while it holds nobody. Both searches are bounded and
  // issued together.
  const [resultsA, resultsB] = await Promise.all([
    data.a.state === "loaded" || params.qa === "" ? Promise.resolve([]) : searchPlayersForSelection(params.qa),
    data.b.state === "loaded" || params.qb === "" ? Promise.resolve([]) : searchPlayersForSelection(params.qb),
  ])

  const intlLocale = locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB"
  const fmt = {
    numbers: new Intl.NumberFormat(intlLocale),
    ratings: new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    rates: new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    percent: new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 1 }),
    dates: new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "short" }),
  }

  const bothLoaded = data.a.state === "loaded" && data.b.state === "loaded"

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold sm:text-2xl">
              <ArrowLeftRight className="size-5 shrink-0" aria-hidden />
              {t("compare.title")}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{t("compare.subtitle")}</p>
          </div>
          <Link href="/players" className="shrink-0 text-sm text-primary hover:underline">
            {t("players.backToDirectory")}
          </Link>
        </div>

        {/* SELECTION HEADER. Two independent slots - filling one never clears
            the other, and each one is addressed by Player.id in the URL. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <SlotPanel
            slot="a"
            side={data.a}
            params={params}
            results={resultsA}
            query={params.qa}
            t={t}
            locale={locale}
            numbers={fmt.numbers}
          />
          <SlotPanel
            slot="b"
            side={data.b}
            params={params}
            results={resultsB}
            query={params.qb}
            t={t}
            locale={locale}
            numbers={fmt.numbers}
          />
        </div>

        {same ? (
          <p className="goalx-broadcast-panel space-y-1 p-4 text-center text-sm">
            <span className="block font-medium">{t("compare.samePlayer")}</span>
            <span className="block text-xs text-muted-foreground">{t("compare.samePlayerHint")}</span>
          </p>
        ) : null}

        {!bothLoaded && !same ? (
          <p className="goalx-broadcast-panel p-6 text-center text-sm text-muted-foreground">
            {data.a.state === "loaded" || data.b.state === "loaded" ? t("compare.needOneMore") : t("compare.needTwo")}
          </p>
        ) : null}

        {data.a.state === "loaded" && data.b.state === "loaded" ? (
          <Comparison a={data.a} b={data.b} t={t} locale={locale} fmt={fmt} />
        ) : null}
      </main>
    </div>
  )
}

type Formats = {
  numbers: Intl.NumberFormat
  ratings: Intl.NumberFormat
  rates: Intl.NumberFormat
  percent: Intl.NumberFormat
  dates: Intl.DateTimeFormat
}

type LoadedSide = Extract<ComparisonSide, { state: "loaded" }>

/** The whole comparison, once both sides hold a different real player. */
function Comparison({
  a,
  b,
  t,
  locale,
  fmt,
}: {
  a: LoadedSide
  b: LoadedSide
  t: Translator
  locale: "he" | "en" | "ar"
  fmt: Formats
}) {
  const careerA = a.profile.career
  const careerB = b.profile.career
  const currentA = a.profile.current
  const currentB = b.profile.current

  const abilityRows = buildAbilityRows(ABILITY_METRICS, currentA, currentB)
  const attributeCategories = compareAttributes(
    currentA.primaryPosition,
    currentB.primaryPosition,
    a.attributes,
    b.attributes
  )

  const keeperRelevant = showsGoalkeeping(
    currentA.primaryPosition,
    currentB.primaryPosition,
    careerA.totals.saves,
    careerB.totals.saves
  )
  const careerGroups = CAREER_METRIC_GROUPS.filter((group) => !group.goalkeeping || keeperRelevant)
  const anyHistory = careerA.totals.appearances > 0 || careerB.totals.appearances > 0
  const crossPosition = currentA.primaryPosition !== currentB.primaryPosition

  return (
    <>
      {/* THE LEGEND, ABOVE EVERYTHING IT EXPLAINS. A reader should learn what
          a highlight means before they see one, not after. */}
      <section className="goalx-broadcast-panel space-y-1 p-4 text-[11px] text-muted-foreground">
        <p className="font-medium text-foreground">{t("compare.legendTitle")}</p>
        <p>{t("compare.legendFavoured")}</p>
        <p>{t("compare.legendNeutral")}</p>
        <p>{t("compare.legendNoWinner")}</p>
        {crossPosition ? <p>{t("compare.crossPositionNote")}</p> : null}
      </section>

      {/* CURRENT STATE - facts about right now, and none of them a statistic. */}
      <Section icon={<User className="size-4" aria-hidden />} title={t("compare.currentState")} note={t("playerProfile.currentStateNote")}>
        <div className="goalx-broadcast-panel divide-y overflow-hidden">
          <TextRow label={t("playerProfile.position")} a={position(t, currentA.primaryPosition)} b={position(t, currentB.primaryPosition)} />
          <TextRow
            label={t("playerProfile.otherPositions")}
            a={currentA.secondaryPositions.map((p) => position(t, p)).join(" · ") || "—"}
            b={currentB.secondaryPositions.map((p) => position(t, p)).join(" · ") || "—"}
          />
          <TextRow
            label={t("playerProfile.squadStatus")}
            a={t(`squad.status.${currentA.squadStatus}` as TranslationKey)}
            b={t(`squad.status.${currentB.squadStatus}` as TranslationKey)}
          />
          <TextRow
            label={t("playerProfile.preferredFoot")}
            a={t(`squad.foot.${currentA.preferredFoot}` as TranslationKey)}
            b={t(`squad.foot.${currentB.preferredFoot}` as TranslationKey)}
          />
          <TextRow
            label={t("playerProfile.nationality")}
            a={getCountryName(currentA.nationality, locale) ?? currentA.nationality}
            b={getCountryName(currentB.nationality, locale) ?? currentB.nationality}
          />
          <TextRow
            label={t("playerProfile.shirtNumber")}
            a={fmt.numbers.format(currentA.shirtNumber)}
            b={fmt.numbers.format(currentB.shirtNumber)}
          />
          {/* CURRENT club, from Player.teamId. It is stated here, among the
              current facts, and it never touches the career blocks below. */}
          <TextRow label={t("playerProfile.currentClub")} a={clubLabel(t, currentA)} b={clubLabel(t, currentB)} />
        </div>
      </Section>

      {/* CURRENT ABILITY - the game's own scale, not a record of anything. */}
      <Section icon={<Shirt className="size-4" aria-hidden />} title={t("playerProfile.currentAbility")} note={t("playerProfile.abilityNote")}>
        <MetricTable rows={abilityRows} t={t} fmt={fmt} />
      </Section>

      {/* ATTRIBUTES - the one canonical 0-100 scale in the schema, so a bar
          is honest here in a way it would not be for a career total. */}
      {attributeCategories.length > 0 ? (
        <Section icon={<Activity className="size-4" aria-hidden />} title={t("compare.attributes")} note={t("playerProfile.abilityNote")}>
          <div className="space-y-3">
            {attributeCategories.map((category) => (
              <div key={category.id} className="goalx-broadcast-panel overflow-hidden">
                <p className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(category.labelKey)}
                </p>
                <div className="divide-y">
                  {category.rows.map((row) => (
                    <AttributeRow
                      key={row.key}
                      label={t(attributeLabelKey(row.key) as TranslationKey)}
                      a={row.a}
                      b={row.b}
                      favoured={row.favoured}
                      t={t}
                      numbers={fmt.numbers}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* CAREER - everything below this line is history. */}
      {!anyHistory ? (
        <p className="goalx-broadcast-panel p-6 text-center text-sm text-muted-foreground">
          {t("playerProfile.noHistory")}
        </p>
      ) : (
        <>
          {careerGroups.map((group) => (
            <Section
              key={group.id}
              icon={<Activity className="size-4" aria-hidden />}
              title={t(group.labelKey)}
              note={group.id === "summary" ? t("compare.sampleNote") : undefined}
            >
              <MetricTable rows={buildComparisonRows(group.metrics, careerA, careerB)} t={t} fmt={fmt} />
              {group.id === "summary" && (careerA.smallSample || careerB.smallSample) ? (
                <p className="text-[11px] text-muted-foreground">
                  {/* NAMED BY SLOT, NOT ONLY BY NAME. Production draws 1320
                      players from 42 first names, so "David Cohen · David
                      Cohen" is a real possibility and would say nothing at
                      all - the slot is what makes the note readable. */}
                  {t("playerProfile.smallSample")}:{" "}
                  {[
                    careerA.smallSample ? `${t("compare.slotA")} — ${currentA.firstName} ${currentA.lastName}` : null,
                    careerB.smallSample ? `${t("compare.slotB")} — ${currentB.firstName} ${currentB.lastName}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </Section>
          ))}

          {/* CAREER CLUBS - from PlayerMatchStats.teamId, never from the
              current club above. */}
          <Section
            icon={<Building2 className="size-4" aria-hidden />}
            title={t("playerProfile.clubCareer")}
            note={t("playerProfile.historicalClubNote")}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ClubColumn clubs={a.profile.clubs} t={t} fmt={fmt} />
              <ClubColumn clubs={b.profile.clubs} t={t} fmt={fmt} />
            </div>
          </Section>
        </>
      )}
    </>
  )
}

function position(t: Translator, code: string): string {
  return t(`squad.position.${code}` as TranslationKey)
}

function clubLabel(t: Translator, current: PlayerCurrentState): string {
  if (current.currentClub) return current.currentClub.name
  return current.careerStatus === "RETIRED" ? t("playerProfile.retired") : t("playerProfile.freeAgent")
}

function Section({
  icon,
  title,
  note,
  children,
}: {
  icon: React.ReactNode
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground sm:text-base">
          {icon}
          {title}
        </h2>
        {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

/**
 * One block of metrics.
 *
 * Three columns - A, the label, B - so the two numbers a reader is actually
 * comparing sit next to the name of what they are. Logical alignment keeps A
 * first in every direction, RTL included.
 */
function MetricTable({ rows, t, fmt }: { rows: ComparisonRow[]; t: Translator; fmt: Formats }) {
  return (
    <div className="goalx-broadcast-panel divide-y overflow-hidden">
      {rows.map((row) => (
        <MetricRow key={row.metric.key} row={row} t={t} fmt={fmt} />
      ))}
    </div>
  )
}

function formatValue(meta: MetricMeta, value: number | null, fmt: Formats): string {
  // A DASH, NEVER A ZERO. "No shots attempted" and "0% accuracy" are
  // different facts, and printing the second for the first would libel them.
  if (value === null) return "—"
  switch (meta.format) {
    case "rating":
      return fmt.ratings.format(value)
    case "rate":
      return fmt.rates.format(value)
    case "percent":
      return fmt.percent.format(value)
    case "count":
    case "score":
    default:
      return fmt.numbers.format(value)
  }
}

function MetricRow({ row, t, fmt }: { row: ComparisonRow; t: Translator; fmt: Formats }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2">
      <Value text={formatValue(row.metric, row.a, fmt)} favoured={row.favoured === "a"} align="end" t={t} />
      <span className="px-1 text-center text-[11px] leading-tight text-muted-foreground">
        {t(row.metric.labelKey)}
        {/* Why this row carries no highlight, said out loud rather than left
            for the reader to wonder about. */}
        {row.metric.neutralNoteKey ? (
          <span className="block text-[9px] opacity-70">{t(row.metric.neutralNoteKey)}</span>
        ) : null}
      </span>
      <Value text={formatValue(row.metric, row.b, fmt)} favoured={row.favoured === "b"} align="start" t={t} />
    </div>
  )
}

/**
 * One number.
 *
 * A highlight is NEVER colour alone: the favoured cell also carries a dot and
 * a screen-reader sentence saying what the mark means, so the page still
 * reads correctly without colour vision and out loud.
 */
function Value({
  text,
  favoured,
  align,
  t,
}: {
  text: string
  favoured: boolean
  align: "start" | "end"
  t: Translator
}) {
  return (
    <span
      className={[
        "flex min-w-0 items-center gap-1.5 text-sm tabular-nums",
        align === "end" ? "justify-end" : "justify-start",
        favoured ? "font-semibold text-primary" : "text-foreground",
      ].join(" ")}
    >
      {favoured && align === "start" ? <Dot /> : null}
      <span className="truncate">{text}</span>
      {favoured && align === "end" ? <Dot /> : null}
      {favoured ? <span className="sr-only">{t("compare.legendFavoured")}</span> : null}
    </span>
  )
}

function Dot() {
  return <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
}

/** A plain text row - no comparison, because these values are not numbers. */
function TextRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2">
      <span className="truncate text-end text-sm">{a}</span>
      <span className="px-1 text-center text-[11px] text-muted-foreground">{label}</span>
      <span className="truncate text-start text-sm">{b}</span>
    </div>
  )
}

/**
 * One attribute.
 *
 * The bar is a percentage of 100 because a player attribute genuinely IS a
 * 1-100 scale - the only canonical range in the schema. Career totals get no
 * bar at all: there is no "100 goals" ceiling to draw them against, and
 * inventing one would be a scale nobody agreed to.
 */
function AttributeRow({
  label,
  a,
  b,
  favoured,
  t,
  numbers,
}: {
  label: string
  a: number | null
  b: number | null
  favoured: ComparisonSlot | null
  t: Translator
  numbers: Intl.NumberFormat
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-1.5">
      <AttributeCell value={a} favoured={favoured === "a"} align="end" t={t} numbers={numbers} />
      <span className="w-24 shrink-0 px-1 text-center text-[10px] leading-tight text-muted-foreground sm:w-32">{label}</span>
      <AttributeCell value={b} favoured={favoured === "b"} align="start" t={t} numbers={numbers} />
    </div>
  )
}

function AttributeCell({
  value,
  favoured,
  align,
  t,
  numbers,
}: {
  value: number | null
  favoured: boolean
  align: "start" | "end"
  t: Translator
  numbers: Intl.NumberFormat
}) {
  // A null attribute is genuinely not applicable to this player's role - a
  // keeper has no finishing - so it shows a dash and no bar. Never a 0.
  if (value === null) {
    return <span className={`text-sm text-muted-foreground ${align === "end" ? "text-end" : "text-start"}`}>—</span>
  }
  const tier = getAttributeScoreTier(value)
  return (
    <span className={`flex min-w-0 items-center gap-2 ${align === "end" ? "flex-row-reverse" : ""}`}>
      <span className={`w-6 shrink-0 text-sm tabular-nums ${favoured ? "font-semibold text-primary" : ""}`}>
        {numbers.format(value)}
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full rounded-full ${tier.colorClass}`} style={{ width: `${value}%` }} />
      </span>
      {favoured ? <span className="sr-only">{t("compare.legendFavoured")}</span> : null}
    </span>
  )
}

/** One player's clubs, from their own history. */
function ClubColumn({ clubs, t, fmt }: { clubs: ProfileClubCareer[]; t: Translator; fmt: Formats }) {
  if (clubs.length === 0) {
    return (
      <div className="goalx-broadcast-panel p-4 text-center text-xs text-muted-foreground">
        {t("playerProfile.noHistory")}
      </div>
    )
  }
  return (
    <ul className="goalx-broadcast-panel divide-y overflow-hidden">
      {clubs.map((row) => (
        <li key={row.teamId} className="flex items-center gap-2 px-3 py-2">
          {row.club ? <Crest club={row.club} size={22} /> : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{row.club?.name ?? row.teamId}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {fmt.dates.format(row.career.firstAppearanceAt)} – {fmt.dates.format(row.career.lastAppearanceAt)}
            </span>
          </span>
          <span className="shrink-0 text-end text-[11px] tabular-nums text-muted-foreground">
            <span className="block">
              {t("playerProfile.appearances")} {fmt.numbers.format(row.career.totals.appearances)}
            </span>
            <span className="block">
              {t("playerProfile.goals")} {fmt.numbers.format(row.career.totals.goals)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Crest({ club, size }: { club: ProfileClub; size: number }) {
  return (
    <TeamCrest
      shape={club.crestShape}
      pattern={club.crestPattern}
      icon={club.crestIcon}
      color={club.crestColor}
      secondaryColor={club.crestSecondaryColor}
      borderColor={club.crestBorderColor}
      imageUrl={club.crestImageUrl}
      size={size}
      className="shrink-0"
    />
  )
}

/**
 * One side's selector.
 *
 * Three states, all of them safe:
 *   loaded    the player, with a link to swap them out.
 *   notFound  an id that names nobody - a shared link can outlive a player.
 *             It says so and offers the search, and it is never a 500.
 *   empty     the search itself.
 */
function SlotPanel({
  slot,
  side,
  params,
  results,
  query,
  t,
  locale,
  numbers,
}: {
  slot: ComparisonSlot
  side: ComparisonSide
  params: ComparisonParams
  results: DirectoryPlayer[]
  query: string
  t: Translator
  locale: "he" | "en" | "ar"
  numbers: Intl.NumberFormat
}) {
  const heading = slot === "a" ? t("compare.slotA") : t("compare.slotB")

  if (side.state === "loaded") {
    const current = side.profile.current
    return (
      <div className="goalx-broadcast-panel space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{heading}</p>
          <Link href={clearHref(params, slot)} className="shrink-0 text-xs text-primary hover:underline">
            {t("compare.change")}
          </Link>
        </div>
        <Link href={`/players/${current.playerId}`} className="flex items-center gap-3 hover:text-primary">
          {current.currentClub ? <Crest club={current.currentClub} size={32} /> : <span className="size-8 shrink-0 rounded-full bg-muted" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">
              {current.firstName} {current.lastName}
            </span>
            {/* WHAT TELLS TWO IDENTICAL NAMES APART. Production draws 1320
                players from 42 first names and 44 surnames, so the name alone
                is not an identity - the club, the position and the
                nationality are what a reader picks the right one by, and the
                id in the URL is what the page actually uses. */}
            <span className="block truncate text-[11px] text-muted-foreground">
              {position(t, current.primaryPosition)} · {getCountryName(current.nationality, locale) ?? current.nationality} ·{" "}
              {clubLabel(t, current)} · {t("playerProfile.age")} {numbers.format(current.age)}
            </span>
          </span>
        </Link>
      </div>
    )
  }

  return (
    <div className="goalx-broadcast-panel space-y-2 p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{heading}</p>
      {side.state === "notFound" ? (
        <p className="text-xs">
          <span className="block font-medium">{t("compare.notFound")}</span>
          <span className="block text-muted-foreground">{t("compare.notFoundHint")}</span>
        </p>
      ) : null}

      {/* A plain GET form. The OTHER side travels through as a hidden field,
          so filling one slot never empties the other. */}
      <form method="get" action="/players/compare" className="flex gap-2">
        {slot === "a" ? (
          params.b ? <input type="hidden" name="b" value={params.b} /> : null
        ) : params.a ? (
          <input type="hidden" name="a" value={params.a} />
        ) : null}
        <label htmlFor={`compare-${slot}`} className="sr-only">
          {t("compare.choosePlayer")}
        </label>
        <input
          id={`compare-${slot}`}
          name={slot === "a" ? "qa" : "qb"}
          type="search"
          defaultValue={query}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder={t("compare.searchPlaceholder")}
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Search className="size-4" aria-hidden />
          <span className="sr-only">{t("compare.searchAction")}</span>
        </button>
      </form>

      {query === "" ? (
        <p className="text-[11px] text-muted-foreground">{t("compare.searchHint")}</p>
      ) : results.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t("compare.noResults")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {results.map((player) => (
            <li key={player.id}>
              <Link
                href={selectHref(params, slot, player.id)}
                className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {player.firstName} {player.lastName}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {position(t, player.primaryPosition)} ·{" "}
                    {player.club?.name ??
                      (player.careerStatus === "RETIRED" ? t("players.retired") : t("players.freeAgent"))}{" "}
                    · {getCountryName(player.nationality, locale) ?? player.nationality}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {numbers.format(player.overall)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const metadata = { title: "Compare players · GoalX" }
