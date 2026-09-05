/**
 * READ ONLY. Picks real Production players to verify the Player Profile
 * route against after deploy, and reports the shapes that route must survive.
 *
 * WHY BEFORE IMPLEMENTATION: a route is only meaningfully checked with ids
 * that really exist. A 200 on a made-up id proves nothing, and inventing
 * sample players would be inventing the verification too. This also reports
 * whether Production actually CONTAINS the awkward shapes - a transferred
 * player, a retiree, a free agent, a zero-minute cameo - so the phase knows
 * which cases can only be proven against a seeded database.
 *
 * It prints player ids, team ids and counts. No personal data: these are
 * generated squad players, and no user, email or manager name is read.
 *
 * SELECTs only. Run with: npm run prod:players:samples
 */
import { createProductionClient } from "../../src/lib/production/client"
import { MATCH_REAL_DURATION_MINUTES } from "../../src/lib/match/timing"

async function main() {
  console.info("=== prod:players:samples ===")
  console.info("Mode:     READ ONLY - SELECTs only\n")

  const { prisma, target } = createProductionClient()
  console.info(`Database: host=${target.host} name=${target.database}`)
  const now = new Date()
  console.info(`Now:      ${now.toISOString()}\n`)

  // The SAME public-finished cutoff the read surfaces use: isMatchFinished
  // pushed into SQL. A live match's stats exist from kickoff and must not
  // pick a sample player or count towards one.
  const cutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)
  const eligible = {
    fixture: { playedAt: { not: null }, scheduledAt: { not: null, lte: cutoff } },
  } as const

  const rows = await prisma.playerMatchStats.findMany({
    where: eligible,
    select: { playerId: true, teamId: true, goals: true, assists: true, rating: true, minutesPlayed: true },
  })
  console.info(`--- 1. ELIGIBLE HISTORY ---`)
  console.info(`  eligible stat rows=${rows.length}`)

  interface Agg {
    apps: number
    goals: number
    assists: number
    ratingSum: number
    clubs: Set<string>
    zeroMinute: number
  }
  const careers = new Map<string, Agg>()
  for (const r of rows) {
    let a = careers.get(r.playerId)
    if (!a) {
      a = { apps: 0, goals: 0, assists: 0, ratingSum: 0, clubs: new Set(), zeroMinute: 0 }
      careers.set(r.playerId, a)
    }
    a.apps += 1
    a.goals += r.goals
    a.assists += r.assists
    a.ratingSum += r.rating
    a.clubs.add(r.teamId)
    if (r.minutesPlayed === 0) a.zeroMinute += 1
  }
  console.info(`  players with eligible history=${careers.size}\n`)

  const entries = [...careers.entries()]
  const best = (label: string, score: (a: Agg) => number) => {
    let top: [string, Agg] | null = null
    for (const e of entries) {
      // Ties resolve by playerId so this diagnostic is deterministic between
      // runs. It picks a sample, it does not rank anybody.
      if (!top || score(e[1]) > score(top[1]) || (score(e[1]) === score(top[1]) && e[0] < top[0])) top = e
    }
    if (!top) {
      console.info(`  ${label}: none`)
      return null
    }
    const [id, a] = top
    console.info(
      `  ${label}: playerId=${id} apps=${a.apps} goals=${a.goals} assists=${a.assists} avgRating=${(a.ratingSum / a.apps).toFixed(3)} clubs=${a.clubs.size}`
    )
    return id
  }

  console.info(`--- 2. SAMPLE PLAYERS FOR POST-DEPLOY GET VERIFICATION ---`)
  const mostApps = best("most appearances", (a) => a.apps)
  const topScorer = best("top scorer      ", (a) => a.goals)
  const topAssister = best("top assister    ", (a) => a.assists)
  const bestRated = best("best avg rating ", (a) => a.ratingSum / a.apps)
  const cameo = entries.find(([, a]) => a.zeroMinute > 0)?.[0] ?? null
  console.info(`  zero-minute cameo: ${cameo ? `playerId=${cameo}` : "none"}`)
  const multiClub = entries.find(([, a]) => a.clubs.size > 1)?.[0] ?? null
  console.info(`  multi-club career: ${multiClub ? `playerId=${multiClub}` : "none"}`)

  console.info(`\n--- 3. SHAPES PRODUCTION DOES OR DOES NOT CONTAIN ---`)
  const [retired, freeAgents, noHistory, totalPlayers] = await Promise.all([
    prisma.player.count({ where: { careerStatus: "RETIRED" } }),
    prisma.player.count({ where: { teamId: null } }),
    prisma.player.count({ where: { matchStats: { none: {} } } }),
    prisma.player.count(),
  ])
  console.info(`  players=${totalPlayers} retired=${retired} freeAgents=${freeAgents} withNoStatRowAtAll=${noHistory}`)
  console.info(`  players with zero-minute rows: ${entries.filter(([, a]) => a.zeroMinute > 0).length}`)
  console.info(`  players with more than one club: ${entries.filter(([, a]) => a.clubs.size > 1).length}`)

  const liveRows = await prisma.playerMatchStats.count({
    where: { fixture: { playedAt: { not: null }, scheduledAt: { gt: cutoff } } },
  })
  console.info(`  stat rows on a NOT-yet-public fixture (must never be counted): ${liveRows}`)

  console.info(`\n--- 4. MAX HISTORY, for the performance budget ---`)
  const maxApps = entries.reduce((m, [, a]) => Math.max(m, a.apps), 0)
  console.info(`  most appearances held by any one player: ${maxApps}`)

  console.info(`\nSAMPLES: ${[mostApps, topScorer, topAssister, bestRated].filter(Boolean).length} chosen`)
  console.info("PLAYER PROFILE SAMPLES: REPORTED")
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
