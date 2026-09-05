import { assertProductionWriteConfirmed, PRODUCTION_WRITE_CONFIRMATION, ProductionWriteNotConfirmedError } from "./write-guard"

describe("assertProductionWriteConfirmed", () => {
  it("throws when the confirmation variable is missing", () => {
    expect(() => assertProductionWriteConfirmed({})).toThrow(ProductionWriteNotConfirmedError)
  })

  it("throws on a near-miss value (truthy but not exact)", () => {
    expect(() => assertProductionWriteConfirmed({ PRODUCTION_WRITE_CONFIRM: "true" })).toThrow(ProductionWriteNotConfirmedError)
    expect(() => assertProductionWriteConfirmed({ PRODUCTION_WRITE_CONFIRM: "1" })).toThrow(ProductionWriteNotConfirmedError)
    expect(() => assertProductionWriteConfirmed({ PRODUCTION_WRITE_CONFIRM: `${PRODUCTION_WRITE_CONFIRMATION} ` })).toThrow(
      ProductionWriteNotConfirmedError
    )
  })

  it("passes only with the exact confirmation string", () => {
    expect(() => assertProductionWriteConfirmed({ PRODUCTION_WRITE_CONFIRM: PRODUCTION_WRITE_CONFIRMATION })).not.toThrow()
  })
})
