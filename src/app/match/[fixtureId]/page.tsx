import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MatchLiveView } from "./match-live-view"

export default async function MatchPage({ params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId } = await params
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  if (!session?.user?.id) notFound()

  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } })
  if (!fixture) notFound()

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-4">
          <Link href="/league" className="text-sm text-primary hover:underline">
            {t("league.backToDashboard")}
          </Link>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("match.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MatchLiveView fixtureId={fixtureId} />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
