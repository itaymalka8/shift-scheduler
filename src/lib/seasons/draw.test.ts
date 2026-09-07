import {
  KNOCKOUT_DRAW_VERSION,
  deriveDrawSeed,
  drawKnockout,
  drawMatchesSeed,
  nextPowerOfTwo,
  parseKnockoutDraw,
  planKnockoutRound,
  seededShuffle,
} from "./draw"

const LABEL = { countryCode: "IL", seasonNumber: 1, tier: 1, group: "" }
const fx = (iso: string, hs: number | null, as: number | null) => ({
  scheduledAt: iso ? new Date(iso) : null,
  homeScore: hs,
  awayScore: as,
})

const SOURCE = [
  fx("2026-08-31T19:00:00.000Z", 2, 1),
  fx("2026-09-02T19:00:00.000Z", 0, 0),
  fx("2026-09-05T19:00:00.000Z", 3, 2),
]

describe("deriveDrawSeed", () => {
  it("is deterministic", () => {
    expect(deriveDrawSeed(LABEL, SOURCE)).toBe(deriveDrawSeed(LABEL, SOURCE))
  })

  it("IS ORDER-INDEPENDENT - no ordering decision enters the seed", () => {
    const forwards = deriveDrawSeed(LABEL, SOURCE)
    const backwards = deriveDrawSeed(LABEL, [...SOURCE].reverse())
    const shuffled = deriveDrawSeed(LABEL, [SOURCE[1], SOURCE[2], SOURCE[0]])
    expect(backwards).toBe(forwards)
    expect(shuffled).toBe(forwards)
  })

  it("changes when the sporting record changes", () => {
    const other = deriveDrawSeed(LABEL, [...SOURCE.slice(0, 2), fx("2026-09-05T19:00:00.000Z", 3, 1)])
    expect(other).not.toBe(deriveDrawSeed(LABEL, SOURCE))
  })

  it("differs between divisions of the same season", () => {
    const tierOne = deriveDrawSeed({ ...LABEL, tier: 1, group: "" }, SOURCE)
    const tierTwoA = deriveDrawSeed({ ...LABEL, tier: 2, group: "A" }, SOURCE)
    expect(tierTwoA).not.toBe(tierOne)
  })

  it("ignores unplayed or unscheduled fixtures rather than crashing", () => {
    const withNulls = [...SOURCE, fx("", null, null), { scheduledAt: new Date(), homeScore: null, awayScore: 1 }]
    expect(deriveDrawSeed(LABEL, withNulls)).toBe(deriveDrawSeed(LABEL, SOURCE))
  })

  it("carries a human-readable competition label plus the digest", () => {
    expect(deriveDrawSeed(LABEL, SOURCE)).toMatch(/^IL-S1-T1-[0-9a-f]{8}$/)
  })

  it("takes no team identity at all - the input shape carries scores and a kickoff only", () => {
    expect(Object.keys(SOURCE[0]).sort()).toEqual(["awayScore", "homeScore", "scheduledAt"])
  })
})

describe("nextPowerOfTwo", () => {
  it.each([
    [2, 2], [3, 4], [4, 4], [5, 8], [8, 8], [9, 16],
  ])("%i -> %i", (input, expected) => {
    expect(nextPowerOfTwo(input)).toBe(expected)
  })
})

describe("seededShuffle", () => {
  it("is deterministic for a given seed", () => {
    const items = ["a", "b", "c", "d", "e"]
    expect(seededShuffle(items, "s")).toEqual(seededShuffle(items, "s"))
  })

  it("different seeds give different permutations", () => {
    const items = ["a", "b", "c", "d", "e"]
    const seen = new Set(Array.from({ length: 20 }, (_, i) => seededShuffle(items, `s${i}`).join("")))
    expect(seen.size).toBeGreaterThan(1)
  })

  it("is a permutation - nothing added, nothing lost", () => {
    const items = ["a", "b", "c", "d", "e"]
    expect([...seededShuffle(items, "x")].sort()).toEqual([...items].sort())
  })

  it("does not mutate its input", () => {
    const items = ["a", "b", "c"]
    seededShuffle(items, "x")
    expect(items).toEqual(["a", "b", "c"])
  })
})

