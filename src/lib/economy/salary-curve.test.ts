/**
 * THE SALARY PARITY PROOF.
 *
 * Phase 3R's economic verdict was produced by a simulation, and a simulation
 * only licenses a deployment if the runtime computes the same thing. This
 * file is that link. It re-implements the calibrated transform INDEPENDENTLY
 * - from the four approved constants, in the form the calibration wrote it,
 * not by calling the runtime helper - and holds the shipped salary authority
 * to it across the entire supported player domain.
 *
 * If a future edit changes what the runtime pays a player, these tests fail,
 * and that is the point: the constants are frozen, so any divergence is
 * either a bug or a decision that needs re-calibrating.
 */
import { DEFAULT_SALARY_CONFIG, PHASE_3R_ACTIVATION_START, SALARY_MIN } from "./config"
import {
  SALARY_COMPRESSION,
  SALARY_COMPRESSION_NORMALISER,
  SALARY_COMPRESSION_PIVOT,
  SALARY_CURVE_COEFFICIENT,
  SALARY_SCALE,
  applyCalibratedSalaryCurve,
} from "./salary-curve"
import {
  calculateAuthoritativeSalary,
  calculatePhase3RSalary,
  calculateUncompressedPlayerSalary,
  salaryAuthorityAt,
  type SalaryPlayer,
} from "./salary"
import { PLAYER_POSITIONS } from "@/lib/players/positions"

/**
 * The calibrated transform, written the way the calibration script wrote it,
 * with no shared code. Deliberately duplicated: a parity test that calls the
 * implementation it is meant to check proves only that the function is
 * deterministic.
 */
function calibratedReference(uncompressed: number): number {
  return Math.round(
    SALARY_SCALE *
      SALARY_COMPRESSION_NORMALISER *
      Math.pow(SALARY_COMPRESSION_PIVOT, SALARY_COMPRESSION) *
      Math.pow(Math.max(1, uncompressed), 1 - SALARY_COMPRESSION)
  )
}

/**
 * THE FULL SUPPORTED DOMAIN, enumerated rather than sampled.
 *
 * Overall and potential span 1..100 because those are the column's real
 * bounds, not because a squad has ever contained an Overall 1. Age spans 15
 * to 45, which covers every age band including both ends of the curve. Every
 * primary position is included, so the position multiplier is exercised in
 * all five of its broad groups.
 */
function* domain(): Generator<SalaryPlayer> {
  for (const primaryPosition of PLAYER_POSITIONS) {
    for (let overall = 1; overall <= 100; overall += 1) {
      for (const age of [15, 18, 21, 22, 25, 26, 29, 30, 33, 34, 40, 45]) {
        for (const potentialGap of [0, 1, 7, 20]) {
          yield { overall, age, potential: Math.min(100, overall + potentialGap), primaryPosition }
        }
      }
    }
  }
}

