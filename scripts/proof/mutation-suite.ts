/**
 * THE NEGATIVE MUTATION SUITE - deliberately break Phase 3R, one rule at a
 * time, and require that something goes red.
 *
 * A passing test suite proves the code does what the tests say. It does not
 * prove the tests would notice if the code stopped doing it. This closes that
 * gap the only way it can be closed: by editing the source to reintroduce each
 * defect the phase exists to prevent, running the test that claims to catch it,
 * and demanding a failure.
 *
 * THREE OUTCOMES, AND ONLY ONE OF THEM IS A PASS:
 *
 *   CAUGHT      the mutation applied and the named test failed. Good.
 *   MISSED      the mutation applied and every test still passed. The rule is
 *               unguarded, and the suite says so loudly.
 *   NOT APPLIED the anchor text was not found, so nothing was changed. This is
 *               reported as a FAILURE, never as a pass - a mutation that could
 *               not be applied proves nothing at all, and silently counting it
 *               as green is exactly how a mutation suite rots into decoration.
 *
 * SAFETY. It edits real files in the working tree and restores them with `git
 * checkout` afterwards, including on a crash. It refuses to start if the tree
 * is dirty, because that is the one state in which a restore could destroy
 * work. It touches no database and reads no environment.
 *
 * Run with: npm run proof:mutations
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..")

interface Mutation {
  /** What defect this reintroduces, in the words of the rule it breaks. */
  name: string
  file: string
  /** Exact text to find. Not a regex: an anchor that drifts must FAIL, not fuzzily match. */
  from: string
  to: string
  /** The test file that claims to catch it. */
  catcher: string
}

