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

export interface AttendanceRollOptions {
  /**
   * The week-to-week noise draw, uniform in [0, 1).
   *
   * REQUIRED OF EVERY CALLER THAT SETTLES MONEY, and the reason is a defect
   * this argument exists to make unrepresentable. Attendance used to be rolled
   * from Math.random() by two different subsystems for the SAME fixture - once
   * to store the crowd and charge the match expenses, and again to compute the
   * gate receipts - so a fixture's stored attendance and its ticket revenue
   * came from two different crowds. Measured on Production, zero of ninety
   * played fixtures could reproduce their own gate, with reconstruction error
   * spanning -71,100 to +86,520.
   *
   * A caller that omits this still gets an independent draw, because a
   * preview - the /economy page's "what would a typical matchday look like" -
   * is genuinely asking for a fresh sample and has no seed to offer. Nothing
   * that writes to the ledger may omit it.
   */
  roll?: number
  /**
   * The baseline this club's quality is measured against. Defaults to the
   * config's fixed neutral, which is the pre-Phase-3R authority; the
   * calibrated era passes the league's own median for the season instead.
   */
  neutralQuality?: number
}

/**
 * How many fans show up to a home match. A base occupancy rate nudged by the
 * home team's quality relative to the league's neutral, plus week-to-week
 * randomness, applied uniformly across every seat type and capped at each
 * type's own capacity. `match`/`club` are accepted (rather than just a number)
 * so a later pass can factor in table position, form, opponent quality, match
 * importance, and ticket price without changing this function's shape - only
 * what it reads off them.
 */
export function calculateAttendance(
  match: AttendanceMatch,
  club: AttendanceClub,
  stadium: AttendanceStadium,
  config: StadiumConfig = DEFAULT_STADIUM_CONFIG,
  options: AttendanceRollOptions = {}
): AttendanceResult {
  const capacity = calculateStadiumCapacity(stadium.seats)
  const { attendance: cfg } = config

  const neutral = options.neutralQuality ?? cfg.neutralQuality
  const qualityFactor = (club.teamTotalQuality - neutral) * cfg.qualityInfluence
  const randomFactor = ((options.roll ?? Math.random()) * 2 - 1) * cfg.randomVariance
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