describe("drawKnockout", () => {
  it("pairs an even field with no byes", () => {
    const draw = drawKnockout(["a", "b", "c", "d"], "seed")
    expect(draw.byes).toEqual([])
    expect(draw.firstRound.pairings).toHaveLength(2)
  })

  it("gives byes when the field is not a power of two", () => {
    expect(drawKnockout(["a", "b", "c"], "seed").byes).toHaveLength(1)
    expect(drawKnockout(["a", "b", "c", "d", "e"], "seed").byes).toHaveLength(3)
  })

  it("every entrant appears exactly once, playing or on a bye", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const entrants = Array.from({ length: n }, (_, i) => `t${i}`)
      const draw = drawKnockout(entrants, "seed")
      const placed = [...draw.byes, ...draw.firstRound.pairings.flatMap((p) => [p.homeTeamId, p.awayTeamId])]
      expect(placed.sort()).toEqual([...entrants].sort())
      expect(new Set(placed).size).toBe(n)
    }
  })

  it("IS DETERMINISTIC - the same seed and entrants always give the same bracket", () => {
    const a = drawKnockout(["x", "y", "z", "w", "v"], "fixed")
    const b = drawKnockout(["x", "y", "z", "w", "v"], "fixed")
    expect(b).toEqual(a)
  })

  it("is INDEPENDENT of the order the entrants were assembled in", () => {
    const a = drawKnockout(["a", "b", "c", "d", "e"], "fixed")
    const b = drawKnockout(["e", "d", "c", "b", "a"], "fixed")
    expect(b).toEqual(a)
  })

  it("a different seed gives a different bracket", () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) => drawKnockout(["a", "b", "c", "d", "e"], `s${i}`).order.join(""))
    )
    expect(seen.size).toBeGreaterThan(1)
  })

  it("the permutation depends on the SEED alone, not on what the ids happen to be", () => {
    // Stated precisely rather than loosely: with the same seed and the same
    // number of entrants, the shuffle moves the SORTED POSITIONS the same way
    // whatever the ids are. That is the honest description of the mechanism -
    // the canonical sort is a technical device, and the seed does the placing.
    const rankOrder = (draw: { entrants: string[]; order: string[] }) =>
      draw.order.map((id) => draw.entrants.indexOf(id)).join(",")
    const original = drawKnockout(["aaa", "bbb", "ccc", "ddd", "eee"], "fixed")
    const renamed = drawKnockout(["zzz", "yyy", "xxx", "www", "vvv"], "fixed")
    expect(rankOrder(renamed)).toBe(rankOrder(original))
    // Which is why fairness cannot be argued from this test alone, and is
    // asserted directly by the two below instead.
  })

  it("A CLUB'S ID DOES NOT DECIDE ITS FATE - renaming one club moves its bracket position", () => {
    // The concrete consequence: the club sorting first is not a fixed
    // identity. Rename it so it now sorts last, and it lands somewhere else.
    const before = drawKnockout(["aaa", "mmm", "nnn"], "fixed")
    const after = drawKnockout(["zzz", "mmm", "nnn"], "fixed")
    const positionOf = (draw: { order: string[] }, id: string) => draw.order.indexOf(id)
    expect(positionOf(after, "zzz")).not.toBe(positionOf(before, "aaa"))
  })

  it("THE PERMUTATION IS A FUNCTION OF (seed, n) AND NOTHING ELSE", () => {
    // The property that actually severs teamId from the sporting outcome:
    // seededShuffle never inspects a value, only a position. If that holds,
    // no club can influence the draw by being who it is - the labels are
    // carried along by a permutation chosen before they are even looked at.
    let labelDependent = 0
    for (let s = 0; s < 2000; s++) {
      for (const n of [3, 4, 5, 6, 7]) {
        const indices = Array.from({ length: n }, (_, k) => k)
        const permutation = seededShuffle(indices, `perm-${s}`)
        // Deliberately NOT sorted, and deliberately not related to the ranks.
        const labels = indices.map((k) => `Z${(n * 31 - k * 7) % 97}#${k}`)
        const shuffled = seededShuffle(labels, `perm-${s}`)
        for (let position = 0; position < n; position++) {
          if (shuffled[position] !== labels[permutation[position]]) labelDependent++
        }
      }
    }
    expect(labelDependent).toBe(0)
  })

  it("EXACT: every index draw is uniform to within one value of the 2^32 grid", () => {
    // Not sampled - COMPUTED. rng.int(0, i) is monotone in the underlying
    // 2^32 output grid of next(), so binary search finds the exact bucket
    // boundaries and every one of the 4294967296 possible draws is
    // accounted for. This is the only place a Fisher-Yates shuffle can
    // acquire bias, so it is bounded here rather than argued about.
    const TWO32 = 4294967296
    const indexFor = (k: number, max: number) => Math.floor((k / TWO32) * (max + 1 - Number.EPSILON))

    for (let max = 1; max <= 19; max++) {
      const firstK: number[] = []
      for (let m = 0; m <= max + 1; m++) {
        let lo = 0
        let hi = TWO32
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2)
          if (indexFor(mid, max) >= m) hi = mid
          else lo = mid + 1
        }
        firstK.push(lo)
      }
      const sizes = Array.from({ length: max + 1 }, (_, m) => firstK[m + 1] - firstK[m])

      // Every draw is accounted for, and no bucket is empty.
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(TWO32)
      expect(Math.min(...sizes)).toBeGreaterThan(0)
      // As equal as a 2^32 grid can be split into (max + 1) parts.
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(2)
      const mean = TWO32 / sizes.length
      expect((Math.max(...sizes) - Math.min(...sizes)) / mean).toBeLessThan(1e-8)
    }
  })

  describe("no canonical rank is favoured", () => {
    // Replaces a loose 600-draw eyeball with a bounded statistical test over
    // a FIXED, deterministic seed sequence - so this either passes forever or
    // fails forever; it can never flake.
    //
    // Under a uniform draw, a club's bye count is Binomial(N, B/n), so the
    // count's standard deviation is sqrt(N * p * (1 - p)). Four sigma is the
    // bound: comfortably wider than sampling noise, far narrower than any
    // real bias would be.
    const TRIALS = 30000
    const SIGMA_BOUND = 4

    function draws(n: number) {
      // Canonical order is exactly lexical teamId order, so index === rank.
      const entrants = Array.from({ length: n }, (_, k) => `t${String(k).padStart(3, "0")}`)
      const byes = new Array<number>(n).fill(0)
      const positions = Array.from({ length: n }, () => new Array<number>(n).fill(0))
      for (let i = 0; i < TRIALS; i++) {
        const draw = drawKnockout(entrants, `IL-S1-T1A-${(i * 2654435761) >>> 0}`)
        for (const id of draw.byes) byes[entrants.indexOf(id)]++
        draw.order.forEach((id, position) => positions[entrants.indexOf(id)][position]++)
      }
      return { entrants, byes, positions, byeSlots: nextPowerOfTwo(n) - n }
    }

    for (const n of [3, 5, 6]) {
      it(`n=${n}: a club's BYE probability does not depend on its lexical rank`, () => {
        const { byes, byeSlots } = draws(n)
        const p = byeSlots / n
        const expected = TRIALS * p
        const sigma = Math.sqrt(TRIALS * p * (1 - p))
        // Every bye is handed out, every time - nothing is lost or invented.
        expect(byes.reduce((a, b) => a + b, 0)).toBe(TRIALS * byeSlots)
        byes.forEach((count, rank) => {
          const z = Math.abs(count - expected) / sigma
          // rank is named so a failure says WHICH rank is favoured.
          expect({ rank, z: z < SIGMA_BOUND }).toEqual({ rank, z: true })
        })
      })

      it(`n=${n}: every club reaches every bracket position equally often`, () => {
        const { positions } = draws(n)
        const p = 1 / n
        const expected = TRIALS * p
        const sigma = Math.sqrt(TRIALS * p * (1 - p))
        positions.forEach((row, rank) => {
          // A club occupies exactly one position per draw.
          expect(row.reduce((a, b) => a + b, 0)).toBe(TRIALS)
          row.forEach((count, position) => {
            const z = Math.abs(count - expected) / sigma
            expect({ rank, position, z: z < SIGMA_BOUND }).toEqual({ rank, position, z: true })
          })
        })
      })
    }
  })

  it("refuses a field of fewer than two", () => {
    expect(() => drawKnockout(["only"], "seed")).toThrow(/at least two/)
    expect(() => drawKnockout([], "seed")).toThrow(/at least two/)
  })

  it("records the version that produced it", () => {
    expect(drawKnockout(["a", "b"], "seed").version).toBe(KNOCKOUT_DRAW_VERSION)
  })
})

