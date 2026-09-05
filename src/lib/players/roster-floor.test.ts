/**
 * The roster floor, tested as arithmetic.
 *
 * Every case in Phase 3M.1's matrix is here, plus the properties the whole
 * design rests on: max-not-sum, minimality, the four-group partition, and
 * the fact that no depth addition is ever a goalkeeper.
 */
import { MAX_ACTIVE_ROSTER_SIZE } from "./roster"
import { PLAYER_POSITIONS } from "./positions"
import {
  DEPTH_CYCLE,
  EMPTY_ROSTER_COUNTS,
  GROUP_MINIMUM,
  MIN_ACTIVE_ROSTER,
  ROSTER_GROUPS,
  UnknownPlayerPositionError,
  assertPositionPartition,
  countAdditions,
  countRoster,
  countsAfterAdditions,
  countsAfterDeparture,
  failedConstraints,
  isResolvableWithinCap,
  meetsRosterFloor,
  planAdditions,
  positionalAdditions,
  requiredAdditions,
  rosterGroupOf,
  type RosterCounts,
} from "./roster-floor"

const counts = (over: Partial<RosterCounts>): RosterCounts => {
  const merged = { ...EMPTY_ROSTER_COUNTS, ...over }
  return { ...merged, total: merged.GK + merged.DF + merged.MF + merged.FW }
}

describe("the four groups partition the twelve positions", () => {
  it("every canonical position belongs to exactly one roster group", () => {
    expect(() => assertPositionPartition()).not.toThrow()
    expect(PLAYER_POSITIONS).toHaveLength(12)
    for (const position of PLAYER_POSITIONS) {
      expect(ROSTER_GROUPS).toContain(rosterGroupOf(position))
    }
  })

  it("a position outside the canonical set FAILS LOUDLY rather than being dropped", () => {
    // Player.primaryPosition is a String column, so this is reachable at
    // runtime. Silently ignoring it would let a club pass a coverage floor it
    // does not meet.
    expect(() => rosterGroupOf("SWEEPER")).toThrow(UnknownPlayerPositionError)
    expect(() => countRoster([{ primaryPosition: "SWEEPER" }])).toThrow(UnknownPlayerPositionError)
  })

  it("gk + def + mid + att is an identity, not an assumption", () => {
    const squad = PLAYER_POSITIONS.map((primaryPosition) => ({ primaryPosition }))
    const c = countRoster(squad)
    expect(c.GK + c.DF + c.MF + c.FW).toBe(c.total)
    expect(c.total).toBe(12)
  })

  it("the floors are the documented ones", () => {
    expect(MIN_ACTIVE_ROSTER).toBe(16)
    expect(GROUP_MINIMUM).toEqual({ GK: 2, DF: 4, MF: 4, FW: 2 })
    expect(MAX_ACTIVE_ROSTER_SIZE).toBe(22)
  })
})

describe("requiredAdditions is MAX, never SUM", () => {
  it("16 players with no goalkeeper needs 2, finishing at 18", () => {
    const c = counts({ GK: 0, DF: 6, MF: 6, FW: 4 })
    expect(c.total).toBe(16)
    expect(countAdditions(c)).toBe(0)
    expect(positionalAdditions(c)).toBe(2)
    expect(requiredAdditions(c)).toBe(2)
    expect(countsAfterAdditions(c, planAdditions(c)).total).toBe(18)
  })

  it("10 midfielders needs 8, finishing at 18", () => {
    const c = counts({ MF: 10 })
    expect(positionalAdditions(c)).toBe(2 + 4 + 0 + 2)
    expect(countAdditions(c)).toBe(6)
    expect(requiredAdditions(c)).toBe(8)
    expect(countsAfterAdditions(c, planAdditions(c)).total).toBe(18)
  })

  it("12 with perfect coverage needs 4 of pure depth, finishing at 16", () => {
    const c = counts({ GK: 2, DF: 4, MF: 4, FW: 2 })
    expect(positionalAdditions(c)).toBe(0)
    expect(countAdditions(c)).toBe(4)
    expect(requiredAdditions(c)).toBe(4)
    expect(countsAfterAdditions(c, planAdditions(c)).total).toBe(16)
  })

  it("13 with only one goalkeeper needs 3, and the FIRST is the goalkeeper", () => {
    const c = counts({ GK: 1, DF: 5, MF: 5, FW: 2 })
    expect(requiredAdditions(c)).toBe(3)
    const plan = planAdditions(c)
    expect(plan[0]).toBe("GK")
    expect(plan.filter((g) => g === "GK")).toHaveLength(1)
    expect(countsAfterAdditions(c, plan)).toMatchObject({ total: 16, GK: 2 })
  })

  it("22 with coverage needs nothing", () => {
    const c = counts({ GK: 2, DF: 8, MF: 8, FW: 4 })
    expect(c.total).toBe(22)
    expect(requiredAdditions(c)).toBe(0)
    expect(planAdditions(c)).toEqual([])
    expect(meetsRosterFloor(c)).toBe(true)
  })

  it("exactly 16 and fully valid needs nothing", () => {
    const c = counts({ GK: 2, DF: 5, MF: 6, FW: 3 })
    expect(c.total).toBe(16)
    expect(requiredAdditions(c)).toBe(0)
  })

  it("15 fully covered needs exactly one depth player", () => {
    const c = counts({ GK: 2, DF: 5, MF: 5, FW: 3 })
    expect(c.total).toBe(15)
    expect(requiredAdditions(c)).toBe(1)
    expect(planAdditions(c)).toEqual(["DF"])
  })

  it("20 with no goalkeeper needs 2, landing exactly on the cap", () => {
    const c = counts({ GK: 0, DF: 8, MF: 8, FW: 4 })
    expect(c.total).toBe(20)
    expect(requiredAdditions(c)).toBe(2)
    expect(isResolvableWithinCap(c)).toBe(true)
    expect(countsAfterAdditions(c, planAdditions(c)).total).toBe(22)
  })

  it("summing instead of maxing would over-generate - the bug this guards", () => {
    const c = counts({ GK: 1, DF: 5, MF: 5, FW: 2 })
    expect(positionalAdditions(c) + countAdditions(c)).toBe(4)
    expect(requiredAdditions(c)).toBe(3)
  })

  it("is minimal: one fewer addition can never satisfy the invariant", () => {
    const cases: RosterCounts[] = [
      counts({ GK: 0, DF: 6, MF: 6, FW: 4 }),
      counts({ MF: 10 }),
      counts({ GK: 2, DF: 4, MF: 4, FW: 2 }),
      counts({ GK: 1, DF: 5, MF: 5, FW: 2 }),
      counts({ GK: 0, DF: 8, MF: 8, FW: 4 }),
      counts({ GK: 3, DF: 1, MF: 1, FW: 0 }),
    ]
    for (const c of cases) {
      const k = requiredAdditions(c)
      expect(meetsRosterFloor(countsAfterAdditions(c, planAdditions(c)))).toBe(true)
      if (k === 0) continue
      // Any distribution of k-1 additions leaves something unmet: either the
      // group deficits cannot all be covered, or the total cannot reach 16.
      const deficitSum = positionalAdditions(c)
      expect(Math.max(deficitSum, MIN_ACTIVE_ROSTER - c.total)).toBe(k)
      expect(k - 1 < deficitSum || c.total + k - 1 < MIN_ACTIVE_ROSTER).toBe(true)
    }
  })
})

