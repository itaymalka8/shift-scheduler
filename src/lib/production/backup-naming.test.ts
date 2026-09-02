import { formatBackupBranchName } from "./backup-naming"

describe("formatBackupBranchName", () => {
  it("formats as pre-deploy-goalx-YYYY-MM-DD-HHmm in UTC", () => {
    const date = new Date(Date.UTC(2026, 8, 2, 14, 5)) // 2026-09-02 14:05 UTC
    expect(formatBackupBranchName(date)).toBe("pre-deploy-goalx-2026-09-02-1405")
  })

  it("zero-pads single-digit month, day, hour, and minute", () => {
    const date = new Date(Date.UTC(2026, 0, 5, 3, 7))
    expect(formatBackupBranchName(date)).toBe("pre-deploy-goalx-2026-01-05-0307")
  })

  it("uses UTC regardless of the local timezone the process runs in", () => {
    const date = new Date(Date.UTC(2026, 5, 30, 23, 59))
    expect(formatBackupBranchName(date)).toBe("pre-deploy-goalx-2026-06-30-2359")
  })
})
