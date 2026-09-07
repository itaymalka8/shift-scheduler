import { generateProductionOpsReadToken } from "./ops-token"

describe("generateProductionOpsReadToken", () => {
  it("produces a 64-character hex string (32 bytes)", () => {
    const token = generateProductionOpsReadToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it("never produces the same value twice", () => {
    const a = generateProductionOpsReadToken()
    const b = generateProductionOpsReadToken()
    expect(a).not.toBe(b)
  })
})
