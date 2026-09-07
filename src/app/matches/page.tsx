import Link from "next/link"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale, type Locale } from "@/lib/i18n/translations"
import { resolveSelectedSeason } from "@/lib/leagues/season-select"
import { belongsInResults, belongsInUpcoming, getFixtureListStatus, revealFinalScore } from "@/lib/match/fixture-status"
import { MatchCard, type MatchCardFixture } from "./match-card"
import { cn } from "@/lib/utils"

// Same three-way mapping the dashboard uses for its own kickoff line.
function localeToBCP47(locale: Locale): string {
  return locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-US"
}

const CREST_SELECT = {
  id: true,
  name: true,
  crestShape: true,
  crestPattern: true,
  crestIcon: true,
  crestColor: true,
  crestSecondaryColor: true,
  crestBorderColor: true,
  crestImageUrl: true,
} as const

type MatchesTab = "upcoming" | "results"

/**
 * A club's full match calendar - everything ahead of it and everything
 * behind it, for one season at a time.
 *
 * READ ONLY, by construction: it never calls ensureFixtureSimulated, never
 * touches the scheduler, and never computes standings. A fixture becomes
 * played by processDueFixtures() running on its own schedule (see
 * src/lib/match/simulate.ts) - opening this page must never be what plays a
 * match, exactly as the live match API already refuses to.
 *
 * SPOILER SAFETY: the fixture query below deliberately does NOT select
 * homeScore/awayScore. The engine writes the final result at kickoff, so
 * those columns already hold the finished score of a match whose live
 * 10-minute window still has minutes to run - selecting them here would put
 * a spoiler one careless render away. Scores come from a second, separate
 * query issued only for fixtures already classified `finished`, mirroring
 * how src/app/api/matches/[fixtureId]/route.ts isolates its own
 * finished-only read.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; season?: string }>
}) {
  const { tab: tabParam, season: seasonParam } = await searchParams
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)
  const dateLocale = localeToBCP47(locale)
  const tab: MatchesTab = tabParam === "results" ? "results" : "upcoming"

  const team = session?.user?.id
    ? await prisma.team.findUnique({ where: { userId: session.user.id }, select: { id: true } })
    : null

  if (!team) {
    return (
      <Shell title={t("matches.title")}>
        <p className="text-sm text-muted-foreground">{t("matches.noTeam")}</p>
      </Shell>
    )
  }

  // Every season this club has ever been placed in, newest first. Driven off
  // its division memberships (the DivisionTeam(teamId) index) rather than off
  // fixtures, so a season whose schedule is still being built still appears.
  const memberships = await prisma.divisionTeam.findMany({
    where: { teamId: team.id },
    select: { division: { select: { season: { select: { id: true, number: true, isActive: true } } } } },
  })
  const seasons = [...new Map(memberships.map((m) => [m.division.season.id, m.division.season])).values()].sort(
    (a, b) => b.number - a.number
  )
  const selectedSeason = resolveSelectedSeason(seasons, seasonParam)

  if (!selectedSeason) {
    return (
      <Shell title={t("matches.title")}>
        <p className="text-sm text-muted-foreground">{t("matches.noSeason")}</p>
      </Shell>
    )
  }

  const fixtures = await prisma.fixture.findMany({
    where: {
      division: { seasonId: selectedSeason.id },
      OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
    },
    // No homeScore/awayScore here on purpose - see the header note.
    select: {
      id: true,
      matchday: true,
      scheduledAt: true,
      playedAt: true,
      homeTeamId: true,
      homeTeam: { select: CREST_SELECT },
      awayTeam: { select: CREST_SELECT },
    },
    orderBy: [{ matchday: "asc" }],
  })

  // One `now` for the whole render, so a fixture cannot be classified against
  // one instant and scored against another.
  const now = new Date()
  const upcoming = fixtures.filter((f) => belongsInUpcoming(f, now))
  const results = fixtures.filter((f) => belongsInResults(f, now))

  // The isolated, finished-only score read. Only ids that already classified
  // as `finished` are asked about at all.
  const finishedIds = results.filter((f) => getFixtureListStatus(f, now) === "finished").map((f) => f.id)
  const scoreRows = finishedIds.length
    ? await prisma.fixture.findMany({
        where: { id: { in: finishedIds } },
        select: { id: true, homeScore: true, awayScore: true },
      })
    : []
  const scoreById = new Map(scoreRows.map((row) => [row.id, row]))

  const toCard = (fixture: (typeof fixtures)[number]): MatchCardFixture => {
    const stored = scoreById.get(fixture.id)
    return {
      id: fixture.id,
      matchday: fixture.matchday,
      seasonNumber: selectedSeason.number,
      scheduledAt: fixture.scheduledAt,
      status: getFixtureListStatus(fixture, now),
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      isHome: fixture.homeTeamId === team.id,
      // revealFinalScore re-checks the status itself, so even a score that
      // reached this map by mistake still cannot be rendered early.
      score: stored
        ? revealFinalScore({ ...fixture, homeScore: stored.homeScore, awayScore: stored.awayScore }, now)
        : null,
    }
  }

  const byKickoffAsc = (a: MatchCardFixture, b: MatchCardFixture) =>
    (a.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.scheduledAt?.getTime() ?? Number.MAX_SAFE_INTEGER)

  const visible =
    tab === "results"
      ? results.map(toCard).sort((a, b) => byKickoffAsc(b, a)) // latest first
      : upcoming.map(toCard).sort(byKickoffAsc)

  const seasonHref = (seasonId: string) => `/matches?tab=${tab}&season=${seasonId}`

  return (
    <Shell title={t("matches.title")}>
      {/* Tabs. Plain links, so the whole screen stays a server component and
          a tab is a shareable URL rather than client state. */}
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
        <TabLink
          href={`/matches?tab=upcoming&season=${selectedSeason.id}`}
          label={t("matches.tabUpcoming")}
          active={tab === "upcoming"}
        />
        <TabLink
          href={`/matches?tab=results&season=${selectedSeason.id}`}
          label={t("matches.tabResults")}
          active={tab === "results"}
        />
      </div>

      {/* Season filter, only once there is more than one season to choose. */}
      {seasons.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t("matches.seasonFilterLabel")}</span>
          {seasons.map((season) => (
            <Link
              key={season.id}
              href={seasonHref(season.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                season.id === selectedSeason.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {t("matches.season", { n: String(season.number) })}
            </Link>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab === "results" ? t("matches.emptyResults") : t("matches.emptyUpcoming")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((fixture) => (
            <MatchCard key={fixture.id} fixture={fixture} dateLocale={dateLocale} t={t} />
          ))}
        </ul>
      )}
    </Shell>
  )
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-center text-sm font-semibold transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </Link>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3 py-6 sm:px-6 sm:py-10">
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {children}
      </main>
    </div>
  )
}