describe("the pathological state is detected, not papered over", () => {
  it("22 players with no goalkeeper is unresolvable within the cap", () => {
    const c = counts({ GK: 0, DF: 8, MF: 8, FW: 6 })
    expect(c.total).toBe(22)
    expect(requiredAdditions(c)).toBe(2)
    expect(isResolvableWithinCap(c)).toBe(false)
  })

  it("22 attackers is unresolvable by a wide margin", () => {
    const c = counts({ FW: 22 })
    expect(requiredAdditions(c)).toBe(2 + 4 + 4)
    expect(isResolvableWithinCap(c)).toBe(false)
  })

  it("a retirement can never make a valid club unresolvable", () => {
    // Each retirement that creates a deficit also frees the slot to fill it.
    const start = counts({ GK: 2, DF: 8, MF: 8, FW: 4 })
    let current = start
    for (const position of ["GK", "GK", "CB", "ST", "CM", "RB"]) {
      current = countsAfterDeparture(current, position)
      expect(isResolvableWithinCap(current)).toBe(true)
      expect(current.total + requiredAdditions(current)).toBeLessThanOrEqual(MAX_ACTIVE_ROSTER_SIZE)
    }
  })
})

describe("the plan is deterministic and never invents a third goalkeeper", () => {
  it("deficits come first, goalkeepers before everything", () => {
    const c = counts({ GK: 0, DF: 0, MF: 0, FW: 0 })
    expect(planAdditions(c)).toEqual([
      "GK", "GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "MF", "FW", "FW",
      // then depth, cycling DF MF DF MF FW, to reach 16
      "DF", "MF", "DF", "MF",
    ])
  })

  it("depth never adds a goalkeeper", () => {
    for (let missing = 1; missing <= 10; missing++) {
      const c = counts({ GK: 2, DF: 4, MF: 4, FW: 2 + (10 - missing) })
      const plan = planAdditions(c)
      const depth = plan.slice(positionalAdditions(c))
      expect(depth).not.toContain("GK")
    }
    expect(DEPTH_CYCLE).not.toContain("GK")
  })

  it("the same roster always produces the same plan", () => {
    const c = counts({ GK: 1, DF: 2, MF: 3, FW: 1 })
    expect(planAdditions(c)).toEqual(planAdditions(c))
  })
})

describe("failedConstraints speaks the product's vocabulary", () => {
  it("names every breached floor, in a stable order", () => {
    expect(failedConstraints(counts({ GK: 0, DF: 1, MF: 1, FW: 0 }))).toEqual(["TOTAL", "GK", "DEF", "MID", "ATT"])
    expect(failedConstraints(counts({ GK: 1, DF: 8, MF: 8, FW: 4 }))).toEqual(["GK"])
    expect(failedConstraints(counts({ GK: 2, DF: 8, MF: 8, FW: 4 }))).toEqual([])
  })
})

describe("countsAfterDeparture is what the voluntary guard asks", () => {
  it("removes the player from his own group and the total", () => {
    const c = counts({ GK: 2, DF: 5, MF: 6, FW: 3 })
    expect(countsAfterDeparture(c, "GK")).toMatchObject({ total: 15, GK: 1 })
    expect(countsAfterDeparture(c, "CB")).toMatchObject({ total: 15, DF: 4 })
    expect(countsAfterDeparture(c, "ST")).toMatchObject({ total: 15, FW: 2 })
  })

  it("selling the second-last goalkeeper from a comfortable squad still fails", () => {
    const c = counts({ GK: 2, DF: 8, MF: 6, FW: 4 })
    expect(c.total).toBe(20)
    expect(meetsRosterFloor(c)).toBe(true)
    expect(failedConstraints(countsAfterDeparture(c, "GK"))).toEqual(["GK"])
  })
})
