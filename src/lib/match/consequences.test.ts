import { DEFAULT_GAME_BALANCE_CONFIG } from "./engine/config"
import {
  FITNESS_MAX,
  FITNESS_MIN,
  FULL_MATCH_FITNESS_COST,
  INJURY_DURATION_BANDS,
  REST_FITNESS_RECOVERY,
  RED_CARD_SUSPENSION_MATCHES,
  STAMINA_FITNESS_PROTECTION,
  YELLOW_CARDS_PER_SUSPENSION,
  clampFitness,
  injuryMatchesFor,
  matchFitnessCost,
  nextFitness,
  suspensionFromMatch,
} from "./consequences"

describe("there is one fatigue model, and this is its persisted half", () => {
  it("takes Stamina protection from the engine's own config rather than restating it", () => {
    expect(STAMINA_FITNESS_PROTECTION).toBe(DEFAULT_GAME_BALANCE_CONFIG.staminaEnergyProtection)
  })

  it("a full 90 costs more than a 30-minute substitute appearance", () => {
    expect(matchFitnessCost(90, 50)).toBeGreaterThan(matchFitnessCost(30, 50))
  })

  it("cost is linear in minutes played", () => {
    expect(matchFitnessCost(45, 50)).toBeCloseTo(matchFitnessCost(90, 50) / 2, 10)
  })

  it("Stamina genuinely buys availability", () => {
    expect(matchFitnessCost(90, 100)).toBeLessThan(matchFitnessCost(90, 0))
    expect(matchFitnessCost(90, 0)).toBe(FULL_MATCH_FITNESS_COST)
    expect(matchFitnessCost(90, 100)).toBeCloseTo(FULL_MATCH_FITNESS_COST * (1 - STAMINA_FITNESS_PROTECTION), 10)
  })

  it("a missing Stamina attribute is treated as average, never as zero", () => {
    expect(matchFitnessCost(90, null)).toBe(matchFitnessCost(90, 50))
    expect(matchFitnessCost(90, undefined)).toBe(matchFitnessCost(90, 50))
  })

  it("A ZERO-MINUTE CAMEO COSTS NOTHING - explicitly", () => {
    // A row with minutesPlayed 0 is a stoppage-time cameo whose minutes
    // rounded down, not a full match and not an unused substitute.
    expect(matchFitnessCost(0, 50)).toBe(0)
    expect(nextFitness(80, 0, 50)).toBe(clampFitness(80 + REST_FITNESS_RECOVERY))
  })

  it("an unused player receives rest and no match fatigue at all", () => {
    // null minutes is the caller saying "this player has no row for this
    // fixture" - they were never on the pitch.
    expect(nextFitness(60, null, 50)).toBe(60 + REST_FITNESS_RECOVERY)
    expect(nextFitness(60, null, 50)).toBeGreaterThan(nextFitness(60, 90, 50))
  })

  it("an ever-present with average Stamina drifts down; an elite one does not", () => {
    const average = nextFitness(80, 90, 50)
    const elite = nextFitness(80, 90, 100)
    expect(average).toBeLessThan(80)
    expect(elite).toBeGreaterThanOrEqual(80)
  })
})

describe("fitness is bounded at both ends", () => {
  it("never exceeds the maximum, however much rest accumulates", () => {
    expect(nextFitness(100, null, 50)).toBe(FITNESS_MAX)
    expect(nextFitness(95, 0, 50)).toBe(FITNESS_MAX)
  })

  it("never goes below the minimum, however many matches are played", () => {
    let fitness = FITNESS_MAX
    for (let i = 0; i < 200; i++) fitness = nextFitness(fitness, 90, 0)
    expect(fitness).toBeGreaterThanOrEqual(FITNESS_MIN)
    expect(fitness).toBeLessThanOrEqual(FITNESS_MAX)
  })

  it("clamps and rounds to a whole number", () => {
    expect(clampFitness(-40)).toBe(FITNESS_MIN)
    expect(clampFitness(140)).toBe(FITNESS_MAX)
    expect(Number.isInteger(nextFitness(73, 37, 61))).toBe(true)
  })

  it("minutes outside 0-90 cannot produce a cost outside the model", () => {
    expect(matchFitnessCost(-10, 50)).toBe(0)
    expect(matchFitnessCost(200, 50)).toBe(matchFitnessCost(90, 50))
  })
})

