import { evaluateAutoDeployGuard, formatAutoDeployReading, describeAutoDeployState } from "./auto-deploy-guard"
import { readServiceAutoDeploy } from "./render-client"

describe("readServiceAutoDeploy - reading Render's field", () => {
  it('reads Render\'s documented "yes"/"no" strings', () => {
    expect(readServiceAutoDeploy({ autoDeploy: "yes" })).toBe("on")
    expect(readServiceAutoDeploy({ autoDeploy: "no" })).toBe("off")
  })

  it("also reads the boolean shape earlier API iterations used", () => {
    expect(readServiceAutoDeploy({ autoDeploy: true })).toBe("on")
    expect(readServiceAutoDeploy({ autoDeploy: false })).toBe("off")
  })

  it("returns unknown - never off - for a shape it does not recognise", () => {
    // The load-bearing case: if Render renames or re-types this field, the
    // guard must get stricter, not silently permissive.
    expect(readServiceAutoDeploy({})).toBe("unknown")
    expect(readServiceAutoDeploy({ autoDeploy: "off" })).toBe("unknown")
    expect(readServiceAutoDeploy({ autoDeploy: 0 })).toBe("unknown")
    expect(readServiceAutoDeploy(null)).toBe("unknown")
    expect(readServiceAutoDeploy("not an object")).toBe("unknown")
  })
})

describe("evaluateAutoDeployGuard", () => {
  it("accepts only when BOTH services are confirmed off", () => {
    const result = evaluateAutoDeployGuard({ web: "off", cron: "off" })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it("rejects when web auto-deploy is on", () => {
    const result = evaluateAutoDeployGuard({ web: "on", cron: "off" })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("ENABLED")
    expect(result.reason).toContain("web")
  })

  it("rejects when only the cron service still auto-deploys", () => {
    // The cron service picking up new code mid-pipeline is its own hazard:
    // prod:deploy:safe believes it has that service frozen.
    const result = evaluateAutoDeployGuard({ web: "off", cron: "on" })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("cron")
  })

  it("rejects when auto-deploy is unknown - fail closed, never assumed off", () => {
    for (const reading of [
      { web: "unknown", cron: "off" },
      { web: "off", cron: "unknown" },
      { web: "unknown", cron: "unknown" },
    ] as const) {
      const result = evaluateAutoDeployGuard(reading)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("UNKNOWN")
    }
  })

  it("reports ENABLED ahead of UNKNOWN when both are present, since that is the more urgent fact", () => {
    const result = evaluateAutoDeployGuard({ web: "on", cron: "unknown" })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("ENABLED")
  })

  it("always reports both readings in its detail, whatever the verdict", () => {
    expect(formatAutoDeployReading({ web: "on", cron: "unknown" })).toBe("web=ON cron=UNKNOWN")
    expect(evaluateAutoDeployGuard({ web: "off", cron: "off" }).detail).toBe("web=OFF cron=OFF")
  })

  it("describes each state in the ON / OFF / UNKNOWN vocabulary the report uses", () => {
    expect(describeAutoDeployState("on")).toBe("ON")
    expect(describeAutoDeployState("off")).toBe("OFF")
    expect(describeAutoDeployState("unknown")).toBe("UNKNOWN")
  })
})
