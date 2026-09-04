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

// The ONE definition of "this branch is a GoalX pre-deploy backup". Deletion
// tooling must never decide that from a substring, a prefix check, or a
// human reading a name off a list - it asks here, and here the whole name
// has to match the exact shape formatBackupBranchName produces, anchored at
// both ends. A branch called "pre-deploy-goalx-manual" or
// "pre-deploy-goalx-2026-09-03-1121-copy" is NOT a backup by this
// definition, and that is deliberate: an unrecognised name is a branch
// somebody created for a reason this code does not know about.
const BACKUP_BRANCH_NAME = /^pre-deploy-goalx-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/

export interface ParsedBackupBranchName {
  name: string
  takenAt: Date
}

/**
 * Returns the UTC instant encoded in a backup branch name, or null if the
 * name is not a GoalX pre-deploy backup name at all. Also returns null when
 * the name is well-shaped but not a real calendar instant (month 13, day 32,
 * hour 25) - a name that cannot be a moment in time cannot be trusted to
 * order backups, so it does not count as a backup.
 */
export function parseBackupBranchName(name: string): ParsedBackupBranchName | null {
  const match = BACKUP_BRANCH_NAME.exec(name)
  if (!match) return null
  const [, year, month, day, hours, minutes] = match.map(Number) as unknown as number[]
  const takenAt = new Date(Date.UTC(year, month - 1, day, hours, minutes))
  // Round-tripping catches every out-of-range field at once: Date.UTC
  // silently rolls 2026-02-31 over into March, and the reformatted name
  // then differs from the one we were given.
  if (formatBackupBranchName(takenAt) !== name) return null
  return { name, takenAt }
}

export function isBackupBranchName(name: string): boolean {
  return parseBackupBranchName(name) !== null
}
