// Every stadium number the product spec calls out as tunable lives here -
// seat counts, prices, construction costs/time, maintenance, and the
// attendance model's weights. Rebalancing the stadium economy is a config
// edit, not a hunt through UI or calculation code.

export const SEAT_TYPES = ["regular", "covered", "premium", "vip"] as const
export type SeatType = (typeof SEAT_TYPES)[number]

export interface SeatCounts {
  regular: number
  covered: number
  premium: number
  vip: number
}

// The Stadium DB row uses regularSeats/coveredSeats/... column names; every
// calculation in this module works off the shorter SeatCounts shape instead
// - these two convert at the boundary, so the math never has to say "Seats"
// four times per line.
export interface StadiumSeatColumns {
  regularSeats: number
  coveredSeats: number
  premiumSeats: number
  vipSeats: number
}

export function toSeatCounts(row: StadiumSeatColumns): SeatCounts {
  return { regular: row.regularSeats, covered: row.coveredSeats, premium: row.premiumSeats, vip: row.vipSeats }
}

export function toSeatColumns(seats: SeatCounts): StadiumSeatColumns {
  return {
    regularSeats: seats.regular,
    coveredSeats: seats.covered,
    premiumSeats: seats.premium,
    vipSeats: seats.vip,
  }
}

// --- Starting stadium -------------------------------------------------------

export const DEFAULT_STARTING_SEATS: SeatCounts = {
  regular: 8000,
  covered: 2000,
  premium: 500,
  vip: 100,
}

export const DEFAULT_STADIUM_NAME_SUFFIX = "אצטדיון"

// --- Club starting balance ---------------------------------------------------

export const DEFAULT_STARTING_BALANCE = 5_000_000

// --- Ticket prices, per seat, per match --------------------------------------

export const TICKET_PRICES: Record<SeatType, number> = {
  regular: 30,
  covered: 45,
  premium: 75,
  vip: 180,
}

// --- Construction cost, per new seat -----------------------------------------

export const CONSTRUCTION_COST_PER_SEAT: Record<SeatType, number> = {
  regular: 1500,
  covered: 2500,
  premium: 5000,
  vip: 25000,
}

// --- Construction time --------------------------------------------------------

export interface ConstructionTimeConfig {
  small: { maxSeats: number; days: number }
  medium: { maxSeats: number; minDays: number; maxDays: number }
  large: { baseDays: number; extraSeatsPerDay: number }
}

// <=1,000 seats: 1 day. 1,001-5,000: 3-5 days (interpolated across the
// band). >5,000: 7 days plus one more day per extra 2,000 seats.
export const DEFAULT_CONSTRUCTION_TIME_CONFIG: ConstructionTimeConfig = {
  small: { maxSeats: 1000, days: 1 },
  medium: { maxSeats: 5000, minDays: 3, maxDays: 5 },
  large: { baseDays: 7, extraSeatsPerDay: 2000 },
}

// --- Weekly maintenance -------------------------------------------------------

export const MAINTENANCE_COST_PER_SEAT: Record<SeatType, number> = {
  regular: 3,
  covered: 5,
  premium: 12,
  vip: 40,
}

// Future facilities (training center, museum, floodlights, ...) will add
// their own upkeep here - 0 until they exist.
export const ADDITIONAL_FACILITIES_WEEKLY_MAINTENANCE = 0

// --- Stadium value ---------------------------------------------------------------

export const VALUE_PER_SEAT: Record<SeatType, number> = {
  regular: 4000,
  covered: 7000,
  premium: 15000,
  vip: 60000,
}

// Future facilities add their own value contribution here - 0 until they exist.
export const ADDITIONAL_FACILITIES_VALUE = 0

// --- Visual tier (display only - never a substitute for the real seat count) --

export type StadiumVisualTier = "small" | "medium" | "large" | "senior" | "elite"

export const STADIUM_VISUAL_TIERS: { id: StadiumVisualTier; maxCapacity: number; labelKey: string }[] = [
  { id: "small", maxCapacity: 10_000, labelKey: "stadium.tier.small" },
  { id: "medium", maxCapacity: 20_000, labelKey: "stadium.tier.medium" },
  { id: "large", maxCapacity: 40_000, labelKey: "stadium.tier.large" },
  { id: "senior", maxCapacity: 60_000, labelKey: "stadium.tier.senior" },
  { id: "elite", maxCapacity: Infinity, labelKey: "stadium.tier.elite" },
]

// --- Attendance (v1 - simple, but structured for later extension) -------------

export interface AttendanceConfig {
  baseOccupancy: number // fraction of capacity a mid-table team draws on an average matchday
  qualityInfluence: number // how much a team's overall quality nudges occupancy, per quality point above/below a neutral baseline
  neutralQuality: number // the "average team" Total Quality baseline qualityInfluence is measured against
  randomVariance: number // +- this fraction of capacity, per match, for natural week-to-week noise
  nearCapacityThreshold: number // occupancy fraction at/above which a home match counts as "almost full" for the sell-more-tickets nudge
  nearCapacityStreakForHint: number // consecutive near-full home matches before showing the expansion hint
}

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  baseOccupancy: 0.62,
  qualityInfluence: 0.0015,
  neutralQuality: 1320,
  randomVariance: 0.12,
  nearCapacityThreshold: 0.93,
  nearCapacityStreakForHint: 3,
}

export interface StadiumConfig {
  startingSeats: SeatCounts
  startingBalance: number
  ticketPrices: Record<SeatType, number>
  constructionCostPerSeat: Record<SeatType, number>
  constructionTime: ConstructionTimeConfig
  maintenanceCostPerSeat: Record<SeatType, number>
  additionalFacilitiesMaintenance: number
  valuePerSeat: Record<SeatType, number>
  additionalFacilitiesValue: number
  attendance: AttendanceConfig
}

export const DEFAULT_STADIUM_CONFIG: StadiumConfig = {
  startingSeats: DEFAULT_STARTING_SEATS,
  startingBalance: DEFAULT_STARTING_BALANCE,
  ticketPrices: TICKET_PRICES,
  constructionCostPerSeat: CONSTRUCTION_COST_PER_SEAT,
  constructionTime: DEFAULT_CONSTRUCTION_TIME_CONFIG,
  maintenanceCostPerSeat: MAINTENANCE_COST_PER_SEAT,
  additionalFacilitiesMaintenance: ADDITIONAL_FACILITIES_WEEKLY_MAINTENANCE,
  valuePerSeat: VALUE_PER_SEAT,
  additionalFacilitiesValue: ADDITIONAL_FACILITIES_VALUE,
  attendance: DEFAULT_ATTENDANCE_CONFIG,
}
