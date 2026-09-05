import type { BroadPositionGroup } from "@/lib/players/config"

// Every number that shapes the club economy - salaries, match-day costs,
// payroll timing, and the target salary band for a brand-new squad - lives
// here, one edit away from a balance pass.

export type Competition = "league" | "cup" | "international"

// --- Player salaries ------------------------------------------------------------

export interface SalaryOverallBand {
  min: number
  max: number
  salaryMin: number
  salaryMax: number
}

// Overall is the dominant factor - within a band, salary interpolates
// linearly from salaryMin at the band's floor to salaryMax at its ceiling.
export const SALARY_OVERALL_BANDS: SalaryOverallBand[] = [
  { min: 0, max: 49, salaryMin: 2_000, salaryMax: 6_000 },
  { min: 50, max: 59, salaryMin: 5_000, salaryMax: 10_000 },
  { min: 60, max: 69, salaryMin: 8_000, salaryMax: 20_000 },
  { min: 70, max: 79, salaryMin: 18_000, salaryMax: 40_000 },
  { min: 80, max: 89, salaryMin: 35_000, salaryMax: 80_000 },
  { min: 90, max: 94, salaryMin: 75_000, salaryMax: 150_000 },
  { min: 95, max: 100, salaryMin: 140_000, salaryMax: 320_000 },
]

export interface SalaryAgeBand {
  maxAge: number
  multiplier: number
}

// Prime-career ages earn a premium; very young or aging players a discount.
export const SALARY_AGE_CURVE: SalaryAgeBand[] = [
  { maxAge: 21, multiplier: 0.8 },
  { maxAge: 25, multiplier: 0.95 },
  { maxAge: 29, multiplier: 1.15 },
  { maxAge: 33, multiplier: 0.95 },
  { maxAge: 99, multiplier: 0.8 },
]

// Potential nudges salary, but far more gently than Overall does - a young
// high-potential player earns a bit more than an equally-rated veteran with
// no room to grow, never more than that.
export const SALARY_POTENTIAL_GAP_WEIGHT = 0.008

export const SALARY_POSITION_MULTIPLIER: Record<BroadPositionGroup, number> = {
  GK: 0.85,
  CB: 0.9,
  FB: 0.95,
  MF: 1.0,
  ATT: 1.15,
}

export const SALARY_MIN = 1_500
export const SALARY_ROUNDING_UNIT = 500

export interface SalaryConfig {
  overallBands: SalaryOverallBand[]
  ageCurve: SalaryAgeBand[]
  potentialGapWeight: number
  positionMultiplier: Record<BroadPositionGroup, number>
  minSalary: number
  roundingUnit: number
}

export const DEFAULT_SALARY_CONFIG: SalaryConfig = {
  overallBands: SALARY_OVERALL_BANDS,
  ageCurve: SALARY_AGE_CURVE,
  potentialGapWeight: SALARY_POTENTIAL_GAP_WEIGHT,
  positionMultiplier: SALARY_POSITION_MULTIPLIER,
  minSalary: SALARY_MIN,
  roundingUnit: SALARY_ROUNDING_UNIT,
}

// A new 22-player squad's combined weekly salary must land in this band -
// generation scales every salary by the same factor if the raw total falls
// outside it, so a lucky/unlucky quality roll never produces a squad the
// starting budget can't plausibly support (or one that's suspiciously cheap).
export const INITIAL_SQUAD_SALARY_RANGE = { min: 180_000, max: 300_000 }

// --- Match expenses ---------------------------------------------------------------

export interface MatchExpenseConfig {
  baseMatchCost: number
  costPerCapacity: number
  costPerSpectator: number
  competitionModifier: Record<Competition, number>
  // Proportions of the total cost each category represents, for the
  // itemized display only - must sum to 1.
  breakdown: { security: number; stewards: number; medical: number; cleaning: number; powerAndOps: number; misc: number }
  awayTravelCost: Record<Competition, number>
}

export const DEFAULT_MATCH_EXPENSE_CONFIG: MatchExpenseConfig = {
  baseMatchCost: 10_000,
  costPerCapacity: 0.5,
  costPerSpectator: 3,
  competitionModifier: { league: 1, cup: 1.15, international: 1.4 },
  breakdown: { security: 0.33, stewards: 0.18, medical: 0.09, cleaning: 0.11, powerAndOps: 0.18, misc: 0.11 },
  // International away costs aren't modeled yet (would need a real
  // destination) - 0 until that exists, per the product spec.
  awayTravelCost: { league: 10_000, cup: 12_000, international: 0 },
}

// --- Payroll ------------------------------------------------------------------------

// Every club pays wages on the same weekday, at a fixed server hour - never
// derived from a viewer's local clock. 13:00 UTC = 15:00 Israel Standard
// Time (UTC+2); Israel Daylight Time (UTC+3, roughly Mar-Oct) shifts the
// actual local payroll time to 16:00 during that period, since this fixed
// UTC hour isn't DST-aware (matching the rest of the schedule, e.g.
// src/lib/match/schedule.ts).
export const PAYROLL_WEEKDAY = 4 // Thursday (JS Date#getDay(): 0=Sunday)
export const PAYROLL_HOUR_UTC = 13

/**
 * THE ACTIVATION BOUNDARY - the instant autonomous payroll begins.
 *
 * START-LINE ACTIVATION. Payroll weeks that closed BEFORE this instant are
 * permanently outside autonomous settlement and are never charged, whether or
 * not a ledger row exists for them. Weeks from here on are charged to every
 * club, Human and BOT alike, by the scheduled job and by nothing else.
 *
 * WHY A COMMITTED LITERAL RATHER THAN A DATABASE ROW. It has to be explicit,
 * canonical, identical for every club, and impossible for a redeploy to
 * reset - a constant in source is all four, and needs no migration and no
 * write to Production to establish. Deploy time is NEVER read: this is a
 * fixed instant, not "whenever the container started".
 *
 * WHY IT IS IN THE FUTURE WHEN IT SHIPS. The deploy that first turns payroll
 * on must land BEFORE this instant, so that the first week the league is
 * charged for is one that closes with the new behaviour already live and
 * observable. Deploying after it had passed would settle a week retroactively
 * on the very first tick. `npm run prod:payroll:activation-check` fails
 * closed on exactly that, and preflight prints the boundary every time.
 *
 * ONCE AUTONOMOUS PAYROLL IS LIVE THIS VALUE IS HISTORY. It must not be moved
 * forward by a later deploy: doing so would silently skip the weeks between
 * the old and new boundary. Moving it is a reviewed code change with a diff,
 * which is the point.
 *
 * 2026-09-10T13:00:00.000Z is a Thursday at 13:00 UTC - on the payroll grid
 * defined by PAYROLL_WEEKDAY and PAYROLL_HOUR_UTC above, which
 * payroll-clock.test.ts asserts rather than trusts.
 */
export const PAYROLL_AUTOMATION_START = new Date("2026-09-10T13:00:00.000Z")

/**
 * How many payroll boundaries one run will look back over.
 *
 * The scheduled job runs every two minutes, so the healthy case has exactly
 * one candidate week and usually zero unsettled ones. This bound exists so a
 * long outage cannot grow the candidate list without limit - and when it is
 * actually hit, the run REPORTS the weeks it left outside the window rather
 * than dropping them silently. Six months of missed payroll is an incident to
 * be looked at by a person, not a backlog to be quietly charged.
 */
export const PAYROLL_MAX_CATCHUP_WEEKS = 26
