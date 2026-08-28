import { DEFAULT_STADIUM_CONFIG, SEAT_TYPES, type SeatCounts, type StadiumConfig } from "./config"

/** Total cost of adding these seats, computed server-side - never trust a client-submitted price. */
export function calculateConstructionCost(seatsToAdd: SeatCounts, config: StadiumConfig = DEFAULT_STADIUM_CONFIG): number {
  return SEAT_TYPES.reduce((sum, type) => sum + seatsToAdd[type] * config.constructionCostPerSeat[type], 0)
}

/**
 * Construction time in days for a given number of new seats (across every
 * type combined) - a small job is done in a day, a big one takes over a
 * week, with a smooth band in between. See ConstructionTimeConfig in
 * config.ts for the exact breakpoints.
 */
export function calculateConstructionTime(
  totalNewSeats: number,
  config: StadiumConfig = DEFAULT_STADIUM_CONFIG
): number {
  const { small, medium, large } = config.constructionTime
  if (totalNewSeats <= 0) return 0
  if (totalNewSeats <= small.maxSeats) return small.days

  if (totalNewSeats <= medium.maxSeats) {
    const ratio = (totalNewSeats - small.maxSeats) / (medium.maxSeats - small.maxSeats)
    return Math.round(medium.minDays + ratio * (medium.maxDays - medium.minDays))
  }

  const extraSeats = totalNewSeats - medium.maxSeats
  const extraDays = Math.ceil(extraSeats / large.extraSeatsPerDay)
  return large.baseDays + extraDays
}

export function totalSeats(seats: SeatCounts): number {
  return SEAT_TYPES.reduce((sum, type) => sum + seats[type], 0)
}
