import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"
import { LanguageSwitcher } from "@/components/language-switcher"
import { DEFAULT_FORMATION, isFormationId, type FormationId, type TacticStyle } from "@/lib/players/formations"
import { TacticsBoard } from "./tactics-board"

export default async function SquadPage() {
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  const [players, lineupSlots] = await Promise.all([
    prisma.player.findMany({ where: { teamId: team.id }, orderBy: { rating: "desc" } }),
    prisma.lineupSlot.findMany({ where: { teamId: team.id } }),
  ])

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

      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-6 text-2xl font-bold">{t("squad.title")}</h1>
        <TacticsBoard
          players={players.map((p) => ({
            id: p.id,
            name: p.name,
            position: p.position as "GK" | "DF" | "MF" | "FW",
            age: p.age,
            rating: p.rating,
            jerseyNumber: p.jerseyNumber,
          }))}
          initialSlots={lineupSlots.map((s) => ({ playerId: s.playerId, x: s.x, y: s.y }))}
          initialFormation={(isFormationId(team.formation) ? team.formation : DEFAULT_FORMATION) as FormationId}
          initialTacticStyle={(team.tacticStyle ?? "balanced") as TacticStyle}
          accentColor={team.crestColor ?? "#3B2F7A"}
        />
      </main>
    </div>
  )
}
