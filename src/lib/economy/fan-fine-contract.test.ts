/**
 * THE FAN-FINE ECONOMIC CONTRACT.
 *
 * Phase 3R changed nothing about fan fines, deliberately. But the calibration
 * measured what they cost, and that measurement carries an obligation this file
 * exists to record - in the one place a future edit to those constants would
 * have to walk past.
 *
 * WHAT WAS MEASURED. A sensitivity run charged an EXTRA 900,000 per season,
 * league-wide, to the ultras clubs only, on top of the fines the game already
 * levies. The frozen candidate stayed inside the hard band on all six seeds -
 * but the worst seed reached -13.6% at season 20, leaving 1.4 percentage points
 * of headroom on the negative side, and every seed then finished with three or
 * four insolvent clubs where two had finished clean.
 *
 * THEREFORE: any material increase in fan-fine FREQUENCY or SEVERITY requires
 * re-calibration before it ships. The economy is not "roughly balanced with
 * room to spare" on that axis; it is balanced with 1.4 points of room, and a
 * change made on intuition would spend all of it.
 *
 * AND: the 900,000 is a SENSITIVITY, not a charge. It was a probe to find out
 * how much sink the calibrated economy could absorb. Turning it into a runtime
 * flat fee would be charging the league for a measurement.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_GAME_BALANCE_CONFIG } from "@/lib/match/engine/config"

const ROOT = join(__dirname, "..", "..", "..")
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8")

/**
 * The fan-fine constants exactly as the calibration measured them. A change to
 * any of these fails this test - which is the alarm, not the bug. The fix is to
 * re-run `prod:economy:regression` (and, if it moves the band, the calibration
 * itself) and then update these numbers with the new evidence.
 */
const CALIBRATED_FAN_FINES = {
  ultrasIncidentBaseChance: 0.035,
  incidentFineMin: 15_000,
  incidentFineMax: 60_000,
} as const

describe("fan fines are unchanged by Phase 3R", () => {
  it("carries the exact constants the calibration was run against", () => {
    const { crowd } = DEFAULT_GAME_BALANCE_CONFIG
    expect(crowd.ultrasIncidentBaseChance).toBe(CALIBRATED_FAN_FINES.ultrasIncidentBaseChance)
    expect(crowd.incidentFineMin).toBe(CALIBRATED_FAN_FINES.incidentFineMin)
    expect(crowd.incidentFineMax).toBe(CALIBRATED_FAN_FINES.incidentFineMax)
  })

  it("expected cost per ultras club per season, as measured, for whoever changes it next", () => {
    // 19 home fixtures, one incident roll each, a uniform fine between the two
    // bounds. Stated as a number so the next person to reach for these
    // constants can see what they are actually moving.
    const { crowd } = DEFAULT_GAME_BALANCE_CONFIG
    const perSeason = 19 * crowd.ultrasIncidentBaseChance * ((crowd.incidentFineMin + crowd.incidentFineMax) / 2)
    expect(Math.round(perSeason)).toBe(24_938)
    // The sensitivity probe added roughly 29,000 per ultras club per season on
    // top of this - slightly MORE than doubling it - and that is what consumed
    // all but 1.4 points of the negative headroom.
    expect(900_000 / 31).toBeGreaterThan(perSeason)
  })
})

describe("the sensitivity value never became a runtime charge", () => {
  it("900,000 appears in the diagnostics and nowhere in shipped economy code", () => {
    for (const file of [
      ["src", "lib", "economy", "weekly-settlement.ts"],
      ["src", "lib", "economy", "payroll.ts"],
      ["src", "lib", "economy", "config.ts"],
      ["src", "lib", "economy", "maintenance.ts"],
      ["src", "lib", "economy", "sponsor.ts"],
      ["src", "lib", "match", "simulate.ts"],
      ["src", "lib", "match", "engine", "config.ts"],
    ]) {
      const source = read(...file)
      expect(source).not.toContain("900_000")
      expect(source).not.toContain("900000")
    }
  })

  it("no flat league-wide fee of any name was introduced", () => {
    const settlement = read("src", "lib", "economy", "weekly-settlement.ts")
    expect(settlement).not.toMatch(/leagueFee|flatCharge|solidarityLevy|sinkPerSeason/i)
  })
})
