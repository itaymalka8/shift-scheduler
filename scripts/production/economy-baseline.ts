/**
 * prod:economy:baseline - THE FIRST ECONOMIC HISTORY ROW FOR EVERY CLUB.
 *
 * TeamEconomicState is exact from its first row forward and silent before it.
 * This command writes that first row, and WHEN it runs is the whole design.
 *
 * WHY NOT IN THE MIGRATION. `prisma migrate deploy` runs inside render.yaml's
 * buildCommand - during the BUILD, minutes before the new instance goes live,
 * while the OLD web instance is still serving registrations, youth promotions,
 * purchases and releases with no appender in it. A baseline written there would
 * be followed by mutations that record nothing, reproducing the exact
 * first-observation defect the table exists to prevent.
 *
 * WHY NOT INSIDE prod:deploy:safe. The deploy's own job is to get code live; it
 * finishes before anyone has confirmed both services are running it. This is a
 * separate, deliberate step, taken after that confirmation.
 *
 * THE SEQUENCE THIS BELONGS TO:
 *   A. Migration 23 creates the table and its protections. No rows.
 *   B. The runtime containing every appender goes live via prod:deploy:safe.
 *   C. THIS COMMAND, only once both Web and Cron are confirmed on that commit.
 *   D. B is strictly before PHASE_3R_ACTIVATION_START.
 *   E. From here, every economic mutation appends.
 *   F. Activation happens later, and `latest state <= T` is answerable even if
 *      the Cron is down at T.
 *
 * READ-ONLY UNLESS CONFIRMED. Like every other mutating production command,
 * this refuses without PRODUCTION_WRITE_CONFIRM. Run it without to get the
 * plan.
 */
