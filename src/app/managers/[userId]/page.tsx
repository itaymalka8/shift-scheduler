import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { CalendarDays, Trophy } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale, type Translator } from "@/lib/i18n/translations"
import { loadManagerProfile, type ProfileSpell } from "@/lib/managers/profile"
import { winPercentage } from "@/lib/managers/career"
import type { ManagerRecord } from "@/lib/teams/era"
import { TeamCrest } from "@/components/team-crest"
import { TrophyCard } from "@/components/trophies/trophy-card"

export const dynamic = "force-dynamic"

/**
 * A MANAGER'S CAREER, read from history.
 *
 * Everything on this page comes from TeamEra and SeasonChampion. The current
 * club is the OPEN era's club, not Team.userId - so the moment a manager
 * leaves, this page says they have no club, while every match and every title
 * they earned stays exactly where it is.
 *
 * One `now` for the whole render, passed down, so every number on the page is
 * measured from the same instant.
 */
export default async function ManagerProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  const now = new Date()
  const profile = await loadManagerProfile(userId, now)
  if (!profile) notFound()

  const { summary, spells, currentClub, currentSeasonRecord, trophies } = profile
  const dateFormat = new Intl.DateTimeFormat(locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold sm:text-2xl">{t("manager.profileTitle")}</h1>
          <Link href="/dashboard" className="shrink-0 text-sm text-primary hover:underline">
            {t("manager.backToDashboard")}
          </Link>
        </div>

        {/* HEADER - identity is userId; the name shown is the CURRENT one. */}
        <section className="goalx-broadcast-panel flex items-center gap-4 p-4 sm:p-6">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary sm:size-16"
            aria-hidden
          >
            {(profile.name ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xl font-bold sm:text-2xl">{profile.name ?? t("manager.unnamed")}</p>
            {currentClub ? (
              <Link
                href={`/clubs/${currentClub.id}`}
                className="mt-1 flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
              >
                <TeamCrest
                  shape={currentClub.crestShape}
                  pattern={currentClub.crestPattern}
                  icon={currentClub.crestIcon}
                  color={currentClub.crestColor}
                  secondaryColor={currentClub.crestSecondaryColor}
                  borderColor={currentClub.crestBorderColor}
                  imageUrl={currentClub.crestImageUrl}
                  size={20}
                />
                <span className="truncate">{currentClub.name}</span>
              </Link>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t("manager.noCurrentClub")}</p>
            )}
          </div>
        </section>

        {spells.length === 0 ? (
          <p className="goalx-broadcast-panel p-6 text-center text-sm text-muted-foreground">
            {t("manager.neverManaged")}
          </p>
        ) : (
          <>
            {/* CAREER SUMMARY */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">{t("manager.careerRecord")}</h2>
              {summary.record.matches === 0 ? (
                <p className="goalx-broadcast-panel p-4 text-sm text-muted-foreground">{t("manager.noMatches")}</p>
              ) : (
                <RecordGrid record={summary.record} t={t} />
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label={t("manager.championships")} value={String(summary.championships)} />
                <Stat label={t("manager.clubsManaged")} value={String(summary.clubsManaged)} />
                <Stat label={t("manager.spells")} value={String(summary.spells)} />
                <Stat
                  label={t("manager.careerStart")}
                  value={summary.careerStartedAt ? dateFormat.format(summary.careerStartedAt) : "—"}
                />
              </div>
            </section>

            {/* CURRENT SEASON - only with an open era. */}
            {currentSeasonRecord && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {t("manager.currentSeasonRecord")} ·{" "}
                  {t("manager.currentSeason", { season: String(currentSeasonRecord.seasonNumber) })}
                </h2>
                <RecordGrid record={currentSeasonRecord.record} t={t} />
              </section>
            )}

            {/* SPELLS - one per era, never merged. */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">{t("manager.careerTimeline")}</h2>
              <ol className="space-y-3">
                {[...spells].reverse().map((spell) => (
                  <SpellCard key={spell.id} spell={spell} t={t} format={dateFormat} />
                ))}
              </ol>
            </section>
          </>
        )}

        {/* TROPHY CABINET */}
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Trophy className="size-4" aria-hidden />
            {t("manager.trophyCabinet")}
          </h2>
          {trophies.length === 0 ? (
            <p className="goalx-broadcast-panel p-4 text-sm text-muted-foreground">{t("manager.noTrophies")}</p>
          ) : (
            <ul className="space-y-3">
              {trophies.map((trophy) => (
                <TrophyCard key={trophy.id} trophy={trophy} t={t} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="goalx-broadcast-panel px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-base font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/** Win percentage is derived here too - never read from a stored field. */
function RecordGrid({ record, t }: { record: ManagerRecord; t: Translator }) {
  const rate = winPercentage(record)
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <Stat label={t("manager.matches")} value={String(record.matches)} />
      <Stat label={t("manager.wins")} value={String(record.wins)} />
      <Stat label={t("manager.draws")} value={String(record.draws)} />
      <Stat label={t("manager.losses")} value={String(record.losses)} />
      <Stat label={t("manager.winPercentage")} value={rate === null ? "—" : `${Math.round(rate * 100)}%`} />
      <Stat label={t("manager.goalsFor")} value={String(record.goalsFor)} />
      <Stat label={t("manager.goalsAgainst")} value={String(record.goalsAgainst)} />
    </div>
  )
}

/**
 * One spell. Two spells at the same club render as two of these, which is the
 * whole point - a returning manager's career reads as chapters.
 */
function SpellCard({ spell, t, format }: { spell: ProfileSpell; t: Translator; format: Intl.DateTimeFormat }) {
  const period = spell.endedAt
    ? t("manager.spellRange", { from: format.format(spell.startedAt), to: format.format(spell.endedAt) })
    : t("manager.spellFrom", { from: format.format(spell.startedAt) })

  const seasons =
    spell.startedSeason && spell.endedSeason
      ? t("manager.seasonRange", {
          from: String(spell.startedSeason.number),
          to: String(spell.endedSeason.number),
        })
      : spell.startedSeason
        ? t("manager.seasonFrom", { from: String(spell.startedSeason.number) })
        : null

  const rate = winPercentage(spell.record)

  return (
    <li className="goalx-broadcast-panel space-y-2 p-4">
      <div className="flex items-start gap-3">
        <TeamCrest
          shape={spell.club.crestShape}
          pattern={spell.club.crestPattern}
          icon={spell.club.crestIcon}
          color={spell.club.crestColor}
          secondaryColor={spell.club.crestSecondaryColor}
          borderColor={spell.club.crestBorderColor}
          imageUrl={spell.club.crestImageUrl}
          size={40}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/clubs/${spell.club.id}`} className="truncate font-semibold hover:text-primary">
              {spell.club.name}
            </Link>
            {spell.isCurrent && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                {t("manager.spellCurrent")}
              </span>
            )}
            {spell.championships > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                <Trophy className="size-3" aria-hidden />
                {spell.championships}
              </span>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{period}</span>
          </p>
          {seasons && <p className="text-xs text-muted-foreground">{seasons}</p>}
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <SpellStat label={t("manager.matches")} value={spell.record.matches} />
        <SpellStat label={t("manager.wins")} value={spell.record.wins} />
        <SpellStat label={t("manager.draws")} value={spell.record.draws} />
        <SpellStat label={t("manager.losses")} value={spell.record.losses} />
        <div className="flex gap-1">
          <dt>{t("manager.winPercentage")}</dt>
          <dd className="font-medium text-foreground">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</dd>
        </div>
        <SpellStat label={t("manager.goalsFor")} value={spell.record.goalsFor} />
        <SpellStat label={t("manager.goalsAgainst")} value={spell.record.goalsAgainst} />
      </dl>
    </li>
  )
}

function SpellStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  return { title: user?.name ? `${user.name} · GoalX` : "GoalX" }
}
