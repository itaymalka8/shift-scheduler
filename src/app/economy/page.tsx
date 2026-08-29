import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { calculateTeamTotalQuality } from "@/lib/players/quality"
import { ensureStadiumForTeam } from "@/lib/stadium/actions"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateAttendance, calculateMatchStadiumRevenue } from "@/lib/stadium/attendance"
import { calculateHomeMatchExpenses, calculateAwayTravelCost } from "@/lib/economy/match-expenses"
import { settleDuePayroll, getNextPayrollDate } from "@/lib/economy/payroll"
import { EconomyApp } from "./economy-app"

const LEDGER_LIMIT = 30
const COMPETITION = "league" as const

export default async function EconomyPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  await settleDuePayroll(team.id)
  const stadium = await ensureStadiumForTeam(team.id, team.name)

  const [freshTeam, players, transactions] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: team.id }, select: { balance: true } }),
    prisma.player.findMany({ where: { teamId: team.id } }),
    prisma.financialTransaction.findMany({
      where: { teamId: team.id },
      orderBy: { createdAt: "desc" },
      take: LEDGER_LIMIT,
    }),
  ])

  const totalWeeklyPlayerSalaries = players.reduce((sum, p) => sum + p.weeklySalary, 0)
  const nextPayrollDate = getNextPayrollDate()

  const seats = toSeatCounts(stadium)
  const capacity = calculateStadiumCapacity(seats)
  const teamQuality = calculateTeamTotalQuality(players)

  const now = new Date()
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const upcomingFixtures = await prisma.fixture.findMany({
    where: {
      OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }],
      scheduledAt: { gte: now, lt: weekEnd },
      playedAt: null,
    },
  })

  let expectedIncome = 0
  let expectedExpenses = totalWeeklyPlayerSalaries
  for (const fixture of upcomingFixtures) {
    if (fixture.homeTeamId === team.id) {
      const attendance = calculateAttendance({ isHome: true }, { teamTotalQuality: teamQuality }, { seats })
      const revenue = calculateMatchStadiumRevenue(attendance.bySeatType)
      const expenses = calculateHomeMatchExpenses({ capacity }, attendance.total, COMPETITION)
      expectedIncome += revenue.total
      expectedExpenses += expenses.total
    } else {
      expectedExpenses += calculateAwayTravelCost(COMPETITION)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <EconomyApp
          balance={freshTeam.balance}
          totalWeeklyPlayerSalaries={totalWeeklyPlayerSalaries}
          nextPayrollDate={nextPayrollDate.toISOString()}
          players={players
            .map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, position: p.primaryPosition, overall: p.overall, weeklySalary: p.weeklySalary }))
            .sort((a, b) => b.weeklySalary - a.weeklySalary)}
          forecast={{ expectedIncome, expectedExpenses, net: expectedIncome - expectedExpenses }}
          transactions={transactions.map((tx) => ({
            id: tx.id,
            type: tx.type,
            amount: tx.amount,
            description: tx.description,
            createdAt: tx.createdAt.toISOString(),
          }))}
        />
      </main>
    </div>
  )
}
