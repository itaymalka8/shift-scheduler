import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE ECONOMY CLOCK'S BOUNDARIES, ASSERTED AGAINST THE SOURCE ITSELF.
 *
 * Every rule below is one that a reasonable future change could break without
 * a single behavioural test going red - a page settling "as a backup", a
 * per-club roster read creeping back into the payroll sweep, a maintenance
 * writer appearing because the enum value was already there. Behaviour tests
 * prove what the code does; these prove what it is not allowed to become.
 */

const ROOT = join(__dirname, "..", "..", "..")
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8")

/** Source with the import block stripped, so an assertion about CALLS never matches an import line. */
function body(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*import\b/.test(line) && !/^\s*}\s*from\s+"/.test(line) && !/^\s*[A-Za-z{},*\s]+from "/.test(line))
    .join("\n")
}

/**
 * Executable source only - comments stripped.
 *
 * These files EXPLAIN at length why they no longer settle anything, and those
 * explanations name the very functions the guards forbid. A guard that cannot
 * tell a call from a sentence about a call would either fail on correct code
 * or force the code to stop explaining itself.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const PAYROLL = read("src", "lib", "economy", "payroll.ts")
const CLOCK = read("src", "lib", "economy", "payroll-clock.ts")
const CONFIG = read("src", "lib", "economy", "config.ts")
const SERVICE = read("src", "lib", "economy", "service.ts")
const BALANCE = read("src", "lib", "finance", "balance.ts")
const CRON = read("scripts", "process-scheduled-jobs.ts")
const ECONOMY_PAGE = read("src", "app", "economy", "page.tsx")
const STADIUM_PAGE = read("src", "app", "stadium", "page.tsx")
const STADIUM_ACTIONS = read("src", "lib", "stadium", "actions.ts")
const AS_OF = read("src", "lib", "stadium", "as-of.ts")
const SIMULATE = read("src", "lib", "match", "simulate.ts")
const SNAPSHOT = read("src", "lib", "match", "engine", "build-snapshot.ts")

/** Just completeStadiumConstruction's own body - the next export ends it. */
const COMPLETION = STADIUM_ACTIONS.slice(
  STADIUM_ACTIONS.indexOf("export async function completeStadiumConstruction"),
  STADIUM_ACTIONS.indexOf("export const STADIUM_COMPLETION_BATCH")
)

describe("ONE CLOCK: no page advances the economy", () => {
  it("the economy page never settles payroll", () => {
    const page = code(ECONOMY_PAGE)
    expect(page).not.toContain("settleDuePayroll")
    expect(page).not.toContain("settlePayrollWeek")
    expect(page).not.toContain("processWeeklyPayroll")
  })

  it("the stadium page never settles construction", () => {
    const page = code(STADIUM_PAGE)
    expect(page).not.toContain("settleDueStadiumConstruction")
    expect(page).not.toContain("completeStadiumConstruction")
  })

  it("no page or API route anywhere settles either clock", () => {
    for (const file of [
      ["src", "app", "dashboard", "page.tsx"],
      ["src", "app", "squad", "page.tsx"],
      ["src", "app", "league", "page.tsx"],
      ["src", "app", "transfers", "page.tsx"],
      ["src", "app", "matches", "page.tsx"],
      ["src", "app", "club", "page.tsx"],
      ["src", "app", "api", "stadium", "construction", "route.ts"],
      ["src", "app", "api", "squad", "route.ts"],
    ]) {
      const source = code(read(...file))
      expect(source).not.toContain("settleDuePayroll")
      expect(source).not.toContain("settlePayrollWeek")
      expect(source).not.toContain("completeStadiumConstruction")
      expect(source).not.toContain("settleDueStadiumConstructionForAll")
    }
  })

  it("the scheduled job is the only caller of either settler", () => {
    expect(CRON).toContain("settleDuePayroll()")
    expect(CRON).toContain("settleDueStadiumConstructionForAll()")
  })
})

describe("START-LINE ACTIVATION: nothing before the boundary is ever charged", () => {
  it("the boundary is an explicit committed instant, not derived from deploy time", () => {
    expect(CONFIG).toContain("export const PAYROLL_AUTOMATION_START = new Date(")
    expect(CONFIG).toMatch(/PAYROLL_AUTOMATION_START = new Date\("\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"\)/)
  })

  it("the boundary is never computed from Date.now, an env var or a database row", () => {
    const declaration = CONFIG.slice(CONFIG.indexOf("export const PAYROLL_AUTOMATION_START"))
    const line = declaration.split("\n")[0]
    expect(line).not.toContain("process.env")
    expect(line).not.toContain("Date.now")
    expect(line).not.toContain("new Date()")
  })

  it("eligibility is gated on the boundary, in the one place that decides it", () => {
    expect(CLOCK).toContain("PAYROLL_AUTOMATION_START")
    const gate = CLOCK.slice(CLOCK.indexOf("export function isPayrollDueForTeam"))
    expect(gate).toContain("getFirstPayrollDueAfter(activationStart)")
  })

  it("the settlement service does not decide eligibility for itself", () => {
    const settle = body(PAYROLL)
    expect(settle).toContain("isPayrollDueForTeam(")
    expect(settle).not.toContain("PAYROLL_WEEKDAY")
    expect(settle).not.toContain("PAYROLL_HOUR_UTC")
  })
})

