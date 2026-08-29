import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale, type Locale } from "@/lib/i18n/translations"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TeamCrest } from "@/components/team-crest"
import { getLeagueTiers, getDivisionName } from "@/lib/leagues/config"
import { computeStandings, type StandingRow } from "@/lib/leagues/standings"
import { ensureIsraelSeasonSeeded } from "@/lib/leagues/seed"
import { ensureTeamForUser } from "@/lib/team-setup"
import { ensureStadiumForTeam } from "@/lib/stadium/actions"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { calculateTeamTotalQuality, calculateSquadMarketValue } from "@/lib/players/quality"
import { formatMarketValueCompact } from "@/lib/players/currency"
import { cn } from "@/lib/utils"
import { Trophy, Landmark, Star, Users, Wallet, Coins, ListOrdered, CalendarOff, type LucideIcon } from "lucide-react"

function localeToBCP47(locale: Locale): string {
  return locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-US"
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  // Self-heal an "account setup incomplete" state: an authenticated user
  // who somehow ended up without a team (e.g. an OAuth signup whose team
  // creation failed partway through) gets one created here instead of
  // seeing a broken, team-less dashboard forever.
  if (session?.user?.id) {
    await ensureTeamForUser(prisma, session.user.id, session.user.name ?? null)
  }

  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  const team = session?.user?.id
    ? await prisma.team.findUnique({ where: { userId: session.user.id } })
    : null

  if (team?.countryCode === "IL") {
    await ensureIsraelSeasonSeeded()
  }

  const membership = team
    ? await prisma.divisionTeam.findFirst({
        where: { teamId: team.id },
        include: { division: true },
        orderBy: { joinedAt: "desc" },
      })
    : null

  const division = membership?.division ?? null
  const tierConfig = division ? getLeagueTiers(team!.countryCode ?? "").find((tc) => tc.tier === division.tier) : null
  const divisionName = division && tierConfig ? getDivisionName(tierConfig, division.group ?? "", locale) : null
  const standings = division ? await computeStandings(division.id) : []
  const teamNameById = new Map(standings.map((r) => [r.teamId, r.teamName]))

  // A compact "around my team" window for the dashboard card - 2 above +
  // me + 2 below, or the top 6 when there aren't 2 teams above (including
  // right at season start, where every team is still tied on 0 points and
  // this just reads as "the top of the table"). The full table stays on
  // /league, untouched.
  const myStandingIndex = team ? standings.findIndex((r) => r.teamId === team.id) : -1
  const standingsWindowStart = myStandingIndex < 0 || myStandingIndex < 2 ? 0 : myStandingIndex - 2
  const standingsWindowEnd =
    myStandingIndex < 0 || myStandingIndex < 2
      ? Math.min(6, standings.length)
      : Math.min(myStandingIndex + 3, standings.length)
  const visibleStandings = standings.slice(standingsWindowStart, standingsWindowEnd)
  const visibleTeamCrests = visibleStandings.length
    ? new Map(
        (
          await prisma.team.findMany({
            where: { id: { in: visibleStandings.map((r) => r.teamId) } },
            select: {
              id: true,
              crestShape: true,
              crestPattern: true,
              crestIcon: true,
              crestColor: true,
              crestSecondaryColor: true,
              crestBorderColor: true,
              crestImageUrl: true,
            },
          })
        ).map((t) => [t.id, t])
      )
    : new Map()

  const upcomingFixtures = division
    ? await prisma.fixture.findMany({
        where: {
          divisionId: division.id,
          homeScore: null,
          OR: [{ homeTeamId: team!.id }, { awayTeamId: team!.id }],
        },
        orderBy: { matchday: "asc" },
        take: 5,
      })
    : []

  // Everything below (players/stadium/position/next-match) reuses the exact
  // same derivation functions the squad/stadium/league pages already use -
  // no new data model, just reading what's already there for the Hero and
  // the 4 key-stat cards.
  const players = team
    ? await prisma.player.findMany({ where: { teamId: team.id }, select: { overall: true, marketValue: true } })
    : []
  const teamTotalQuality = calculateTeamTotalQuality(players)
  const squadMarketValue = calculateSquadMarketValue(players)

  const stadium = team ? await ensureStadiumForTeam(team.id, team.name) : null
  const stadiumCapacity = stadium ? calculateStadiumCapacity(toSeatCounts(stadium)) : null

  const positionLabel = myStandingIndex >= 0 ? myStandingIndex + 1 : null

  const nextFixture = upcomingFixtures[0] ?? null
  const isHomeNextMatch = nextFixture && team ? nextFixture.homeTeamId === team.id : true
  const opponentId = nextFixture && team ? (isHomeNextMatch ? nextFixture.awayTeamId : nextFixture.homeTeamId) : null
  const opponentTeam = opponentId
    ? await prisma.team.findUnique({
        where: { id: opponentId },
        select: {
          name: true,
          crestShape: true,
          crestPattern: true,
          crestIcon: true,
          crestColor: true,
          crestSecondaryColor: true,
          crestBorderColor: true,
          crestImageUrl: true,
        },
      })
    : null
  const opponentName = opponentId ? (opponentTeam?.name ?? teamNameById.get(opponentId) ?? "") : null

  const dateLocale = localeToBCP47(locale)
  const nextMatchDate = nextFixture?.scheduledAt
    ? nextFixture.scheduledAt.toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long" })
    : null
  const nextMatchTime = nextFixture?.scheduledAt
    ? nextFixture.scheduledAt.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })
    : null

  let countdown: { days: number; hours: number } | null = null
  if (nextFixture?.scheduledAt) {
    const diffMs = nextFixture.scheduledAt.getTime() - Date.now()
    if (diffMs > 0) {
      countdown = { days: Math.floor(diffMs / 86_400_000), hours: Math.floor((diffMs % 86_400_000) / 3_600_000) }
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Subtle page-wide purple tint + a huge, near-transparent GoalX mark
          decorating the background - the existing logo asset, not a new
          image - so the brand is felt even where there's no real artwork. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.04] via-transparent to-transparent" />
      <div
        aria-hidden
        className="pointer-events-none absolute -end-32 -top-32 size-[420px] rotate-[-10deg] opacity-[0.05] blur-[1px] sm:-end-40 sm:-top-40 sm:size-[560px] lg:size-[680px]"
      >
        <Image src="/logo.png" alt="" fill sizes="680px" className="object-contain" />
      </div>

      <main className="relative mx-auto max-w-5xl px-6 py-8 sm:py-12">
        <div className="space-y-6">
          <ClubHero
            team={team}
            managerName={session?.user?.name ?? null}
            divisionName={divisionName}
            positionLabel={positionLabel}
            stadiumName={stadium?.name ?? null}
            stadiumCapacity={stadiumCapacity}
            teamTotalQuality={teamTotalQuality}
            fallbackTeamName={session?.user?.teamName ?? ""}
            t={t}
          />

          <div className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-start">
            <NextMatchCard
              team={team}
              opponentName={opponentName}
              opponentTeam={opponentTeam}
              isHome={isHomeNextMatch}
              divisionName={divisionName}
              matchDate={nextMatchDate}
              matchTime={nextMatchTime}
              countdown={countdown}
              t={t}
            />

            <ClubStatusStats
              teamTotalQuality={teamTotalQuality}
              squadMarketValue={squadMarketValue}
              balance={team?.balance ?? 0}
              playerCount={players.length}
              t={t}
            />
          </div>
        </div>

        <Card className="mt-6 overflow-hidden py-0">
          <CardHeader className="gap-2 border-b bg-gradient-to-br from-primary/10 via-primary/5 to-transparent py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="truncate text-base">{divisionName ?? t("league.title")}</CardTitle>
                {nextFixture && (
                  <CardDescription className="mt-0.5">
                    {t("league.matchday", { n: String(nextFixture.matchday) })}
                  </CardDescription>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {positionLabel && (
                  <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                    <Trophy className="size-3.5" />
                    {t("dashboard.hero.position", { n: String(positionLabel) })}
                  </span>
                )}
                {division && (
                  <Button asChild size="sm" variant="outline" className="bg-card">
                    <Link href="/league">{t("dashboard.league.viewFullTable")}</Link>
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 px-3 py-4 sm:px-4">
            {!division ? (
              <p className="px-3 text-muted-foreground">{t("league.notAssigned")}</p>
            ) : (
              <>
                {/* Each row's grid columns collapse per breakpoint (see
                    StandingsRow) instead of scrolling - position, team,
                    played and points always fit; won/drawn/lost/goal-diff
                    only join in at sm: where there's room, so this never
                    needs horizontal scroll. */}
                <StandingsHeaderRow t={t} />
                <div className="space-y-1">
                  {visibleStandings.map((row, i) => (
                    <StandingsRow
                      key={row.teamId}
                      row={row}
                      position={standingsWindowStart + i + 1}
                      isMe={row.teamId === team?.id}
                      crest={visibleTeamCrests.get(row.teamId) ?? null}
                      t={t}
                    />
                  ))}
                </div>

                <h3 className="mb-2 mt-6 px-3 text-sm font-medium text-muted-foreground">
                  {t("league.upcomingFixtures")}
                </h3>
                {upcomingFixtures.length === 0 ? (
                  <p className="px-3 text-muted-foreground">{t("league.noFixturesYet")}</p>
                ) : (
                  <ul className="space-y-1 px-3 text-sm">
                    {upcomingFixtures.map((f) => {
                      const isHome = f.homeTeamId === team?.id
                      const opponentId = isHome ? f.awayTeamId : f.homeTeamId
                      const opponentName = teamNameById.get(opponentId) ?? ""
                      return (
                        <li key={f.id} className="border-b py-1 last:border-0">
                          <Link
                            href={`/match/${f.id}`}
                            className="flex items-center justify-between hover:text-primary"
                          >
                            <span className="text-muted-foreground">
                              {t("league.matchday", { n: String(f.matchday) })}
                            </span>
                            <span>
                              {isHome ? t("league.home") : t("league.away")} · {opponentName}
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

type Translator = ReturnType<typeof getTranslator>

/**
 * The club's identity strip - replaces the old plain "welcome" card. Deep
 * purple/lavender surface (same brand gradient as the landing page), crest,
 * club name up front, manager name underneath, and a compact meta row for
 * whatever real context already exists (league, table position, stadium,
 * squad quality) - never a table.
 */
function ClubHero({
  team,
  managerName,
  divisionName,
  positionLabel,
  stadiumName,
  stadiumCapacity,
  teamTotalQuality,
  fallbackTeamName,
  t,
}: {
  team: {
    name: string
    crestShape: string | null
    crestPattern: string | null
    crestIcon: string | null
    crestColor: string | null
    crestSecondaryColor: string | null
    crestBorderColor: string | null
    crestImageUrl: string | null
  } | null
  managerName: string | null
  divisionName: string | null
  positionLabel: number | null
  stadiumName: string | null
  stadiumCapacity: number | null
  teamTotalQuality: number
  fallbackTeamName: string
  t: Translator
}) {
  const metaItems: { icon: LucideIcon; label: string }[] = []
  if (divisionName) metaItems.push({ icon: Trophy, label: divisionName })
  if (positionLabel) metaItems.push({ icon: ListOrdered, label: t("dashboard.hero.position", { n: String(positionLabel) }) })
  if (stadiumName && stadiumCapacity) {
    metaItems.push({ icon: Landmark, label: `${stadiumName} · ${stadiumCapacity.toLocaleString()}` })
  }
  metaItems.push({ icon: Star, label: `${t("squad.summaryQuality")} ${teamTotalQuality}` })

  return (
    <div className="goalx-hero-gradient motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 relative overflow-hidden rounded-2xl border border-white/10 p-6 text-white shadow-lg motion-safe:duration-500 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -end-14 -top-14 size-56 rotate-[8deg] opacity-[0.08] blur-[1px] sm:size-72"
      >
        <Image src="/logo.png" alt="" fill sizes="288px" className="object-contain" />
      </div>

      <div className="relative flex flex-wrap items-center gap-4">
        <TeamCrest
          shape={team?.crestShape}
          pattern={team?.crestPattern}
          icon={team?.crestIcon}
          color={team?.crestColor}
          secondaryColor={team?.crestSecondaryColor}
          borderColor={team?.crestBorderColor}
          imageUrl={team?.crestImageUrl}
          size={64}
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold sm:text-3xl">{team?.name ?? fallbackTeamName}</h1>
          {managerName && <p className="mt-1 text-sm text-white/70">{t("dashboard.hero.manager", { name: managerName })}</p>}
        </div>
      </div>

      <div className="relative mt-5 flex flex-wrap gap-x-6 gap-y-2">
        {metaItems.map((item, i) => (
          <span key={i} className="flex items-center gap-1.5 text-sm text-white/85">
            <item.icon className="size-4 text-white/60" />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Big, central "what's next" card - the game's actual reason to check the dashboard. */
function NextMatchCard({
  team,
  opponentName,
  opponentTeam,
  isHome,
  divisionName,
  matchDate,
  matchTime,
  countdown,
  t,
}: {
  team: {
    name: string
    crestShape: string | null
    crestPattern: string | null
    crestIcon: string | null
    crestColor: string | null
    crestSecondaryColor: string | null
    crestBorderColor: string | null
    crestImageUrl: string | null
  } | null
  opponentName: string | null
  opponentTeam: {
    crestShape: string | null
    crestPattern: string | null
    crestIcon: string | null
    crestColor: string | null
    crestSecondaryColor: string | null
    crestBorderColor: string | null
    crestImageUrl: string | null
  } | null
  isHome: boolean
  divisionName: string | null
  matchDate: string | null
  matchTime: string | null
  countdown: { days: number; hours: number } | null
  t: Translator
}) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 rounded-2xl border bg-card p-6 shadow-sm motion-safe:duration-500 motion-safe:delay-100">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("dashboard.nextMatch.title")}</h2>
        {divisionName && <span className="truncate text-xs text-muted-foreground">{divisionName}</span>}
      </div>

      {!opponentName ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <CalendarOff className="size-10 text-muted-foreground/40" />
          <p className="max-w-xs text-sm font-medium text-muted-foreground">{t("dashboard.nextMatch.emptyTitle")}</p>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center justify-center gap-4 sm:gap-10">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamCrest
                shape={team?.crestShape}
                pattern={team?.crestPattern}
                icon={team?.crestIcon}
                color={team?.crestColor}
                secondaryColor={team?.crestSecondaryColor}
                borderColor={team?.crestBorderColor}
                imageUrl={team?.crestImageUrl}
                size={48}
              />
              <span className="max-w-full truncate text-sm font-semibold">{team?.name}</span>
            </div>

            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("dashboard.nextMatch.vs")}</span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  isHome ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                {isHome ? t("league.home") : t("league.away")}
              </span>
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamCrest
                shape={opponentTeam?.crestShape}
                pattern={opponentTeam?.crestPattern}
                icon={opponentTeam?.crestIcon}
                color={opponentTeam?.crestColor}
                secondaryColor={opponentTeam?.crestSecondaryColor}
                borderColor={opponentTeam?.crestBorderColor}
                imageUrl={opponentTeam?.crestImageUrl}
                size={48}
              />
              <span className="max-w-full truncate text-sm font-semibold">{opponentName}</span>
            </div>
          </div>

          {(matchDate || matchTime) && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {matchDate && <span>{matchDate}</span>}
              {matchTime && <span>{matchTime}</span>}
            </div>
          )}

          {countdown && (
            <div className="mt-4 rounded-lg bg-primary/5 py-2 text-center text-sm font-medium text-primary">
              {t("dashboard.nextMatch.countdownLabel")} · {countdown.days} {t("dashboard.countdown.days")}{" "}
              {countdown.hours} {t("dashboard.countdown.hours")}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Four real, already-computed numbers - never a table, never invented data. */
function ClubStatusStats({
  teamTotalQuality,
  squadMarketValue,
  balance,
  playerCount,
  t,
}: {
  teamTotalQuality: number
  squadMarketValue: number
  balance: number
  playerCount: number
  t: Translator
}) {
  const stats: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Star, label: t("squad.summaryQuality"), value: String(teamTotalQuality) },
    { icon: Coins, label: t("squad.summaryValue"), value: formatMarketValueCompact(squadMarketValue) },
    { icon: Wallet, label: t("dashboard.availableBudget"), value: formatMarketValueCompact(balance) },
    { icon: Users, label: t("squad.summaryPlayers"), value: String(playerCount) },
  ]

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 space-y-2 motion-safe:duration-500 motion-safe:delay-150">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("dashboard.clubStatus.title")}</h2>
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <stat.icon className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-bold leading-tight">{stat.value}</div>
              <div className="truncate text-xs text-muted-foreground">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type TeamCrestFields = {
  crestShape: string | null
  crestPattern: string | null
  crestIcon: string | null
  crestColor: string | null
  crestSecondaryColor: string | null
  crestBorderColor: string | null
  crestImageUrl: string | null
}

/** Column labels for StandingsRow, sharing its exact grid template so everything lines up. */
function StandingsHeaderRow({ t }: { t: Translator }) {
  return (
    <div className="grid grid-cols-[1.75rem_1fr_2.25rem_2.75rem] items-center gap-2 px-2 pb-1.5 text-[11px] font-medium text-muted-foreground sm:grid-cols-[1.75rem_1fr_2.25rem_2.25rem_2.25rem_2.25rem_2.75rem_2.75rem] sm:gap-3 sm:px-3">
      <span />
      <span />
      <span className="text-center">{t("league.colPlayed")}</span>
      <span className="hidden text-center sm:block">{t("league.colWon")}</span>
      <span className="hidden text-center sm:block">{t("league.colDrawn")}</span>
      <span className="hidden text-center sm:block">{t("league.colLost")}</span>
      <span className="hidden text-center sm:block">{t("league.colGoalDiff")}</span>
      <span className="text-center">{t("league.colPoints")}</span>
    </div>
  )
}

/**
 * One row of the dashboard's compact standings window - a "game row" feel
 * (crest, generous padding, no thin table borders) instead of a spreadsheet.
 * Mobile shows position/team/played/points only; won/drawn/lost/goal-diff
 * join in at sm: via the same row simply switching its own grid template
 * (hidden cells drop out of grid flow entirely, so nothing needs to scroll).
 * No promotion/relegation stripe - that ruleset isn't wired up as queryable
 * per-position data anywhere in the app yet, so it isn't invented here.
 */
function StandingsRow({
  row,
  position,
  isMe,
  crest,
  t,
}: {
  row: StandingRow
  position: number
  isMe: boolean
  crest: TeamCrestFields | null
  t: Translator
}) {
  const isTopThree = position <= 3
  const goalDiffLabel = row.goalDiff > 0 ? `+${row.goalDiff}` : String(row.goalDiff)

  return (
    <div
      className={cn(
        "grid grid-cols-[1.75rem_1fr_2.25rem_2.75rem] items-center gap-2 rounded-lg border-s-4 px-2 py-2.5 sm:grid-cols-[1.75rem_1fr_2.25rem_2.25rem_2.25rem_2.25rem_2.75rem_2.75rem] sm:gap-3 sm:px-3",
        isMe ? "border-s-primary bg-primary/5" : "border-s-transparent"
      )}
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full text-xs font-bold",
          isTopThree ? "bg-primary/10 text-primary" : "text-sm font-semibold text-muted-foreground"
        )}
      >
        {position}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <TeamCrest
          shape={crest?.crestShape}
          pattern={crest?.crestPattern}
          icon={crest?.crestIcon}
          color={crest?.crestColor}
          secondaryColor={crest?.crestSecondaryColor}
          borderColor={crest?.crestBorderColor}
          imageUrl={crest?.crestImageUrl}
          size={22}
        />
        <span className="min-w-0">
          <span className={cn("block truncate text-sm", isMe ? "font-bold" : "font-medium")}>{row.teamName}</span>
          {isMe && <span className="text-[10px] font-medium text-primary">{t("dashboard.league.myTeamBadge")}</span>}
        </span>
      </span>

      <span className="text-center text-sm text-muted-foreground">{row.played}</span>

      <span className="hidden text-center text-sm text-muted-foreground sm:block">{row.won}</span>
      <span className="hidden text-center text-sm text-muted-foreground sm:block">{row.drawn}</span>
      <span className="hidden text-center text-sm text-muted-foreground sm:block">{row.lost}</span>
      <span className="hidden text-center text-sm text-muted-foreground sm:block">{goalDiffLabel}</span>

      <span className="text-center text-sm font-bold">{row.points}</span>
    </div>
  )
}