import { PrismaClient } from "../../src/generated/prisma"
import { assertProductionDatabaseUrl, parseDatabaseTarget } from "../../src/lib/production/env-guard"
import { assertProductionWriteConfirmed, ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"
import { getWebServiceConfig, getCronServiceConfig, getLatestDeploy } from "../../src/lib/production/render-ops"
import { PHASE_3R_ACTIVATION_START } from "../../src/lib/economy/config"
import { acquireEconomyHistoryShared, appendTeamEconomicState } from "../../src/lib/economy/state-history"
import { lockTeamRoster } from "../../src/lib/players/roster"

interface CommitCheck {
  ok: boolean
  webCommit: string | null
  cronCommit: string | null
  detail: string
}

/**
 * BOTH SERVICES MUST BE ON THE SAME COMMIT before a single row is written.
 *
 * This is a MEASUREMENT, not an inference. Render rebuilds a service only when
 * a deploy is triggered, and prod:deploy:safe triggers the WEB service, relying
 * on the Cron's suspend/resume cycle to bring it along - so "the Cron is on the
 * new code" is an assumption until someone reads its commit. If the Cron were
 * still on the old build, it would keep settling and mutating with no appender,
 * and every row this command writes would start out already wrong.
 */
async function checkBothServicesOnOneCommit(): Promise<CommitCheck> {
  const [web, cron] = await Promise.all([getWebServiceConfig(), getCronServiceConfig()])
  const [webDeploy, cronDeploy] = await Promise.all([getLatestDeploy(web.id), getLatestDeploy(cron.id)])

  const webCommit = webDeploy?.commitId ?? null
  const cronCommit = cronDeploy?.commitId ?? null

  if (!webCommit || !cronCommit) {
    return { ok: false, webCommit, cronCommit, detail: "one or both services report no deploy commit" }
  }
  if (webCommit !== cronCommit) {
    return { ok: false, webCommit, cronCommit, detail: "Web and Cron are running DIFFERENT commits" }
  }
  return { ok: true, webCommit, cronCommit, detail: `both services on ${webCommit}` }
}

async function main(): Promise<void> {
  const url = assertProductionDatabaseUrl()
  const target = parseDatabaseTarget(url)

  console.info("=== prod:economy:baseline ===")
  console.info(`Database: host=${target.host} name=${target.database}`)
  console.info(`Now:      ${new Date().toISOString()}`)
  console.info(`Phase 3R activation: ${PHASE_3R_ACTIVATION_START.toISOString()}`)
  console.info("")

  let confirmed = true
  try {
    assertProductionWriteConfirmed()
  } catch (error) {
    if (!(error instanceof ProductionWriteNotConfirmedError)) throw error
    confirmed = false
  }
  console.info(confirmed ? "Mode:     WRITE (confirmed)" : "Mode:     DRY RUN - no rows will be written")
  console.info("")

  // --- GATE 1: both services on the appender commit ------------------------
  const commits = await checkBothServicesOnOneCommit()
  console.info("--- 1. DEPLOYED RUNTIME ---")
  console.info(`  Web commit:  ${commits.webCommit ?? "unknown"}`)
  console.info(`  Cron commit: ${commits.cronCommit ?? "unknown"}`)
  console.info(`  ${commits.ok ? "PASS" : "FAIL"}  ${commits.detail}`)
  if (!commits.ok) {
    console.error("")
    console.error("REFUSED: baseline must run only after BOTH services carry the appender commit.")
    console.error("A service still on the old build mutates rosters without appending history.")
    process.exitCode = 1
    return
  }

  // --- GATE 2: the boundary must still be ahead ----------------------------
  const now = new Date()
  console.info("")
  console.info("--- 2. ACTIVATION BOUNDARY ---")
  if (now.getTime() >= PHASE_3R_ACTIVATION_START.getTime()) {
    console.info(`  FAIL  the boundary passed at ${PHASE_3R_ACTIVATION_START.toISOString()}`)
    console.error("")
    console.error("REFUSED: the baseline must be strictly BEFORE the activation boundary.")
    console.error("Baselining after it would leave the boundary itself unreconstructible -")
    console.error("`latest state <= T` would find nothing for T = the activation instant.")
    process.exitCode = 1
    return
  }
  const daysAway = (PHASE_3R_ACTIVATION_START.getTime() - now.getTime()) / 86_400_000
  console.info(`  PASS  boundary is ${daysAway.toFixed(1)} day(s) away`)

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    const teams = await prisma.team.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } })
    const existing = await prisma.$queryRaw<{ teamId: string }[]>`
      SELECT DISTINCT "teamId" FROM "TeamEconomicState"
    `
    const alreadyHave = new Set(existing.map((row) => row.teamId))
    const needing = teams.filter((team) => !alreadyHave.has(team.id))

    console.info("")
    console.info("--- 3. COVERAGE ---")
    console.info(`  clubs:                 ${teams.length}`)
    console.info(`  already have history:  ${alreadyHave.size}`)
    console.info(`  to baseline:           ${needing.length}`)

    if (!confirmed) {
      console.info("")
      console.info("To execute: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:economy:baseline")
      console.info("")
      console.info("BASELINE: DRY RUN (nothing written)")
      return
    }

    // --- THE WRITE ---------------------------------------------------------
    //
    // ONE SHORT TRANSACTION PER CLUB, in ascending id order - the project's
    // documented order for anything touching many clubs, and short enough that
    // a pooler cannot kill it half way through the league.
    //
    // THE SAME LOCKS EVERY APPENDER TAKES. The shared economy lock so this
    // orders against settlements exactly as an ordinary mutation would, and
    // the club's own roster lock so version allocation is race-free against a
    // registration or promotion landing at the same moment. A club that gets
    // baselined and mutated concurrently ends up with version 1 and version 2
    // in the right order rather than a unique-constraint violation.
    //
    // IDEMPOTENT: a club that already has any row is skipped, never
    // re-baselined. UNIQUE(teamId, version) is the backstop if two runs ever
    // overlap.
    let written = 0
    for (const team of needing) {
      await prisma.$transaction(async (tx) => {
        await acquireEconomyHistoryShared(tx)
        if (!(await lockTeamRoster(tx, team.id))) {
          throw new Error(`Team disappeared during baseline: ${team.id}`)
        }
        // Re-check under the lock: a registration that committed since the read
        // above has already written version 1, and a second one would be wrong.
        const rows = await tx.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*)::bigint AS n FROM "TeamEconomicState" WHERE "teamId" = ${team.id}
        `
        if (Number(rows[0]?.n ?? 0) > 0) return
        const state = await appendTeamEconomicState(tx, { teamId: team.id, reason: "baseline" })
        written++
        console.info(
          `  ${team.id}  v${state.version}  payroll ${state.weeklyPayroll.toLocaleString("en-US")}  quality ${state.attendanceQuality}`
        )
      })
    }

    // --- ASSERT COVERAGE, rather than assuming the loop worked -------------
    const missing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT t."id" FROM "Team" t
       WHERE NOT EXISTS (SELECT 1 FROM "TeamEconomicState" s WHERE s."teamId" = t."id")
       ORDER BY t."id"
    `
    console.info("")
    console.info("--- 4. FINAL COVERAGE ASSERTION ---")
    console.info(`  rows written this run: ${written}`)
    console.info(`  clubs still without history: ${missing.length}`)
    if (missing.length > 0) {
      for (const row of missing.slice(0, 10)) console.error(`    MISSING ${row.id}`)
      console.error("")
      console.error("BASELINE: FAIL - not every club has economic history.")
      console.error("Activation must not proceed: a club with no row cannot be settled.")
      process.exitCode = 1
      return
    }

    console.info("")
    console.info("BASELINE: PASS - every club has economic history, established before the boundary.")
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error("prod:economy:baseline crashed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
