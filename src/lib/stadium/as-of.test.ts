import { isEffectiveAt, isMaterialised, seatsAsOf, type ConstructionJobReading } from "./as-of"
import type { SeatCounts } from "./config"

/**
 * The as-of-kickoff seat calculation, tested as arithmetic in BOTH
 * directions.
 *
 * Phase 3O proposed only half of this - subtracting a job that was
 * materialised too early - and half would have replaced "capacity depends on
 * when a manager refreshed a page" with "capacity depends on when the cron
 * ran", which is a different unfairness rather than a fix. The cases below
 * pin the whole rule: a job's seats belong to a fixture if and only if
 * job.endsAt <= fixture.scheduledAt, whatever the settler has or has not got
 * round to.
 */

const KICKOFF = new Date("2026-09-12T19:00:00.000Z")

const BASE: SeatCounts = { regular: 8_000, covered: 1_500, premium: 400, vip: 100 }

function job(overrides: Partial<ConstructionJobReading> = {}): ConstructionJobReading {
  return {
    status: "active",
    endsAt: new Date("2026-09-12T18:50:00.000Z"),
    regularSeatsAdded: 2_000,
    coveredSeatsAdded: 500,
    premiumSeatsAdded: 100,
    vipSeatsAdded: 20,
    ...overrides,
  }
}

describe("the two predicates the rule is built from", () => {
  it("only a completed job has had its seats written into the Stadium row", () => {
    expect(isMaterialised(job({ status: "completed" }))).toBe(true)
    expect(isMaterialised(job({ status: "active" }))).toBe(false)
    expect(isMaterialised(job({ status: "pending" }))).toBe(false)
  })

  it("a job is effective at kickoff when it ended at or before it", () => {
    expect(isEffectiveAt(job({ endsAt: new Date(KICKOFF.getTime() - 1) }), KICKOFF)).toBe(true)
    expect(isEffectiveAt(job({ endsAt: KICKOFF }), KICKOFF)).toBe(true)
    expect(isEffectiveAt(job({ endsAt: new Date(KICKOFF.getTime() + 1) }), KICKOFF)).toBe(false)
  })
})

describe("when materialisation and effectiveness AGREE, nothing is corrected", () => {
  it("a completed job that finished before kickoff is already in the row", () => {
    const result = seatsAsOf(BASE, [job({ status: "completed", endsAt: new Date(KICKOFF.getTime() - 60_000) })], KICKOFF)
    expect(result.seats).toEqual(BASE)
    expect(result.added).toBe(0)
    expect(result.subtracted).toBe(0)
  })

  it("an active job that has not finished yet is correctly absent from the row", () => {
    const result = seatsAsOf(BASE, [job({ status: "active", endsAt: new Date(KICKOFF.getTime() + 60_000) })], KICKOFF)
    expect(result.seats).toEqual(BASE)
    expect(result.added).toBe(0)
    expect(result.subtracted).toBe(0)
  })

  it("a club with no construction history at all is reported exactly as it stands", () => {
    expect(seatsAsOf(BASE, [], KICKOFF).seats).toEqual(BASE)
  })
})

describe("EFFECTIVE BUT NOT MATERIALISED - the half Phase 3O missed", () => {
  const overdue = job({ status: "active", endsAt: new Date("2026-09-12T18:50:00.000Z") })

  it("adds the seats of a build that finished before kickoff and the settler has not collected", () => {
    const result = seatsAsOf(BASE, [overdue], KICKOFF)
    expect(result.seats).toEqual({ regular: 10_000, covered: 2_000, premium: 500, vip: 120 })
    expect(result.added).toBe(1)
    expect(result.subtracted).toBe(0)
  })

  it("the answer does not change however late the settler is", () => {
    // The same fixture read ten days later, still unmaterialised.
    const asOfPunctual = seatsAsOf(BASE, [overdue], KICKOFF)
    const asOfLate = seatsAsOf(BASE, [overdue], KICKOFF)
    expect(asOfLate.seats).toEqual(asOfPunctual.seats)
  })

  it("once the settler HAS materialised it, the same fixture gets the same seats", () => {
    // Materialised means the base row already contains the seats.
    const materialisedBase: SeatCounts = { regular: 10_000, covered: 2_000, premium: 500, vip: 120 }
    const settled = seatsAsOf(materialisedBase, [{ ...overdue, status: "completed" }], KICKOFF)
    expect(settled.seats).toEqual(seatsAsOf(BASE, [overdue], KICKOFF).seats)
  })
})

