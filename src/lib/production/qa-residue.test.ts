import { isQaMatchday, QA_MATCHDAY } from "./qa-residue"

describe("isQaMatchday", () => {
  it("flags the sentinel matchday as QA residue", () => {
    expect(isQaMatchday(QA_MATCHDAY)).toBe(true)
    expect(isQaMatchday(999999)).toBe(true)
  })

  it("does not flag any real league matchday", () => {
    expect(isQaMatchday(1)).toBe(false)
    expect(isQaMatchday(38)).toBe(false)
    expect(isQaMatchday(999998)).toBe(false)
  })
})