const MUTATIONS: Mutation[] = [
  {
    name: "Human clubs get a better sponsor formula than BOT clubs",
    file: "src/lib/economy/sponsor.ts",
    from: "    const amount = meanTierMultiplier === 0 ? 0 : Math.round((base * multiplier) / meanTierMultiplier)",
    to: "    const amount = meanTierMultiplier === 0 ? 0 : Math.round((base * multiplier * (club.teamId === \"human\" ? 1.1 : 1)) / meanTierMultiplier)",
    catcher: "src/lib/economy/sponsor.test.ts",
  },
  {
    name: "BOT clubs avoid stadium maintenance",
    file: "src/lib/economy/weekly-settlement.ts",
    from: "      const teams = await tx.team.findMany({ select: { id: true, createdAt: true }, orderBy: { id: \"asc\" } })\n      const eligible = teams.filter((team) => isPayrollDueForTeam(instant, team))\n      if (eligible.length === 0) {\n        return {\n          weekKey,\n          instant,\n          eligibleTeams: 0,\n          teamsCharged: 0,",
    to: "      const teams = await tx.team.findMany({ select: { id: true, createdAt: true, isBot: true }, orderBy: { id: \"asc\" } })\n      const eligible = teams.filter((team) => isPayrollDueForTeam(instant, team) && !team.isBot)\n      if (eligible.length === 0) {\n        return {\n          weekKey,\n          instant,\n          eligibleTeams: 0,\n          teamsCharged: 0,",
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "a page visit settles sponsor income",
    file: "src/app/economy/page.tsx",
    from: 'import { readLeagueNeutralQuality } from "@/lib/stadium/neutral-quality"',
    to: 'import { readLeagueNeutralQuality } from "@/lib/stadium/neutral-quality"\nimport { settleSponsorWeek } from "@/lib/economy/weekly-settlement"\nvoid settleSponsorWeek',
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "a page visit settles stadium maintenance",
    file: "src/app/economy/page.tsx",
    from: 'import { calculateMatchStadiumRevenue } from "@/lib/stadium/attendance"',
    to: 'import { calculateMatchStadiumRevenue } from "@/lib/stadium/attendance"\nimport { settleMaintenanceWeek } from "@/lib/economy/weekly-settlement"\nvoid settleMaintenanceWeek',
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "sponsor stops checking what is already settled, so a re-run pays twice",
    file: "src/lib/economy/weekly-settlement.ts",
    from: "      const existing = await tx.financialTransaction.findMany({\n        where: { teamId: { in: eligibleIds }, referenceId },\n        select: { teamId: true },\n      })\n      const alreadySettled = new Set(existing.map((row) => row.teamId))\n\n      const charges: SettlementCharge[] = []\n      let totalCredited = 0",
    to: "      const alreadySettled = new Set<string>()\n\n      const charges: SettlementCharge[] = []\n      let totalCredited = 0",
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "maintenance stops checking what is already settled, so a re-run charges twice",
    file: "src/lib/economy/weekly-settlement.ts",
    from: "      const existing = await tx.financialTransaction.findMany({\n        where: { teamId: { in: eligibleIds }, referenceId },\n        select: { teamId: true },\n      })\n      const alreadySettled = new Set(existing.map((row) => row.teamId))\n\n      const charges: SettlementCharge[] = []\n      let totalCharged = 0\n      let teamsExempt = 0",
    to: "      const alreadySettled = new Set<string>()\n\n      const charges: SettlementCharge[] = []\n      let totalCharged = 0\n      let teamsExempt = 0",
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "sponsor is paid retroactively for weeks before the activation boundary",
    file: "src/lib/economy/weekly-settlement.ts",
    from: '      era === "phase3r" && !complete(sponsorReferenceId(weekKey), eligible)',
    to: "      !complete(sponsorReferenceId(weekKey), eligible)",
    catcher: "src/lib/economy/phase-3r-activation.test.ts",
  },
  {
    name: "maintenance is charged retroactively for weeks before the activation boundary",
    file: "src/lib/economy/weekly-settlement.ts",
    from: '      era === "phase3r" &&\n      owesUpkeep.size > 0 &&',
    to: "      owesUpkeep.size > 0 &&",
    catcher: "src/lib/economy/phase-3r-activation.test.ts",
  },
  {
    name: "the sponsor tier is read from live season state instead of as of the instant",
    file: "src/lib/economy/season-tier.ts",
    from: "    where: { createdAt: { lte: instant } },",
    to: "    where: { isActive: true },",
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "the season roll runs while a weekly settlement is still outstanding",
    file: "scripts/process-scheduled-jobs.ts",
    from: "  if (weeklySettlementOutstanding) {",
    to: "  if (false) {",
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "repricing derives a wage from the stored wage",
    file: "src/lib/economy/salary-repricing.ts",
    from: "    const target = calculateAuthoritativeSalary(player, at, undefined, activationStart)",
    to: "    const target = Math.round(player.weeklySalary * 0.73) || calculateAuthoritativeSalary(player, at, undefined, activationStart)",
    catcher: "src/lib/economy/salary-repricing.test.ts",
  },
  {
    name: "the calibrated salary curve is used before the activation boundary",
    file: "src/lib/economy/activation.ts",
    from: "  return at.getTime() >= activationStart.getTime() ? \"phase3r\" : \"legacy\"",
    to: "  void at\n  void activationStart\n  return \"phase3r\"",
    catcher: "src/lib/economy/salary-curve.test.ts",
  },
  {
    name: "the legacy salary curve survives the activation boundary",
    file: "src/lib/economy/activation.ts",
    from: "  return at.getTime() >= activationStart.getTime() ? \"phase3r\" : \"legacy\"",
    to: "  void at\n  void activationStart\n  return \"legacy\"",
    catcher: "src/lib/economy/salary-curve.test.ts",
  },
  {
    name: "attendance is rolled a second time, independently, for the gate",
    file: "src/lib/match/simulate.ts",
    from: "    const revenue = neutralMoney ? { total: 0 } : calculateMatchStadiumRevenue(snapshot.attendanceBySeatType)",
    to: "    const rerolled = calculateAttendance({ isHome: true }, { teamTotalQuality: 1320 }, { seats: homeSeatsAtKickoff })\n    const revenue = neutralMoney ? { total: 0 } : calculateMatchStadiumRevenue(rerolled.bySeatType)",
    catcher: "src/lib/economy/economy-clock-isolation.test.ts",
  },
  {
    name: "releasing a player below Overall 40 increases attendance",
    file: "src/lib/stadium/attendance-quality.ts",
    from: "  for (const player of players) surplus += Math.max(0, player.overall - REPLACEMENT_OVERALL)",
    to: "  for (const player of players) surplus += player.overall - REPLACEMENT_OVERALL",
    catcher: "src/lib/stadium/attendance-quality.test.ts",
  },
  {
    name: "the four-week reserve is omitted from a transfer purchase",
    file: "src/lib/transfers/purchase.ts",
    from: "    const reserve = await evaluateDiscretionarySpendForTeam(",
    to: "    const reserve = await Promise.resolve({ allowed: true, headroom: 0, balance: 0, reserve: 0, weeklyPayroll: 0, cost: 0 }) ?? await evaluateDiscretionarySpendForTeamUnused(",
    catcher: "src/lib/economy/reserve.test.ts",
  },
  {
    name: "the four-week reserve is omitted from stadium construction",
    file: "src/lib/stadium/actions.ts",
    from: "      const reserve = await evaluateDiscretionarySpendForTeam(tx, teamId, team.balance, totalCost)",
    to: "      const reserve = { allowed: true, headroom: 0 }",
    catcher: "src/lib/economy/reserve.test.ts",
  },
  {
    name: "the four-week reserve blocks payroll",
    file: "src/lib/economy/payroll.ts",
    from: "import { createFinancialTransaction } from \"./service\"",
    to: "import { createFinancialTransaction } from \"./service\"\nimport { evaluateDiscretionarySpendForTeam } from \"./reserve\"\nvoid evaluateDiscretionarySpendForTeam",
    catcher: "src/lib/economy/reserve.test.ts",
  },
  {
    name: "the four-week reserve blocks a release",
    file: "src/lib/transfers/release.ts",
    from: "import { createFinancialTransaction } from \"@/lib/economy/service\"",
    to: "import { createFinancialTransaction } from \"@/lib/economy/service\"\nimport { evaluateDiscretionarySpendForTeam } from \"@/lib/economy/reserve\"\nvoid evaluateDiscretionarySpendForTeam",
    catcher: "src/lib/economy/reserve.test.ts",
  },
  {
    name: "a release refuses to take the balance negative",
    file: "src/lib/transfers/release.ts",
    from: "      allowNegative: true,",
    to: "      allowNegative: false,",
    catcher: "src/lib/economy/reserve.test.ts",
  },
  {
    name: "the acknowledged historical orphan is removed from the ledger's allow-list",
    file: "scripts/production/economy-audit.ts",
    from: 'const ACKNOWLEDGED_ORPHAN_FIXTURE_IDS = ["cmtedbpib0001ya9jpzjzevb5"]',
    to: "const ACKNOWLEDGED_ORPHAN_FIXTURE_IDS: string[] = []",
    catcher: "src/lib/economy/ledger-residue.test.ts",
  },
  {
    name: "a NEW orphaned fixture is silently accepted instead of failing the audit",
    file: "scripts/production/economy-audit.ts",
    from: "    if (unexpectedOrphans.length > 0) {\n      phase3rFailures.push(",
    to: "    if (false) {\n      console.info(",
    catcher: "src/lib/economy/ledger-residue.test.ts",
  },
]

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
}

