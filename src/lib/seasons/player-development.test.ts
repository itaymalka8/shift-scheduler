import { SeededRandom } from "@/lib/match/engine/rng"
import { calculatePlayerOverall } from "@/lib/players/overall"
import {
  GOALKEEPER_SHARED_ATTRIBUTES,
  GOALKEEPING_ATTRIBUTES,
  OUTFIELD_ATTRIBUTES,
  type AttributeKey,
  type PlayerAttributes,
} from "@/lib/players/attributes"
import type { PlayerPosition } from "@/lib/players/positions"
import {
  developPlayer,
  developmentSeed,
  growthBandForAge,
  retirementProbability,
  retirementSeed,
  rollRetirement,
} from "./player-development"

/**
 * Every attribute a player of this position actually carries, all at the same
 * value - so the weighted average, and therefore Overall, is exactly `value`.
 * That makes "did Overall move, and by how much" readable without having to
 * work backwards through a generated attribute spread.
 */
function buildAttributes(position: PlayerPosition, value: number): PlayerAttributes {
  const keys: readonly AttributeKey[] =
    position === "GK" ? [...GOALKEEPING_ATTRIBUTES, ...GOALKEEPER_SHARED_ATTRIBUTES] : [...OUTFIELD_ATTRIBUTES]
  const attributes: PlayerAttributes = {}
  for (const key of keys) attributes[key] = value
  return attributes
}

describe("growthBandForAge", () => {
  it("maps each age to the band the design calls for", () => {
    expect(growthBandForAge(16)).toMatchObject({ minGrowth: 1, maxGrowth: 4 })
    expect(growthBandForAge(19)).toMatchObject({ minGrowth: 1, maxGrowth: 4 })
    expect(growthBandForAge(20)).toMatchObject({ minGrowth: 1, maxGrowth: 3 })
    expect(growthBandForAge(22)).toMatchObject({ minGrowth: 1, maxGrowth: 3 })
    expect(growthBandForAge(23)).toMatchObject({ minGrowth: 0, maxGrowth: 2 })
    expect(growthBandForAge(25)).toMatchObject({ minGrowth: 0, maxGrowth: 2 })
    expect(growthBandForAge(26)).toMatchObject({ minGrowth: 0, maxGrowth: 0 })
    expect(growthBandForAge(34)).toMatchObject({ minGrowth: 0, maxGrowth: 0 })
  })
})

describe("developPlayer", () => {
  // A. A 16-year-old with room to grow improves, and lands exactly on the
  // rolled target.
  it("develops a 16-year-old with high potential up to the rolled target", () => {
    const result = developPlayer(
      { age: 16, potential: 85, primaryPosition: "ST", attributes: buildAttributes("ST", 60) },
      new SeededRandom(developmentSeed("player-a", 1))
    )

    expect(result.currentOverall).toBe(60)
    expect(result.rolledGrowth).toBeGreaterThanOrEqual(1)
    expect(result.rolledGrowth).toBeLessThanOrEqual(4)
    expect(result.targetOverall).toBe(60 + result.rolledGrowth)
    expect(result.overall).toBe(result.targetOverall)
    expect(result.bumps).toBeGreaterThan(0)
  })

  // A (second half). Potential is a hard ceiling, even when the age band
  // rolls a bigger growth than the gap to it.
  it("never develops a player past their potential", () => {
    for (let season = 1; season <= 12; season++) {
      const result = developPlayer(
        { age: 16, potential: 61, primaryPosition: "ST", attributes: buildAttributes("ST", 60) },
        new SeededRandom(developmentSeed("player-capped", season))
      )
      expect(result.targetOverall).toBeLessThanOrEqual(61)
      expect(result.overall).toBeLessThanOrEqual(61)
    }
  })

  // B (development half - the aging half is covered in player-lifecycle.test).
  it("gives a 26-year-old no growth at all", () => {
    const result = developPlayer(
      { age: 26, potential: 90, primaryPosition: "CM", attributes: buildAttributes("CM", 70) },
      new SeededRandom(developmentSeed("player-b", 1))
    )

    expect(result.rolledGrowth).toBe(0)
    expect(result.bumps).toBe(0)
    expect(result.overall).toBe(70)
    expect(result.changed).toEqual({})
  })

  // C. The whole point of the design: Overall is derived, never accumulated.
  it("returns an overall that the returned attributes grade out at exactly", () => {
    for (const position of ["ST", "CB", "CM", "GK", "RW"] as PlayerPosition[]) {
      const result = developPlayer(
        { age: 17, potential: 90, primaryPosition: position, attributes: buildAttributes(position, 62) },
        new SeededRandom(developmentSeed(`player-${position}`, 3))
      )
      expect(calculatePlayerOverall({ primaryPosition: position, ...result.attributes })).toBe(result.overall)
    }
  })

  it("only ever moves attributes the position actually weights, by +1 at a time", () => {
    const before = buildAttributes("ST", 60)
    const result = developPlayer(
      { age: 16, potential: 90, primaryPosition: "ST", attributes: before },
      new SeededRandom(developmentSeed("player-weights", 1))
    )

    // The input object is never mutated.
    expect(before.finishing).toBe(60)

    for (const [key, value] of Object.entries(result.changed)) {
      expect(value).toBeGreaterThan(before[key as AttributeKey] as number)
      // Goalkeeping attributes are not weighted for a striker, so they must
      // never appear here.
      expect(GOALKEEPING_ATTRIBUTES).not.toContain(key)
    }
    // Nothing outside `changed` moved.
    for (const key of Object.keys(before) as AttributeKey[]) {
      if (key in result.changed) continue
      expect(result.attributes[key]).toBe(before[key])
    }
  })

  it("stops cleanly when every position-relevant attribute is already maxed", () => {
    const result = developPlayer(
      { age: 16, potential: 100, primaryPosition: "ST", attributes: buildAttributes("ST", 100) },
      new SeededRandom(developmentSeed("player-maxed", 1))
    )

    expect(result.currentOverall).toBe(100)
    expect(result.bumps).toBe(0)
    expect(result.overall).toBe(100)
  })

  // D. Same player, same season - always the identical result.
  it("is deterministic for the same player and season", () => {
    const run = () =>
      developPlayer(
        { age: 18, potential: 88, primaryPosition: "CAM", attributes: buildAttributes("CAM", 64) },
        new SeededRandom(developmentSeed("player-d", 7))
      )

    const first = run()
    const second = run()

    expect(second.rolledGrowth).toBe(first.rolledGrowth)
    expect(second.overall).toBe(first.overall)
    expect(second.bumps).toBe(first.bumps)
    expect(second.changed).toEqual(first.changed)
    expect(second.attributes).toEqual(first.attributes)
  })

  // E. A different season is a different draw.
  it("produces different growth across different seasons for the same player", () => {
    const rolls = new Set<number>()
    for (let season = 1; season <= 10; season++) {
      rolls.add(
        developPlayer(
          { age: 17, potential: 95, primaryPosition: "CM", attributes: buildAttributes("CM", 60) },
          new SeededRandom(developmentSeed("player-e", season))
        ).rolledGrowth
      )
    }
    expect(rolls.size).toBeGreaterThan(1)
  })
})

