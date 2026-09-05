import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { Bot, Trophy } from "lucide-react"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"
import { getClubIdentity, getClubTrophies } from "@/lib/clubs/history"
import { TeamCrest } from "@/components/team-crest"
import { TrophyCard } from "@/components/trophies/trophy-card"

export const dynamic = "force-dynamic"

/**
 * A CLUB'S HONOURS, for any club.
 *
 * The minimal route the club cabinet needs - deliberately not a club profile
 * redesign. /club stays what it is: the signed-in manager's own crest and kit
 * studio. This is the public, read-only history of any club by id.
 *
 * Every title the club ever won is here, including the ones a bot won. A bot
 * title shows no manager, and never the person who happens to hold the club
 * today.
 */
export default async function ClubHistoryPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  const now = new Date()
  const [club, trophies] = await Promise.all([getClubIdentity(teamId), getClubTrophies(teamId, now)])
  if (!club) notFound()

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold sm:text-2xl">{t("club.historyTitle")}</h1>
          <Link href="/dashboard" className="shrink-0 text-sm text-primary hover:underline">
            {t("manager.backToDashboard")}
          </Link>
        </div>

        {/* The club's CURRENT identity. Historical titles below keep their own names. */}
        <section className="goalx-broadcast-panel flex items-center gap-4 p-4 sm:p-6">
          <TeamCrest
            shape={club.crestShape}
            pattern={club.crestPattern}
            icon={club.crestIcon}
            color={club.crestColor}
            secondaryColor={club.crestSecondaryColor}
            borderColor={club.crestBorderColor}
            imageUrl={club.crestImageUrl}
            size={56}
            className="shrink-0"
          />
          <div className="min-w-0">
            <p className="truncate text-xl font-bold sm:text-2xl">{club.name}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Trophy className="size-4" aria-hidden />
              {t("club.honours")}: <span className="font-semibold tabular-nums">{trophies.length}</span>
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("club.honours")}</h2>
          {trophies.length === 0 ? (
            <p className="goalx-broadcast-panel p-4 text-sm text-muted-foreground">{t("club.noHonours")}</p>
          ) : (
            <ul className="space-y-3">
              {trophies.map((trophy) => (
                <TrophyCard
                  key={trophy.id}
                  trophy={trophy}
                  t={t}
                  footer={
                    trophy.manager ? (
                      <p className="text-xs text-muted-foreground">
                        {t("club.managerLabel")}:{" "}
                        <Link href={`/managers/${trophy.manager.userId}`} className="text-primary hover:underline">
                          {trophy.manager.name ?? t("manager.unnamed")}
                        </Link>
                      </p>
                    ) : (
                      // A bot title belongs to the club and to nobody else. No
                      // fake manager is invented to fill the space.
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Bot className="size-3.5" aria-hidden />
                        {t("club.managedByBot")}
                      </p>
                    )
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const club = await getClubIdentity(teamId)
  return { title: club ? `${club.name} · GoalX` : "GoalX" }
}
