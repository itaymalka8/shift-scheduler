import { DEFAULT_STADIUM_CONFIG, SEAT_TYPES, type SeatCounts, type SeatType, type StadiumConfig } from "./config"
import { calculateStadiumCapacity } from "./metrics"

export interface AttendanceMatch {
  isHome: boolean
}

export interface AttendanceClub {
  teamTotalQuality: number
}

export interface AttendanceStadium {
  seats: SeatCounts
}

export interface AttendanceResult {
  bySeatType: SeatCounts
  total: number
  capacity: number
  soldOut: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * How many fans show up to a home match. v1 formula: a base occupancy rate
 * nudged by the home team's overall quality plus week-to-week randomness,
 * applied uniformly across every seat type and capped at each type's own
 * capacity. `match`/`club` are accepted (rather than just a number) so a
 * later pass can factor in table position, form, opponent quality, match
 * importance, and ticket price without changing this function's shape -
 * only what it reads off them.
 */
export function calculateAttendance(
  match: AttendanceMatch,
  club: AttendanceClub,
  stadium: AttendanceStadium,
  config: StadiumConfig = DEFAULT_STADIUM_CONFIG
): AttendanceResult {
  const capacity = calculateStadiumCapacity(stadium.seats)
  const { attendance: cfg } = config

  const qualityFactor = (club.teamTotalQuality - cfg.neutralQuality) * cfg.qualityInfluence
  const randomFactor = (Math.random() * 2 - 1) * cfg.randomVariance
  const occupancyRatio = clamp(cfg.baseOccupancy + qualityFactor + randomFactor, 0.05, 1.5)
  const perTypeRatio = Math.min(1, occupancyRatio)

  const bySeatType = SEAT_TYPES.reduce((acc, type) => {
    acc[type] = Math.round(stadium.seats[type] * perTypeRatio)
    return acc
  }, {} as SeatCounts)

  const total = SEAT_TYPES.reduce((sum, type) => sum + bySeatType[type], 0)

  return { bySeatType, total, capacity, soldOut: occupancyRatio >= 1 }
}

/** Gate revenue from one match - attendance per seat type times that type's ticket price. */
export function calculateMatchStadiumRevenue(
  attendanceBySeatType: SeatCounts,
  config: StadiumConfig = DEFAULT_STADIUM_CONFIG
): { bySeatType: Record<SeatType, number>; total: number } {
  const bySeatType = SEAT_TYPES.reduce((acc, type) => {
    acc[type] = attendanceBySeatType[type] * config.ticketPrices[type]
    return acc
  }, {} as Record<SeatType, number>)

  const total = SEAT_TYPES.reduce((sum, type) => sum + bySeatType[type], 0)
  return { bySeatType, total }
}
