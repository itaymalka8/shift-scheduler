import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageSwitcher } from "@/components/language-switcher"
import { getLeagueTiers, getDivisionName } from "@/lib/leagues/config"
import { computeStandings } from "@/lib/leagues/standings"
import { cn } from "@/lib/utils"

export default async function LeaguePage() {
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  const team = session?.user?.id
    ? await prisma.team.findUnique({ where: { userId: session.user.id } })
    : null

  const tierConfigs = getLeagueTiers(team?.countryCode ?? "")
  const season = team?.countryCode
    ? await prisma.season.findFirst({ where: { countryCode: team.countryCode, isActive: true } })
    : null

  const divisions = season
    ? await prisma.division.findMany({
        where: { seasonId: season.id },
        orderBy: [{ tier: "asc" }, { group: "asc" }],
      })
    : []

  const divisionsWithStandings = await Promise.all(
    divisions.map(async (division) => {
      const tierConfig = tierConfigs.find((tc) => tc.tier === division.tier)
      return {
        division,
        name: tierConfig ? getDivisionName(tierConfig, division.group ?? "", locale) : division.name,
        standings: await computeStandings(division.id),
      }
    })
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Image src="/logo.png" alt="Goalx Manager" width={40} height={40} className="rounded-full" />
            <span className="font-semibold text-lg">{t("app.name")}</span>
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("league.allLeaguesTitle")}</h1>
          <Link href="/dashboard" className="text-sm text-primary hover:underline">
            {t("league.backToDashboard")}
          </Link>
        </div>

        {divisionsWithStandings.length === 0 ? (
          <p className="text-muted-foreground">{t("league.notAssigned")}</p>
        ) : (
          divisionsWithStandings.map(({ division, name, standings }) => (
            <Card key={division.id}>
              <CardHeader>
                <CardTitle>{name}</CardTitle>
              </CardHeader>
              <CardContent>
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
                          className={cn(
                            "border-b last:border-0",
                            row.teamId === team?.id && "bg-accent/60 font-medium"
                          )}
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
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  )
}