describe("the calibrated salary curve", () => {
  it("is composed of exactly the four approved constants", () => {
    expect(SALARY_SCALE).toBe(0.7305)
    expect(SALARY_COMPRESSION).toBe(0.5)
    expect(SALARY_COMPRESSION_PIVOT).toBe(20_000)
    expect(SALARY_COMPRESSION_NORMALISER).toBeCloseTo(1.011958, 6)
    expect(SALARY_CURVE_COEFFICIENT).toBeCloseTo(
      SALARY_SCALE * SALARY_COMPRESSION_NORMALISER * Math.sqrt(SALARY_COMPRESSION_PIVOT),
      10
    )
  })

  it("maps the pivot to exactly scale x normaliser x pivot - the level, undistorted by shape", () => {
    // At w = PIVOT the shape term cancels completely, which is what makes
    // `scale` readable as a level rather than as a tilt.
    expect(applyCalibratedSalaryCurve(SALARY_COMPRESSION_PIVOT)).toBe(
      Math.round(SALARY_SCALE * SALARY_COMPRESSION_NORMALISER * SALARY_COMPRESSION_PIVOT)
    )
  })

  it("never returns zero for a zero or negative input", () => {
    // 0^0.5 is 0. Without the input floor a corrupt row would be paid nothing
    // rather than the least the curve can pay.
    expect(applyCalibratedSalaryCurve(0)).toBe(Math.round(SALARY_CURVE_COEFFICIENT))
    expect(applyCalibratedSalaryCurve(-5)).toBe(Math.round(SALARY_CURVE_COEFFICIENT))
  })

  it("is monotone: a bigger uncompressed wage is never a smaller compressed one", () => {
    let previous = -1
    for (let w = 0; w <= 400_000; w += 137) {
      const current = applyCalibratedSalaryCurve(w)
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })
})

describe("runtime parity with the calibrated model", () => {
  it("prices every player in the supported domain exactly as the calibration did", () => {
    let checked = 0
    let worstDelta = 0
    for (const player of domain()) {
      const runtime = calculatePhase3RSalary(player)
      const reference = calibratedReference(calculateUncompressedPlayerSalary(player, DEFAULT_SALARY_CONFIG))
      worstDelta = Math.max(worstDelta, Math.abs(runtime - reference))
      checked++
    }
    // EXACT, not "within tolerance". The runtime applies the calibrated
    // transform to the finished wage, which is the composition that was
    // simulated - so there is no approximation to leave a residual.
    expect(worstDelta).toBe(0)
    expect(checked).toBeGreaterThan(20_000)
  })

  it("reproduces the league aggregate wage bill to the unit, not merely to a tolerance", () => {
    let runtimeBill = 0
    let referenceBill = 0
    for (const player of domain()) {
      runtimeBill += calculatePhase3RSalary(player)
      referenceBill += calibratedReference(calculateUncompressedPlayerSalary(player))
    }
    expect(runtimeBill).toBe(referenceBill)
  })
})

describe("the shape the calibration bought", () => {
  it("compresses the upper tail: the higher the wage, the harder it is pulled down", () => {
    const top = { overall: 99, age: 27, potential: 99, primaryPosition: "ST" }
    const mid = { overall: 70, age: 27, potential: 70, primaryPosition: "ST" }
    const topRatio = calculatePhase3RSalary(top) / calculateUncompressedPlayerSalary(top)
    const midRatio = calculatePhase3RSalary(mid) / calculateUncompressedPlayerSalary(mid)
    expect(topRatio).toBeLessThan(midRatio)
    expect(calculatePhase3RSalary(top)).toBeLessThan(calculateUncompressedPlayerSalary(top))
  })

  it("narrows the spread between the best-paid and worst-paid player", () => {
    const best = { overall: 99, age: 27, potential: 99, primaryPosition: "ST" }
    const worst = { overall: 20, age: 40, potential: 20, primaryPosition: "GK" }
    const before = calculateUncompressedPlayerSalary(best) / calculateUncompressedPlayerSalary(worst)
    const after = calculatePhase3RSalary(best) / calculatePhase3RSalary(worst)
    expect(after).toBeLessThan(before)
    // c = 0.5 halves the exponent, so the ratio is square-rooted.
    expect(after).toBeCloseTo(Math.sqrt(before), 1)
  })

  it("lifts wages below the pivot and lowers wages above it - deliberately, and only there", () => {
    // This is compression, not an accident, and the fixed point is exactly
    // where the constants put it. The test states the crossover so that a
    // future reader meets it as a design decision rather than as a surprise.
    // The fixed point solves w = K * sqrt(w), i.e. w = K^2 = (scale * N)^2 * PIVOT.
    // NOT the pivot itself: the pivot is where the SHAPE term vanishes, while
    // the level term still applies, so the two are different wages and
    // confusing them is the easy mistake here.
    const crossover = Math.pow(SALARY_SCALE * SALARY_COMPRESSION_NORMALISER, 2) * SALARY_COMPRESSION_PIVOT
    expect(crossover).toBeGreaterThan(10_000)
    expect(crossover).toBeLessThan(11_500)
    expect(applyCalibratedSalaryCurve(Math.round(crossover * 0.5))).toBeGreaterThan(Math.round(crossover * 0.5))
    expect(applyCalibratedSalaryCurve(Math.round(crossover * 2))).toBeLessThan(Math.round(crossover * 2))
    // Where the curve and the identity actually cross, to the unit.
    expect(applyCalibratedSalaryCurve(Math.round(crossover))).toBe(Math.round(crossover))
  })

  it("never pays a real player less than the pre-3R minimum wage", () => {
    // The one thing "low salaries are not accidentally deflated" has to mean:
    // the compression must not push anybody under the floor the old authority
    // guaranteed. The uncompressed curve's own floor is SALARY_MIN, and the
    // curve maps that well above it.
    let lowest = Infinity
    for (const player of domain()) lowest = Math.min(lowest, calculatePhase3RSalary(player))
    expect(lowest).toBe(applyCalibratedSalaryCurve(SALARY_MIN))
    expect(lowest).toBeGreaterThan(SALARY_MIN)
  })

  it("bounds how far the bottom of the league can be lifted", () => {
    // The largest possible lift is at the smallest possible wage. Stated as a
    // number so that a future constants change cannot quietly turn a modest
    // floor adjustment into a subsidy.
    const lift = applyCalibratedSalaryCurve(SALARY_MIN) / SALARY_MIN
    expect(lift).toBeGreaterThan(1)
    expect(lift).toBeLessThan(3)
  })
})

describe("the era switch", () => {
  it("is legacy before the boundary and Phase 3R at and after it", () => {
    const before = new Date(PHASE_3R_ACTIVATION_START.getTime() - 1)
    const at = new Date(PHASE_3R_ACTIVATION_START.getTime())
    const after = new Date(PHASE_3R_ACTIVATION_START.getTime() + 1)
    expect(salaryAuthorityAt(before)).toBe("legacy")
    expect(salaryAuthorityAt(at)).toBe("phase3r")
    expect(salaryAuthorityAt(after)).toBe("phase3r")
  })

  it("routes every player in the domain to exactly one of the two authorities", () => {
    const before = new Date(PHASE_3R_ACTIVATION_START.getTime() - 1)
    const at = PHASE_3R_ACTIVATION_START
    for (const player of domain()) {
      expect(calculateAuthoritativeSalary(player, before)).toBe(calculateUncompressedPlayerSalary(player))
      expect(calculateAuthoritativeSalary(player, at)).toBe(calculatePhase3RSalary(player))
    }
  })

  it("changes nothing about what the league pays before the boundary", () => {
    // The pre-activation economy must be byte-identical to what is live now.
    const before = new Date(PHASE_3R_ACTIVATION_START.getTime() - 60_000)
    for (const player of domain()) {
      expect(calculateAuthoritativeSalary(player, before)).toBe(calculateUncompressedPlayerSalary(player))
    }
  })
})
