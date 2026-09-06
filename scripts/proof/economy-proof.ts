/**
 * PHASE 3R AGAINST REAL POSTGRESQL - the proofs that a pure unit test cannot
 * give, run against an actual database with actual transactions, actual
 * advisory locks and actual concurrent workers.
 *
 * WHAT A UNIT TEST CANNOT PROVE, AND THIS DOES:
 *   - that a settlement written twice produces one row, because the
 *     (teamId, referenceId) unique constraint is enforced by Postgres and not
 *     by the caller remembering;
 *   - that four workers racing the same week produce one row each rather than
 *     four, because the advisory lock is a real lock;
 *   - that a repricing survives a rollback and lands on the same numbers;
 *   - that a fixture's stored gate can be reconstructed from its own stored
 *     crowd - the measurement that failed on 90 of 90 Production fixtures.
 *
 * IT NEVER RUNS AGAINST PRODUCTION. It requires PROOF_DATABASE_URL to be set
 * explicitly, refuses any host that looks like the hosted database, refuses a
 * URL equal to PRODUCTION_DATABASE_URL, and DELETES EVERYTHING in the database
 * it is given before seeding. That last property is why the guard is
 * paranoid rather than polite: this script is destructive by design, so the
 * only acceptable failure mode is refusing to run.
 *
 * Run with: PROOF_DATABASE_URL=postgresql://... npm run proof:economy
 */
import { execFileSync } from "node:child_process"

