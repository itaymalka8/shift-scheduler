/**
 * READ ONLY. The Production player population, so the directory's filters are
 * designed against what actually exists rather than against what would be
 * convenient.
 *
 * Every question here is about CURRENT STATE - the Player row - because the
 * directory is a current directory. It deliberately reads no PlayerMatchStats
 * and computes no career figure: that is the Player Profile's job, and
 * duplicating it here would be a second source of truth.
 *
 * SELECTs only. No user, email, auth or manager data is read.
 *
 * Run with: npm run prod:players:directory-audit
 */
import { createProductionClient } from "../../src/lib/production/client"

async function main() {
  console.info("=== prod:players:directory-audit ===")
  console.info("Mode:     READ ONLY - SELECTs only\n")

  const { prisma, target } = createProductionClient()
  console.info(`Database: host=${target.host} name=${target.database}\n`)

  const [total, active, retired, freeAgents, withClub] = await Promise.all([
    prisma.player.count(),
    prisma.player.count({ where: { careerStatus: "ACTIVE" } }),
    prisma.player.count({ where: { careerStatus: "RETIRED" } }),
    prisma.player.count({ where: { teamId: null } }),
    prisma.player.count({ where: { teamId: { not: null } } }),
  ])
  console.info("--- 1. POPULATION ---")
  console.info(`  total=${total} active=${active} retired=${retired}`)
  console.info(`  freeAgents(teamId null)=${freeAgents} withCurrentClub=${withClub}`)

  console.info("\n--- 2. BY PRIMARY POSITION ---")
  const byPosition = await prisma.player.groupBy({
    by: ["primaryPosition"],
    _count: { _all: true },
    orderBy: { _count: { primaryPosition: "desc" } },
  })
  for (const row of byPosition) {
    console.info(`  ${row.primaryPosition.padEnd(4)} ${String(row._count._all).padStart(5)}`)
  }
  console.info(`  distinct positions: ${byPosition.length}`)

  console.info("\n--- 3. BY NATIONALITY (top 15) ---")
  const byNationality = await prisma.player.groupBy({
    by: ["nationality"],
    _count: { _all: true },
    orderBy: { _count: { nationality: "desc" } },
    take: 15,
  })
  for (const row of byNationality) {
    console.info(`  ${row.nationality.padEnd(6)} ${String(row._count._all).padStart(5)}`)
  }
  const allNationalities = await prisma.player.groupBy({ by: ["nationality"], _count: { _all: true } })
  console.info(`  distinct nationalities: ${allNationalities.length}`)

  console.info("\n--- 4. BY SQUAD AVAILABILITY (Player.status) ---")
  const byStatus = await prisma.player.groupBy({
    by: ["status"],
    _count: { _all: true },
    orderBy: { _count: { status: "desc" } },
  })
  for (const row of byStatus) {
    console.info(`  ${row.status.padEnd(12)} ${String(row._count._all).padStart(5)}`)
  }

  console.info("\n--- 5. PLAYERS PER CURRENT CLUB ---")
  const byClub = await prisma.player.groupBy({
    by: ["teamId"],
    _count: { _all: true },
    orderBy: { _count: { teamId: "desc" } },
  })
  const withTeam = byClub.filter((r) => r.teamId !== null)
  const counts = withTeam.map((r) => r._count._all).sort((a, b) => a - b)
  console.info(`  clubs with players: ${withTeam.length}`)
  if (counts.length > 0) {
    console.info(`  squad size min=${counts[0]} median=${counts[Math.floor(counts.length / 2)]} max=${counts[counts.length - 1]}`)
  }

  console.info("\n--- 6. NAME INTEGRITY (drives search design) ---")
  const [emptyFirst, emptyLast] = await Promise.all([
    prisma.player.count({ where: { firstName: "" } }),
    prisma.player.count({ where: { lastName: "" } }),
  ])
  console.info(`  empty firstName=${emptyFirst} empty lastName=${emptyLast}`)
  // firstName/lastName are NOT NULL in the schema, so null is unstorable; the
  // empty-string counts above are the only "missing name" this model permits.
  const dupSurnames = await prisma.player.groupBy({
    by: ["lastName"],
    _count: { _all: true },
    having: { lastName: { _count: { gt: 1 } } },
  })
  const dupFirst = await prisma.player.groupBy({
    by: ["firstName"],
    _count: { _all: true },
    having: { firstName: { _count: { gt: 1 } } },
  })
  console.info(`  surnames shared by more than one player: ${dupSurnames.length}`)
  console.info(`  first names shared by more than one player: ${dupFirst.length}`)
  const distinctFirst = await prisma.player.groupBy({ by: ["firstName"], _count: { _all: true } })
  const distinctLast = await prisma.player.groupBy({ by: ["lastName"], _count: { _all: true } })
  console.info(`  distinct firstName=${distinctFirst.length} distinct lastName=${distinctLast.length}`)

  console.info("\n--- 7. PAGE-SIZE SANITY ---")
  for (const size of [20, 25, 30]) {
    console.info(`  page size ${size}: ${Math.ceil(total / size)} pages for the whole directory`)
  }

  console.info("\nPLAYER DIRECTORY AUDIT: REPORTED")
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
