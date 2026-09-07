/**
 * The continuity fallback: deterministic, deliberately weak, and drawn from
 * the squad's own position shape rather than a second distribution.
 */
import { YOUTH_POSITION_WEIGHTS } from "@/lib/youth/config"
import { calculatePositionOverall } from "./overall"
import { POSITION_GROUP } from "./positions"
import {
  FALLBACK_AGE_MAX,
  FALLBACK_AGE_MIN,
  FALLBACK_OVERALL_MAX,
  FALLBACK_OVERALL_MIN,
  FALLBACK_POTENTIAL_GAP_MAX,
  fallbackSeed,
  generateFallbackPlayer,
  positionWeightsForGroup,
} from "./fallback-generator"
import { ROSTER_GROUPS } from "./roster-floor"

const make = (over: Partial<Parameters<typeof generateFallbackPlayer>[0]> = {}) =>
  generateFallbackPlayer({ seasonId: "s1", teamId: "t1", slotIndex: 0, group: "MF", ...over })

describe("DETERMINISM: the same seed is the same footballer", () => {
  it("re-running produces identical football facts", () => {
    for (const group of ROSTER_GROUPS) {
      for (let slotIndex = 0; slotIndex < 4; slotIndex++) {
        const a = make({ group, slotIndex })
        const b = make({ group, slotIndex })
        expect(a).toEqual(b)
      }
    }
  })

  it("a different club, season or slot is a different footballer", () => {
    const base = make()
    expect(make({ teamId: "t2" })).not.toEqual(base)
    expect(make({ seasonId: "s2" })).not.toEqual(base)
    expect(make({ slotIndex: 1 })).not.toEqual(base)
  })

  it("the seed is a stable, namespaced identity", () => {
    expect(fallbackSeed({ seasonId: "s1", teamId: "t1", slotIndex: 3 })).toBe("replenishment:s1:t1:3")
  })

  it("nothing in the module reaches for Math.random", () => {
    const spy = jest.spyOn(Math, "random")
    try {
      for (const group of ROSTER_GROUPS) make({ group, slotIndex: 7 })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe("DELIBERATELY WEAK: the anti-exploit band", () => {
  it("Overall stays inside 40-52 across many draws", () => {
    for (let slotIndex = 0; slotIndex < 200; slotIndex++) {
      const player = make({ slotIndex, group: ROSTER_GROUPS[slotIndex % ROSTER_GROUPS.length] })
      expect(player.overall).toBeGreaterThanOrEqual(FALLBACK_OVERALL_MIN)
      expect(player.overall).toBeLessThanOrEqual(FALLBACK_OVERALL_MAX)
    }
  })

  it("potential never exceeds overall by more than two - there is no career here", () => {
    for (let slotIndex = 0; slotIndex < 200; slotIndex++) {
      const player = make({ slotIndex })
      expect(player.potential).toBeGreaterThanOrEqual(player.overall)
      expect(player.potential - player.overall).toBeLessThanOrEqual(FALLBACK_POTENTIAL_GAP_MAX)
    }
  })

  it("age is prime-but-finished: never young enough to grow, never old enough to retire soon", () => {
    for (let slotIndex = 0; slotIndex < 100; slotIndex++) {
      const player = make({ slotIndex })
      expect(player.age).toBeGreaterThanOrEqual(FALLBACK_AGE_MIN)
      expect(player.age).toBeLessThanOrEqual(FALLBACK_AGE_MAX)
      // Retirement starts at 34; nobody generated here reaches it next season.
      expect(player.age).toBeLessThan(33)
    }
  })

  it("Overall is DERIVED from the attributes, never written independently", () => {
    for (let slotIndex = 0; slotIndex < 40; slotIndex++) {
      const player = make({ slotIndex, group: ROSTER_GROUPS[slotIndex % ROSTER_GROUPS.length] })
      expect(calculatePositionOverall(player, player.primaryPosition)).toBe(player.overall)
    }
  })

  it("is worth a fraction of a real squad player", () => {
    // A generated squad averages Overall 60 across 22 players; these are the
    // bottom of the game and the market value curve says so.
    const values = Array.from({ length: 30 }, (_, slotIndex) => make({ slotIndex }).marketValue)
    for (const value of values) expect(value).toBeLessThan(1_000_000)
  })
})

describe("POSITIONS: one shape, reused - not a second distribution", () => {
  it("a generated player lands in the group he was asked for", () => {
    for (const group of ROSTER_GROUPS) {
      for (let slotIndex = 0; slotIndex < 25; slotIndex++) {
        const player = make({ group, slotIndex })
        expect(POSITION_GROUP[player.primaryPosition]).toBe(group)
      }
    }
  })

  it("the within-group weights are the academy's own, restricted to that group", () => {
    // Proof that no new granular distribution was invented: this table and
    // YOUTH_POSITION_WEIGHTS are derived from the same squad composition.
    for (const group of ROSTER_GROUPS) {
      const mine = positionWeightsForGroup(group)
      const youth = YOUTH_POSITION_WEIGHTS.filter((entry) => POSITION_GROUP[entry.position] === group)
      expect(mine).toEqual(youth)
    }
  })

  it("secondary positions come from the canonical pool, and a keeper has none", () => {
    for (let slotIndex = 0; slotIndex < 30; slotIndex++) {
      const keeper = make({ group: "GK", slotIndex })
      expect(keeper.primaryPosition).toBe("GK")
      expect(keeper.secondaryPositions).toEqual([])
    }
    const outfielder = make({ group: "FW", slotIndex: 3 })
    expect(outfielder.secondaryPositions.length).toBeGreaterThan(0)
    expect(outfielder.secondaryPositions).not.toContain(outfielder.primaryPosition)
  })
})

describe("the rest of the row is the canonical policy", () => {
  it("is Israeli, fit, available and carries a real wage", () => {
    const player = make()
    expect(player.nationality).toBe("IL")
    expect(player.fitness).toBe(100)
    expect(player.status).toBe("available")
    expect(player.weeklySalary).toBeGreaterThan(0)
    expect(player.firstName.length).toBeGreaterThan(0)
    expect(player.lastName.length).toBeGreaterThan(0)
  })
})