const RESULTS: { ok: boolean; label: string; detail?: string }[] = []
function check(ok: boolean, label: string, detail?: string): void {
  RESULTS.push({ ok, label, detail })
  console.info(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`)
}

/**
 * THE GUARD, RUN BEFORE ANY APPLICATION MODULE IS EVEN LOADED.
 *
 * Everything below imports dynamically, after this has passed and after
 * DATABASE_URL has been pointed at the proof database - because the Prisma
 * client is constructed at module load from DATABASE_URL, and an import that
 * ran first would connect to whatever the developer's .env happened to say.
 */
function resolveProofDatabaseUrl(): string {
  const url = process.env.PROOF_DATABASE_URL
  if (!url) {
    throw new Error("PROOF_DATABASE_URL is not set. This script wipes the database it is given; it will not guess one.")
  }
  const production = process.env.PRODUCTION_DATABASE_URL
  if (production && production.trim() === url.trim()) {
    throw new Error("REFUSED: PROOF_DATABASE_URL equals PRODUCTION_DATABASE_URL.")
  }
  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      throw new Error("REFUSED: PROOF_DATABASE_URL is not a parseable URL.")
    }
  })()
  for (const banned of ["neon.tech", "render.com", "amazonaws.com", "supabase"]) {
    if (host.includes(banned)) throw new Error(`REFUSED: PROOF_DATABASE_URL host "${host}" looks like a hosted database.`)
  }
  return url
}

async function main() {
  console.info("=== proof:economy - Phase 3R against real PostgreSQL ===")

  let url: string
  try {
    url = resolveProofDatabaseUrl()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
    return
  }
  process.env.DATABASE_URL = url
  console.info(`Database: ${new URL(url).hostname}${new URL(url).pathname}`)
  console.info("Mode:     DESTRUCTIVE - this database is wiped and reseeded\n")

  // The schema, applied by the project's own migrations rather than by a
  // db push: a proof run against a schema Production has never seen would
  // prove something about a schema that does not exist.
  console.info("Applying migrations...")
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  })

  const { PrismaClient } = await import("../../src/generated/prisma")
  const prisma = new PrismaClient({ datasources: { db: { url } } })

  const { prisma: appPrisma } = await import("../../src/lib/prisma")
  const { PHASE_3R_ACTIVATION_START } = await import("../../src/lib/economy/config")
  const { DEFAULT_STARTING_SEATS, MAINTENANCE_COST_PER_SEAT, toSeatColumns } = await import("../../src/lib/stadium/config")
  const { settleSponsorWeek, settleMaintenanceWeek, settleWeeklyEconomy } = await import(
    "../../src/lib/economy/weekly-settlement"
  )
  const { settlePayrollWeek } = await import("../../src/lib/economy/payroll")
  const { repriceLeagueSalaries } = await import("../../src/lib/economy/salary-repricing")
  const { calculatePhase3RSalary, calculateUncompressedPlayerSalary } = await import("../../src/lib/economy/salary")
  const { sponsorReferenceId } = await import("../../src/lib/economy/sponsor")
  const { maintenanceReferenceId } = await import("../../src/lib/economy/maintenance")
  const { payrollWeekKey, payrollReferenceId, MS_PER_WEEK } = await import("../../src/lib/economy/payroll-clock")
  const { generateInitialSquad } = await import("../../src/lib/players/generate")
  const { evaluateDiscretionarySpendForTeam } = await import("../../src/lib/economy/reserve")
  const { createFinancialTransaction } = await import("../../src/lib/economy/service")
  const { releasePlayer } = await import("../../src/lib/transfers/release")
  const { ensureFixtureSimulated } = await import("../../src/lib/match/simulate")
  const { buildMatchSnapshot } = await import("../../src/lib/match/engine/build-snapshot")
  const { calculateMatchStadiumRevenue } = await import("../../src/lib/stadium/attendance")
  const { calculateHomeMatchExpenses } = await import("../../src/lib/economy/match-expenses")
  const { resetProofDatabase } = await import("./reset")
  const { acquireEconomyHistoryShared, appendTeamEconomicState } = await import("../../src/lib/economy/state-history")
  const { lockTeamRoster } = await import("../../src/lib/players/roster")

  void appPrisma

  const BOUNDARY = PHASE_3R_ACTIVATION_START
  const WEEK_1 = BOUNDARY
  const WEEK_2 = new Date(BOUNDARY.getTime() + MS_PER_WEEK)
  const PRE_BOUNDARY_WEEK = new Date(BOUNDARY.getTime() - MS_PER_WEEK)

  try {
    // ------------------------------------------------------------------
    // SEED. Six clubs, two divisions, one season, real squads.
    // ------------------------------------------------------------------
    console.info("Seeding...")
    // DROP AND RE-MIGRATE, not TRUNCATE. TeamEconomicState refuses TRUNCATE at
    // the database level - economic history is append-only, and that guard has
    // to cover the one verb that row-level DELETE triggers do not see. Dropping
    // the schema is not deleting rows, so no guard is consulted, and the reset
    // is stronger: every proof run now also replays the migrations from nothing.
    await prisma.$disconnect()
    await resetProofDatabase(url)
    await prisma.$connect()

    const season = await prisma.season.create({
      data: { countryCode: "IL", number: 1, createdAt: new Date(BOUNDARY.getTime() - 30 * 24 * 3600 * 1000) },
    })
    const tier1 = await prisma.division.create({ data: { seasonId: season.id, tier: 1, name: "Tier 1" } })
    const tier2 = await prisma.division.create({ data: { seasonId: season.id, tier: 2, name: "Tier 2" } })

    const clubs: { id: string; isBot: boolean; tier: number }[] = []
    for (let i = 0; i < 6; i++) {
      const isBot = i >= 2
      const team = await prisma.team.create({
        data: {
          name: `Proof ${i}`,
          isBot,
          countryCode: "IL",
          // Old enough that every settled week below is due for every club.
          createdAt: new Date(BOUNDARY.getTime() - 60 * 24 * 3600 * 1000),
        },
      })
      // Squads priced on the LEGACY curve, deliberately: the proof needs a
      // league that is genuinely off the calibrated curve so that repricing
      // has something to do and can be seen doing it.
      const squad = generateInitialSquad(new Date(BOUNDARY.getTime() - 24 * 3600 * 1000))
      await prisma.player.createMany({ data: squad.map((player) => ({ teamId: team.id, ...player })) })
      await prisma.stadium.create({
        data: { teamId: team.id, name: `Ground ${i}`, ...toSeatColumns(DEFAULT_STARTING_SEATS) },
      })
      const tier = i < 3 ? 1 : 2
      await prisma.divisionTeam.create({
        data: { divisionId: tier === 1 ? tier1.id : tier2.id, seasonId: season.id, teamId: team.id },
      })
      clubs.push({ id: team.id, isBot, tier })
    }
    // THE SEASON'S OPENING LEAGUE FIXTURE. A season is tier-effective from the
    // instant its football begins, so a season with divisions and membership
    // but no LEAGUE fixture has no effective tiers at all - every club falls to
    // the entry tier. That is the rule working, not a defect, and it is why
    // this fixture exists: a real season has kicked off long before its first
    // sponsor week, and the proof has to model a league that is actually being
    // played rather than one that only exists on paper.
    //
    // Unplayed and past-dated: nothing in this proof scans for due fixtures,
    // and section 12 creates its own fixture to simulate.
    await prisma.fixture.create({
      data: {
        divisionId: tier1.id,
        matchday: 1,
        homeTeamId: clubs[0].id,
        awayTeamId: clubs[1].id,
        stage: "LEAGUE",
        scheduledAt: new Date(BOUNDARY.getTime() - 25 * 24 * 3600 * 1000),
      },
    })

    // THE BASELINE, exactly as Production does it: after the squads exist and
    // strictly before the activation boundary. These clubs were inserted
    // directly rather than through the registration path, so none of them has
    // economic history yet - and without it every settlement below would fail
    // closed, which is itself the correct behaviour and is asserted further
    // down. Production runs prod:economy:baseline for the same reason.
    for (const club of clubs) {
      await prisma.$transaction(async (tx) => {
        await acquireEconomyHistoryShared(tx)
        await lockTeamRoster(tx, club.id)
        await appendTeamEconomicState(tx, { teamId: club.id, reason: "baseline" })
      })
    }
    console.info(`  ${clubs.length} clubs, ${await prisma.player.count()} players, ${clubs.length} baseline history rows\n`)

    // ------------------------------------------------------------------
    console.info("=== 1. SALARY REPRICING, PERSISTED ===")
    // ------------------------------------------------------------------
    const before = await prisma.player.findMany({
      select: { id: true, overall: true, age: true, potential: true, primaryPosition: true, weeklySalary: true },
      orderBy: { id: "asc" },
    })
    const legacyMatches = before.filter((p) => p.weeklySalary === calculateUncompressedPlayerSalary(p)).length
    check(
      legacyMatches < before.length,
      "the seeded league starts OFF the calibrated curve",
      `${legacyMatches}/${before.length} on the legacy curve (initial-squad scaling moves the rest)`
    )

    const first = await repriceLeagueSalaries(prisma, WEEK_1)
    const afterFirst = await prisma.player.findMany({
      select: { id: true, overall: true, age: true, potential: true, primaryPosition: true, weeklySalary: true },
      orderBy: { id: "asc" },
    })
    check(
      afterFirst.every((p) => p.weeklySalary === calculatePhase3RSalary(p)),
      "after one run every active player is on the calibrated curve",
      `${first.repriced} repriced, bill ${first.weeklyBillBefore} -> ${first.weeklyBillAfter}`
    )

    const second = await repriceLeagueSalaries(prisma, WEEK_1)
    check(second.repriced === 0, "a second run writes nothing", `${second.alreadyCorrect} already correct`)

    // A crash retry, modelled honestly: the work is rolled back by the
    // database, then the same call runs again on a fresh connection state.
    await prisma
      .$transaction(async (tx) => {
        await repriceLeagueSalaries(tx, WEEK_1)
        throw new Error("deliberate rollback")
      })
      .catch(() => undefined)
    const third = await repriceLeagueSalaries(prisma, WEEK_1)
    const afterRetry = await prisma.player.findMany({ select: { id: true, weeklySalary: true }, orderBy: { id: "asc" } })
    check(
      third.repriced === 0 && afterRetry.every((p, i) => p.weeklySalary === afterFirst[i].weeklySalary),
      "a rolled-back run followed by a retry lands on identical numbers"
    )

    const preBoundary = await repriceLeagueSalaries(prisma, PRE_BOUNDARY_WEEK)
    check(
      preBoundary.authority === "legacy" && preBoundary.examined === 0,
      "repricing does nothing at all before the boundary"
    )

    // ------------------------------------------------------------------
    console.info("\n=== 2. SPONSOR: EXACTLY ONCE, UNDER CONCURRENCY ===")
    // ------------------------------------------------------------------
    const sponsor1 = await settleSponsorWeek(WEEK_1)
    check(sponsor1.teamsCredited === clubs.length, "every eligible club is credited once", `${sponsor1.teamsCredited} clubs`)
    check(
      sponsor1.medianWeeklyPayroll > 0,
      "the award is derived from the league median payroll",
      `median ${sponsor1.medianWeeklyPayroll}, mean tier multiplier ${sponsor1.meanTierMultiplier.toFixed(4)}`
    )

    const sponsorAgain = await settleSponsorWeek(WEEK_1)
    check(sponsorAgain.teamsCredited === 0, "re-running the same week credits nobody a second time")

    // FOUR WORKERS, ONE WEEK. Without the advisory lock each would take its own
    // snapshot; with it, exactly one does the work and the rest find it done.
    const racers = await Promise.all([
      settleSponsorWeek(WEEK_2),
      settleSponsorWeek(WEEK_2),
      settleSponsorWeek(WEEK_2),
      settleSponsorWeek(WEEK_2),
    ])
    const creditedByRacers = racers.reduce((sum, r) => sum + r.teamsCredited, 0)
    const week2Rows = await prisma.financialTransaction.count({
      where: { type: "sponsorIncome", referenceId: sponsorReferenceId(payrollWeekKey(WEEK_2)) },
    })
    check(
      creditedByRacers === clubs.length && week2Rows === clubs.length,
      "four concurrent workers produce exactly one sponsor row per club",
      `${creditedByRacers} credited, ${week2Rows} rows`
    )

    const tier1Award = sponsor1.charges.find((c) => c.teamId === clubs.find((x) => x.tier === 1)?.id)?.amount ?? 0
    const tier2Award = sponsor1.charges.find((c) => c.teamId === clubs.find((x) => x.tier === 2)?.id)?.amount ?? 0
    check(
      Math.abs(tier1Award / tier2Award - 1.25) < 0.01,
      "a tier 1 club is paid 1.25x a tier 2 club",
      `${tier1Award} vs ${tier2Award}`
    )

    const humanAward = sponsor1.charges.find((c) => c.teamId === clubs.find((x) => !x.isBot && x.tier === 1)?.id)?.amount
    const botAward = sponsor1.charges.find((c) => c.teamId === clubs.find((x) => x.isBot && x.tier === 1)?.id)?.amount
    check(humanAward === botAward, "a Human and a BOT club in the same tier are paid identically", `${humanAward} = ${botAward}`)

    // ------------------------------------------------------------------
    console.info("\n=== 3. NO HISTORICAL CATCH-UP ===")
    // ------------------------------------------------------------------
    const preSponsor = await settleSponsorWeek(PRE_BOUNDARY_WEEK)
    const preMaintenance = await settleMaintenanceWeek(PRE_BOUNDARY_WEEK)
    // The settlement functions themselves are not era-gated - the RUNNER is,
    // which is the layer that decides a week's era. Proving the runner is what
    // matters, so this asserts through settleWeeklyEconomy rather than around it.
    void preSponsor
    void preMaintenance
    await prisma.financialTransaction.deleteMany({
      where: {
        OR: [
          { referenceId: sponsorReferenceId(payrollWeekKey(PRE_BOUNDARY_WEEK)) },
          { referenceId: maintenanceReferenceId(payrollWeekKey(PRE_BOUNDARY_WEEK)) },
        ],
      },
    })
    const runner = await settleWeeklyEconomy(new Date(WEEK_2.getTime() + 3600_000))
    const preBoundaryWeeks = runner.weeksSettled.filter((week) => week.instant.getTime() < BOUNDARY.getTime())
    check(
      preBoundaryWeeks.every((week) => week.sponsor === null && week.maintenance === null),
      "the runner settles no sponsor or maintenance for any week before the boundary",
      `${preBoundaryWeeks.length} pre-boundary week(s) reached, all payroll-only`
    )
    const strayPre = await prisma.financialTransaction.count({
      where: {
        type: { in: ["sponsorIncome", "stadiumMaintenance"] },
        referenceId: { lt: sponsorReferenceId(payrollWeekKey(BOUNDARY)) },
      },
    })
    check(strayPre === 0, "no sponsor or maintenance row exists for a pre-boundary week")

    // ------------------------------------------------------------------
    console.info("\n=== 4. MAINTENANCE: EXEMPT BY DEFAULT, CHARGED WHEN EXPANDED ===")
    // ------------------------------------------------------------------
    const maintenanceDefault = await settleMaintenanceWeek(WEEK_1)
    check(
      maintenanceDefault.teamsCharged === 0 && maintenanceDefault.teamsExempt === clubs.length,
      "a league that has never expanded is charged nothing at all",
      `${maintenanceDefault.teamsExempt} exempt`
    )

    const expander = clubs[0].id
    await prisma.stadium.update({
      where: { teamId: expander },
      data: { regularSeats: DEFAULT_STARTING_SEATS.regular + 1000, vipSeats: DEFAULT_STARTING_SEATS.vip + 10 },
    })
    const maintenanceExpanded = await settleMaintenanceWeek(WEEK_2)
    const expectedUpkeep = 1000 * MAINTENANCE_COST_PER_SEAT.regular + 10 * MAINTENANCE_COST_PER_SEAT.vip
    const charged = maintenanceExpanded.charges.find((c) => c.teamId === expander)?.amount ?? 0
    check(
      maintenanceExpanded.teamsCharged === 1 && charged === expectedUpkeep,
      "only the expanded club is charged, and only for the seats above the baseline",
      `${charged} = 1000 x ${MAINTENANCE_COST_PER_SEAT.regular} + 10 x ${MAINTENANCE_COST_PER_SEAT.vip}`
    )
    const maintenanceAgain = await settleMaintenanceWeek(WEEK_2)
    check(maintenanceAgain.teamsCharged === 0, "re-running the same maintenance week charges nobody twice")

    // ------------------------------------------------------------------
    console.info("\n=== 5. ORDER: SPONSOR SETTLES BEFORE PAYROLL ===")
    // ------------------------------------------------------------------
    const WEEK_3 = new Date(WEEK_2.getTime() + MS_PER_WEEK)
    const orderedRun = await settleWeeklyEconomy(new Date(WEEK_3.getTime() + 3600_000))
    const week3 = orderedRun.weeksSettled.find((week) => week.instant.getTime() === WEEK_3.getTime())
    const sponsorRow = await prisma.financialTransaction.findFirst({
      where: { teamId: clubs[1].id, referenceId: sponsorReferenceId(payrollWeekKey(WEEK_3)) },
      select: { createdAt: true },
    })
    const payrollRow = await prisma.financialTransaction.findFirst({
      where: { teamId: clubs[1].id, referenceId: payrollReferenceId(payrollWeekKey(WEEK_3)) },
      select: { createdAt: true },
    })
    check(
      !!week3 && !!sponsorRow && !!payrollRow && sponsorRow.createdAt.getTime() <= payrollRow.createdAt.getTime(),
      "the sponsor row for a week is written no later than that week's payroll row"
    )

    // ------------------------------------------------------------------
    console.info("\n=== 6. OUTAGE RECOVERY ===")
    // ------------------------------------------------------------------
    const WEEK_4 = new Date(WEEK_3.getTime() + MS_PER_WEEK)
    const WEEK_5 = new Date(WEEK_4.getTime() + MS_PER_WEEK)
    // Two weeks pass with nothing running, then one tick catches up.
    const recovery = await settleWeeklyEconomy(new Date(WEEK_5.getTime() + 3600_000))
    const recovered = recovery.weeksSettled.map((week) => week.weekKey)
    check(
      recovered.includes(payrollWeekKey(WEEK_4)) && recovered.includes(payrollWeekKey(WEEK_5)),
      "a single tick after a two-week outage settles both missed weeks, oldest first",
      recovered.join(", ")
    )
    const rerun = await settleWeeklyEconomy(new Date(WEEK_5.getTime() + 7200_000))
    check(rerun.weeksSettled.length === 0, "running again immediately settles nothing further")

    // ------------------------------------------------------------------
    console.info("\n=== 7. HISTORY IS NOT REWRITTEN WHEN A CLUB MOVES TIER ===")
    // ------------------------------------------------------------------
    const mover = clubs.find((club) => club.tier === 2)!.id
    const historicalSponsor = await prisma.financialTransaction.findMany({
      where: { teamId: mover, type: "sponsorIncome" },
      select: { referenceId: true, amount: true },
      orderBy: { referenceId: "asc" },
    })
    // Promotion: a NEW season, with the club in tier 1. The old season's rows
    // are what the old weeks were settled against and must not move.
    // The database enforces one ACTIVE season per country (the duplicate-active
    // -seasons guard), so the old season is closed first - which is also what
    // actually happens when a league rolls over.
    await prisma.season.update({ where: { id: season.id }, data: { isActive: false, status: "COMPLETED" } })
    const season2 = await prisma.season.create({
      data: { countryCode: "IL", number: 2, createdAt: new Date(WEEK_5.getTime() + 24 * 3600 * 1000) },
    })
    const season2Tier1 = await prisma.division.create({ data: { seasonId: season2.id, tier: 1, name: "Tier 1 S2" } })
    for (const club of clubs) {
      await prisma.divisionTeam.create({
        data: { divisionId: season2Tier1.id, seasonId: season2.id, teamId: club.id },
      })
    }
    const historicalAfterMove = await prisma.financialTransaction.findMany({
      where: { teamId: mover, type: "sponsorIncome" },
      select: { referenceId: true, amount: true },
      orderBy: { referenceId: "asc" },
    })
    check(
      JSON.stringify(historicalSponsor) === JSON.stringify(historicalAfterMove),
      "settled sponsor rows are byte-identical after the club is promoted",
      `${historicalSponsor.length} row(s) unchanged`
    )

    // MEMBERSHIP ALONE DOES NOT MOVE THE MONEY, and this is the defect the
    // first-LEAGUE-fixture authority exists to fix.
    //
    // Season 2's row and its complete membership now exist, but season 2 has
    // not kicked off - exactly the state the offseason leaves the league in
    // between PROMOTION_RELEGATION and CREATE_NEXT. Under the old
    // Season.createdAt authority, a sponsor week settled in this interval would
    // already have paid this club at its NEW tier, for football it had not yet
    // played. It must still be paid on season 1's tiers.
    const WEEK_5B = new Date(WEEK_5.getTime() + MS_PER_WEEK)
    const beforeKickoff = await settleSponsorWeek(WEEK_5B)
    const preKickoffAward = beforeKickoff.charges.find((c) => c.teamId === mover)?.amount ?? 0
    const lastOldAward = historicalSponsor[historicalSponsor.length - 1]?.amount ?? 0
    check(
      preKickoffAward === lastOldAward,
      "a season that exists but has not kicked off does NOT change tiers yet",
      `${lastOldAward} -> ${preKickoffAward} (unchanged while season 2 has no LEAGUE fixture)`
    )

    // Season 2 kicks off. NOW its tiers govern.
    const WEEK_6 = new Date(WEEK_5.getTime() + 2 * MS_PER_WEEK)
    await prisma.fixture.create({
      data: {
        divisionId: season2Tier1.id,
        matchday: 1,
        homeTeamId: clubs[0].id,
        awayTeamId: clubs[1].id,
        stage: "LEAGUE",
        scheduledAt: new Date(WEEK_6.getTime() - 24 * 3600 * 1000),
      },
    })
    const afterPromotion = await settleSponsorWeek(WEEK_6)
    const moverAward = afterPromotion.charges.find((c) => c.teamId === mover)?.amount ?? 0
    const oldAward = historicalSponsor[historicalSponsor.length - 1]?.amount ?? 0
    check(
      moverAward > oldAward,
      "once season 2 has kicked off, the club's FUTURE sponsor reflects its new tier",
      `${oldAward} in tier 2 -> ${moverAward} in tier 1`
    )

    // ------------------------------------------------------------------
    console.info("\n=== 8. THE FOUR-WEEK RESERVE ===")
    // ------------------------------------------------------------------
    const spender = clubs[1].id
    const spenderTeam = await prisma.team.findUniqueOrThrow({ where: { id: spender }, select: { balance: true } })
    const spenderPayroll = (
      await prisma.player.aggregate({ where: { teamId: spender, careerStatus: "ACTIVE" }, _sum: { weeklySalary: true } })
    )._sum.weeklySalary!
    const headroom = spenderTeam.balance - spenderPayroll * 4
    const atLimit = await evaluateDiscretionarySpendForTeam(prisma, spender, spenderTeam.balance, headroom, WEEK_1)
    const overLimit = await evaluateDiscretionarySpendForTeam(prisma, spender, spenderTeam.balance, headroom + 1, WEEK_1)
    check(
      atLimit.allowed && !overLimit.allowed,
      "a spend of exactly the headroom is allowed and one unit more is refused",
      `headroom ${headroom} on a ${spenderPayroll} wage bill`
    )
    const beforeBoundary = await evaluateDiscretionarySpendForTeam(
      prisma,
      spender,
      spenderTeam.balance,
      spenderTeam.balance,
      PRE_BOUNDARY_WEEK
    )
    check(beforeBoundary.allowed, "the reserve is not enforced before the activation boundary")

    // ------------------------------------------------------------------
    console.info("\n=== 9. MANDATORY CHARGES IGNORE THE RESERVE, AND MAY GO NEGATIVE ===")
    // ------------------------------------------------------------------
    const pauper = clubs[5].id
    await prisma.team.update({ where: { id: pauper }, data: { balance: 1000 } })
    const WEEK_7 = new Date(WEEK_6.getTime() + MS_PER_WEEK)
    await settleSponsorWeek(WEEK_7)
    await settlePayrollWeek(WEEK_7)
    const pauperAfter = await prisma.team.findUniqueOrThrow({ where: { id: pauper }, select: { balance: true } })
    check(
      pauperAfter.balance < 0,
      "payroll charges a club that cannot afford it and takes the balance negative",
      `balance ${pauperAfter.balance}`
    )
    const pauperPayrollRow = await prisma.financialTransaction.findFirst({
      where: { teamId: pauper, referenceId: payrollReferenceId(payrollWeekKey(WEEK_7)) },
    })
    check(!!pauperPayrollRow, "and the ledger row exists - the charge was made, not skipped")

    // A discretionary spend for the same club is refused, in the same state.
    const pauperSpend = await evaluateDiscretionarySpendForTeam(prisma, pauper, pauperAfter.balance, 1, WEEK_7)
    check(!pauperSpend.allowed, "while a one-unit discretionary spend by the same club is refused")

    // ------------------------------------------------------------------
    console.info("\n=== 10. THE LEDGER IS APPEND-ONLY AND HISTORY IS UNTOUCHED ===")
    // ------------------------------------------------------------------
    const snapshotBefore = await prisma.financialTransaction.findMany({
      select: { id: true, teamId: true, type: true, amount: true, referenceId: true },
      orderBy: { id: "asc" },
    })
    await settleWeeklyEconomy(new Date(WEEK_7.getTime() + 3600_000))
    await repriceLeagueSalaries(prisma, WEEK_7)
    const snapshotAfter = await prisma.financialTransaction.findMany({
      select: { id: true, teamId: true, type: true, amount: true, referenceId: true },
      orderBy: { id: "asc" },
    })
    const preserved = snapshotBefore.every((row, i) => JSON.stringify(row) === JSON.stringify(snapshotAfter[i]))
    check(
      preserved && snapshotAfter.length >= snapshotBefore.length,
      "every pre-existing ledger row is byte-identical afterwards",
      `${snapshotBefore.length} -> ${snapshotAfter.length} rows`
    )

    // The duplicate a caller could try to write by hand is refused by the
    // database, not by the caller remembering.
    const duplicateAttempt = await createFinancialTransaction(prisma, {
      teamId: clubs[0].id,
      type: "sponsorIncome",
      amount: 999_999,
      description: "duplicate attempt",
      referenceId: sponsorReferenceId(payrollWeekKey(WEEK_1)),
    })
    check(duplicateAttempt === null, "a duplicate (teamId, referenceId) write is a safe no-op, enforced by Postgres")

    // ------------------------------------------------------------------
    console.info("\n=== 11. RELEASE STAYS AVAILABLE TO A CLUB IN THE RED ===")
    // ------------------------------------------------------------------
    const inTheRed = await prisma.team.findUniqueOrThrow({ where: { id: pauper }, select: { balance: true } })
    const victim = await prisma.player.findFirstOrThrow({
      where: { teamId: pauper, careerStatus: "ACTIVE", primaryPosition: { notIn: ["GK"] } },
      orderBy: { overall: "asc" },
      select: { id: true, weeklySalary: true },
    })
    const released = await releasePlayer({ teamId: pauper, playerId: victim.id })
    const afterRelease = await prisma.team.findUniqueOrThrow({ where: { id: pauper }, select: { balance: true } })
    check(
      released.alreadyProcessed === false && afterRelease.balance === inTheRed.balance - victim.weeklySalary,
      "a club with a negative balance can still release, and is still charged one weekly wage",
      `${inTheRed.balance} -> ${afterRelease.balance} (cost ${victim.weeklySalary})`
    )
    check(afterRelease.balance < 0, "and the balance is allowed to stay negative rather than the release being refused")
    const releaseAgain = await releasePlayer({ teamId: pauper, playerId: victim.id })
    check(releaseAgain.alreadyProcessed === true, "releasing the same player again is a no-op, not a second charge")

    // ------------------------------------------------------------------
    console.info("\n=== 12. ONE CROWD PER FIXTURE, RECONSTRUCTED FROM ITS OWN LEDGER ===")
    // ------------------------------------------------------------------
    // THE MEASUREMENT THAT FAILED ON PRODUCTION. Before this phase, zero of
    // ninety played fixtures could reproduce their own gate from their own
    // stored attendance, because attendance was rolled twice. Here the
    // snapshot is rebuilt from the fixture's stored matchSeed and its gate
    // recomputed - if the two agree, there is genuinely one crowd.
    //
    // Deliberately a PAST-DATED fixture, and therefore a legacy-era one: a
    // match cannot be simulated before its own kickoff, and the boundary is in
    // the future. That is the right test anyway - the single-roll fix is the
    // UNCONDITIONAL half of this phase, so it must hold in both eras, and the
    // era it is hardest to get right is the one that is already live.
    const kickoff = new Date(Date.now() - 3600_000)
    const fixture = await prisma.fixture.create({
      data: {
        divisionId: tier1.id,
        matchday: 1,
        homeTeamId: clubs[0].id,
        awayTeamId: clubs[1].id,
        scheduledAt: kickoff,
      },
    })
    await ensureFixtureSimulated(fixture.id)
    const played = await prisma.fixture.findUniqueOrThrow({ where: { id: fixture.id } })
    check(!!played.playedAt && played.attendance != null, "the fixture was simulated and stored a crowd", `attendance ${played.attendance}`)

    const rebuilt = await buildMatchSnapshot(fixture.id, played.matchSeed!)
    check(
      rebuilt.attendance === played.attendance,
      "rebuilding the snapshot from the stored seed reproduces the SAME crowd",
      `${rebuilt.attendance} vs stored ${played.attendance}`
    )
    const reconstructedGate = calculateMatchStadiumRevenue(rebuilt.attendanceBySeatType).total
    check(
      reconstructedGate === played.homeRevenue,
      "the stored gate is exactly what that crowd would have paid",
      `reconstructed ${reconstructedGate} vs stored ${played.homeRevenue}`
    )
    const reconstructedExpense = calculateHomeMatchExpenses(
      { capacity: rebuilt.stadiumCapacity },
      rebuilt.attendance,
      "league"
    ).total
    // Stored as a positive cost on the Fixture (the ledger row carries the
    // sign), so it is compared unsigned.
    check(
      reconstructedExpense === played.homeMatchExpense,
      "and the stored match-day cost is exactly what stewarding that crowd would have cost",
      `reconstructed ${reconstructedExpense} vs stored ${played.homeMatchExpense}`
    )

    // ------------------------------------------------------------------
    const failures = RESULTS.filter((result) => !result.ok)
    console.info(`\nPROOF: ${RESULTS.length - failures.length}/${RESULTS.length} checks passed`)
    if (failures.length > 0) {
      for (const failure of failures) console.error(`  FAILED: ${failure.label}`)
      process.exitCode = 1
    }
    console.info(failures.length === 0 ? "ECONOMY PROOF: PASS" : "ECONOMY PROOF: FAIL")
  } catch (error) {
    console.error("proof:economy failed:", error instanceof Error ? error.stack ?? error.message : error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main()
