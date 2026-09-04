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
import { drawKnockout, drawMatchesSeed, parseKnockoutDraw } from "../../src/lib/seasons/draw"
import { MAX_ROUND_ROBIN_ROUNDS, playoffMatchOutcome } from "../../src/lib/seasons/playoff"
import { decidingFixtureOfRound } from "../../src/lib/seasons/playoff-resolution"

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

    const playoffs = await prisma.championshipPlayoff.findMany({
      select: {
        id: true,
        seasonId: true,
        divisionId: true,
        drawSeed: true,
        knockoutDraw: true,
        fixtures: {
          select: {
            id: true,
            divisionId: true,
            playoffPhase: true,
            playoffRound: true,
            homeTeamId: true,
            awayTeamId: true,
            scheduledAt: true,
            playedAt: true,
            homeScore: true,
            awayScore: true,
            homeShootoutScore: true,
            awayShootoutScore: true,
          },
        },
      },
      orderBy: { id: "asc" },
    })
    const playoffFixtureById = new Map(
      playoffs.flatMap((playoff) => playoff.fixtures.map((f) => [f.id, { playoff, fixture: f }] as const))
    )

    console.info("\n--- 7. DECIDER WINNER MATCHES THE STORED CHAMPION ---")
    let mismatched = 0
    let prematureChampion = 0
    for (const c of champions) {
      if (!c.decidedByFixtureId) continue
      // A multi-club title is decided by a playoff fixture, not a decider -
      // section 8d verifies those. Only a champion pointing at neither is
      // genuinely broken.
      if (playoffFixtureById.has(c.decidedByFixtureId)) continue
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

    console.info("\n--- 8. CHAMPIONSHIP PLAYOFFS ---")
    console.info(`  INFO  ChampionshipPlayoff rows: ${playoffs.length}`)

    // Every playoff fixture must be reachable through its playoff, and every
    // playoff-linked fixture must be a TITLE_PLAYOFF. The CHECK constraints
    // enforce both; this proves the constraints are actually in place.
    const [playoffStageCount, orphanStage, orphanLink, badRound] = await Promise.all([
      prisma.fixture.count({ where: { stage: "TITLE_PLAYOFF" } }),
      prisma.fixture.count({ where: { stage: "TITLE_PLAYOFF", playoffId: null } }),
      prisma.fixture.count({ where: { stage: { not: "TITLE_PLAYOFF" }, playoffId: { not: null } } }),
      prisma.fixture.count({
        where: { stage: "TITLE_PLAYOFF", OR: [{ playoffPhase: null }, { playoffRound: null }] },
      }),
    ])
    console.info(`  INFO  TITLE_PLAYOFF fixtures: ${playoffStageCount}`)
    record(checks, orphanStage === 0, `TITLE_PLAYOFF fixtures with no playoff: ${orphanStage}`)
    record(checks, orphanLink === 0, `non-playoff fixtures linked to a playoff: ${orphanLink}`)
    record(checks, badRound === 0, `TITLE_PLAYOFF fixtures missing phase or round: ${badRound}`)

    const overCap = await prisma.fixture.count({
      where: { stage: "TITLE_PLAYOFF", playoffPhase: "ROUND_ROBIN", playoffRound: { gt: MAX_ROUND_ROBIN_ROUNDS } },
    })
    record(checks, overCap === 0, `round robin fixtures beyond round ${MAX_ROUND_ROBIN_ROUNDS}: ${overCap}`)

    let selfPairing = 0
    let duplicatePairing = 0
    let wrongDivision = 0
    let missingSeed = 0
    for (const playoff of playoffs) {
      if (!playoff.drawSeed) missingSeed++
      const seen = new Set<string>()
      for (const f of playoff.fixtures) {
        if (f.divisionId !== playoff.divisionId) wrongDivision++
        if (f.homeTeamId === f.awayTeamId) selfPairing++
        const pair = [f.homeTeamId, f.awayTeamId].sort().join("|")
        const key = `${f.playoffPhase}|${f.playoffRound}|${pair}`
        if (seen.has(key)) duplicatePairing++
        seen.add(key)
      }
    }
    record(checks, missingSeed === 0, `playoffs with no draw seed: ${missingSeed}`)
    record(checks, wrongDivision === 0, `playoff fixtures belonging to another division: ${wrongDivision}`)
    record(checks, selfPairing === 0, `playoff fixtures pairing a club with itself: ${selfPairing}`)
    record(checks, duplicatePairing === 0, `duplicate pairings within one playoff round: ${duplicatePairing}`)

    // --- THE PERSISTED DRAW IS THE SOURCE OF TRUTH -----------------------
    //
    // The stored bracket is recomputed from its own seed and compared. A
    // disagreement means either the stored draw was edited or the draw
    // algorithm changed under a season already using it - both of which
    // silently rewrite sporting history, so both FAIL CLOSED here rather
    // than being repaired.
    console.info("\n--- 8b. PERSISTED KNOCKOUT DRAW ---")
    let unparsableDraw = 0
    let drawSeedMismatch = 0
    let bracketMismatch = 0
    let knockoutWithoutDraw = 0
    let strangerInBracket = 0
    for (const playoff of playoffs) {
      const knockoutFixtures = playoff.fixtures.filter((f) => f.playoffPhase === "KNOCKOUT")
      const stored = parseKnockoutDraw(playoff.knockoutDraw)
      if (playoff.knockoutDraw !== null && stored === null) {
        unparsableDraw++
        continue
      }
      if (!stored) {
        if (knockoutFixtures.length > 0) knockoutWithoutDraw++
        continue
      }
      if (!drawMatchesSeed(stored, playoff.drawSeed)) {
        drawSeedMismatch++
        continue
      }
      // Round 1 is the round the draw itself fixed: it must match exactly.
      const recomputed = drawKnockout(stored.entrants, playoff.drawSeed)
      const expectedFirst = recomputed.firstRound.pairings
        .map((p) => [p.homeTeamId, p.awayTeamId].join(">"))
        .sort()
      const actualFirst = knockoutFixtures
        .filter((f) => f.playoffRound === 1)
        .map((f) => [f.homeTeamId, f.awayTeamId].join(">"))
        .sort()
      if (actualFirst.length > 0 && expectedFirst.join(",") !== actualFirst.join(",")) bracketMismatch++

      const inDraw = new Set(stored.order)
      for (const f of knockoutFixtures) {
        if (!inDraw.has(f.homeTeamId) || !inDraw.has(f.awayTeamId)) strangerInBracket++
      }
    }
    record(checks, unparsableDraw === 0, `playoffs whose stored draw could not be parsed: ${unparsableDraw}`)
    record(checks, drawSeedMismatch === 0, `stored draws that do not match their own seed: ${drawSeedMismatch}`)
    record(checks, bracketMismatch === 0, `knockout round 1 brackets disagreeing with the stored draw: ${bracketMismatch}`)
    record(checks, knockoutWithoutDraw === 0, `knockout fixtures with no persisted draw: ${knockoutWithoutDraw}`)
    record(checks, strangerInBracket === 0, `knockout fixtures involving a club outside the stored draw: ${strangerInBracket}`)

    // --- Playoff results -------------------------------------------------
    console.info("\n--- 8c. PLAYOFF RESULTS ---")
    let unresolvedFinished = 0
    let badPlayoffShootout = 0
    let playoffShootoutOnNonDraw = 0
    for (const playoff of playoffs) {
      for (const f of playoff.fixtures) {
        if ((f.homeShootoutScore === null) !== (f.awayShootoutScore === null)) badPlayoffShootout++
        else if (f.homeShootoutScore !== null && f.homeShootoutScore === f.awayShootoutScore) badPlayoffShootout++
        if (f.homeShootoutScore !== null && f.homeScore !== null && f.homeScore !== f.awayScore) {
          playoffShootoutOnNonDraw++
        }
        // A finished playoff tie must have produced a winner: the whole
        // point of the shootout is that a playoff match cannot end level.
        if (isMatchFinished(f.scheduledAt, now) && f.playedAt && playoffMatchOutcome(f).kind !== "decided") {
          unresolvedFinished++
        }
      }
    }
    record(checks, badPlayoffShootout === 0, `playoff ties with a half-written or level shootout: ${badPlayoffShootout}`)
    record(checks, playoffShootoutOnNonDraw === 0, `playoff ties carrying a shootout despite a decided 90 minutes: ${playoffShootoutOnNonDraw}`)
    record(checks, unresolvedFinished === 0, `finished playoff ties that produced no winner: ${unresolvedFinished}`)

    console.info("\n--- 8d. CHAMPIONS DECIDED BY A PLAYOFF ---")
    let playoffChampionMismatch = 0
    let playoffChampionPremature = 0
    let notTheDecidingRow = 0
    for (const c of champions) {
      if (!c.decidedByFixtureId) continue
      const entry = playoffFixtureById.get(c.decidedByFixtureId)
      if (!entry) continue
      const { playoff, fixture } = entry
      if (fixture.divisionId !== c.divisionId) playoffChampionMismatch++
      if (fixture.scheduledAt && c.decidedAt.getTime() !== fixture.scheduledAt.getTime()) playoffChampionMismatch++
      if (!isMatchFinished(fixture.scheduledAt, now) || !fixture.playedAt) playoffChampionPremature++

      // The provenance row must be the deciding row of its own round: the
      // last kickoff, with the fixture id used only to separate simultaneous
      // ones. Recomputed here rather than trusted.
      const round = playoff.fixtures.filter(
        (f) => f.playoffPhase === fixture.playoffPhase && f.playoffRound === fixture.playoffRound
      )
      const deciding = decidingFixtureOfRound(round)
      if (deciding?.id !== fixture.id) notTheDecidingRow++

      // A champion crowned by a knockout must have WON that final.
      if (fixture.playoffPhase === "KNOCKOUT") {
        const outcome = playoffMatchOutcome(fixture)
        if (outcome.kind !== "decided" || outcome.winnerTeamId !== c.teamId) playoffChampionMismatch++
      }
    }
    record(checks, playoffChampionMismatch === 0, `champions disagreeing with their own playoff fixture: ${playoffChampionMismatch}`)
    record(checks, playoffChampionPremature === 0, `champions crowned before their playoff round finished: ${playoffChampionPremature}`)
    record(checks, notTheDecidingRow === 0, `champions dated from a row that is not their round's deciding fixture: ${notTheDecidingRow}`)

    // --- THE DATABASE IS THE FINAL AUTHORITY ------------------------------
    //
    // Application code cannot overwrite a draw, and 8b would catch a stored
    // draw that stopped matching its seed. Neither helps against a manual,
    // self-consistent UPDATE from a psql session or a console. The write-once
    // trigger does, so its PRESENCE is itself an invariant worth verifying -
    // a Production without it is a Production where sporting history can be
    // rewritten silently.
    console.info("\n--- 8e. HISTORICAL DRAW IMMUTABILITY (DATABASE LEVEL) ---")
    const triggers = await prisma.$queryRaw<{ tgname: string; timing: string; level: string; enabled: string }[]>`
      SELECT tgname,
             CASE WHEN (tgtype & 2) > 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
             CASE WHEN (tgtype & 1) > 0 THEN 'ROW' ELSE 'STATEMENT' END AS level,
             tgenabled::text AS enabled
      FROM pg_trigger
      WHERE tgrelid = '"ChampionshipPlayoff"'::regclass
        AND NOT tgisinternal
        AND tgname = 'ChampionshipPlayoff_draw_write_once'
    `
    const trigger = triggers[0]
    record(checks, !!trigger, `write-once trigger present on ChampionshipPlayoff: ${trigger ? "yes" : "NO"}`)
    if (trigger) {
      console.info(`  INFO  ${trigger.tgname} ${trigger.timing} UPDATE FOR EACH ${trigger.level}`)
      record(checks, trigger.timing === "BEFORE" && trigger.level === "ROW", `trigger fires BEFORE UPDATE per row: ${trigger.timing}/${trigger.level}`)
      // 'O' is origin - the trigger fires for ordinary local writes. A
      // disabled ('D') trigger is present and useless, which is worse than
      // absent because it looks protected.
      record(checks, trigger.enabled === "O", `trigger is enabled (tgenabled=${trigger.enabled})`)
    }

    const functions = await prisma.$queryRaw<{ proname: string; kind: string }[]>`
      SELECT proname, pg_get_function_result(oid) AS kind
      FROM pg_proc
      WHERE proname = 'championship_playoff_draw_write_once'
    `
    record(
      checks,
      functions.length === 1 && functions[0].kind === "trigger",
      `write-once trigger function present and returns trigger: ${functions.length === 1 ? functions[0].kind : "MISSING"}`
    )

    console.info("\n--- 9. HISTORICAL PRESERVATION ---")
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
