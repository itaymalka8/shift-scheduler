/**
 * Read-only proof that Production's championship records are coherent.
 * Run with: npm run prod:champions:verify
 *
 * SELECTs only. Never writes, never repairs, never backfills - a failure
 * here is reported for a human to decide about, because the wrong response
 * to a bad title row is an automated one.
 *
 * Prints no personal data: club, era and fixture ids, counts and scores.
 */
import { createProductionClient } from "../../src/lib/production/client"
import { printProductionBanner } from "../../src/lib/production/report"
import { ProductionSafetyError } from "../../src/lib/production/env-guard"
import { isMatchFinished } from "../../src/lib/match/timing"

interface Check {
  ok: boolean
  label: string
}

function record(checks: Check[], ok: boolean, label: string): void {
  checks.push({ ok, label })
  console.info(`  ${ok ? "PASS" : "FAIL"}  ${label}`)
}

async function main() {
  let handle: ReturnType<typeof createProductionClient>
  try {
    handle = createProductionClient()
  } catch (error) {
    if (error instanceof ProductionSafetyError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    throw error
  }
  const { prisma, target } = handle
  printProductionBanner("prod:champions:verify", target)

  const checks: Check[] = []
  const now = new Date()

  try {
    const champions = await prisma.seasonChampion.findMany({
      select: {
        id: true,
        seasonId: true,
        divisionId: true,
        teamId: true,
        teamEraId: true,
        decidedAt: true,
        decidedByFixtureId: true,
      },
      orderBy: { id: "asc" },
    })

    console.info("\n--- 1. CHAMPION ROWS ---")
    console.info(`  INFO  SeasonChampion rows: ${champions.length}`)
    if (champions.length === 0) {
      console.info("  INFO  No championship has been decided yet - nothing further to verify.")
    }

    // --- One per division, and only for divisions that are actually done ---
    console.info("\n--- 2. ONE CHAMPION PER DIVISION ---")
    const byDivision = new Map<string, number>()
    for (const c of champions) byDivision.set(c.divisionId, (byDivision.get(c.divisionId) ?? 0) + 1)
    record(checks, [...byDivision.values()].every((n) => n === 1), `divisions with more than one champion: ${[...byDivision.values()].filter((n) => n > 1).length}`)

    console.info("\n--- 3. NO CHAMPION FOR AN UNFINISHED DIVISION ---")
    let unfinishedWithChampion = 0
    for (const c of champions) {
      const unplayed = await prisma.fixture.count({
        where: { divisionId: c.divisionId, OR: [{ playedAt: null }, { homeScore: null }] },
      })
      if (unplayed > 0) unfinishedWithChampion++
    }
    record(checks, unfinishedWithChampion === 0, `champions on divisions with unplayed fixtures: ${unfinishedWithChampion}`)

    // --- Manager attribution ---------------------------------------------
    console.info("\n--- 4. TEAM ERA ATTRIBUTION ---")
    let missingEra = 0
    let outsideWindow = 0
    let wrongClub = 0
    for (const c of champions) {
      if (!c.teamEraId) {
        missingEra++
        continue
      }
      const era = await prisma.teamEra.findUnique({
        where: { id: c.teamEraId },
        select: { teamId: true, startedAt: true, endedAt: true, type: true, userId: true },
      })
      if (!era) {
        missingEra++
        continue
      }
      if (era.teamId !== c.teamId) wrongClub++
      // The half-open window the whole project attributes by.
      const inWindow =
        c.decidedAt.getTime() >= era.startedAt.getTime() &&
        (era.endedAt === null || c.decidedAt.getTime() < era.endedAt.getTime())
      if (!inWindow) outsideWindow++
    }
    record(checks, missingEra === 0, `champions with a missing or unresolvable TeamEra: ${missingEra}`)
    record(checks, wrongClub === 0, `champions whose era belongs to a different club: ${wrongClub}`)
    record(checks, outsideWindow === 0, `champions whose decidedAt falls outside its own era window: ${outsideWindow}`)

    console.info("\n--- 5. NO BOT TITLE ATTRIBUTED TO A HUMAN ---")
    let botTitleWithUser = 0
    for (const c of champions) {
      if (!c.teamEraId) continue
      const era = await prisma.teamEra.findUnique({ where: { id: c.teamEraId }, select: { type: true, userId: true } })
      if (era?.type === "BOT" && era.userId !== null) botTitleWithUser++
    }
    record(checks, botTitleWithUser === 0, `BOT-era titles carrying a user: ${botTitleWithUser}`)

    // --- Deciders ----------------------------------------------------------
    console.info("\n--- 6. TITLE DECIDERS ---")
    const deciders = await prisma.fixture.findMany({
      where: { stage: "TITLE_DECIDER" },
      select: {
        id: true,
        divisionId: true,
        homeTeamId: true,
        awayTeamId: true,
        scheduledAt: true,
        playedAt: true,
        homeScore: true,
        awayScore: true,
        homeShootoutScore: true,
        awayShootoutScore: true,
      },
    })
    console.info(`  INFO  TITLE_DECIDER fixtures: ${deciders.length}`)

    const deciderByDivision = new Map<string, number>()
    for (const d of deciders) deciderByDivision.set(d.divisionId, (deciderByDivision.get(d.divisionId) ?? 0) + 1)
    record(checks, [...deciderByDivision.values()].every((n) => n === 1), `divisions with more than one decider: ${[...deciderByDivision.values()].filter((n) => n > 1).length}`)

    // Technical home is the lower lexical id - a decider is neutral turf.
    const wrongRoles = deciders.filter((d) => d.homeTeamId > d.awayTeamId).length
    record(checks, wrongRoles === 0, `deciders whose technical home/away roles are not in lexical id order: ${wrongRoles}`)

    // A shootout is stored only when it happened, and can never be level.
    const badShootout = deciders.filter(
      (d) =>
        (d.homeShootoutScore === null) !== (d.awayShootoutScore === null) ||
        (d.homeShootoutScore !== null && d.homeShootoutScore === d.awayShootoutScore)
    ).length
    record(checks, badShootout === 0, `deciders with a half-written or level shootout: ${badShootout}`)

    const shootoutOnNonDraw = deciders.filter(
      (d) => d.homeShootoutScore !== null && d.homeScore !== null && d.homeScore !== d.awayScore
    ).length
    record(checks, shootoutOnNonDraw === 0, `deciders carrying a shootout despite a decided 90 minutes: ${shootoutOnNonDraw}`)

    const leagueShootout = await prisma.fixture.count({
      where: { stage: "LEAGUE", homeShootoutScore: { not: null } },
    })
    record(checks, leagueShootout === 0, `LEAGUE fixtures carrying a shootout score: ${leagueShootout}`)

    console.info("\n--- 7. DECIDER WINNER MATCHES THE STORED CHAMPION ---")
    let mismatched = 0
    let prematureChampion = 0
    for (const c of champions) {
      if (!c.decidedByFixtureId) continue
      const decider = deciders.find((d) => d.id === c.decidedByFixtureId)
      if (!decider) {
        mismatched++
        continue
      }
      if (decider.divisionId !== c.divisionId) mismatched++
      // decidedAt must be the decider's own kickoff.
      if (decider.scheduledAt && c.decidedAt.getTime() !== decider.scheduledAt.getTime()) mismatched++
      // And it must not have been crowned before the decider finished.
      if (!isMatchFinished(decider.scheduledAt, now) || !decider.playedAt) prematureChampion++

      const winner =
        decider.homeScore === null || decider.awayScore === null
          ? null
          : decider.homeScore !== decider.awayScore
            ? decider.homeScore > decider.awayScore
              ? decider.homeTeamId
              : decider.awayTeamId
            : decider.homeShootoutScore !== null && decider.awayShootoutScore !== null && decider.homeShootoutScore !== decider.awayShootoutScore
              ? decider.homeShootoutScore > decider.awayShootoutScore
                ? decider.homeTeamId
                : decider.awayTeamId
              : null
      if (winner !== c.teamId) mismatched++
    }
    record(checks, mismatched === 0, `champions disagreeing with their own decider: ${mismatched}`)
    record(checks, prematureChampion === 0, `champions crowned before their decider finished: ${prematureChampion}`)

    console.info("\n--- 8. HISTORICAL PRESERVATION ---")
    const [leagueFixtures, nonLeagueFixtures, teams, eras] = await Promise.all([
      prisma.fixture.count({ where: { stage: "LEAGUE" } }),
      prisma.fixture.count({ where: { stage: { not: "LEAGUE" } } }),
      prisma.team.count(),
      prisma.teamEra.count(),
    ])
    console.info(`  INFO  LEAGUE fixtures=${leagueFixtures} nonLeague=${nonLeagueFixtures} Teams=${teams} TeamEras=${eras}`)
  } catch (error) {
    record(checks, false, `unexpected error: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await prisma.$disconnect()
  }

  const failed = checks.filter((c) => !c.ok)
  console.info(`\nSEASON CHAMPION VERIFICATION: ${failed.length === 0 ? "PASS" : "FAIL"}`)
  if (failed.length > 0) {
    for (const f of failed) console.error(`  - ${f.label}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error("prod:champions:verify failed:", error)
  process.exitCode = 1
})
