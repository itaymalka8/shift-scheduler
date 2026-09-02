import { assertProductionDatabaseUrl, parseDatabaseTarget, ProductionSafetyError } from "./env-guard"

describe("parseDatabaseTarget", () => {
  it("extracts host and database name from a Postgres URL", () => {
    expect(parseDatabaseTarget("postgresql://user:secret@ep-xyz.us-east-2.aws.neon.tech:5432/goalx?sslmode=require")).toEqual({
      host: "ep-xyz.us-east-2.aws.neon.tech",
      database: "goalx",
    })
  })

  it("never includes username or password in the result", () => {
    const target = parseDatabaseTarget("postgresql://admin:hunter2@db.example.com:5432/goalx")
    expect(JSON.stringify(target)).not.toMatch(/admin|hunter2/)
  })

  it("throws on an unparseable string", () => {
    expect(() => parseDatabaseTarget("not-a-url")).toThrow(ProductionSafetyError)
  })

  it("throws when the database name is missing", () => {
    expect(() => parseDatabaseTarget("postgresql://user:pass@db.example.com:5432/")).toThrow(ProductionSafetyError)
  })
})

describe("assertProductionDatabaseUrl", () => {
  it("throws when PRODUCTION_DATABASE_URL is not set", () => {
    expect(() => assertProductionDatabaseUrl({})).toThrow(ProductionSafetyError)
  })

  it("throws when PRODUCTION_DATABASE_URL is an empty string", () => {
    expect(() => assertProductionDatabaseUrl({ PRODUCTION_DATABASE_URL: "" })).toThrow(ProductionSafetyError)
  })

  it.each(["localhost", "LOCALHOST", "127.0.0.1", "::1", "0.0.0.0"])("rejects host %s as not Production", (host) => {
    expect(() => assertProductionDatabaseUrl({ PRODUCTION_DATABASE_URL: `postgresql://user:pass@${host}:5432/goalx` })).toThrow(
      ProductionSafetyError
    )
  })

  it("accepts a real-looking remote host and returns the raw URL", () => {
    const url = "postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech:5432/goalx?sslmode=require"
    expect(assertProductionDatabaseUrl({ PRODUCTION_DATABASE_URL: url })).toBe(url)
  })

  it("never falls back to DATABASE_URL when PRODUCTION_DATABASE_URL is missing", () => {
    expect(() =>
      assertProductionDatabaseUrl({ DATABASE_URL: "postgresql://user:pass@real-prod-host.example.com:5432/goalx" })
    ).toThrow(ProductionSafetyError)
  })
})
