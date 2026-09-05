import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { Activity, Building2, CalendarDays, ListOrdered, Shirt, User } from "lucide-react"
import { DEFAULT_LOCALE, getTranslator, isLocale, type TranslationKey, type Translator } from "@/lib/i18n/translations"
import { loadPlayerProfile, getPlayerName, type ProfileAppearance, type ProfileClub, type ProfileClubCareer } from "@/lib/players/profile"
import type { CareerTotals } from "@/lib/players/career"
import { TeamCrest } from "@/components/team-crest"

export const dynamic = "force-dynamic"

/**
 * A PLAYER'S CAREER, read from history.
 *
 * TWO KINDS OF FACT LIVE ON THIS PAGE AND THEY ARE NEVER MIXED:
 *
 *   CURRENT STATE - the header and the ability block. Where they play now,
 *   how fit they are, what they are rated today. All of it from the Player
 *   row, all of it true only right now, and none of it a statistic.
 *
 *   CAREER HISTORY - everything below. Every figure comes from
 *   PlayerMatchStats rows whose fixture is publicly finished, attributed to
 *   the club named on the row. A transfer rewrites the header and leaves the
 *   history exactly where it was.
 *
 * The page renders; it does not decide. Totals, club splits and derived rates
 * are all computed in the pure layer, and the anti-spoiler gate is applied in
 * SQL before anything reaches here.
 *
 * ONE `now` for the whole render, so every number was measured from the same
 * instant.
 */
