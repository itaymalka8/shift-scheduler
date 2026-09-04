/**
 * READ ONLY diagnostic of the historical player-stat surface, so the Player
 * Hall of Fame's minimum-appearance threshold is chosen from Production's
 * actual usage distribution rather than from a number that sounded right.
 *
 * SELECTs only. Creates nothing, changes nothing, and prints no personal data
 * beyond the player ids and positions the other verifiers already print.
 *
 * THE FINISHED GATE IS THE SAME ONE THE READ SURFACES USE: a PlayerMatchStats
 * row exists from kickoff (the engine writes the whole match at once), so
 * "has a stats row" is NOT "is public". Everything below is measured over
 * fixtures whose live window has fully played out, which is what the
 * leaderboards will read.
 *
 * Run with: npm run prod:players:distribution
 */
import { createProductionClient } from "../../src/lib/production/client"
import { MATCH_REAL_DURATION_MINUTES } from "../../src/lib/match/timing"

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function describe(label: string, values: number[], digits = 0): void {
  if (values.length === 0) {
    console.info(`  ${label}: no data`)
    return
  }
  const s = [...values].sort((a, b) => a - b)
  const f = (n: number) => n.toFixed(digits)
  console.info(
    `  ${label}: n=${s.length} min=${f(s[0])} p25=${f(quantile(s, 0.25))} median=${f(quantile(s, 0.5))}` +
      ` p75=${f(quantile(s, 0.75))} p90=${f(quantile(s, 0.9))} p95=${f(quantile(s, 0.95))} max=${f(s[s.length - 1])}`
  )
}

async function main() {
  console.info("=== prod:players:distribution ===")
  console.info("Mode:     READ ONLY - SELECTs only, no writes\n")

  try {
    const { prisma, target } = createProductionClient()
    const now = new Date()
    console.info(`Database: host=${target.host} name=${target.database}`)
    console.info(`Now:      ${now.toISOString()}\n`)

    const liveWindowCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)

    const [players, allStats, fixtures] = await Promise.all([
      prisma.player.count(),
      prisma.playerMatchStats.count(),
      prisma.fixture.count(),
    ])
    console.info("--- 1. RAW COUNTS ---")
    console.info(`  Players=${players} PlayerMatchStats=${allStats} Fixtures=${fixtures}`)

    // The eligible set: rows whose fixture is publicly finished.
    const rows = await prisma.playerMatchStats.findMany({
      where: {
        fixture: { playedAt: { not: null }, scheduledAt: { not: null, lte: liveWindowCutoff } },
      },
      select: { playerId: true, teamId: true, goals: true, assists: true, rating: true, minutesPlayed: true, saves: true },
    })
    console.info(`  eligible (finished-fixture) stat rows=${rows.length}  excluded=${allStats - rows.length}`)

    const byPlayer = new Map<string, { apps: number; goals: number; assists: number; ratingSum: number; minutes: number; saves: number; clubs: Set<string> }>()
    for (const r of rows) {
      let p = byPlayer.get(r.playerId)
      if (!p) {
        p = { apps: 0, goals: 0, assists: 0, ratingSum: 0, minutes: 0, saves: 0, clubs: new Set() }
        byPlayer.set(r.playerId, p)
      }
      p.apps += 1
      p.goals += r.goals
      p.assists += r.assists
      p.ratingSum += r.rating
      p.minutes += r.minutesPlayed
      p.saves += r.saves
      p.clubs.add(r.teamId)
    }
    const careers = [...byPlayer.values()]
    console.info(`  distinct players with eligible history=${careers.length} (of ${players} players)`)

    console.info("\n--- 2. DISTRIBUTIONS ---")
    describe("appearances", careers.map((c) => c.apps))
    describe("goals      ", careers.map((c) => c.goals))
    describe("assists    ", careers.map((c) => c.assists))
    describe("avg rating ", careers.map((c) => c.ratingSum / c.apps), 2)
    describe("saves      ", careers.map((c) => c.saves))

    console.info("\n--- 3. RATING THRESHOLD CANDIDATES ---")
    for (const threshold of [1, 5, 10, 15, 20, 25, 30, 38]) {
      const eligible = careers.filter((c) => c.apps >= threshold)
      const best = eligible.length ? Math.max(...eligible.map((c) => c.ratingSum / c.apps)) : 0
      console.info(
        `  >= ${String(threshold).padStart(2)} appearances: ${String(eligible.length).padStart(4)} players` +
          ` (${((eligible.length / Math.max(1, careers.length)) * 100).toFixed(1)}%)  best avg=${best ? best.toFixed(3) : "n/a"}`
      )
    }

    console.info("\n--- 4. DATA-SHAPE CHECKS THE LEADERBOARDS DEPEND ON ---")
    const zeroMinuteRows = rows.filter((r) => r.minutesPlayed === 0).length
    console.info(`  eligible rows with minutesPlayed = 0: ${zeroMinuteRows}`)
    const multiClub = careers.filter((c) => c.clubs.size > 1).length
    console.info(`  players with eligible history at more than one club: ${multiClub}`)
    const dupes = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM (
        SELECT "fixtureId", "playerId" FROM "PlayerMatchStats" GROUP BY 1,2 HAVING count(*) > 1
      ) d
    `
    console.info(`  (fixtureId, playerId) duplicate groups: ${Number(dupes[0]?.n ?? 0)}  [UNIQUE constraint should make this 0]`)
    const retired = await prisma.player.count({ where: { careerStatus: "RETIRED" } })
    const freeAgents = await prisma.player.count({ where: { teamId: null } })
    console.info(`  RETIRED players=${retired}  free agents (teamId NULL)=${freeAgents}`)

    console.info("\nPLAYER STATS DISTRIBUTION: REPORTED")
  } catch (error) {
    console.error("prod:players:distribution failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
