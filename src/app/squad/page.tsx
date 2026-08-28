import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"
import { LanguageSwitcher } from "@/components/language-switcher"
import { DEFAULT_FORMATION, isFormationId } from "@/lib/players/formations"
import { computeRecommendedLineup } from "@/lib/players/recommend"
import { calculateTeamTotalQuality, calculateSquadMarketValue } from "@/lib/players/quality"
import { SquadTacticsApp } from "./squad-tactics-app"

export default async function SquadPage() {
  const session = await getServerSession(authOptions)
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  const formation = isFormationId(team.formation) ? team.formation : DEFAULT_FORMATION
  if (team.formation !== formation) {
    await prisma.team.update({ where: { id: team.id }, data: { formation } })
  }

  let lineupSlots = await prisma.lineupSlot.findMany({ where: { teamId: team.id } })
  const players = await prisma.player.findMany({ where: { teamId: team.id }, orderBy: { overall: "desc" } })

  // Self-heal: a team should never land on an empty pitch.
  if (lineupSlots.length === 0 && players.length > 0) {
    const assignments = computeRecommendedLineup(
      formation,
      players.map((p) => ({
        id: p.id,
        primaryPosition: p.primaryPosition,
        secondaryPositions: p.secondaryPositions,
        overall: p.overall,
        fitness: p.fitness,
        status: p.status,
      }))
    )
    await prisma.lineupSlot.createMany({
      data: assignments.map((a) => ({ teamId: team.id, playerId: a.playerId, slotIndex: a.slotIndex })),
    })
    lineupSlots = await prisma.lineupSlot.findMany({ where: { teamId: team.id } })
  }

  const teamTotalQuality = calculateTeamTotalQuality(players)
  const squadMarketValue = calculateSquadMarketValue(players)
  const totalWeeklyPlayerSalaries = players.reduce((sum, p) => sum + p.weeklySalary, 0)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Image src="/logo.png" alt="Goalx Manager" width={40} height={40} className="rounded-full" />
            <span className="font-semibold text-lg">{t("app.name")}</span>
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <SquadTacticsApp
          players={players.map((p) => ({
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            primaryPosition: p.primaryPosition,
            secondaryPositions: p.secondaryPositions,
            age: p.age,
            overall: p.overall,
            potential: p.potential,
            fitness: p.fitness,
            status: p.status as "available" | "injured" | "suspended" | "unavailable",
            marketValue: p.marketValue,
            weeklySalary: p.weeklySalary,
            preferredFoot: p.preferredFoot as "left" | "right" | "both",
            nationality: p.nationality,
            shirtNumber: p.shirtNumber,
          }))}
          initialAssignments={lineupSlots.map((s) => ({ slotIndex: s.slotIndex, playerId: s.playerId }))}
          initialFormation={formation}
          initialMentality={team.mentality ?? "balanced"}
          initialTempo={team.tempo ?? "normal"}
          initialPressing={team.pressing ?? "normal"}
          initialWidth={team.width ?? "balanced"}
          initialCaptainId={team.captainId}
          initialPenaltyTakerId={team.penaltyTakerId}
          initialFreeKickTakerId={team.freeKickTakerId}
          initialCornerTakerId={team.cornerTakerId}
          accentColor={team.crestColor ?? "#3B2F7A"}
          teamTotalQuality={teamTotalQuality}
          squadMarketValue={squadMarketValue}
          totalWeeklyPlayerSalaries={totalWeeklyPlayerSalaries}
        />
      </main>
    </div>
  )
}