describe("NO UNBOUNDED HISTORICAL WALK (defect C-1)", () => {
  it("payroll never walks forward from Team.createdAt", () => {
    const settle = body(PAYROLL)
    expect(settle).not.toContain("team.createdAt")
    expect(settle).not.toContain("MAX_WEEKS_TO_BACKFILL")
    // A while-loop over weeks is exactly the shape that regressed before.
    expect(settle).not.toMatch(/while\s*\([^)]*cursor/)
  })

  it("the candidate window is bounded by the calendar and says so", () => {
    expect(CLOCK).toContain("PAYROLL_MAX_CATCHUP_WEEKS")
    expect(CONFIG).toContain("export const PAYROLL_MAX_CATCHUP_WEEKS")
  })

  it("weeks dropped by the cap are REPORTED, never silently skipped", () => {
    expect(CLOCK).toContain("weeksOutsideWindow")
    expect(CRON).toContain("weeksOutsideWindow")
  })
})

describe("ONE LEAGUE-WIDE ROSTER SNAPSHOT PER PAYROLL WEEK", () => {
  const settle = PAYROLL.slice(PAYROLL.indexOf("export async function settlePayrollWeek"))

  it("reads every club's players in ONE query, not one query per club", () => {
    // Pinned as one shape rather than two loose substrings. The loose version
    // of this guard did not fail when the read was rewritten into a per-club
    // loop: `teamId: { in: eligibleIds }` still appeared further down in the
    // ledger read, and the loop still contained exactly one player.findMany.
    expect(settle).toMatch(
      /tx\.player\.findMany\(\{\s*\n\s*where: \{ teamId: \{ in: eligibleIds \}, careerStatus: "ACTIVE" \},/
    )
    expect(settle.match(/player\.findMany/g) ?? []).toHaveLength(1)
  })

  it("nothing loops around the roster read", () => {
    const region = settle.slice(settle.indexOf("2b. THE CANONICAL"), settle.indexOf("const wageBill"))
    expect(region).not.toContain("for (")
    expect(region).not.toContain("while (")
    expect(region).not.toContain(".push(")
  })

  it("the roster read is inside the same transaction as the charges", () => {
    const txStart = settle.indexOf("prisma.$transaction")
    expect(txStart).toBeGreaterThan(-1)
    expect(settle.indexOf("player.findMany")).toBeGreaterThan(txStart)
  })

  it("filters careerStatus ACTIVE explicitly rather than relying on teamId going null", () => {
    expect(settle).toContain('careerStatus: "ACTIVE"')
  })

  it("takes a transaction-scoped advisory lock keyed by the payroll week", () => {
    expect(settle).toContain("pg_advisory_xact_lock")
    expect(PAYROLL).toContain("goalx:payroll:")
    // A session-scoped lock survives a rolled-back transaction and leaks.
    expect(PAYROLL).not.toContain("pg_advisory_lock(")
    expect(PAYROLL).not.toContain("pg_advisory_unlock")
  })

  it("processes clubs in deterministic ascending id order", () => {
    expect(settle).toContain('orderBy: { id: "asc" }')
  })

  it("settles weeks oldest first", () => {
    const run = PAYROLL.slice(PAYROLL.indexOf("export async function settleDuePayroll"))
    expect(run).toContain("for (const instant of window.instants)")
    expect(CLOCK).toContain("OLDEST FIRST")
  })
})

describe("CRON ORDER: payroll before the season roll, stadium first", () => {
  const stadiumStep = CRON.indexOf("settleDueStadiumConstructionForAll()")
  const fixtures = CRON.indexOf("processDueFixtures()")
  const payroll = CRON.indexOf("settleDuePayroll()")
  const seasons = CRON.indexOf("runSeasonEndOrchestratorForAllSeasons()")

  it("stadium completion runs before fixtures are played", () => {
    expect(stadiumStep).toBeGreaterThan(-1)
    expect(stadiumStep).toBeLessThan(fixtures)
  })

  it("payroll runs after fixtures and BEFORE season lifecycle", () => {
    expect(payroll).toBeGreaterThan(fixtures)
    expect(payroll).toBeLessThan(seasons)
  })

  it("season lifecycle is deferred when payroll is outstanding", () => {
    expect(CRON).toContain("payrollOutstanding")
    const guard = CRON.slice(CRON.indexOf("// --- C. Season lifecycle"))
    expect(guard).toContain("if (payrollOutstanding)")
    expect(guard).toContain("DEFERRED")
  })
})

describe("STADIUM: completion moves seats, never money", () => {
  it("the completion path writes no financial transaction and touches no balance", () => {
    expect(COMPLETION).not.toContain("createFinancialTransaction")
    expect(COMPLETION).not.toContain("adjustClubBalance")
    expect(COMPLETION).not.toContain("balance")
  })

  it("the scheduled settler writes no money either", () => {
    const settler = STADIUM_ACTIONS.slice(
      STADIUM_ACTIONS.indexOf("export async function settleDueStadiumConstructionForAll")
    )
    expect(settler).not.toContain("createFinancialTransaction")
    expect(settler).not.toContain("balance")
  })

  it("the construction cost is still debited only when the job starts", () => {
    const start = STADIUM_ACTIONS.slice(
      STADIUM_ACTIONS.indexOf("export async function startStadiumConstruction"),
      STADIUM_ACTIONS.indexOf("export async function completeStadiumConstruction")
    )
    expect(start).toContain('type: "stadiumConstruction"')
    expect(start).toContain("allowNegative: false")
  })

  it("the settler is bounded per run", () => {
    expect(STADIUM_ACTIONS).toContain("STADIUM_COMPLETION_BATCH")
    expect(STADIUM_ACTIONS).toContain("take: limit")
  })
})

describe("STADIUM AS-OF: a match reads the stadium it was played in", () => {
  it("the match engine never reads raw Stadium seats for capacity", () => {
    for (const source of [SIMULATE, SNAPSHOT]) {
      expect(source).toContain("readSeatsAsOf(")
      expect(source).not.toContain("toSeatCounts(homeStadium)")
      expect(source).not.toContain("ensureStadiumForTeam(fixture.homeTeamId")
    }
  })

  it("both engine reads are anchored to the fixture's own scheduledAt", () => {
    expect(SIMULATE).toContain("readSeatsAsOf(fixture.homeTeamId, fixture.scheduledAt)")
    expect(SNAPSHOT).toContain("readSeatsAsOf(fixture.homeTeamId, fixture.scheduledAt")
  })

  it("the correction runs in BOTH directions, not just the subtract", () => {
    const calc = AS_OF.slice(AS_OF.indexOf("export function seatsAsOf"))
    expect(calc).toContain("seats[type] -= seatsOf(job, type)")
    expect(calc).toContain("seats[type] += seatsOf(job, type)")
  })

  it("it adjusts every seat class, never a single capacity total", () => {
    const calc = AS_OF.slice(AS_OF.indexOf("export function seatsAsOf"))
    expect(calc).toContain("for (const type of SEAT_TYPES)")
    expect(calc).not.toContain("calculateStadiumCapacity")
  })

  it("past fixtures are never rewritten by a completion", () => {
    expect(code(COMPLETION)).not.toMatch(/fixture/i)
    expect(code(COMPLETION)).not.toMatch(/attendance/i)
    expect(code(COMPLETION)).not.toMatch(/matchEvent|playerMatchStats/i)
  })
})

describe("THE ECONOMY SERVICE IS STILL THE ONLY WRITER OF Team.balance", () => {
  it("adjustClubBalance is the single statement that updates the column", () => {
    expect(BALANCE.match(/team\.update/g) ?? []).toHaveLength(1)
    expect(SERVICE).toContain("adjustClubBalance(")
  })

  it("payroll goes through the service rather than touching the balance itself", () => {
    expect(PAYROLL).toContain("createFinancialTransaction(")
    expect(PAYROLL).not.toContain("adjustClubBalance")
    expect(PAYROLL).not.toContain("team.update")
  })

  it("payroll stays mandatory - it does not opt out of a negative balance", () => {
    const settle = PAYROLL.slice(PAYROLL.indexOf("export async function settlePayrollWeek"))
    expect(settle).not.toContain("allowNegative")
    // ...and nothing invented a floor, a bankruptcy or a forced sale.
    expect(PAYROLL).not.toMatch(/bankrupt/i)
    expect(PAYROLL).not.toMatch(/administration/i)
  })
})

describe("OUT OF SCOPE STAYS OUT", () => {
  const everySource = [PAYROLL, CLOCK, CRON, STADIUM_ACTIONS, AS_OF, ECONOMY_PAGE, STADIUM_PAGE].join("\n")

  it("no stadium maintenance WRITER appeared", () => {
    // /stadium still DISPLAYS calculateWeeklyMaintenance, and always has -
    // showing a club what upkeep would cost is not charging it. What must not
    // exist is a ledger row of that type, which is what this bans.
    expect(everySource).not.toContain('type: "stadiumMaintenance"')
    const settlers = [PAYROLL, CRON, code(STADIUM_ACTIONS)].join("\n")
    expect(settlers).not.toContain("calculateWeeklyMaintenance")
  })

  it("no sponsor income writer appeared", () => {
    expect(everySource).not.toContain('type: "sponsorIncome"')
  })

  it("no season prize or championship reward appeared", () => {
    expect(everySource).not.toMatch(/prizeMoney|championshipReward|seasonPrize/)
  })
})
