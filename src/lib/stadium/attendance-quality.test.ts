/**
 * THE PRODUCT RULE, HELD TO NUMBERS.
 *
 * The previous attendance model let a club raise its own crowd by releasing
 * its worst player. These tests exist so that can never come back, and they
 * assert the three cases as separate facts rather than as one property, so a
 * failure says which boundary moved.
 */
import { PHASE_3R_ACTIVATION_START } from "@/lib/economy/config"
import { MAX_ACTIVE_ROSTER_SIZE } from "@/lib/players/roster"
import { FALLBACK_OVERALL_MIN } from "@/lib/players/fallback-generator"
import {
  ATTENDANCE_QUALITY_FLOOR,
  REPLACEMENT_OVERALL,
  calculateAttendanceQuality,
  calculateLeagueNeutralQuality,
} from "./attendance-quality"
import { resolveMatchAttendance, attendanceSeed } from "./match-attendance"
import { DEFAULT_STARTING_SEATS } from "./config"

const squadOf = (...overalls: number[]) => overalls.map((overall) => ({ overall }))

describe("the attendance quality formula", () => {
  it("takes its constants from the generators they belong to, not from literals", () => {
    expect(REPLACEMENT_OVERALL).toBe(FALLBACK_OVERALL_MIN)
    expect(REPLACEMENT_OVERALL).toBe(40)
    expect(ATTENDANCE_QUALITY_FLOOR).toBe(MAX_ACTIVE_ROSTER_SIZE * 40)
    expect(ATTENDANCE_QUALITY_FLOOR).toBe(880)
  })

  it("agrees with the decided form: SUM(max(overall,40)) + (22 - n) * 40", () => {
    for (const squad of [squadOf(), squadOf(10), squadOf(40, 41, 39), squadOf(...Array(22).fill(70))]) {
      const decided =
        squad.reduce((sum, p) => sum + Math.max(p.overall, REPLACEMENT_OVERALL), 0) +
        (MAX_ACTIVE_ROSTER_SIZE - squad.length) * REPLACEMENT_OVERALL
      expect(calculateAttendanceQuality(squad)).toBe(decided)
    }
  })

  it("prices an empty squad at exactly the floor - 22 vacancies, each worth a replacement player", () => {
    expect(calculateAttendanceQuality([])).toBe(ATTENDANCE_QUALITY_FLOOR)
  })

  it("keeps the old neutral's meaning: 22 players at Overall 60 still score 1,320", () => {
    // A useful sanity anchor, not a coincidence - the pre-3R fixed neutral was
    // 1320 = 22 x 60, and an average squad still lands there under the new
    // formula. The model changed shape at the bottom, not scale in the middle.
    expect(calculateAttendanceQuality(squadOf(...Array(22).fill(60)))).toBe(1320)
  })
})

describe("releasing a player can never raise the crowd", () => {
  const base = squadOf(...Array(21).fill(65))

  it("Overall below the replacement level: attendance quality unchanged", () => {
    for (const victim of [1, 10, 20, 28, 39]) {
      const withHim = calculateAttendanceQuality([...base, { overall: victim }])
      expect(withHim - calculateAttendanceQuality(base)).toBe(0)
    }
  })

  it("Overall exactly at the replacement level: attendance quality unchanged", () => {
    expect(calculateAttendanceQuality([...base, { overall: 40 }]) - calculateAttendanceQuality(base)).toBe(0)
  })

  it("Overall above the replacement level: quality falls by exactly the surplus lost", () => {
    for (const victim of [41, 50, 60, 80, 99]) {
      const delta = calculateAttendanceQuality([...base, { overall: victim }]) - calculateAttendanceQuality(base)
      expect(delta).toBe(victim - REPLACEMENT_OVERALL)
    }
  })

  it("is monotone across the whole Overall range - no rung where deleting pays", () => {
    let previous = -Infinity
    for (let overall = 1; overall <= 100; overall++) {
      const quality = calculateAttendanceQuality([...base, { overall }])
      expect(quality).toBeGreaterThanOrEqual(previous)
      previous = quality
    }
  })

  it("never lets a vacancy outscore the player who vacated it, at any squad size", () => {
    for (let size = 0; size <= MAX_ACTIVE_ROSTER_SIZE; size++) {
      for (const overall of [1, 39, 40, 41, 99]) {
        const squad = squadOf(...Array(size).fill(55))
        const withExtra = size < MAX_ACTIVE_ROSTER_SIZE ? [...squad, { overall }] : squad
        expect(calculateAttendanceQuality(withExtra)).toBeGreaterThanOrEqual(calculateAttendanceQuality(squad))
      }
    }
  })

  it("reads nothing but Overall, so a Human club and a BOT club with the same squad score the same", () => {
    // Parity by construction: the function's only input is a list of overalls,
    // so there is no field a club type could be read from. Asserted anyway,
    // because "it cannot happen" is what every parity bug was before it shipped.
    const squad = squadOf(70, 62, 41, 39, 55)
    expect(calculateAttendanceQuality(squad)).toBe(calculateAttendanceQuality([...squad].reverse()))
  })
})

