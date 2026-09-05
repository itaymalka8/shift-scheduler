import { resolveSelectedSeason } from "./season-select"

const SEASON_1 = { id: "s1", number: 1, isActive: false }
const SEASON_2 = { id: "s2", number: 2, isActive: false }
const SEASON_3_ACTIVE = { id: "s3", number: 3, isActive: true }
const ALL = [SEASON_3_ACTIVE, SEASON_2, SEASON_1]

describe("resolveSelectedSeason", () => {
  it("returns exactly the requested season, so the filter shows only that season", () => {
    expect(resolveSelectedSeason(ALL, "s1")).toBe(SEASON_1)
    expect(resolveSelectedSeason(ALL, "s2")).toBe(SEASON_2)
    expect(resolveSelectedSeason(ALL, "s3")).toBe(SEASON_3_ACTIVE)
  })

  it("defaults to the active season when nothing is requested", () => {
    expect(resolveSelectedSeason(ALL)).toBe(SEASON_3_ACTIVE)
    expect(resolveSelectedSeason(ALL, null)).toBe(SEASON_3_ACTIVE)
    expect(resolveSelectedSeason(ALL, "")).toBe(SEASON_3_ACTIVE)
  })

  it("ignores a season this club never played in rather than showing an empty screen", () => {
    expect(resolveSelectedSeason(ALL, "someone-elses-season")).toBe(SEASON_3_ACTIVE)
  })

  it("falls back to the newest season when no season is active (mid handover)", () => {
    const noneActive = [SEASON_1, SEASON_2]
    expect(resolveSelectedSeason(noneActive)).toBe(SEASON_2)
  })

  it("returns null when the club has no seasons at all", () => {
    expect(resolveSelectedSeason([], "s1")).toBeNull()
  })
})
