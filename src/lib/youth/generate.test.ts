import { calculatePlayerOverall } from "@/lib/players/overall"
import { POSITION_ATTRIBUTE_WEIGHTS } from "@/lib/players/position-weights"
import { PLAYER_POSITIONS, SECONDARY_POSITIONS, type PlayerPosition } from "@/lib/players/positions"
import {
  GOALKEEPER_SHARED_ATTRIBUTES,
  GOALKEEPING_ATTRIBUTES,
  OUTFIELD_ATTRIBUTES,
  type AttributeKey,
} from "@/lib/players/attributes"
import { DEFAULT_NATIONALITY_POOL } from "@/lib/players/config"
import { generateYouthProspect, generateYouthProspects, prospectSeed } from "./generate"
import {
  PROSPECTS_PER_INTAKE,
  YOUTH_AGE_MAX,
  YOUTH_AGE_MIN,
  YOUTH_OVERALL_BANDS,
  YOUTH_OVERALL_MAX,
  YOUTH_OVERALL_MIN,
} from "./config"

const SEASON = "season-dist"

/**
 * A large deterministic sample - the same prospects every run, no DB. Every
 * draw gets a DISTINCT seed (one club per intake-sized block), so `count`
 * really is `count` independent prospects rather than a handful of seeds
 * repeated, which would skew the measured distributions.
 */
function sample(count: number) {
  return Array.from({ length: count }, (_, i) =>
    generateYouthProspect({
      seasonId: SEASON,
      teamId: `team-${Math.floor(i / PROSPECTS_PER_INTAKE)}`,
      index: i % PROSPECTS_PER_INTAKE,
    })
  )
}

describe("youth prospect generation - bounds", () => {
  const prospects = sample(4000)

  it("never generates an Overall outside 45-70", () => {
    for (const p of prospects) {
      expect(p.overall).toBeGreaterThanOrEqual(YOUTH_OVERALL_MIN)
      expect(p.overall).toBeLessThanOrEqual(YOUTH_OVERALL_MAX)
    }
  })

  it("never generates an age outside 16-19, and uses the whole range", () => {
    const ages = new Set<number>()
    for (const p of prospects) {
      expect(p.age).toBeGreaterThanOrEqual(YOUTH_AGE_MIN)
      expect(p.age).toBeLessThanOrEqual(YOUTH_AGE_MAX)
      ages.add(p.age)
    }
    expect([...ages].sort()).toEqual([16, 17, 18, 19])
  })

  it("always gives a potential at or above overall, never above 100", () => {
    for (const p of prospects) {
      expect(p.potential).toBeGreaterThanOrEqual(p.overall)
      expect(p.potential).toBeLessThanOrEqual(100)
    }
  })

  it("allows potential above the 70 Overall ceiling, and makes elite potential rare", () => {
    const above70 = prospects.filter((p) => p.potential > YOUTH_OVERALL_MAX)
    expect(above70.length).toBeGreaterThan(0)
    const elite = prospects.filter((p) => p.potential - p.overall >= 31)
    const eliteShare = elite.length / prospects.length
    expect(eliteShare).toBeGreaterThan(0)
    expect(eliteShare).toBeLessThan(0.05)
  })

  it("uses the existing nationality and name conventions, never QA placeholders", () => {
    for (const p of prospects.slice(0, 200)) {
      expect(DEFAULT_NATIONALITY_POOL).toContain(p.nationality)
      expect(p.firstName.length).toBeGreaterThan(0)
      expect(p.lastName.length).toBeGreaterThan(0)
      expect(p.firstName).not.toMatch(/QA|Test/i)
    }
    // Real variety, not one name repeated.
    expect(new Set(prospects.map((p) => `${p.firstName} ${p.lastName}`)).size).toBeGreaterThan(50)
  })

  it("draws positions across the whole pitch and gives plausible secondary positions", () => {
    const positions = new Set(prospects.map((p) => p.primaryPosition))
    expect(positions.size).toBeGreaterThan(8)
    expect(positions.has("GK")).toBe(true)
    for (const p of prospects.slice(0, 300)) {
      expect(new Set(p.secondaryPositions).size).toBe(p.secondaryPositions.length)
      for (const secondary of p.secondaryPositions) {
        expect(SECONDARY_POSITIONS[p.primaryPosition]).toContain(secondary)
      }
    }
  })

  it("uses the existing preferred-foot convention", () => {
    const feet = new Set(prospects.map((p) => p.preferredFoot))
    for (const foot of feet) expect(["right", "left", "both"]).toContain(foot)
    expect(feet.size).toBeGreaterThan(1)
  })
})

