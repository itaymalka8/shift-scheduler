import { DEFAULT_MATCH_EXPENSE_CONFIG, type Competition, type MatchExpenseConfig } from "./config"

export interface MatchExpenseStadium {
  capacity: number
}

export interface MatchExpenseBreakdown {
  security: number
  stewards: number
  medical: number
  cleaning: number
  powerAndOps: number
  misc: number
}

export interface MatchExpenseResult {
  total: number
  breakdown: MatchExpenseBreakdown
}

/**
 * A home match's operating costs - security, stewards, medical, cleaning,
 * power/ops - scaled by both the stadium's size (a bigger ground costs more
 * to run even on a quiet night) and the actual attendance (more fans, more
 * cost), then adjusted for competition importance.
 */
export function calculateHomeMatchExpenses(
  stadium: MatchExpenseStadium,
  attendance: number,
  competition: Competition,
  config: MatchExpenseConfig = DEFAULT_MATCH_EXPENSE_CONFIG
): MatchExpenseResult {
  const raw =
    config.baseMatchCost + config.costPerCapacity * stadium.capacity + config.costPerSpectator * attendance
  const total = Math.round(raw * config.competitionModifier[competition])

  const breakdown: MatchExpenseBreakdown = {
    security: Math.round(total * config.breakdown.security),
    stewards: Math.round(total * config.breakdown.stewards),
    medical: Math.round(total * config.breakdown.medical),
    cleaning: Math.round(total * config.breakdown.cleaning),
    powerAndOps: Math.round(total * config.breakdown.powerAndOps),
    misc: Math.round(total * config.breakdown.misc),
  }

  return { total, breakdown }
}

/**
 * An away match's travel cost - a flat figure per competition type for now
 * (no real destination/distance modeling yet - international is 0 until
 * that exists).
 */
export function calculateAwayTravelCost(
  competition: Competition,
  config: MatchExpenseConfig = DEFAULT_MATCH_EXPENSE_CONFIG
): number {
  return config.awayTravelCost[competition]
}
