import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"
import { MatchCenter } from "./match-center"

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ fixtureId: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const { fixtureId } = await params
  const { from } = await searchParams
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  if (!session?.user?.id) notFound()

  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId }, select: { id: true } })
  if (!fixture) notFound()

  return (
    // The whole page is the match environment, not a widget dropped on a
    // white document: the dark surface runs edge to edge under the app's
    // navigation, and the Match Center sits inside it with a soft glow, the
    // way a broadcast fills the screen it is watched on.
    <div className="goalx-match-environment min-h-screen">
      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-8">
        {/* Back where the viewer actually came from: the calendar links here
            with ?from=matches, everything else keeps the original target. A
            plain query hint rather than a referrer check, so it survives a
            shared link and never guesses. */}
        <div className="mb-3">
          <Link
            href={from === "matches" ? "/matches" : "/league"}
            className="text-sm font-medium text-white/70 transition-colors hover:text-white"
          >
            {from === "matches" ? t("matches.backToMatches") : t("league.backToDashboard")}
          </Link>
        </div>
        <MatchCenter fixtureId={fixtureId} />
      </main>
    </div>
  )
}