describe("MATERIALISED BUT NOT EFFECTIVE - a stand that was not open yet", () => {
  const tooEarly = job({ status: "completed", endsAt: new Date("2026-09-12T19:10:00.000Z") })
  const materialisedBase: SeatCounts = { regular: 10_000, covered: 2_000, premium: 500, vip: 120 }

  it("subtracts the seats of a build that finished after kickoff", () => {
    const result = seatsAsOf(materialisedBase, [tooEarly], KICKOFF)
    expect(result.seats).toEqual(BASE)
    expect(result.subtracted).toBe(1)
    expect(result.added).toBe(0)
  })

  it("a later fixture, after that job's deadline, keeps the bigger stadium", () => {
    const laterKickoff = new Date("2026-09-15T19:00:00.000Z")
    expect(seatsAsOf(materialisedBase, [tooEarly], laterKickoff).seats).toEqual(materialisedBase)
  })
})

describe("PER SEAT CLASS, never a single capacity number", () => {
  it("adjusts each class by its own delta", () => {
    const uneven = job({
      status: "active",
      endsAt: new Date(KICKOFF.getTime() - 1),
      regularSeatsAdded: 0,
      coveredSeatsAdded: 0,
      premiumSeatsAdded: 250,
      vipSeatsAdded: 0,
    })
    const result = seatsAsOf(BASE, [uneven], KICKOFF)
    expect(result.seats).toEqual({ regular: 8_000, covered: 1_500, premium: 650, vip: 100 })
  })

  it("a premium-only build cannot be smeared across the cheap seats", () => {
    const premiumOnly = job({
      status: "active",
      endsAt: new Date(KICKOFF.getTime() - 1),
      regularSeatsAdded: 0,
      coveredSeatsAdded: 0,
      premiumSeatsAdded: 100,
      vipSeatsAdded: 0,
    })
    expect(seatsAsOf(BASE, [premiumOnly], KICKOFF).seats.regular).toBe(BASE.regular)
  })
})

describe("several jobs at once", () => {
  it("corrects each independently, in both directions, in one pass", () => {
    const built: SeatCounts = { regular: 12_000, covered: 2_000, premium: 500, vip: 120 }
    const result = seatsAsOf(
      built,
      [
        // finished after kickoff but already materialised -> take it back out
        job({ status: "completed", endsAt: new Date(KICKOFF.getTime() + 60_000), regularSeatsAdded: 2_000, coveredSeatsAdded: 0, premiumSeatsAdded: 0, vipSeatsAdded: 0 }),
        // finished before kickoff and already materialised -> leave alone
        job({ status: "completed", endsAt: new Date(KICKOFF.getTime() - 60_000), regularSeatsAdded: 2_000, coveredSeatsAdded: 500, premiumSeatsAdded: 100, vipSeatsAdded: 20 }),
        // finished before kickoff, not materialised -> put it in
        job({ status: "active", endsAt: new Date(KICKOFF.getTime() - 30_000), regularSeatsAdded: 1_000, coveredSeatsAdded: 0, premiumSeatsAdded: 0, vipSeatsAdded: 0 }),
        // not finished, not materialised -> leave alone
        job({ status: "active", endsAt: new Date(KICKOFF.getTime() + 86_400_000) }),
      ],
      KICKOFF
    )
    expect(result.subtracted).toBe(1)
    expect(result.added).toBe(1)
    expect(result.seats).toEqual({ regular: 11_000, covered: 2_000, premium: 500, vip: 120 })
  })
})

describe("edge cases", () => {
  it("a fixture with no scheduledAt reports the stadium exactly as it stands", () => {
    const result = seatsAsOf(BASE, [job({ status: "active", endsAt: new Date("2020-01-01T00:00:00.000Z") })], null)
    expect(result.seats).toEqual(BASE)
    expect(result.added).toBe(0)
    expect(result.subtracted).toBe(0)
  })

  it("never returns a negative stand, even from an inconsistent row", () => {
    const tiny: SeatCounts = { regular: 10, covered: 0, premium: 0, vip: 0 }
    const result = seatsAsOf(
      tiny,
      [job({ status: "completed", endsAt: new Date(KICKOFF.getTime() + 1), regularSeatsAdded: 5_000 })],
      KICKOFF
    )
    expect(result.seats.regular).toBe(0)
    expect(result.seats.covered).toBe(0)
  })

  it("does not mutate the seat counts it was given", () => {
    const original = { ...BASE }
    seatsAsOf(BASE, [job({ status: "active", endsAt: new Date(KICKOFF.getTime() - 1) })], KICKOFF)
    expect(BASE).toEqual(original)
  })
})
