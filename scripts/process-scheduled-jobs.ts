/**
 * Central scheduled-job entrypoint: runs every periodic background task the
 * app needs today - due-fixture simulation, transfer-listing expiration, and
 * season-lifecycle orchestration - back-to-back in one process. This is the
 * one job a scheduler (Render Cron or otherwise) should call going forward;
 * the three single-purpose scripts it wraps (process-due-fixtures.ts,
 * expire-transfer-listings.ts, process-season-lifecycle.ts) are left
 * completely unchanged and still work on their own for local debugging.
 * No task's own logic lives here - this file only calls the existing
 * services (processDueFixtures, expireDueTransferListings,
 * runSeasonEndOrchestratorForAllSeasons), which stay the single source of
 * truth for what each task actually does.
 *
 * ORDER MATTERS TWICE.
 *
 * 1. CONSEQUENCES BRACKET THE MATCHDAY. Activation runs BEFORE fixtures are
 *    processed and again AFTER. Before, because a backlog left by a cron
 *    outage must be settled before any club takes the field again - a match
 *    simulated from squads that have not yet paid for the last one is a
 *    wrong result written permanently into a league table. After, because
 *    the matches this very tick played may already be publicly finished (a
 *    late cron plays fixtures whose kickoff was hours ago, and the public
 *    window is measured from kickoff), so their consequences are due
 *    immediately rather than a tick later.
 *
 *    Neither pass is what makes the ordering CORRECT - correctness lives in
 *    ensureFixtureSimulated, which settles a fixture's own prerequisites
 *    itself and refuses to simulate otherwise, so a backlog bigger than one
 *    activation batch is still safe. These two passes make it EFFICIENT:
 *    they drain a backlog in bulk instead of one fixture at a time.
 *
 * 2. Season lifecycle runs AFTER fixture processing, because fixture
 *    processing is what plays the last match of a season - running the
 *    orchestrator first would always see that match as still unplayed and
 *    defer the whole offseason by a full cron tick. Transfer expiration sits
 *    between them only because it is the cheapest and touches neither: it
 *    reads and writes TransferListing rows alone, so it is genuinely
 *    order-independent with respect to the other two.
 *
 * 3. STADIUM COMPLETION RUNS FIRST, PAYROLL RUNS BEFORE THE SEASON ROLL.
 *
 *    Stadium completion is first purely for freshness - a build that finished
 *    should be visible as soon as possible. It is NOT what makes matches
 *    correct: a fixture's capacity comes from seatsAsOf against its own
 *    scheduledAt (src/lib/stadium/as-of.ts), so a late tick and a punctual one
 *    give the identical stadium to the identical match. The ordering is a
 *    convenience; the as-of read is the authority.
 *
 *    Payroll runs BEFORE season lifecycle, and that ordering IS load-bearing.
 *    The season roll retires players (nulling their teamId) and recalculates
 *    every surviving player's weeklySalary. No salary history is persisted
 *    anywhere, so payroll can only ever charge the squad as it stands when it
 *    runs - which means letting the roll mutate the roster first, inside the
 *    same tick, would change what a already-closed payroll week costs. Wages
 *    first, then the roll.
 *
 *    And if payroll cannot settle, SEASON LIFECYCLE IS SKIPPED FOR THIS TICK
 *    (see the guard at step C). A failed payroll week retries in two minutes;
 *    letting the orchestrator retire players in between would mean the retry
 *    charged a different squad for the same closed week. This does not make a
 *    long outage exact - nothing can, without salary snapshots - it stops the
 *    scheduler from creating the inconsistency itself.
 *
 * The tasks are isolated from each other: a failure in one is logged clearly
 * and does not stop the others from getting their own chance to run, so a
 * problem with transfer expiration never silently prevents fixtures from
 * being played, and a failing season transition never rolls back matches
 * that were already simulated. There is deliberately no wrapping
 * transaction - each domain commits its own work as it goes, and a later
 * failure leaves earlier committed work standing. The process still exits
 * non-zero if any task failed, so a real scheduler sees the run as failed.
 *
 * Run with: npx tsx scripts/process-scheduled-jobs.ts
 */
import { settleDueStadiumConstructionForAll } from "../src/lib/stadium/actions"
import { settleDuePayroll } from "../src/lib/economy/payroll"
import { processDueFixtures } from "../src/lib/match/simulate"
import { activateDueMatchConsequences } from "../src/lib/match/consequence-service"
import { expireDueTransferListings } from "../src/lib/transfers/expiration"
import { runSeasonEndOrchestratorForAllSeasons } from "../src/lib/seasons/orchestrator"
import { prisma } from "../src/lib/prisma"

