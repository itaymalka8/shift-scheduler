/**
 * READ ONLY verification of the TeamEra migration against live Production.
 *
 * Writes nothing. Issues only SELECTs, and prints no personal data - no
 * email, no name. Club ids, user ids, counts and timestamps only.
 *
 * The manager-record section deliberately fetches EVERY fixture for a club,
 * with no time filter, and lets the pure computeManagerRecord (the same
 * function the application's service calls) do all the filtering. That is a
 * stronger check than re-implementing the service's SQL: if the era window
 * or the finished-match gate were wrong, an unfiltered input set would
 * expose it immediately.
 *
 * Run with: npm run prod:eras:verify
 */
import { createProductionClient } from "../../src/lib/production/client"
import { computeManagerRecord, countsTowardRecord, fixtureBelongsToEra } from "../../src/lib/teams/era"
import { isMatchFinished } from "../../src/lib/match/timing"

const EXPECTED = { total: 63, open: 60, openBot: 57, openHuman: 3, closedBot: 3, teams: 60, fixtures: 1140 }

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.info(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`)
}

async function main() {
  console.info("=== prod:eras:verify ===")
  console.info("Mode:     READ ONLY - SELECTs only, no writes\n")

  try {
    const { prisma, target } = createProductionClient()
    console.info(`Database: host=${target.host} name=${target.database}`)
    const now = new Date()
    console.info(`Now:      ${now.toISOString()}\n`)

    // ---- 5. TeamEra invariants -------------------------------------
    console.info("--- 5. TEAM ERA INVARIANTS ---")
    const eras = await prisma.teamEra.findMany({
      select: { id: true, teamId: true, userId: true, type: true, startedAt: true, endedAt: true },
    })
    const open = eras.filter((e) => e.endedAt === null)
    check("total TeamEra rows", eras.length, EXPECTED.total)
    check("open eras", open.length, EXPECTED.open)
    check("open BOT eras", open.filter((e) => e.type === "BOT").length, EXPECTED.openBot)
    check("open HUMAN eras", open.filter((e) => e.type === "HUMAN").length, EXPECTED.openHuman)
    check("closed BOT eras", eras.filter((e) => e.type === "BOT" && e.endedAt !== null).length, EXPECTED.closedBot)
    check("invalid HUMAN era with userId NULL", eras.filter((e) => e.type === "HUMAN" && e.userId === null).length, 0)
    check("invalid BOT era with userId NOT NULL", eras.filter((e) => e.type === "BOT" && e.userId !== null).length, 0)
    check(
      "era period violations (endedAt <= startedAt)",
      eras.filter((e) => e.endedAt !== null && e.endedAt.getTime() <= e.startedAt.getTime()).length,
      0
    )

    const teams = await prisma.team.findMany({ select: { id: true, isBot: true, userId: true } })
    const openByTeam = new Map<string, number>()
    for (const era of open) openByTeam.set(era.teamId, (openByTeam.get(era.teamId) ?? 0) + 1)
    check("teams with zero open eras", teams.filter((t) => (openByTeam.get(t.id) ?? 0) === 0).length, 0)
    check("teams with more than one open era", teams.filter((t) => (openByTeam.get(t.id) ?? 0) > 1).length, 0)

    // ---- 6. Human takeover boundaries ------------------------------
    console.info("\n--- 6. HUMAN TAKEOVER BOUNDARIES ---")
    const humanTeams = teams.filter((t) => !t.isBot && t.userId !== null)
    check("human teams", humanTeams.length, EXPECTED.openHuman)
    for (const team of humanTeams) {
      const mine = eras.filter((e) => e.teamId === team.id).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      const botEras = mine.filter((e) => e.type === "BOT")
      const humanEras = mine.filter((e) => e.type === "HUMAN")
      const closedBot = botEras.filter((e) => e.endedAt !== null)
      const openHuman = humanEras.filter((e) => e.endedAt === null)
      const gapless =
        closedBot.length === 1 && openHuman.length === 1 && closedBot[0].endedAt!.getTime() === openHuman[0].startedAt.getTime()
      const ownerMatches = openHuman.length === 1 && openHuman[0].userId === team.userId
      const ok = closedBot.length === 1 && openHuman.length === 1 && gapless && ownerMatches
      if (!ok) failures++
      console.info(
        `  ${ok ? "PASS" : "FAIL"}  ${team.id}: closedBOT=${closedBot.length} openHUMAN=${openHuman.length} ` +
          `gapless=${gapless} eraUserId===Team.userId=${ownerMatches} boundary=${closedBot[0]?.endedAt?.toISOString() ?? "n/a"}`
      )
    }

    // ---- 7. Manager record -----------------------------------------
    console.info("\n--- 7. MANAGER RECORD (read only, no simulation) ---")
    for (const team of humanTeams) {
      const era = eras.find((e) => e.teamId === team.id && e.type === "HUMAN" && e.endedAt === null)
      if (!era) {
        failures++
        console.info(`  FAIL  ${team.id}: no open HUMAN era`)
        continue
      }
      // Every fixture this club has ever had - no filtering in SQL, so the
      // pure rule has to do all the work and any error in it is visible.
      const all = await prisma.fixture.findMany({
        where: { OR: [{ homeTeamId: team.id }, { awayTeamId: team.id }] },
        select: { homeTeamId: true, awayTeamId: true, scheduledAt: true, playedAt: true, homeScore: true, awayScore: true },
      })
      const window = { teamId: team.id, startedAt: era.startedAt, endedAt: era.endedAt }
      const record = computeManagerRecord(window, all, now)

      const beforeEra = all.filter((f) => f.scheduledAt && f.scheduledAt.getTime() < era.startedAt.getTime())
      const liveNow = all.filter((f) => f.scheduledAt && f.scheduledAt <= now && !isMatchFinished(f.scheduledAt, now))
      const eligible = all.filter((f) => fixtureBelongsToEra(f, window) && countsTowardRecord(f, now))

      const arithmetic = record.wins + record.draws + record.losses === record.matches
      const noneBefore = !beforeEra.some((f) => fixtureBelongsToEra(f, window))
      const noLive = !liveNow.some((f) => countsTowardRecord(f, now))
      const matchesEligible = record.matches === eligible.length
      const ok = arithmetic && noneBefore && noLive && matchesEligible
      if (!ok) failures++
      console.info(
        `  ${ok ? "PASS" : "FAIL"}  ${team.id}: P${record.matches} W${record.wins} D${record.draws} L${record.losses} ` +
          `GF${record.goalsFor} GA${record.goalsAgainst} | fixturesTotal=${all.length} beforeEra=${beforeEra.length} ` +
          `liveNow=${liveNow.length} | W+D+L===P:${arithmetic} noPreEraCounted:${noneBefore} noLiveCounted:${noLive} matchesEligible:${matchesEligible}`
      )
    }

    // ---- 8. Historical preservation --------------------------------
    console.info("\n--- 8. HISTORICAL PRESERVATION ---")
    const [fixtures, matchEvents, playerStats, players, divisions, divisionTeams, financial, playedFixtures] = await Promise.all([
      prisma.fixture.count(),
      prisma.matchEvent.count(),
      prisma.playerMatchStats.count(),
      prisma.player.count(),
      prisma.division.count(),
      prisma.divisionTeam.count(),
      prisma.financialTransaction.count(),
      prisma.fixture.count({ where: { playedAt: { not: null } } }),
    ])
    check("Fixtures", fixtures, EXPECTED.fixtures)
    check("Teams", teams.length, EXPECTED.teams)
    console.info(`  INFO  MatchEvents=${matchEvents} PlayerMatchStats=${playerStats} Players=${players}`)
    console.info(`  INFO  Divisions=${divisions} DivisionTeams=${divisionTeams} FinancialTransactions=${financial} playedFixtures=${playedFixtures}`)

    const stadiums = await prisma.stadium.count()
    console.info(`  INFO  Stadiums=${stadiums}`)
    const balances = await prisma.team.aggregate({ _sum: { balance: true } })
    console.info(`  INFO  total club balance=${balances._sum.balance}`)

    console.info("")
    console.info(failures === 0 ? "TEAM ERA VERIFICATION: PASS" : `TEAM ERA VERIFICATION: FAIL (${failures} check(s) failed)`)
    if (failures > 0) process.exitCode = 1
  } catch (error) {
    console.error("prod:eras:verify failed:", error instanceof Error ? error.message : error)
    console.error("TEAM ERA VERIFICATION: FAIL")
    process.exitCode = 1
  }
}

main()