function runCatcher(testFile: string): boolean {
  try {
    execFileSync("npx", ["jest", "--silent", testFile], { cwd: ROOT, stdio: "pipe" })
    return true // every test passed - the mutation was NOT caught
  } catch {
    return false // something failed - the mutation WAS caught
  }
}

function main(): void {
  console.info("=== proof:mutations - deliberate negative tests ===")
  console.info(`${MUTATIONS.length} mutations, each with the test that claims to catch it\n`)

  const dirty = git("status", "--porcelain").trim()
  if (dirty) {
    console.error("REFUSED: the working tree is dirty. This script edits files and restores them with")
    console.error("git checkout; running it over uncommitted work could destroy it. Commit or stash first.")
    console.error(dirty)
    process.exitCode = 1
    return
  }

  const outcomes: { mutation: Mutation; outcome: "CAUGHT" | "MISSED" | "NOT APPLIED" }[] = []

  for (const mutation of MUTATIONS) {
    const path = join(ROOT, mutation.file)
    const original = readFileSync(path, "utf8")
    let outcome: "CAUGHT" | "MISSED" | "NOT APPLIED"

    if (!original.includes(mutation.from)) {
      // The anchor drifted. NOT a pass: nothing was changed, so nothing was
      // proven, and treating it as green is how a mutation suite rots.
      outcome = "NOT APPLIED"
    } else {
      try {
        writeFileSync(path, original.replace(mutation.from, mutation.to))
        outcome = runCatcher(mutation.catcher) ? "MISSED" : "CAUGHT"
      } finally {
        // Restore from git rather than from the in-memory copy: if this process
        // dies mid-write, the next run's dirty-tree check is what catches it.
        writeFileSync(path, original)
        git("checkout", "--", mutation.file)
      }
    }

    outcomes.push({ mutation, outcome })
    const mark = outcome === "CAUGHT" ? "CAUGHT " : outcome === "MISSED" ? "MISSED " : "NOT APP"
    console.info(`  ${mark}  ${mutation.name}`)
    if (outcome !== "CAUGHT") console.info(`           file ${mutation.file}, catcher ${mutation.catcher}`)
  }

  const caught = outcomes.filter((o) => o.outcome === "CAUGHT").length
  const missed = outcomes.filter((o) => o.outcome === "MISSED")
  const notApplied = outcomes.filter((o) => o.outcome === "NOT APPLIED")

  console.info(`\n  caught ${caught}/${outcomes.length}   missed ${missed.length}   not applied ${notApplied.length}`)
  for (const { mutation } of missed) console.error(`  MISSED: ${mutation.name} - nothing catches this`)
  for (const { mutation } of notApplied) {
    console.error(`  NOT APPLIED: ${mutation.name} - the anchor in ${mutation.file} has drifted`)
  }

  const clean = git("status", "--porcelain").trim()
  if (clean) {
    console.error("\nWARNING: the working tree is dirty after the run - restore did not complete cleanly:")
    console.error(clean)
    process.exitCode = 1
  }

  console.info(`\nMUTATION SUITE: ${missed.length === 0 && notApplied.length === 0 ? "PASS" : "FAIL"}`)
  if (missed.length > 0 || notApplied.length > 0) process.exitCode = 1
}

main()
