// UTC on purpose - a backup branch name must never be ambiguous about when
// it was taken regardless of which machine or timezone triggered it.
export function formatBackupBranchName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const year = now.getUTCFullYear()
  const month = pad(now.getUTCMonth() + 1)
  const day = pad(now.getUTCDate())
  const hours = pad(now.getUTCHours())
  const minutes = pad(now.getUTCMinutes())
  return `pre-deploy-goalx-${year}-${month}-${day}-${hours}${minutes}`
}