async function main() {
  const startedAt = Date.now()
  const failedSubsystems: string[] = []

  let stadiumJobsCompleted: number | null = null
  let payrollWeeksSettled: number | null = null
  let payrollCharged: number | null = null
  let payrollOutstanding = false
  let seasonsDeferred = false
  let fixturesObserved: number | null = null
  let fixturesBlocked = 0
  let consequencesAppliedBefore: number | null = null
  let consequencesAppliedAfter: number | null = null
  let listingsExpired: number | null = null
  let seasonsChecked: number | null = null
  let seasonTransitions: number | null = null
  let seasonErrors = 0

  // --- 0. Stadium construction completion ---------------------------------
  // A build whose deadline has passed becomes real seats here, for every club
  // - not only for the three that have a manager who might open /stadium.
  // MOVES NO MONEY: the whole cost was debited when the job was created.
  try {
    const stadium = await settleDueStadiumConstructionForAll()
    stadiumJobsCompleted = stadium.completed
    console.info(`Stadium construction completed: ${stadium.completed}/${stadium.found} job(s)`)
    for (const failure of stadium.failures) {
      console.error(`Stadium completion failed for job ${failure.jobId}:`, failure.error)
    }
    if (stadium.failures.length > 0) failedSubsystems.push("stadium")
  } catch (error) {
    failedSubsystems.push("stadium")
    console.error("Stadium construction completion failed:", error)
  }

  // --- A1. Match consequence activation (BACKLOG FIRST) -------------------
  // Everything a club already owes from matches the public has seen finish is
  // settled before a single new fixture is played. This is the cron doing in
  // bulk what ensureFixtureSimulated would otherwise have to do one fixture
  // at a time.
  try {
    const consequences = await activateDueMatchConsequences()
    consequencesAppliedBefore = consequences.fixturesApplied
    console.info(
      `Match consequences activated (backlog): ${consequences.fixturesApplied}/${consequences.fixturesFound} fixture(s), ` +
        `${consequences.playersUpdated} player(s), ${consequences.injuriesStarted} injury(ies), ` +
        `${consequences.suspensionsAdded} suspension(s)`
    )
    for (const failure of consequences.failures) {
      console.error(`Consequence activation failed for fixture ${failure.fixtureId}:`, failure.error)
    }
    if (consequences.failures.length > 0) failedSubsystems.push("consequences")
  } catch (error) {
    failedSubsystems.push("consequences")
    console.error("Match consequence activation (backlog) failed:", error)
  }

  // --- A. Fixture processing ----------------------------------------------
  try {
    // processDueFixtures's own returned processedCount is how many fixtures
    // were found due at the moment this call started - not how many this
    // particular call actually simulated. Under two overlapping Runner
    // instances, the loser of ensureFixtureSimulated's own row lock still
    // sees the fixture as "due" here and reports it, even though it safely
    // no-ops once it re-checks playedAt inside that lock. The database
    // stays correct either way (a fixture is only ever really played
    // once) - only the wording below is adjusted, to never claim this
    // Runner itself simulated a fixture it may not actually have.
    const { processedCount, blocked } = await processDueFixtures()
    fixturesObserved = processedCount
    fixturesBlocked = blocked.length
    console.info(`Fixtures due observed: ${processedCount}`)
    // A blocked fixture is a club that cannot field a legal XI. It is NOT a
    // crash and it does not stop the matchday - but it must be loud, because
    // the alternative this replaces was simulating eight against eleven.
    for (const entry of blocked) {
      console.error(`Fixture ${entry.fixtureId} BLOCKED (${entry.code}): ${entry.detail}`)
    }
    if (blocked.length > 0) failedSubsystems.push("lineups")
  } catch (error) {
    failedSubsystems.push("fixtures")
    console.error("Fixture processing failed:", error)
  }

  // --- A2. Match consequence activation (WHAT THIS TICK JUST PLAYED) ------
  // Runs AFTER fixture processing and BEFORE everything else, because a match
  // played earlier in this same tick may already be publicly finished (the
  // cron can be late, and the public window runs from kickoff, not from the
  // moment the engine ran), and a ban served here must be served before the
  // season orchestrator looks at anything.
  //
  // Fixture-driven and idempotent: it selects only fixtures that are played,
  // publicly finished and not yet applied, and each one is applied under its
  // own row lock behind Fixture.consequencesAppliedAt. Running this twice in
  // a row deducts no fitness twice and serves no ban twice - which is exactly
  // why running it both before and after A costs nothing when there is
  // nothing to do.
  try {
    const consequences = await activateDueMatchConsequences()
    consequencesAppliedAfter = consequences.fixturesApplied
    console.info(
      `Match consequences activated (post-matchday): ${consequences.fixturesApplied}/${consequences.fixturesFound} fixture(s), ` +
        `${consequences.playersUpdated} player(s), ${consequences.injuriesStarted} injury(ies), ` +
        `${consequences.suspensionsAdded} suspension(s)`
    )
    for (const failure of consequences.failures) {
      console.error(`Consequence activation failed for fixture ${failure.fixtureId}:`, failure.error)
    }
    if (consequences.failures.length > 0) failedSubsystems.push("consequences")
  } catch (error) {
    failedSubsystems.push("consequences")
    console.error("Match consequence activation failed:", error)
  }

  // --- B. Transfer scheduled jobs -----------------------------------------
  try {
    const { expiredCount } = await expireDueTransferListings()
    listingsExpired = expiredCount
    console.info(`Transfer listings expired: ${expiredCount}`)
  } catch (error) {
    failedSubsystems.push("transfers")
    console.error("Transfer listing expiration failed:", error)
  }

  // --- B2. PAYROLL ---------------------------------------------------------
  // Every club that owes wages for a closed payroll week pays them, league
  // wide and atomically per week. Nothing before the activation boundary is
  // ever charged; see src/lib/economy/payroll-clock.ts.
  try {
    const payroll = await settleDuePayroll()
    payrollWeeksSettled = payroll.weeksSettled.length
    payrollCharged = payroll.totalCharged
    for (const week of payroll.weeksSettled) {
      console.info(
        `Payroll ${week.weekKey}: ${week.teamsCharged}/${week.eligibleTeams} club(s) charged, ` +
          `${week.teamsAlreadySettled} already settled, total ${week.totalCharged}`
      )
    }
    if (payroll.weeksSettled.length === 0) {
      console.info(`Payroll: nothing due (${payroll.weeksAlreadyComplete} week(s) already complete)`)
    }
    // A post-activation week older than the look-back window is an incident,
    // not a backlog: say so loudly rather than let wages vanish quietly.
    if (payroll.weeksOutsideWindow > 0) {
      payrollOutstanding = true
      failedSubsystems.push("payroll")
      console.error(
        `Payroll: ${payroll.weeksOutsideWindow} post-activation week(s) fell outside the catch-up window and were NOT settled`
      )
    }
  } catch (error) {
    payrollOutstanding = true
    failedSubsystems.push("payroll")
    console.error("Payroll settlement failed:", error)
  }

  // --- C. Season lifecycle orchestration ----------------------------------
  // DEFERRED WHEN PAYROLL IS OUTSTANDING. The orchestrator retires players and
  // rewrites salaries; doing that while an already-due payroll week is still
  // unsettled would change what that closed week costs when it retries two
  // minutes from now. Wages are settled first or the roll waits a tick.
  if (payrollOutstanding) {
    seasonsDeferred = true
    console.error("Season lifecycle DEFERRED this tick: an already-due payroll week is outstanding")
  } else
  try {
    const report = await runSeasonEndOrchestratorForAllSeasons()
    seasonsChecked = report.seasonsChecked
    seasonTransitions = report.transitionsPerformed
    seasonErrors = report.failures.length

    for (const summary of report.summaries) {
      const moves = summary.steps.filter((step) => step.advanced)
      if (moves.length === 0) continue
      const path = [
        `${moves[0].fromStatus}/${moves[0].fromStage}`,
        ...moves.map((step) => `${step.toStatus}/${step.toStage}`),
      ].join(" -> ")
      console.info(`Season ${summary.seasonId}: ${path}`)
    }
    // One season failing never stops the others (the orchestrator already
    // isolated them) - but it still fails the run.
    for (const failure of report.failures) {
      console.error(`Season lifecycle failed for season ${failure.seasonId}:`, failure.error)
    }
    if (report.failures.length > 0) {
      failedSubsystems.push("seasons")
    }
  } catch (error) {
    failedSubsystems.push("seasons")
    console.error("Season lifecycle orchestration failed:", error)
  }

  // --- Summary -------------------------------------------------------------
  const na = (value: number | null) => (value === null ? "failed" : String(value))
  console.info(
    [
      "Scheduled run summary:",
      `  Stadium jobs completed:    ${na(stadiumJobsCompleted)}`,
      `  Consequences (backlog):    ${na(consequencesAppliedBefore)}`,
      `  Fixtures processed:        ${na(fixturesObserved)}`,
      `  Fixtures blocked (XI):     ${fixturesBlocked}`,
      `  Consequences (post-match): ${na(consequencesAppliedAfter)}`,
      `  Transfer listings expired: ${na(listingsExpired)}`,
      `  Payroll weeks settled:     ${na(payrollWeeksSettled)}`,
      `  Payroll charged:           ${na(payrollCharged)}`,
      `  Active seasons checked:    ${seasonsDeferred ? "deferred (payroll outstanding)" : na(seasonsChecked)}`,
      `  Season transitions:        ${na(seasonTransitions)}`,
      `  Season errors:             ${seasonErrors}`,
      `  Duration:                  ${Date.now() - startedAt}ms`,
    ].join("\n")
  )

  if (failedSubsystems.length > 0) {
    console.error(`Scheduled run FAILED in: ${failedSubsystems.join(", ")}`)
    process.exitCode = 1
  }
}

main().finally(() => prisma.$disconnect())
