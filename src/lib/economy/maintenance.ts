/**
 * WEEKLY STADIUM MAINTENANCE - the running cost of a ground a club chose to
 * build, and of nothing else.
 *
 * ONLY SEATS ABOVE THE STARTING GROUND ARE CHARGED. Maintenance exists to
 * price EXPANSION, not existence. Charging the default 10,600-seat stadium
 * would be a flat weekly tax on having been created - identical for all sixty
 * clubs, unavoidable, and therefore a change to the economy's LEVEL wearing a
 * mechanic's clothes. The level was already solved, jointly, by the salary
 * curve and the sponsor coefficient; adding a sixty-first identical charge on
 * top would move it away from the value that was calibrated. So the exemption
 * is the default ground itself, and a club pays upkeep exactly when a manager
 * has taken on a commitment.
 *
 * Today 0 of 60 Production clubs have expanded, so the league-wide liability
 * on the first settled week is expected to be exactly zero - which is also the
 * cheapest possible way to discover that this code works.
 *
 * THE EXEMPTION IS IMPORTED, NOT RESTATED. DEFAULT_STARTING_SEATS is the same
 * object stadium generation uses, so changing the starting ground moves the
 * exemption with it rather than leaving a stale copy behind that nobody
 * notices until a club is charged for seats it was given.
 *
 * PER SEAT CLASS, NEVER A TOTAL. Upkeep differs by class - a VIP box costs
 * more than thirteen terrace seats - so collapsing to one number would get the
 * charge wrong even when the seat count is right. The subtraction happens per
 * class too, and is floored at zero per class: a club that somehow has fewer
 * premium seats than the default must not earn a credit against its regular
 * ones.
 *
 * SEATS AS OF THE SETTLEMENT BOUNDARY, NOT AS OF NOW. The caller resolves the
 * ground through the existing seatsAsOf authority against the week's own
 * instant, so a stand finished after the boundary is not charged for that week
 * and one finished before it is - whether or not the construction settler has
 * caught up. A late cron and a punctual cron therefore charge the same amount,
 * which is the property Phase 3P established for capacity and this reuses
 * rather than re-derives.
 */
import { DEFAULT_STARTING_SEATS, MAINTENANCE_COST_PER_SEAT, SEAT_TYPES, type SeatCounts } from "@/lib/stadium/config"

export interface MaintenanceConfig {
  exemptSeats: SeatCounts
  costPerSeat: Record<string, number>
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  exemptSeats: DEFAULT_STARTING_SEATS,
  costPerSeat: MAINTENANCE_COST_PER_SEAT,
}

export interface MaintenanceBreakdown {
  /** Chargeable seats above the exemption, per class. */
  chargeableSeats: SeatCounts
  total: number
}

/**
 * One club's weekly upkeep for a ground of `seats`.
 *
 * Returns a breakdown rather than a number so the ledger description and the
 * production audit can both say WHICH stand is costing the money, without
 * either of them recomputing the split and risking a different answer.
 */
export function calculateWeeklyMaintenance(
  seats: SeatCounts,
  config: MaintenanceConfig = DEFAULT_MAINTENANCE_CONFIG
): MaintenanceBreakdown {
  const chargeableSeats = {} as SeatCounts
  let total = 0
  for (const type of SEAT_TYPES) {
    const chargeable = Math.max(0, seats[type] - config.exemptSeats[type])
    chargeableSeats[type] = chargeable
    total += chargeable * (config.costPerSeat[type] ?? 0)
  }
  return { chargeableSeats, total: Math.round(total) }
}

/** The ledger idempotency key for one club's upkeep in one weekly settlement. */
export function maintenanceReferenceId(weekKey: string): string {
  return `MAINTENANCE_${weekKey}`
}
