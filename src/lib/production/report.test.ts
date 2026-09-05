import { printProductionBanner } from "./report"
import { parseDatabaseTarget } from "./env-guard"

describe("printProductionBanner - secrets never present in formatted output", () => {
  it("prints only host and database name, never a credential embedded in the source URL", () => {
    const target = parseDatabaseTarget("postgresql://admin:hunter2-super-secret@ep-xyz.us-east-2.aws.neon.tech:5432/goalx?sslmode=require")
    const spy = jest.spyOn(console, "info").mockImplementation(() => undefined)

    printProductionBanner("prod:preflight", target)

    const printed = spy.mock.calls.flat().join("\n")
    expect(printed).toContain("ep-xyz.us-east-2.aws.neon.tech")
    expect(printed).toContain("goalx")
    expect(printed).not.toContain("admin")
    expect(printed).not.toContain("hunter2-super-secret")
    expect(printed).not.toContain("postgresql://")

    spy.mockRestore()
  })

  it("the DatabaseTarget object itself structurally carries only host and database", () => {
    const target = parseDatabaseTarget("postgresql://someuser:somepassword@db.example.com:5432/proddb")
    expect(Object.keys(target).sort()).toEqual(["database", "host"])
    expect(JSON.stringify(target)).not.toMatch(/someuser|somepassword/)
  })
})