export default async function PlayerProfilePage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  const now = new Date()
  const profile = await loadPlayerProfile(playerId, now)
  // An id that names no player is a 404. It is never a 500, and never an
  // empty profile pretending somebody exists.
  if (!profile) notFound()

  const { current, career, clubs, appearances } = profile
  const intlLocale = locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB"
  const numbers = new Intl.NumberFormat(intlLocale)
  const ratings = new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const rates = new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const percent = new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 1 })
  const dates = new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "short", day: "numeric" })

  const position = (code: string) => t(`squad.position.${code}` as TranslationKey)
  // A dash, never a zero: "no shots attempted" and "0% accuracy" are
  // different facts, and printing the second for the first would libel them.
  const ratio = (value: number | null) => (value === null ? "—" : rates.format(value))
  const share = (value: number | null) => (value === null ? "—" : percent.format(value))

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold sm:text-2xl">{t("playerProfile.title")}</h1>
          <Link href="/players" className="shrink-0 text-sm text-primary hover:underline">
            {t("players.backToDirectory")}
          </Link>
        </div>

        {/* HEADER - identity is playerId; the name shown is the CURRENT one. */}
        <section className="goalx-broadcast-panel flex items-start gap-4 p-4 sm:p-6">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary sm:size-16"
            aria-hidden
          >
            {/* No avatar exists for a generated player, so the initial stands
                in rather than a stock face being invented for them. */}
            {current.firstName.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-xl font-bold sm:text-2xl">
                {current.firstName} {current.lastName}
              </p>
              {current.careerStatus === "RETIRED" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t("playerProfile.retired")}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {position(current.primaryPosition)} · {current.nationality} ·{" "}
              {t("playerProfile.age")} {numbers.format(current.age)}
            </p>
            {/* CURRENT club, from Player.teamId - which is what that column
                means. Never the club of the latest appearance, which may be
                one they have already left. */}
            {current.currentClub ? (
              <Link
                href={`/clubs/${current.currentClub.id}`}
                className="mt-1.5 flex items-center gap-2 text-sm hover:text-primary"
              >
                <Crest club={current.currentClub} size={20} />
                <span className="truncate">{current.currentClub.name}</span>
              </Link>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {current.careerStatus === "RETIRED" ? t("playerProfile.retired") : t("playerProfile.freeAgent")}
              </p>
            )}
          </div>
        </section>

        {/* CURRENT STATUS - labelled as current so it is never read as history. */}
        <Section icon={<User className="size-4" aria-hidden />} title={t("playerProfile.currentStatus")} note={t("playerProfile.currentStateNote")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("playerProfile.shirtNumber")} value={numbers.format(current.shirtNumber)} />
            <Stat label={t("playerProfile.squadStatus")} value={t(`squad.status.${current.squadStatus}` as TranslationKey)} />
            <Stat label={t("playerProfile.fitness")} value={`${numbers.format(current.fitness)}%`} />
            <Stat label={t("playerProfile.preferredFoot")} value={t(`squad.foot.${current.preferredFoot}` as TranslationKey)} />
          </div>
          {current.secondaryPositions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("playerProfile.otherPositions")}: {current.secondaryPositions.map(position).join(" · ")}
            </p>
          )}
        </Section>

        {career.totals.appearances === 0 ? (
          <p className="goalx-broadcast-panel p-6 text-center text-sm text-muted-foreground">
            {t("playerProfile.noHistory")}
          </p>
        ) : (
          <>
            {/* CAREER SUMMARY */}
            <Section icon={<ListOrdered className="size-4" aria-hidden />} title={t("playerProfile.careerSummary")}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label={t("playerProfile.appearances")} value={numbers.format(career.totals.appearances)} />
                <Stat label={t("playerProfile.minutes")} value={numbers.format(career.totals.minutesPlayed)} />
                <Stat label={t("playerProfile.goals")} value={numbers.format(career.totals.goals)} />
                <Stat label={t("playerProfile.assists")} value={numbers.format(career.totals.assists)} />
                <Stat
                  label={t("playerProfile.averageRating")}
                  // The mean was computed unrounded; this is the first and
                  // only place it is rounded, for display.
                  value={career.totals.averageRating === null ? "—" : ratings.format(career.totals.averageRating)}
                  // A real average over few games is still their real average -
                  // it is labelled, never hidden.
                  note={career.smallSample ? t("playerProfile.smallSample") : undefined}
                />
                <Stat label={t("playerProfile.clubsRepresented")} value={numbers.format(career.clubsRepresented)} />
              </div>
              <TotalsGrid totals={career.totals} t={t} format={numbers} />
            </Section>

            {/* PERFORMANCE - derived on read, never stored. */}
            <Section icon={<Activity className="size-4" aria-hidden />} title={t("playerProfile.performance")}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label={t("playerProfile.goalsPerApp")} value={ratio(career.rates.goalsPerAppearance)} />
                <Stat label={t("playerProfile.assistsPerApp")} value={ratio(career.rates.assistsPerAppearance)} />
                <Stat label={t("playerProfile.goalsPer90")} value={ratio(career.rates.goalsPer90)} />
                <Stat label={t("playerProfile.assistsPer90")} value={ratio(career.rates.assistsPer90)} />
                <Stat label={t("playerProfile.shotAccuracy")} value={share(career.rates.shotAccuracy)} />
                <Stat label={t("playerProfile.passAccuracy")} value={share(career.rates.passAccuracy)} />
              </div>
            </Section>

            {/* CLUB CAREER - from PlayerMatchStats.teamId, never the current club. */}
            <Section
              icon={<Building2 className="size-4" aria-hidden />}
              title={t("playerProfile.clubCareer")}
              note={t("playerProfile.historicalClubNote")}
            >
              <ul className="space-y-3">
                {clubs.map((row) => (
                  <ClubCareerCard key={row.teamId} row={row} t={t} format={numbers} ratings={ratings} dates={dates} />
                ))}
              </ul>
            </Section>

            {/* MATCH HISTORY - every eligible appearance, most recent first. */}
            <Section icon={<CalendarDays className="size-4" aria-hidden />} title={t("playerProfile.matchHistory")}>
              <ul className="goalx-broadcast-panel divide-y overflow-hidden">
                {appearances.map((appearance) => (
                  <AppearanceRow
                    key={appearance.fixtureId}
                    appearance={appearance}
                    t={t}
                    format={numbers}
                    ratings={ratings}
                    dates={dates}
                  />
                ))}
              </ul>
            </Section>
          </>
        )}

        {/* CURRENT ABILITY - last, and clearly not a statistic. */}
        <Section
          icon={<Shirt className="size-4" aria-hidden />}
          title={t("playerProfile.currentAbility")}
          note={t("playerProfile.abilityNote")}
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("playerProfile.overall")} value={numbers.format(current.overall)} />
            <Stat label={t("playerProfile.potential")} value={numbers.format(current.potential)} />
            <Stat label={t("playerProfile.position")} value={position(current.primaryPosition)} />
            <Stat label={t("playerProfile.nationality")} value={current.nationality} />
          </div>
        </Section>
      </main>
    </div>
  )
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
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground sm:text-base">
          {icon}
          {title}
        </h2>
        {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="goalx-broadcast-panel px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-base font-semibold tabular-nums">{value}</p>
      {note ? <p className="truncate text-[10px] text-muted-foreground">{note}</p> : null}
    </div>
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

/** The counting stats, in one compact block rather than a wall of cards. */
function TotalsGrid({ totals, t, format }: { totals: CareerTotals; t: Translator; format: Intl.NumberFormat }) {
  const entries: [string, number][] = [
    [t("playerProfile.shots"), totals.shots],
    [t("playerProfile.shotsOnTarget"), totals.shotsOnTarget],
    [t("playerProfile.keyPasses"), totals.keyPasses],
    [t("playerProfile.dribbles"), totals.dribblesCompleted],
    [t("playerProfile.tackles"), totals.tackles],
    [t("playerProfile.interceptions"), totals.interceptions],
    [t("playerProfile.aerials"), totals.aerialDuelsWon],
    [t("playerProfile.fouls"), totals.fouls],
    [t("playerProfile.yellowCards"), totals.yellowCards],
    [t("playerProfile.redCards"), totals.redCards],
    [t("playerProfile.saves"), totals.saves],
  ]
  return (
    <dl className="goalx-broadcast-panel grid grid-cols-2 gap-x-4 gap-y-1.5 p-4 text-xs sm:grid-cols-3 lg:grid-cols-4">
      {entries.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="truncate text-muted-foreground">{label}</dt>
          <dd className="shrink-0 font-medium tabular-nums">{format.format(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * One club in the career.
 *
 * A player who left and came back has ONE row here holding every appearance
 * they ever made for the club. Nothing in the schema records when a player
 * joined or left, so splitting this into spells would be inferring them from
 * gaps between appearances - and an injury looks exactly like a transfer from
 * the outside. The dates below are the first and last time they actually
 * played for the club, which is a fact rather than a guess.
 */
function ClubCareerCard({
  row,
  t,
  format,
  ratings,
  dates,
}: {
  row: ProfileClubCareer
  t: Translator
  format: Intl.NumberFormat
  ratings: Intl.NumberFormat
  dates: Intl.DateTimeFormat
}) {
  const { career } = row
  const period = t("playerProfile.clubPeriod", {
    from: dates.format(career.firstAppearanceAt),
    to: dates.format(career.lastAppearanceAt),
  })
  const name = row.club?.name ?? row.teamId

  return (
    <li className="goalx-broadcast-panel space-y-2 p-4">
      <div className="flex items-start gap-3">
        {row.club ? <Crest club={row.club} size={40} /> : null}
        <div className="min-w-0 flex-1">
          {row.club ? (
            <Link href={`/clubs/${row.club.id}`} className="block truncate font-semibold hover:text-primary">
              {name}
            </Link>
          ) : (
            <span className="block truncate font-semibold">{name}</span>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{period}</span>
          </p>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <Pair label={t("playerProfile.appearances")} value={format.format(career.totals.appearances)} />
        <Pair label={t("playerProfile.minutes")} value={format.format(career.totals.minutesPlayed)} />
        <Pair label={t("playerProfile.goals")} value={format.format(career.totals.goals)} />
        <Pair label={t("playerProfile.assists")} value={format.format(career.totals.assists)} />
        <Pair
          label={t("playerProfile.averageRating")}
          value={career.totals.averageRating === null ? "—" : ratings.format(career.totals.averageRating)}
        />
      </dl>
    </li>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}

/**
 * One appearance.
 *
 * The score comes from revealFinalScore, the single place a stored score is
 * allowed to become a displayed one - and the read already excluded anything
 * not publicly finished, so this is the second of two locks on the same door.
 */
function AppearanceRow({
  appearance,
  t,
  format,
  ratings,
  dates,
}: {
  appearance: ProfileAppearance
  t: Translator
  format: Intl.NumberFormat
  ratings: Intl.NumberFormat
  dates: Intl.DateTimeFormat
}) {
  const opponent = appearance.opponent?.name ?? "—"
  return (
    <li>
      <Link href={`/match/${appearance.fixtureId}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50">
        {appearance.opponent ? <Crest club={appearance.opponent} size={24} /> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {t("playerProfile.versus")} {opponent}
            <span className="ms-1.5 text-[11px] font-normal text-muted-foreground">
              {appearance.wasHome ? t("playerProfile.home") : t("playerProfile.away")}
            </span>
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {dates.format(appearance.kickoffAt)}
            {appearance.score ? ` · ${format.format(appearance.score.for)}–${format.format(appearance.score.against)}` : ""}
            {` · ${format.format(appearance.minutesPlayed)}'`}
            {appearance.goals > 0 ? ` · ${t("playerProfile.goals")} ${format.format(appearance.goals)}` : ""}
            {appearance.assists > 0 ? ` · ${t("playerProfile.assists")} ${format.format(appearance.assists)}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{ratings.format(appearance.rating)}</span>
      </Link>
    </li>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const player = await getPlayerName(playerId)
  return { title: player ? `${player.firstName} ${player.lastName} · GoalX` : "GoalX" }
}