describe("retirement rolls", () => {
  it("uses the exact probability table the design specifies", () => {
    expect(retirementProbability(33)).toBe(0)
    expect(retirementProbability(34)).toBeCloseTo(0.08)
    expect(retirementProbability(35)).toBeCloseTo(0.15)
    expect(retirementProbability(36)).toBeCloseTo(0.25)
    expect(retirementProbability(37)).toBeCloseTo(0.4)
    expect(retirementProbability(38)).toBeCloseTo(0.65)
    expect(retirementProbability(39)).toBeCloseTo(0.85)
    expect(retirementProbability(40)).toBe(1)
    expect(retirementProbability(44)).toBe(1)
  })

  // F. 40+ is certain, regardless of the draw.
  it("always retires a player aged 40 or over", () => {
    for (let season = 1; season <= 20; season++) {
      expect(rollRetirement(40, new SeededRandom(retirementSeed("player-f", season)))).toBe(true)
      expect(rollRetirement(43, new SeededRandom(retirementSeed("player-f", season)))).toBe(true)
    }
  })

  it("never retires a player under 34", () => {
    for (let age = 16; age <= 33; age++) {
      for (let season = 1; season <= 5; season++) {
        expect(rollRetirement(age, new SeededRandom(retirementSeed("player-young", season)))).toBe(false)
      }
    }
  })

  it("is deterministic per player and season, and varies across seasons", () => {
    const first = rollRetirement(37, new SeededRandom(retirementSeed("player-r", 4)))
    const second = rollRetirement(37, new SeededRandom(retirementSeed("player-r", 4)))
    expect(second).toBe(first)

    const outcomes = new Set<boolean>()
    for (let season = 1; season <= 30; season++) {
      outcomes.add(rollRetirement(37, new SeededRandom(retirementSeed("player-r", season))))
    }
    expect(outcomes.size).toBe(2)
  })

  it("retires roughly the table's share of a large cohort", () => {
    let retiredCount = 0
    const cohort = 2000
    for (let i = 0; i < cohort; i++) {
      if (rollRetirement(36, new SeededRandom(retirementSeed(`player-${i}`, 1)))) retiredCount++
    }
    // Table says 25%; a wide band here keeps the test about "the roll is
    // actually wired to the probability" rather than about RNG minutiae.
    expect(retiredCount / cohort).toBeGreaterThan(0.2)
    expect(retiredCount / cohort).toBeLessThan(0.3)
  })
})
