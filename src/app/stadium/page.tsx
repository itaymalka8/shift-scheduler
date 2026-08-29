import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ensureStadiumForTeam, settleDueStadiumConstruction } from "@/lib/stadium/actions"
import { calculateStadiumCapacity, calculateStadiumValue, calculateWeeklyMaintenance } from "@/lib/stadium/metrics"
import { toSeatCounts } from "@/lib/stadium/config"
import { StadiumApp } from "./stadium-app"

const MATCH_HISTORY_LIMIT = 10

export default async function StadiumPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  await ensureStadiumForTeam(team.id, team.name)
  const justCompletedJob = await settleDueStadiumConstruction(team.id)

  const stadium = await prisma.stadium.findUniqueOrThrow({
    where: { teamId: team.id },
    include: { constructionJobs: { where: { status: "active" } } },
  })
  const seats = toSeatCounts(stadium)
  const capacity = calculateStadiumCapacity(seats)
  const stadiumValue = calculateStadiumValue(seats)
  const weeklyMaintenance = calculateWeeklyMaintenance(seats)
  const activeJob = stadium.constructionJobs[0] ?? null

  const homeFixtures = await prisma.fixture.findMany({
    where: { homeTeamId: team.id, playedAt: { not: null }, attendance: { not: null } },
    orderBy: { playedAt: "desc" },
    take: MATCH_HISTORY_LIMIT,
    include: { awayTeam: { select: { name: true } } },
  })

  const lastMatch = homeFixtures[0] ?? null
  const seasonMatches = homeFixtures // only Season 1 exists so far - every played home fixture is "this season"
  const seasonAvgAttendance = seasonMatches.length
    ? Math.round(seasonMatches.reduce((sum, f) => sum + (f.attendance ?? 0), 0) / seasonMatches.length)
    : 0
  const seasonPeakAttendance = seasonMatches.reduce((max, f) => Math.max(max, f.attendance ?? 0), 0)
  const seasonAvgOccupancy = capacity > 0 ? Math.round((seasonAvgAttendance / capacity) * 100) : 0
  const seasonRevenue = seasonMatches.reduce((sum, f) => sum + (f.homeRevenue ?? 0), 0)

  const recentNearCapacityStreak = (() => {
    let streak = 0
    for (const f of homeFixtures) {
      if (capacity > 0 && (f.attendance ?? 0) / capacity >= 0.93) streak++
      else break
    }
    return streak
  })()

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <StadiumApp
          stadiumName={stadium.name}
          teamName={team.name}
          stadiumStyle={team.stadiumStyle}
          seats={seats}
          capacity={capacity}
          stadiumValue={stadiumValue}
          weeklyMaintenance={weeklyMaintenance}
          balance={team.balance}
          lastMatch={
            lastMatch
              ? {
                  opponentName: lastMatch.awayTeam.name,
                  playedAt: lastMatch.playedAt!.toISOString(),
                  attendance: lastMatch.attendance!,
                  revenue: lastMatch.homeRevenue ?? 0,
                }
              : null
          }
          matchHistory={homeFixtures.map((f) => ({
            id: f.id,
            opponentName: f.awayTeam.name,
            playedAt: f.playedAt!.toISOString(),
            attendance: f.attendance!,
            revenue: f.homeRevenue ?? 0,
          }))}
          seasonStats={{
            avgAttendance: seasonAvgAttendance,
            peakAttendance: seasonPeakAttendance,
            avgOccupancyPercent: seasonAvgOccupancy,
            seasonRevenue,
          }}
          showExpansionHint={recentNearCapacityStreak >= 3}
          activeJob={
            activeJob
              ? {
                  id: activeJob.id,
                  seatsAdded:
                    activeJob.regularSeatsAdded +
                    activeJob.coveredSeatsAdded +
                    activeJob.premiumSeatsAdded +
                    activeJob.vipSeatsAdded,
                  totalCost: activeJob.totalCost,
                  endsAt: activeJob.endsAt.toISOString(),
                  startedAt: activeJob.startedAt.toISOString(),
                }
              : null
          }
          justCompletedCapacity={justCompletedJob ? capacity : null}
        />
      </main>
    </div>
  )
}
