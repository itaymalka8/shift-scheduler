/**
 * Manual, one-off tool for verifying the scheduler end to end - NOT wired
 * into any route, page, or API. Run it yourself, once, from a Render Shell
 * on the web or cron service (both already carry DATABASE_URL):
 *
 *   npx tsx scripts/create-cron-test-fixture.ts
 *
 * Creates exactly one Fixture between the first two teams of the current
 * active season's first division, kicking off ~4 minutes from now, so
 * processDueFixtures() can pick it up on its own next scheduled run. Never
 * calls processDueFixtures itself, never touches any other Fixture, Team,
 * or Player row.
 *
 * Guarded against being run twice by accident: it uses a sentinel matchday
 * number (TEST_MATCHDAY) that real season generation never produces, and
 * refuses to create a second test fixture while one from a previous run is
 * still unplayed - it just reports the existing one instead.
 */
import { prisma } from "../src/lib/prisma"

const TEST_MATCHDAY = 999999
const MINUTES_AHEAD = 4

async function main() {
  const existing = await prisma.fixture.findFirst({
    where: { matchday: TEST_MATCHDAY, playedAt: null },
    include: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
  })
  if (existing) {
    console.log("A cron test fixture is already pending - not creating another.")
    console.log("fixtureId:", existing.id)
    console.log("teams:", `${existing.homeTeam.name} vs ${existing.awayTeam.name}`)
    console.log("scheduledAt:", existing.scheduledAt?.toISOString())
    return
  }

  const season = await prisma.season.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } })
  if (!season) throw new Error("No active season found - cannot create a test fixture safely.")

  const division = await prisma.division.findFirst({
    where: { seasonId: season.id },
    orderBy: [{ tier: "asc" }, { group: "asc" }],
    include: { teams: { orderBy: { joinedAt: "asc" }, take: 2, include: { team: { select: { id: true, name: true } } } } },
  })
  if (!division || division.teams.length < 2) {
    throw new Error("No division with at least two teams found - cannot create a test fixture safely.")
  }
  const [home, away] = division.teams.map((dt) => dt.team)

  const scheduledAt = new Date(Date.now() + MINUTES_AHEAD * 60_000)
  const fixture = await prisma.fixture.create({
    data: {
      divisionId: division.id,
      matchday: TEST_MATCHDAY,
      homeTeamId: home.id,
      awayTeamId: away.id,
      scheduledAt,
    },
  })

  console.log("Created cron test fixture.")
  console.log("fixtureId:", fixture.id)
  console.log("teams:", `${home.name} vs ${away.name}`)
  console.log("scheduledAt:", scheduledAt.toISOString())
}

main()
  .catch((error) => {
    console.error("create-cron-test-fixture failed:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
