import { formatBackupBranchName, isBackupBranchName, parseBackupBranchName } from "./backup-naming"

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

describe("parseBackupBranchName / isBackupBranchName", () => {
  it("round-trips a name this project generated", () => {
    const name = formatBackupBranchName(new Date(Date.UTC(2026, 8, 3, 11, 21)))
    expect(parseBackupBranchName(name)!.takenAt.toISOString()).toBe("2026-09-03T11:21:00.000Z")
  })

  it("accepts every real backup name currently on the Production project", () => {
    for (const name of [
      "pre-deploy-goalx-2026-09-04-1057",
      "pre-deploy-goalx-2026-09-04-0937",
      "pre-deploy-goalx-2026-09-04-0721",
      "pre-deploy-goalx-2026-09-04-0421",
      "pre-deploy-goalx-2026-09-03-2107",
      "pre-deploy-goalx-2026-09-03-1958",
      "pre-deploy-goalx-2026-09-03-1838",
      "pre-deploy-goalx-2026-09-03-1544",
      "pre-deploy-goalx-2026-09-03-1121",
    ]) {
      expect(isBackupBranchName(name)).toBe(true)
    }
  })

  it("rejects the Production branch's own name", () => {
    expect(isBackupBranchName("production")).toBe(false)
    expect(isBackupBranchName("main")).toBe(false)
  })

  it("rejects anything that is not exactly the convention", () => {
    for (const name of [
      "pre-deploy-goalx-manual",
      "pre-deploy-goalx-2026-09-03",
      "pre-deploy-goalx-2026-09-03-112",
      "pre-deploy-goalx-2026-09-03-11211",
      "pre-deploy-goalx-2026-09-03-1121-copy",
      "restore-pre-deploy-goalx-2026-09-03-1121",
      " pre-deploy-goalx-2026-09-03-1121",
      "pre-deploy-goalx-2026-09-03-1121\n",
      "PRE-DEPLOY-GOALX-2026-09-03-1121",
      "",
    ]) {
      expect(isBackupBranchName(name)).toBe(false)
    }
  })

  it("rejects a well-shaped name that is not a real instant", () => {
    for (const name of [
      "pre-deploy-goalx-2026-13-03-1121", // month 13
      "pre-deploy-goalx-2026-00-03-1121", // month 0
      "pre-deploy-goalx-2026-02-31-1121", // 31 February
      "pre-deploy-goalx-2026-09-32-1121", // day 32
      "pre-deploy-goalx-2026-09-03-2500", // hour 25
      "pre-deploy-goalx-2026-09-03-1160", // minute 60
    ]) {
      expect(parseBackupBranchName(name)).toBeNull()
    }
  })
})
