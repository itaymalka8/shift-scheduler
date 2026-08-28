import {
  DEFAULT_STADIUM_CONFIG,
  SEAT_TYPES,
  STADIUM_VISUAL_TIERS,
  type SeatCounts,
  type StadiumConfig,
  type StadiumVisualTier,
} from "./config"

export type StadiumSeats = SeatCounts

function sumBySeatType(seats: StadiumSeats, perSeat: Record<string, number>): number {
  return SEAT_TYPES.reduce((sum, type) => sum + seats[type] * perSeat[type], 0)
}

/** Total capacity is always the sum of the four seat types - never stored on its own. */
export function calculateStadiumCapacity(seats: StadiumSeats): number {
  return SEAT_TYPES.reduce((sum, type) => sum + seats[type], 0)
}

/** Weekly upkeep - bigger, higher-quality stadiums cost more to run, on purpose. */
export function calculateWeeklyMaintenance(seats: StadiumSeats, config: StadiumConfig = DEFAULT_STADIUM_CONFIG): number {
  return sumBySeatType(seats, config.maintenanceCostPerSeat) + config.additionalFacilitiesMaintenance
}

/** The stadium's asset value - not liquid club cash, just what the physical asset is worth. */
export function calculateStadiumValue(seats: StadiumSeats, config: StadiumConfig = DEFAULT_STADIUM_CONFIG): number {
  return sumBySeatType(seats, config.valuePerSeat) + config.additionalFacilitiesValue
}

/** Display-only size label - never a substitute for the real capacity number. */
export function getStadiumVisualTier(capacity: number): StadiumVisualTier {
  const tier = STADIUM_VISUAL_TIERS.find((t) => capacity <= t.maxCapacity)
  return (tier ?? STADIUM_VISUAL_TIERS[STADIUM_VISUAL_TIERS.length - 1]).id
}
