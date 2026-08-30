import { withSerializableRetry } from "./retry"
import { TransferError } from "./errors"

function p2034(): Error & { code: string } {
  return Object.assign(new Error("could not serialize access due to concurrent update"), { code: "P2034" })
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
