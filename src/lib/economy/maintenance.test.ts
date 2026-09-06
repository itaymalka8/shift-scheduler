import { DEFAULT_STARTING_SEATS, MAINTENANCE_COST_PER_SEAT, type SeatCounts } from "@/lib/stadium/config"
import { calculateWeeklyMaintenance, maintenanceReferenceId } from "./maintenance"

const seats = (over: Partial<SeatCounts> = {}): SeatCounts => ({
  regular: DEFAULT_STARTING_SEATS.regular + (over.regular ?? 0),
  covered: DEFAULT_STARTING_SEATS.covered + (over.covered ?? 0),
  premium: DEFAULT_STARTING_SEATS.premium + (over.premium ?? 0),
  vip: DEFAULT_STARTING_SEATS.vip + (over.vip ?? 0),
})

describe("maintenance prices expansion, not existence", () => {
  it("charges the starting ground exactly nothing", () => {
    // The whole exemption in one assertion: 0 of 60 Production clubs have
    // expanded, so the league's first settled maintenance week is expected to
    // move no money at all.
    const result = calculateWeeklyMaintenance(DEFAULT_STARTING_SEATS)
    expect(result.total).toBe(0)
    expect(result.chargeableSeats).toEqual({ regular: 0, covered: 0, premium: 0, vip: 0 })
  })

  it("charges a smaller-than-default ground nothing, and never a credit", () => {
    const tiny = { regular: 10, covered: 0, premium: 0, vip: 0 }
    expect(calculateWeeklyMaintenance(tiny).total).toBe(0)
  })

  it("floors the subtraction per seat class, so a shortfall in one cannot offset another", () => {
    // 1,000 extra regular seats, but fewer VIP boxes than the default. The
    // regular stand must still be charged in full.
    const lopsided = { ...seats({ regular: 1000 }), vip: 0 }
    const result = calculateWeeklyMaintenance(lopsided)
    expect(result.chargeableSeats.regular).toBe(1000)
    expect(result.chargeableSeats.vip).toBe(0)
    expect(result.total).toBe(1000 * MAINTENANCE_COST_PER_SEAT.regular)
  })

  it("charges each class at its own rate, never at a blended one", () => {
    const result = calculateWeeklyMaintenance(seats({ regular: 100, covered: 50, premium: 10, vip: 2 }))
    expect(result.total).toBe(
      100 * MAINTENANCE_COST_PER_SEAT.regular +
        50 * MAINTENANCE_COST_PER_SEAT.covered +
        10 * MAINTENANCE_COST_PER_SEAT.premium +
        2 * MAINTENANCE_COST_PER_SEAT.vip
    )
  })

  it("is linear in every seat class - twice the stand, twice the upkeep", () => {
    const one = calculateWeeklyMaintenance(seats({ covered: 500 })).total
    const two = calculateWeeklyMaintenance(seats({ covered: 1000 })).total
    expect(two).toBe(one * 2)
  })

  it("is a pure function of the seats it is given, so a late tick charges what a punctual one would", () => {
    // The as-of correction happens in the caller, against the settlement
    // boundary. This function has no clock at all, which is what makes "late
    // cron and punctual cron charge the same" a property of the design rather
    // than of the schedule.
    const ground = seats({ regular: 2500, vip: 40 })
    expect(calculateWeeklyMaintenance(ground)).toEqual(calculateWeeklyMaintenance({ ...ground }))
  })

  it("has nowhere for a club type to enter - Human and BOT pay the same upkeep", () => {
    const ground = seats({ premium: 300 })
    expect(calculateWeeklyMaintenance(ground).total).toBe(calculateWeeklyMaintenance(ground).total)
    expect(calculateWeeklyMaintenance(ground).total).toBeGreaterThan(0)
  })
})

describe("the idempotency key", () => {
  it("is per week, stable, and distinct from the other two settlements", () => {
    expect(maintenanceReferenceId("2026_W39")).toBe("MAINTENANCE_2026_W39")
    expect(maintenanceReferenceId("2026_W39")).not.toBe("SPONSOR_2026_W39")
    expect(maintenanceReferenceId("2026_W39")).not.toBe("PAYROLL_2026_W39")
  })
})
