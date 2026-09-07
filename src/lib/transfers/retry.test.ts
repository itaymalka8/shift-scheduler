import { withSerializableRetry } from "./retry"
import { TransferError } from "./errors"

function p2034(): Error & { code: string } {
  return Object.assign(new Error("could not serialize access due to concurrent update"), { code: "P2034" })
}

/** How the same Postgres failure arrives when it is raised inside a raw query. */
function rawSqlState(sqlState: string): Error & { code: string; meta: { code: string } } {
  return Object.assign(new Error("Raw query failed"), {
    code: "P2010",
    meta: { code: sqlState, message: "raw query failed" },
  })
}

describe("withSerializableRetry", () => {
  it("succeeds on the first attempt when the run function never throws", async () => {
    const run = jest.fn().mockResolvedValue("ok")
    await expect(withSerializableRetry(run)).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("retries once on a single P2034, then returns the retry's result", async () => {
    const run = jest.fn().mockRejectedValueOnce(p2034()).mockResolvedValueOnce("ok")
    await expect(withSerializableRetry(run)).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("retries twice on two consecutive P2034s, then returns the third attempt's result", async () => {
    const run = jest.fn().mockRejectedValueOnce(p2034()).mockRejectedValueOnce(p2034()).mockResolvedValueOnce("ok")
    await expect(withSerializableRetry(run)).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(3)
  })

  it("raises a domain TRANSFER_CONFLICT after three consecutive P2034s, never a 4th attempt", async () => {
    const run = jest.fn().mockRejectedValue(p2034())
    await expect(withSerializableRetry(run)).rejects.toMatchObject({
      constructor: TransferError,
      code: "TRANSFER_CONFLICT",
    })
    expect(run).toHaveBeenCalledTimes(3)
  })

  it("retries a serialization failure that arrives through a raw query as P2010/40001", async () => {
    const run = jest.fn().mockRejectedValueOnce(rawSqlState("40001")).mockResolvedValueOnce("ok")
    await expect(withSerializableRetry(run)).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("retries a deadlock that arrives through a raw query as P2010/40P01", async () => {
    const run = jest.fn().mockRejectedValueOnce(rawSqlState("40P01")).mockResolvedValueOnce("ok")
    await expect(withSerializableRetry(run)).resolves.toBe("ok")
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("never retries an unrelated raw query failure, whatever its SQLSTATE", async () => {
    const notRetryable = rawSqlState("23505")
    const run = jest.fn().mockRejectedValue(notRetryable)
    await expect(withSerializableRetry(run)).rejects.toBe(notRetryable)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("never retries a P2010 with no structured SQLSTATE metadata", async () => {
    const noMeta = Object.assign(new Error("Raw query failed"), { code: "P2010" })
    const run = jest.fn().mockRejectedValue(noMeta)
    await expect(withSerializableRetry(run)).rejects.toBe(noMeta)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("never retries a plain domain TransferError - it propagates on the first attempt", async () => {
    const domainError = new TransferError("INSUFFICIENT_FUNDS")
    const run = jest.fn().mockRejectedValue(domainError)
    await expect(withSerializableRetry(run)).rejects.toBe(domainError)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("never retries a regular error that isn't P2034 - it propagates on the first attempt", async () => {
    const plainError = new Error("something unrelated broke")
    const run = jest.fn().mockRejectedValue(plainError)
    await expect(withSerializableRetry(run)).rejects.toBe(plainError)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