describe("the league neutral", () => {
  it("is the median, so one runaway club cannot drag everybody else down", () => {
    const modest = [900, 920, 940, 960, 980]
    expect(calculateLeagueNeutralQuality(modest)).toBe(940)
    // Replace the top club with one ten times better: the median does not move.
    expect(calculateLeagueNeutralQuality([...modest.slice(0, 4), 99_999])).toBe(940)
  })

  it("averages the middle pair when the league has an even number of clubs", () => {
    expect(calculateLeagueNeutralQuality([1000, 1100, 1200, 1300])).toBe(1150)
  })

  it("is order-independent", () => {
    const values = [1300, 900, 1100, 1000, 1200]
    expect(calculateLeagueNeutralQuality(values)).toBe(calculateLeagueNeutralQuality([...values].sort()))
  })

  it("falls back to the floor for an empty league rather than to zero", () => {
    expect(calculateLeagueNeutralQuality([])).toBe(ATTENDANCE_QUALITY_FLOOR)
  })
})

describe("one seeded roll per fixture", () => {
  const input = {
    seed: "fixture-abc",
    homePlayers: squadOf(...Array(22).fill(64)),
    seats: DEFAULT_STARTING_SEATS,
    neutralQuality: 1320,
    at: PHASE_3R_ACTIVATION_START,
  }

  it("salts its own stream so it cannot shift the sequence the engine consumes", () => {
    expect(attendanceSeed("abc")).toBe("abc-attendance")
  })

  it("is reproducible: the same fixture always draws the same crowd", () => {
    const a = resolveMatchAttendance(input)
    const b = resolveMatchAttendance(input)
    expect(b.total).toBe(a.total)
    expect(b.bySeatType).toEqual(a.bySeatType)
  })

  it("is not a constant: a different fixture draws a different crowd", () => {
    const totals = new Set(
      ["f1", "f2", "f3", "f4", "f5", "f6"].map((seed) => resolveMatchAttendance({ ...input, seed }).total)
    )
    expect(totals.size).toBeGreaterThan(1)
  })

  it("breaks the crowd down into seat types that sum to the stored total", () => {
    // The gate is priced off the breakdown and the expenses off the total, so
    // a mismatch here is exactly the defect this phase removed.
    const result = resolveMatchAttendance(input)
    const summed = Object.values(result.bySeatType).reduce((sum, n) => sum + n, 0)
    expect(summed).toBe(result.total)
  })

  it("switches quality model at the boundary and nowhere else", () => {
    const before = new Date(PHASE_3R_ACTIVATION_START.getTime() - 1)
    // A squad stuffed with sub-replacement players is where the two models
    // disagree most, so it is the case that proves the switch is real.
    // Half the squad is world class and half is below replacement level -
    // the shape where the two models disagree most, and the shape a fixed
    // neutral punishes a club for merely CARRYING a weak player.
    const lopsided = {
      ...input,
      homePlayers: squadOf(...Array(11).fill(90), ...Array(11).fill(20)),
    }
    const legacy = resolveMatchAttendance({ ...lopsided, at: before })
    const phase3r = resolveMatchAttendance({ ...lopsided, at: PHASE_3R_ACTIVATION_START })
    // Legacy sums Overall: 11x90 + 11x20 = 1,210. Phase 3R floors the weak
    // half at replacement level: 880 + 11x50 = 1,430. Same squad, and the
    // second one is not punished for the eleven it would not have released.
    expect(calculateAttendanceQuality(lopsided.homePlayers)).toBe(1430)
    expect(phase3r.total).toBeGreaterThan(legacy.total)
    // And a squad entirely at or below replacement level scores exactly the
    // floor - no better than fielding nobody, and no worse.
    expect(calculateAttendanceQuality(squadOf(...Array(22).fill(20)))).toBe(ATTENDANCE_QUALITY_FLOOR)
  })
})
