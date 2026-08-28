import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TeamCrest } from "@/components/team-crest"
import { LanguageSwitcher } from "@/components/language-switcher"
import { SignOutButton } from "./sign-out-button"
import { getLeagueTiers, getDivisionName } from "@/lib/leagues/config"
import { computeStandings } from "@/lib/leagues/standings"
import { ensureIsraelSeasonSeeded } from "@/lib/leagues/seed"
import { ensureTeamForUser } from "@/lib/team-setup"
import { cn } from "@/lib/utils"

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Goalx Manager" width={40} height={40} className="rounded-full" />
            <span className="font-semibold text-lg">{t("app.name")}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/squad" className="text-sm font-medium text-primary hover:underline">
              {t("squad.navLink")}
            </Link>
            <Link href="/stadium" className="text-sm font-medium text-primary hover:underline">
              {t("stadium.navLink")}
            </Link>
            <LanguageSwitcher />
            <SignOutButton label={t("dashboard.signOut")} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <TeamCrest
                shape={team?.crestShape}
                pattern={team?.crestPattern}
                icon={team?.crestIcon}
                color={team?.crestColor}
                secondaryColor={team?.crestSecondaryColor}
                borderColor={team?.crestBorderColor}
                imageUrl={team?.crestImageUrl}
                size={56}
              />
              <div>
                <CardTitle className="text-2xl">
                  {t("dashboard.welcome", { team: team?.name ?? session?.user?.teamName ?? "" })}
                </CardTitle>
                <CardDescription>
                  {t("dashboard.greeting", { name: session?.user?.name ?? "" })}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{t("dashboard.comingSoon")}</p>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("league.title")}</CardTitle>
              {division && (
                <Link href="/league" className="text-sm text-primary hover:underline">
                  {t("league.viewAllLeagues")}
                </Link>
              )}
            </div>
            {divisionName && <CardDescription>{divisionName}</CardDescription>}
          </CardHeader>
          <CardContent>
            {!division ? (
              <p className="text-muted-foreground">{t("league.notAssigned")}</p>
            ) : (
              <>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t("league.standings")}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="px-2 py-1 text-start font-medium">{t("league.colPos")}</th>
                        <th className="px-2 py-1 text-start font-medium">{t("league.colTeam")}</th>
                        <th className="px-2 py-1 text-center font-medium">{t("league.colPlayed")}</th>
                        <th className="px-2 py-1 text-center font-medium">{t("league.colWon")}</th>
                        <th className="px-2 py-1 text-center font-medium">{t("league.colDrawn")}</th>
                        <th className="px-2 py-1 text-center font-medium">{t("league.colLost")}</th>
                        <th className="px-2 py-1 text-center font-medium">{t("league.colGoalsFor")}</th>
                        <th className="px-2 py-1 text-center font-medium">{t("league.colGoalsAgainst")}</th>
                        <th className="px-2 py-1 text-center font-medium">{t("league.colGoalDiff")}</th>
                        <th className="px-2 py-1 text-center font-semibold">{t("league.colPoints")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row, i) => (
                        <tr
                          key={row.teamId}
                          className={cn("border-b last:border-0", row.teamId === team?.id && "bg-accent/60 font-medium")}
                        >
                          <td className="px-2 py-1">{i + 1}</td>
                          <td className="px-2 py-1">{row.teamName}</td>
                          <td className="px-2 py-1 text-center">{row.played}</td>
                          <td className="px-2 py-1 text-center">{row.won}</td>
                          <td className="px-2 py-1 text-center">{row.drawn}</td>
                          <td className="px-2 py-1 text-center">{row.lost}</td>
                          <td className="px-2 py-1 text-center">{row.goalsFor}</td>
                          <td className="px-2 py-1 text-center">{row.goalsAgainst}</td>
                          <td className="px-2 py-1 text-center">{row.goalDiff}</td>
                          <td className="px-2 py-1 text-center font-semibold">{row.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="mb-2 mt-6 text-sm font-medium text-muted-foreground">
                  {t("league.upcomingFixtures")}
                </h3>
                {upcomingFixtures.length === 0 ? (
                  <p className="text-muted-foreground">{t("league.noFixturesYet")}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
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
