import { prisma } from "@/lib/prisma"
import { createFinancialTransaction } from "./service"
import { PAYROLL_WEEKDAY, PAYROLL_HOUR_UTC } from "./config"

const MS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_WEEKS_TO_BACKFILL = 52 // a season's worth - a safety cap, not an expected case

/** ISO-ish week key for a payroll reference, e.g. "2026_W35" - stable, sortable, human-readable in the ledger. */
function payrollWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7)
  return `${d.getUTCFullYear()}_W${String(weekNo).padStart(2, "0")}`
}

/** The most recent payroll weekday/hour at or before `date`, in UTC - never the viewer's local clock. */
function getMostRecentPayrollTime(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), PAYROLL_HOUR_UTC, 0, 0))
  const diff = (d.getUTCDay() - PAYROLL_WEEKDAY + 7) % 7
  d.setUTCDate(d.getUTCDate() - diff)
  if (d.getTime() > date.getTime()) d.setUTCDate(d.getUTCDate() - 7)
  return d
}

function getFirstPayrollDueAfter(createdAt: Date): Date {
  const candidate = getMostRecentPayrollTime(createdAt)
  return candidate.getTime() < createdAt.getTime() ? new Date(candidate.getTime() + 7 * MS_PER_DAY) : candidate
}

export function getNextPayrollDate(now: Date = new Date()): Date {
  return new Date(getMostRecentPayrollTime(now).getTime() + 7 * MS_PER_DAY)
}

/**
 * Pays one club's squad for the payroll week that `at` falls in - summing
 * every player's weeklySalary into a single playerSalaries transaction.
 * Idempotent via the Economy Service: calling this twice for the same week
 * is a safe no-op, never a double charge.
 */
export async function processWeeklyPayroll(teamId: string, at: Date = new Date()) {
  const weekKey = payrollWeekKey(getMostRecentPayrollTime(at))
  const referenceId = `PAYROLL_${weekKey}`

  const players = await prisma.player.findMany({ where: { teamId }, select: { weeklySalary: true } })
  const totalWeeklyPlayerSalaries = players.reduce((sum, p) => sum + p.weeklySalary, 0)
  if (players.length === 0) return null

  return prisma.$transaction((tx) =>
    createFinancialTransaction(tx, {
      teamId,
      type: "playerSalaries",
      amount: -totalWeeklyPlayerSalaries,
      description: `משכורות שבועיות (${players.length} שחקנים)`,
      referenceId,
    })
  )
}

/**
 * Self-heal, run on every economy/dashboard page load (same pattern as
 * settleDueFixtures / settleDueStadiumConstruction) - catches up every
 * payroll week that has come due since the club was created (or last paid),
 * so wages are never skipped just because nobody visited on a Monday. Server
 * time only - never a browser-side timer.
 */
export async function settleDuePayroll(teamId: string): Promise<number> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { createdAt: true } })
  const now = new Date()
  const dueThrough = getMostRecentPayrollTime(now)

  let cursor = getFirstPayrollDueAfter(team.createdAt)
  let paid = 0
  while (cursor.getTime() <= dueThrough.getTime() && paid < MAX_WEEKS_TO_BACKFILL) {
    const result = await processWeeklyPayroll(teamId, cursor)
    if (result) paid++
    cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY)
  }
  return paid
}