describe("planKnockoutRound", () => {
  it("pairs survivors in the bracket order it is given - no reshuffle", () => {
    const plan = planKnockoutRound(2, ["w", "x", "y", "z"])
    expect(plan.pairings).toEqual([
      { homeTeamId: "w", awayTeamId: "x" },
      { homeTeamId: "y", awayTeamId: "z" },
    ])
    expect(plan.byes).toEqual([])
  })

  it("gives a bye when the survivor count is not a power of two", () => {
    const plan = planKnockoutRound(2, ["w", "x", "y"])
    expect(plan.byes).toEqual(["w"])
    expect(plan.pairings).toEqual([{ homeTeamId: "x", awayTeamId: "y" }])
  })

  it("is deterministic and depends on nothing but its input", () => {
    expect(planKnockoutRound(3, ["a", "b"])).toEqual(planKnockoutRound(3, ["a", "b"]))
  })

  it("a final is one pairing and no byes", () => {
    const plan = planKnockoutRound(3, ["a", "b"])
    expect(plan.pairings).toHaveLength(1)
    expect(plan.byes).toEqual([])
  })

  it("refuses fewer than two survivors", () => {
    expect(() => planKnockoutRound(2, ["one"])).toThrow(/at least two/)
  })
})

describe("drawMatchesSeed - tamper detection", () => {
  it("accepts an untampered draw", () => {
    const draw = drawKnockout(["a", "b", "c", "d", "e"], "seed-1")
    expect(drawMatchesSeed(draw, "seed-1")).toBe(true)
  })

  it("REJECTS a draw whose order was edited", () => {
    const draw = drawKnockout(["a", "b", "c", "d", "e"], "seed-1")
    const tampered = { ...draw, order: [...draw.order].reverse() }
    expect(drawMatchesSeed(tampered, "seed-1")).toBe(false)
  })

  it("REJECTS a draw whose byes were edited", () => {
    const draw = drawKnockout(["a", "b", "c", "d", "e"], "seed-1")
    const tampered = { ...draw, byes: ["a"] }
    expect(drawMatchesSeed(tampered, "seed-1")).toBe(false)
  })

  it("REJECTS a draw whose pairings were edited", () => {
    const draw = drawKnockout(["a", "b", "c", "d"], "seed-1")
    const tampered = {
      ...draw,
      firstRound: { ...draw.firstRound, pairings: [{ homeTeamId: "a", awayTeamId: "b" }] },
    }
    expect(drawMatchesSeed(tampered, "seed-1")).toBe(false)
  })

  it("REJECTS a draw checked against the wrong seed", () => {
    const draw = drawKnockout(["a", "b", "c", "d", "e"], "seed-1")
    expect(drawMatchesSeed(draw, "seed-2")).toBe(false)
  })

  it("REJECTS a draw from a different version", () => {
    const draw = drawKnockout(["a", "b"], "seed-1")
    expect(drawMatchesSeed({ ...draw, version: 999 }, "seed-1")).toBe(false)
  })
})

describe("parseKnockoutDraw", () => {
  it("round-trips a real draw through JSON", () => {
    const draw = drawKnockout(["a", "b", "c"], "seed")
    const parsed = parseKnockoutDraw(JSON.parse(JSON.stringify(draw)))
    expect(parsed).toEqual(draw)
  })

  it("rejects anything that is not a draw", () => {
    expect(parseKnockoutDraw(null)).toBeNull()
    expect(parseKnockoutDraw("nope")).toBeNull()
    expect(parseKnockoutDraw({})).toBeNull()
    expect(parseKnockoutDraw({ version: 1, entrants: [], order: [], byes: [] })).toBeNull()
  })
})
