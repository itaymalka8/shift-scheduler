/**
 * WEEKLY SPONSOR INCOME - the league's only autonomous revenue, and the half
 * of Phase 3R that pays for the other half.
 *
 * THE SHAPE, AND WHY IT IS THIS SHAPE:
 *
 *     base   = k * MEDIAN(weekly payroll across the league)
 *     club   = base * tierMultiplier(club) / MEAN(tierMultiplier over the league)
 *
 * A CLUB'S OWN PAYROLL NEVER DETERMINES ITS OWN SPONSOR. That is the rule the
 * whole design is built around, and it is worth being exact about what it
 * forbids and what it does not. A club's wage bill enters this calculation
 * through the league MEDIAN and through nothing else - one of sixty inputs to
 * a statistic that is then identical for every club. It does not appear in
 * that club's own term. So spending more cannot buy a bigger cheque, and the
 * game can never become "sign expensive players, get reimbursed", which would
 * make the wage bill self-funding and the whole calibration meaningless.
 *
 * WHY THE MEDIAN AND NOT THE MEAN. A mean is moved by one club: a single
 * runaway wage bill would raise everybody's sponsor income and hand the league
 * a windfall for one manager's decision. A median is not - it takes sixty
 * clubs moving together to move it, which is exactly the situation in which
 * the league's sponsor income SHOULD move.
 *
 * WHY THE TIER MULTIPLIER IS NORMALISED. Dividing by the league's mean
 * multiplier makes the tier weights a pure distribution: the total the league
 * receives depends on `k` alone, and promoting clubs into tier 1 redistributes
 * income rather than creating it. Without the normaliser, a league-structure
 * change would silently move the economic level that was calibrated - the same
 * failure mode the salary curve's own neutraliser exists to prevent.
 *
 * HUMAN AND BOT ARE THE SAME FORMULA. There is no club-type input here at all;
 * a club's sponsor is a function of the league's median payroll and the club's
 * tier, and there is nowhere for a manager flag to enter even if somebody
 * wanted it to.
 */
import { SPONSOR_COEFFICIENT, SPONSOR_DEFAULT_TIER, SPONSOR_TIER_MULTIPLIER } from "./config"

export interface SponsorClub {
  teamId: string
  /** This club's total weekly wage bill in the settlement snapshot. */
  weeklyPayroll: number
  /**
   * The club's division tier for the season being settled, from DivisionTeam -
   * never inferred from current Team state. Null for a club with no membership
   * in that season, which is priced at the entry tier.
   */
  tier: number | null
}

export interface SponsorConfig {
  coefficient: number
  tierMultiplier: Readonly<Record<number, number>>
  defaultTier: number
}

export const DEFAULT_SPONSOR_CONFIG: SponsorConfig = {
  coefficient: SPONSOR_COEFFICIENT,
  tierMultiplier: SPONSOR_TIER_MULTIPLIER,
  defaultTier: SPONSOR_DEFAULT_TIER,
}

export interface SponsorAward {
  teamId: string
  tier: number
  multiplier: number
  amount: number
}

export interface SponsorCalculation {
  /** The one league-wide statistic every club's award is derived from. */
  medianWeeklyPayroll: number
  /** k * median - the league's per-club average award, before tier distribution. */
  base: number
  /** The divisor that keeps tier weights a distribution rather than a level. */
  meanTierMultiplier: number
  awards: SponsorAward[]
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Pure. Give it the whole league's snapshot for one week and it returns every
 * club's award, plus the two league-wide numbers it derived them from so a
 * report can show the working rather than asserting the result.
 *
 * Deliberately takes the WHOLE league rather than one club at a time: the
 * median and the mean multiplier are properties of the league, and a function
 * that computed them per club would be free to compute them differently per
 * club. Here that is unrepresentable.
 */
export function calculateSponsorIncome(
  clubs: readonly SponsorClub[],
  config: SponsorConfig = DEFAULT_SPONSOR_CONFIG
): SponsorCalculation {
  if (clubs.length === 0) {
    return { medianWeeklyPayroll: 0, base: 0, meanTierMultiplier: 0, awards: [] }
  }

  const multiplierOf = (tier: number | null): number =>
    config.tierMultiplier[tier ?? config.defaultTier] ?? config.tierMultiplier[config.defaultTier] ?? 1

  const medianWeeklyPayroll = median(clubs.map((club) => club.weeklyPayroll))
  const base = config.coefficient * medianWeeklyPayroll
  const meanTierMultiplier = clubs.reduce((sum, club) => sum + multiplierOf(club.tier), 0) / clubs.length

  const awards = clubs.map((club) => {
    const tier = club.tier ?? config.defaultTier
    const multiplier = multiplierOf(club.tier)
    // A zero mean is only reachable if every configured multiplier is zero,
    // which would be a config error rather than a league state - pay nothing
    // rather than divide by it.
    const amount = meanTierMultiplier === 0 ? 0 : Math.round((base * multiplier) / meanTierMultiplier)
    return { teamId: club.teamId, tier, multiplier, amount }
  })

  return { medianWeeklyPayroll, base, meanTierMultiplier, awards }
}

/** The ledger idempotency key for one club's sponsor in one weekly settlement. */
export function sponsorReferenceId(weekKey: string): string {
  return `SPONSOR_${weekKey}`
}
