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
import { getNextPayrollDate, readLastSettledPayroll } from "@/lib/economy/payroll"
import { EconomyApp } from "./economy-app"

const LEDGER_LIMIT = 30
const COMPETITION = "league" as const

export default async function EconomyPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  // READ ONLY WITH RESPECT TO PAYROLL. This page used to be the game's wage
  // clock - it called settleDuePayroll on every render, which meant only the
  // three clubs with a signed-in manager could ever pay wages at all, while
  // the cron charged all sixty for playing. The scheduled job settles payroll
  // now, league-wide and atomically per week, and a page render must never be
  // a second clock racing it.
  //
  // ensureStadiumForTeam stays: it creates a MISSING row, which is
  // initialisation, not the passage of time.
  const stadium = await ensureStadiumForTeam(team.id, team.name)

  const [freshTeam, players, transactions, lastSettledPayroll] = await Promise.all([
    prisma.team.findUniqueOrThrow({ where: { id: team.id }, select: { balance: true } }),
    prisma.player.findMany({ where: { teamId: team.id, careerStatus: "ACTIVE" } }),
    prisma.financialTransaction.findMany({
      where: { teamId: team.id },
      orderBy: { createdAt: "desc" },
      take: LEDGER_LIMIT,
    }),
    readLastSettledPayroll(team.id),
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
          lastSettledPayroll={lastSettledPayroll}
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