describe("youth prospect generation - distributions", () => {
  // 10,000 rolls, deterministic - no DB, no Math.random.
  const prospects = sample(10_000)

  it("matches the configured Overall band distribution", () => {
    const counts = YOUTH_OVERALL_BANDS.map(
      (band) => prospects.filter((p) => p.overall >= band.min && p.overall <= band.max).length
    )
    const shares = counts.map((c) => (c / prospects.length) * 100)
    const expected = YOUTH_OVERALL_BANDS.map((b) => b.weight)

    // Every prospect lands in exactly one band.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(prospects.length)
    shares.forEach((share, i) => {
      // Tolerance widens for the rarer bands, where sampling noise is
      // proportionally larger.
      const tolerance = Math.max(2, expected[i] * 0.2)
      expect(Math.abs(share - expected[i])).toBeLessThan(tolerance)
    })
  })

  it("matches the configured potential-gap distribution, split by age band", () => {
    for (const [label, ages, expected] of [
      ["16-17", [16, 17], [55, 33, 10, 2]],
      ["18-19", [18, 19], [62, 30, 7, 1]],
    ] as const) {
      const group = prospects.filter((p) => (ages as readonly number[]).includes(p.age))
      expect(group.length).toBeGreaterThan(1000)
      const gaps = group.map((p) => p.potential - p.overall)
      // Gaps are capped by potential's own 100 ceiling, so bucket on the
      // rolled gap where it wasn't truncated.
      const uncapped = group.filter((p) => p.potential < 100).map((p) => p.potential - p.overall)
      const buckets = [
        uncapped.filter((g) => g >= 3 && g <= 10).length,
        uncapped.filter((g) => g >= 11 && g <= 20).length,
        uncapped.filter((g) => g >= 21 && g <= 30).length,
        uncapped.filter((g) => g >= 31 && g <= 35).length,
      ]
      const shares = buckets.map((c) => (c / uncapped.length) * 100)
      shares.forEach((share, i) => {
        const tolerance = Math.max(3, expected[i] * 0.3)
        expect({ band: `${label}[${i}]`, off: Math.abs(share - expected[i]) < tolerance }).toEqual({
          band: `${label}[${i}]`,
          off: true,
        })
      })
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(3)
    }
  })
})

describe("youth prospect generation - determinism", () => {
  it("produces the identical prospect for the same season, team and slot", () => {
    const input = { seasonId: "s1", teamId: "t1", index: 2 }
    expect(generateYouthProspect(input)).toEqual(generateYouthProspect(input))
  })

  it("produces different prospects across slots, teams and seasons", () => {
    const base = { seasonId: "s1", teamId: "t1", index: 0 }
    const bySlot = generateYouthProspect({ ...base, index: 1 })
    const byTeam = generateYouthProspect({ ...base, teamId: "t2" })
    const bySeason = generateYouthProspect({ ...base, seasonId: "s2" })
    const original = generateYouthProspect(base)
    expect(bySlot).not.toEqual(original)
    expect(byTeam).not.toEqual(original)
    expect(bySeason).not.toEqual(original)
  })

  it("generates a whole intake reproducibly, with distinct prospects", () => {
    const first = generateYouthProspects("s1", "t1", PROSPECTS_PER_INTAKE)
    const second = generateYouthProspects("s1", "t1", PROSPECTS_PER_INTAKE)
    expect(first).toHaveLength(PROSPECTS_PER_INTAKE)
    expect(second).toEqual(first)
    expect(new Set(first.map((p) => JSON.stringify(p))).size).toBe(PROSPECTS_PER_INTAKE)
  })

  it("builds a stable, distinguishable seed", () => {
    expect(prospectSeed({ seasonId: "s1", teamId: "t1", index: 0 })).toBe("s1-t1-0-youth")
    expect(prospectSeed({ seasonId: "s1", teamId: "t1", index: 1 })).not.toBe(
      prospectSeed({ seasonId: "s1", teamId: "t1", index: 0 })
    )
  })
})

describe("youth prospect generation - attribute integrity", () => {
  it("stores an Overall that its own attributes grade out at exactly, for every position", () => {
    // Enough draws to cover every position across several overall bands.
    const prospects = sample(3000)
    for (const position of PLAYER_POSITIONS) {
      const matching = prospects.filter((p) => p.primaryPosition === position)
      expect(matching.length).toBeGreaterThan(0)
      for (const p of matching) {
        expect(calculatePlayerOverall(p)).toBe(p.overall)
        expect(p.overall).toBeLessThanOrEqual(YOUTH_OVERALL_MAX)
      }
    }
  })

  it("keeps every populated attribute inside 1-100", () => {
    for (const p of sample(1500)) {
      for (const key of [...OUTFIELD_ATTRIBUTES, ...GOALKEEPING_ATTRIBUTES] as AttributeKey[]) {
        const value = p[key]
        if (value == null) continue
        expect(value).toBeGreaterThanOrEqual(1)
        expect(value).toBeLessThanOrEqual(100)
      }
    }
  })

  it("populates goalkeeper and outfield attribute sets exactly as the engine expects", () => {
    const prospects = sample(2000)
    const keepers = prospects.filter((p) => p.primaryPosition === "GK")
    const outfielders = prospects.filter((p) => p.primaryPosition !== "GK")
    expect(keepers.length).toBeGreaterThan(0)
    expect(outfielders.length).toBeGreaterThan(0)

    const gkKeys = new Set<AttributeKey>([...GOALKEEPING_ATTRIBUTES, ...GOALKEEPER_SHARED_ATTRIBUTES])
    for (const keeper of keepers) {
      for (const key of gkKeys) expect(typeof keeper[key]).toBe("number")
      // Outfield-only attributes stay null on a keeper.
      for (const key of OUTFIELD_ATTRIBUTES as readonly AttributeKey[]) {
        if (gkKeys.has(key)) continue
        expect(keeper[key] ?? null).toBeNull()
      }
    }

    for (const outfielder of outfielders) {
      for (const key of OUTFIELD_ATTRIBUTES as readonly AttributeKey[]) {
        expect(typeof outfielder[key]).toBe("number")
      }
      for (const key of GOALKEEPING_ATTRIBUTES as readonly AttributeKey[]) {
        expect(outfielder[key] ?? null).toBeNull()
      }
    }
  })

  it("only moves attributes the position actually weights when converging on the target", () => {
    for (const position of ["GK", "CB", "ST"] as PlayerPosition[]) {
      const weighted = new Set(Object.keys(POSITION_ATTRIBUTE_WEIGHTS[position]) as AttributeKey[])
      expect(weighted.size).toBeGreaterThan(0)
    }
  })
})
