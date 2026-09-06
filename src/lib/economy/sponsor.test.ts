import { SPONSOR_COEFFICIENT, SPONSOR_TIER_MULTIPLIER } from "./config"
import { calculateSponsorIncome, sponsorReferenceId, type SponsorClub } from "./sponsor"

const league = (payrolls: number[], tiers: (number | null)[] = []): SponsorClub[] =>
  payrolls.map((weeklyPayroll, i) => ({ teamId: `club-${i}`, weeklyPayroll, tier: tiers[i] ?? 2 }))

describe("the approved sponsor constants", () => {
  it("are the calibrated ones", () => {
    expect(SPONSOR_COEFFICIENT).toBe(0.06)
    expect(SPONSOR_TIER_MULTIPLIER[1]).toBe(1.25)
    expect(SPONSOR_TIER_MULTIPLIER[2]).toBe(1.0)
  })
})

describe("a club's own payroll never determines its own sponsor", () => {
  it("does not pay a club more for spending more", () => {
    // Same league, one club's wage bill tripled. It sits above the median, so
    // the median does not move and its award is IDENTICAL - this is the rule
    // the whole design exists to enforce.
    const before = calculateSponsorIncome(league([100, 200, 300, 400, 500]))
    const after = calculateSponsorIncome(league([100, 200, 300, 400, 1500]))
    expect(after.medianWeeklyPayroll).toBe(before.medianWeeklyPayroll)
    expect(after.awards[4].amount).toBe(before.awards[4].amount)
  })

  it("pays every club in a tier exactly the same, however differently they spend", () => {
    const calculation = calculateSponsorIncome(league([1, 50_000, 300_000, 900_000, 5_000_000]))
    const amounts = new Set(calculation.awards.map((award) => award.amount))
    expect(amounts.size).toBe(1)
  })

  it("uses the median, so one runaway wage bill cannot hand the league a windfall", () => {
    const modest = calculateSponsorIncome(league([100, 200, 300, 400, 500]))
    const withRunaway = calculateSponsorIncome(league([100, 200, 300, 400, 99_999_999]))
    expect(withRunaway.medianWeeklyPayroll).toBe(modest.medianWeeklyPayroll)
    const total = (c: ReturnType<typeof calculateSponsorIncome>) =>
      c.awards.reduce((sum, a) => sum + a.amount, 0)
    expect(total(withRunaway)).toBe(total(modest))
  })

  it("derives the base from the coefficient and the median, and says so in the result", () => {
    const calculation = calculateSponsorIncome(league([100_000, 200_000, 300_000]))
    expect(calculation.medianWeeklyPayroll).toBe(200_000)
    expect(calculation.base).toBeCloseTo(0.06 * 200_000, 6)
  })
})

describe("tier decides distribution, never level", () => {
  it("pays a tier 1 club exactly 1.25 times a tier 2 club", () => {
    // League-scale payrolls, not toy ones: the ratio is exact before the final
    // rounding to whole currency units, so a four-unit award would be testing
    // Math.round rather than the multiplier.
    const calculation = calculateSponsorIncome(league(Array(4).fill(300_000), [1, 2, 2, 2]))
    expect(calculation.awards[0].amount / calculation.awards[1].amount).toBeCloseTo(1.25, 4)
  })

  it("keeps the league-wide total the same however the tiers are distributed", () => {
    // Promoting clubs into tier 1 must REDISTRIBUTE income, not create it -
    // otherwise a league-structure change silently moves the calibrated level.
    const total = (tiers: number[]) =>
      calculateSponsorIncome(league(Array(20).fill(100_000), tiers)).awards.reduce((s, a) => s + a.amount, 0)
    const allSecond = total(Array(20).fill(2))
    const halfFirst = total([...Array(10).fill(1), ...Array(10).fill(2)])
    const allFirst = total(Array(20).fill(1))
    expect(halfFirst).toBeCloseTo(allSecond, -1)
    expect(allFirst).toBeCloseTo(allSecond, -1)
  })

  it("normalises by the league mean multiplier, and reports it", () => {
    const calculation = calculateSponsorIncome(league([100, 100, 100, 100], [1, 1, 2, 2]))
    expect(calculation.meanTierMultiplier).toBeCloseTo((1.25 + 1.25 + 1 + 1) / 4, 10)
  })

  it("prices a club with no season membership at the ENTRY tier, not the top one", () => {
    // "Not yet placed" must never be the most valuable state in the game.
    const calculation = calculateSponsorIncome(league([100, 100], [null, 1]))
    expect(calculation.awards[0].tier).toBe(2)
    expect(calculation.awards[0].amount).toBeLessThan(calculation.awards[1].amount)
  })

  it("falls back to the entry multiplier for a tier that has no configured weight", () => {
    // A future third tier must not crash a settlement or pay an accidental zero.
    const calculation = calculateSponsorIncome(league([100, 100], [3, 2]))
    expect(calculation.awards[0].amount).toBe(calculation.awards[1].amount)
  })
})

describe("Human and BOT parity", () => {
  it("has nowhere for a club type to enter the calculation", () => {
    // Structural: SponsorClub carries teamId, payroll and tier and nothing
    // else, so there is no field a manager flag could be read from. Two clubs
    // identical in those three respects are identical in their award.
    const calculation = calculateSponsorIncome([
      { teamId: "human", weeklyPayroll: 250_000, tier: 1 },
      { teamId: "bot", weeklyPayroll: 250_000, tier: 1 },
    ])
    expect(calculation.awards[0].amount).toBe(calculation.awards[1].amount)
  })
})

describe("degenerate leagues", () => {
  it("pays nothing, and does not divide by zero, in an empty league", () => {
    const calculation = calculateSponsorIncome([])
    expect(calculation.awards).toEqual([])
    expect(calculation.base).toBe(0)
  })

  it("pays nothing when the whole league's wage bill is zero", () => {
    const calculation = calculateSponsorIncome(league([0, 0, 0]))
    expect(calculation.awards.every((award) => award.amount === 0)).toBe(true)
  })
})

describe("the idempotency key", () => {
  it("is per week and stable", () => {
    expect(sponsorReferenceId("2026_W39")).toBe("SPONSOR_2026_W39")
    // Distinct from payroll's and maintenance's, so the three settlements of
    // one week cannot collide on the (teamId, referenceId) unique constraint.
    expect(sponsorReferenceId("2026_W39")).not.toBe("PAYROLL_2026_W39")
  })
})