describe("injury duration is seeded, never random", () => {
  it("the same fixture and player always produce the same absence", () => {
    const a = injuryMatchesFor("seed-abc", "player-1")
    const b = injuryMatchesFor("seed-abc", "player-1")
    expect(a).toBe(b)
  })

  it("different players in the same match can differ", () => {
    const values = new Set(Array.from({ length: 40 }, (_, i) => injuryMatchesFor("seed-abc", `p${i}`)))
    expect(values.size).toBeGreaterThan(1)
  })

  it("every outcome is inside the declared bands", () => {
    const allowed = new Set(INJURY_DURATION_BANDS.map((band) => band.matches))
    for (let i = 0; i < 300; i++) {
      expect(allowed.has(injuryMatchesFor(`s${i}`, `p${i}`))).toBe(true)
    }
  })

  it("is always at least one match - an injury nobody misses a game for is not an injury", () => {
    for (const band of INJURY_DURATION_BANDS) expect(band.matches).toBeGreaterThanOrEqual(1)
  })
})

describe("suspensions come only from what the database can prove", () => {
  it("a sending-off costs one match", () => {
    expect(suspensionFromMatch({ yellowsBefore: 0, yellowsInMatch: 0, redsInMatch: 1 })).toBe(
      RED_CARD_SUSPENSION_MATCHES
    )
  })

  it("a clean match costs nothing", () => {
    expect(suspensionFromMatch({ yellowsBefore: 3, yellowsInMatch: 0, redsInMatch: 0 })).toBe(0)
  })

  it("a single yellow below the threshold costs nothing", () => {
    expect(suspensionFromMatch({ yellowsBefore: 1, yellowsInMatch: 1, redsInMatch: 0 })).toBe(0)
  })

  it("crossing the yellow threshold costs one match", () => {
    expect(
      suspensionFromMatch({ yellowsBefore: YELLOW_CARDS_PER_SUSPENSION - 1, yellowsInMatch: 1, redsInMatch: 0 })
    ).toBe(1)
  })

  it("crossing it again later costs another - the count keeps running", () => {
    expect(
      suspensionFromMatch({ yellowsBefore: YELLOW_CARDS_PER_SUSPENSION * 2 - 1, yellowsInMatch: 1, redsInMatch: 0 })
    ).toBe(1)
  })

  it("sitting just past a threshold without crossing a new one costs nothing", () => {
    expect(suspensionFromMatch({ yellowsBefore: YELLOW_CARDS_PER_SUSPENSION, yellowsInMatch: 1, redsInMatch: 0 })).toBe(0)
  })

  it("a second yellow can dismiss AND cross a threshold - two rules, two matches", () => {
    const total = suspensionFromMatch({
      yellowsBefore: YELLOW_CARDS_PER_SUSPENSION - 2,
      yellowsInMatch: 2,
      redsInMatch: 1,
    })
    expect(total).toBe(RED_CARD_SUSPENSION_MATCHES + 1)
  })

  it("is a pure function of the counts - recomputing the same match gives the same ban", () => {
    const input = { yellowsBefore: 4, yellowsInMatch: 1, redsInMatch: 1 }
    expect(suspensionFromMatch(input)).toBe(suspensionFromMatch(input))
  })

  it("never returns a negative ban, whatever the counts", () => {
    for (let before = 0; before < 20; before++) {
      for (let inMatch = 0; inMatch < 3; inMatch++) {
        expect(suspensionFromMatch({ yellowsBefore: before, yellowsInMatch: inMatch, redsInMatch: 0 })).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
