/**
 * AUTONOMOUS PAYROLL - the league pays wages because game time passed, not
 * because a manager opened a web page.
 *
 * WHAT CHANGED AND WHY IT HAD TO. The previous implementation settled one
 * club at a time, from that club's own /economy page render, walking forward
 * from Team.createdAt and reading that club's roster separately for every
 * week it caught up. Three things were wrong with it and all three are fixed
 * here:
 *
 *   1. ONLY THREE OF SIXTY CLUBS COULD EVER PAY. A BOT club has no manager,
 *      so it had no path to a wage bill at all, while the cron charged every
 *      club for playing. The economy was asymmetric by construction.
 *
 *   2. A PLAYER COULD BE PAID TWICE, OR NOT AT ALL. Reading each club's
 *      roster in its own transaction means a transfer landing mid-sweep is
 *      seen by both sides or by neither: club A is charged for P, P moves to
 *      B, B is charged for P. The (teamId, referenceId) unique index does not
 *      catch that - both rows are legitimately distinct keys. THE FIX IS ONE
 *      ROSTER SNAPSHOT FOR THE WHOLE LEAGUE, taken once inside one
 *      transaction, so every player belongs to exactly one payer for that
 *      week. See settlePayrollWeek.
 *
 *   3. IT GOT SLOWER FOREVER. The catch-up loop's bound counted rows created,
 *      not weeks examined, so a fully-settled club still walked every week
 *      since its creation on every call. The window is now derived from the
 *      ACTIVATION BOUNDARY and a fixed look-back (payroll-clock.ts), so an
 *      idle tick costs the same three statements a year from now as today.
 *
 * WHAT DELIBERATELY DID NOT CHANGE: the Thursday 13:00 UTC clock, the
 * PAYROLL_<week> reference id, the aggregation of a club's whole squad into
 * one ledger row, and allowNegative - wages are mandatory and may take a club
 * below zero, which is the economic pressure the game is meant to create.
 *
 * THE ROSTER RULE, STATED RATHER THAN IMPLIED: payroll charges the OWNED,
 * career-ACTIVE squad AS IT EXISTS AT SETTLEMENT TIME. No salary history is
 * persisted anywhere in this codebase - Player.weeklySalary is overwritten on
 * every season roll - so reconstructing what a squad earned in a past week is
 * not merely unimplemented, it is impossible from the data that exists. The
 * obligation of this system is therefore to settle PROMPTLY (one cron tick
 * after the boundary), not to reconstruct. A long outage settles the roster
 * as it stands when the outage ends, and that is the documented rule.
 */
import { prisma } from "@/lib/prisma"
import { createFinancialTransaction } from "./service"
import {
  getMostRecentPayrollTime,
  getNextPayrollDate,
  isPayrollDueForTeam,
  payrollReferenceId,
  payrollWeekKey,
  payrollWindow,
} from "./payroll-clock"

export { getNextPayrollDate, payrollWeekKey, payrollReferenceId }

/** What one club owed, and whether this run is what charged it. */
export interface TeamPayrollCharge {
  teamId: string
  players: number
  amount: number
  /** False when a previous run had already settled this club for this week. */
  charged: boolean
}

export interface PayrollWeekResult {
  weekKey: string
  instant: Date
  /** Clubs for which this instant was due at all. */
  eligibleTeams: number
  /** Clubs this run actually debited. */
  teamsCharged: number
  /** Clubs that already had a ledger row for this week. */
  teamsAlreadySettled: number
  /** Total debited by THIS run, as a positive number. */
  totalCharged: number
  charges: TeamPayrollCharge[]
}

export interface PayrollRunResult {
  weeksSettled: PayrollWeekResult[]
  /** Weeks that were already complete for every eligible club - no work done. */
  weeksAlreadyComplete: number
  /** Post-activation weeks older than the look-back window. Non-zero is an incident. */
  weeksOutsideWindow: number
  totalCharged: number
}

/**
 * The advisory-lock key for one payroll week.
 *
 * pg_advisory_xact_lock takes a bigint, so the week key is hashed - through
 * PostgreSQL's own hashtext so the value is stable across processes and Node
 * versions rather than depending on a JS hash we would have to keep stable
 * ourselves. Namespaced with a literal prefix so it can never collide with an
 * advisory lock some other subsystem takes later.
 */
function payrollLockKey(weekKey: string): string {
  return `goalx:payroll:${weekKey}`
}

/**
 * SETTLE ONE PAYROLL WEEK FOR THE WHOLE LEAGUE, ATOMICALLY.
 *
 * Everything below happens inside ONE transaction:
 *
 *   1. A TRANSACTION-SCOPED ADVISORY LOCK on this week. Two scheduled runs
 *      overlapping - two cron instances, a retry racing the original - would
 *      otherwise each take their OWN roster snapshot. If a transfer landed
 *      between those two snapshots, each worker could win the ledger row for
 *      a different club and the same player's wage would be charged twice
 *      under two perfectly valid, perfectly distinct unique keys. The unique
 *      index cannot see that; the lock can. It is transaction-scoped, so it
 *      is released by commit or rollback and can never be leaked by a crash.
 *
 *   2. THE CLUB LIST AND THE ROSTER, READ UNDER THE LOCK. One query for the
 *      teams, one query for every ACTIVE owned player in the league. That
 *      single player read IS the canonical snapshot: a player appears under
 *      exactly one teamId in it, so exactly one club pays for him. Which club
 *      depends on whether a concurrent transfer committed before or after
 *      this read - either answer is correct, because both are one coherent
 *      instant. Neither double nor zero is reachable.
 *
 *   3. The ledger rows that already exist for this week, so a re-run charges
 *      nobody twice even before the unique index is consulted.
 *
 *   4. One FinancialTransaction per club, in ASCENDING TEAM ID ORDER. The
 *      order is a lock order, not an economic one: every club's charge is
 *      computed from the same snapshot and is independent of every other's,
 *      so no club can gain or lose from where it sits in the list. Ascending
 *      id is exactly the order lockTeamRosters uses, which is what stops this
 *      transaction and a concurrent transfer from forming a lock cycle over
 *      the same two clubs.
 *
 * If anything throws, the whole week rolls back: no club is left half-paid
 * and the next tick retries the same week from the beginning.
 */
export async function settlePayrollWeek(instant: Date): Promise<PayrollWeekResult> {
  const weekKey = payrollWeekKey(instant)
  const referenceId = payrollReferenceId(weekKey)

  return prisma.$transaction(
    async (tx) => {
      // 1. THE WEEK'S EXECUTION AUTHORITY. Transaction-scoped: released on
      // commit or rollback, never held by a dead session.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payrollLockKey(weekKey)}))`

      // 2a. Who is on the hook for this instant.
      const teams = await tx.team.findMany({ select: { id: true, createdAt: true }, orderBy: { id: "asc" } })
      const eligible = teams.filter((team) => isPayrollDueForTeam(instant, team))
      if (eligible.length === 0) {
        return {
          weekKey,
          instant,
          eligibleTeams: 0,
          teamsCharged: 0,
          teamsAlreadySettled: 0,
          totalCharged: 0,
          charges: [],
        }
      }
      const eligibleIds = eligible.map((team) => team.id)

      // 2b. THE CANONICAL LEAGUE ROSTER SNAPSHOT - one query, one instant.
      // careerStatus is filtered EXPLICITLY. It used to be ACTIVE-only only
      // by accident, because retirement happens to null teamId; relying on
      // that would mean a future phase that left a retired player attached to
      // a club would silently have his wages paid.
      const players = await tx.player.findMany({
        where: { teamId: { in: eligibleIds }, careerStatus: "ACTIVE" },
        select: { teamId: true, weeklySalary: true },
      })

      const wageBill = new Map<string, { players: number; amount: number }>()
      for (const player of players) {
        if (!player.teamId) continue
        const bucket = wageBill.get(player.teamId) ?? { players: 0, amount: 0 }
        bucket.players += 1
        bucket.amount += player.weeklySalary
        wageBill.set(player.teamId, bucket)
      }

      // 3. What is already settled, so a re-run is a no-op rather than a
      // sixty-fold no-op discovered one unique violation at a time.
      const existing = await tx.financialTransaction.findMany({
        where: { teamId: { in: eligibleIds }, referenceId },
        select: { teamId: true },
      })
      const alreadySettled = new Set(existing.map((row) => row.teamId))

      // 4. One row per club, ascending id.
      const charges: TeamPayrollCharge[] = []
      let totalCharged = 0
      for (const team of eligible) {
        const bill = wageBill.get(team.id)
        // A club with nobody on its books owes nothing and gets no ledger
        // row - a zero-valued wage entry would be a worse story than silence.
        if (!bill || bill.amount === 0) {
          charges.push({ teamId: team.id, players: bill?.players ?? 0, amount: 0, charged: false })
          continue
        }
        if (alreadySettled.has(team.id)) {
          charges.push({ teamId: team.id, players: bill.players, amount: bill.amount, charged: false })
          continue
        }

        await createFinancialTransaction(tx, {
          teamId: team.id,
          type: "playerSalaries",
          amount: -bill.amount,
          description: `משכורות שבועיות (${bill.players} שחקנים)`,
          referenceId,
        })
        totalCharged += bill.amount
        charges.push({ teamId: team.id, players: bill.players, amount: bill.amount, charged: true })
      }

      return {
        weekKey,
        instant,
        eligibleTeams: eligible.length,
        teamsCharged: charges.filter((charge) => charge.charged).length,
        teamsAlreadySettled: alreadySettled.size,
        totalCharged,
        charges,
      }
    },
    // A league-wide week is sixty inserts, sixty balance updates and two
    // reads. It measures in the low hundreds of milliseconds at this scale;
    // the headroom is for a tick queued behind a matchday holding the same
    // Team rows.
    { timeout: 60_000, maxWait: 20_000 }
  )
}

/**
 * THE SCHEDULED ENTRY POINT: settle every payroll week that is due and not
 * yet settled, OLDEST FIRST.
 *
 * Three statements on an idle tick - the window query is pure arithmetic, and
 * the two database reads below are bounded by the calendar rather than by how
 * old any club is. Chronology is strict: if an older week fails, the run
 * stops there rather than settling a newer week on top of an unsettled older
 * one.
 */
export async function settleDuePayroll(now: Date = new Date()): Promise<PayrollRunResult> {
  const window = payrollWindow(now)
  const result: PayrollRunResult = {
    weeksSettled: [],
    weeksAlreadyComplete: 0,
    weeksOutsideWindow: window.weeksOutsideWindow,
    totalCharged: 0,
  }
  if (window.instants.length === 0) return result

  // ONE read that answers "which of the candidate weeks still needs work",
  // for the entire league at once. Its cost is the size of the calendar
  // window, never the age of a club.
  const referenceIds = window.instants.map((instant) => payrollReferenceId(payrollWeekKey(instant)))
  const [teams, settled] = await Promise.all([
    prisma.team.findMany({ select: { id: true, createdAt: true } }),
    prisma.financialTransaction.findMany({
      where: { type: "playerSalaries", referenceId: { in: referenceIds } },
      select: { teamId: true, referenceId: true },
    }),
  ])

  const settledByWeek = new Map<string, Set<string>>()
  for (const row of settled) {
    const bucket = settledByWeek.get(row.referenceId) ?? new Set<string>()
    bucket.add(row.teamId)
    settledByWeek.set(row.referenceId, bucket)
  }

  for (const instant of window.instants) {
    const referenceId = payrollReferenceId(payrollWeekKey(instant))
    const eligible = teams.filter((team) => isPayrollDueForTeam(instant, team))
    const done = settledByWeek.get(referenceId) ?? new Set<string>()
    if (eligible.length > 0 && eligible.every((team) => done.has(team.id))) {
      result.weeksAlreadyComplete++
      continue
    }
    if (eligible.length === 0) {
      result.weeksAlreadyComplete++
      continue
    }

    const week = await settlePayrollWeek(instant)
    result.weeksSettled.push(week)
    result.totalCharged += week.totalCharged
  }

  return result
}

/**
 * What the /economy page shows: the last payroll week this club actually
 * paid, read from the ledger. Read-only - the page is no longer a clock.
 */
export async function readLastSettledPayroll(teamId: string): Promise<{ weekKey: string; amount: number } | null> {
  const row = await prisma.financialTransaction.findFirst({
    where: { teamId, type: "playerSalaries" },
    orderBy: { referenceId: "desc" },
    select: { referenceId: true, amount: true },
  })
  if (!row) return null
  return { weekKey: row.referenceId.replace(/^PAYROLL_/, ""), amount: -row.amount }
}

/** The payroll instant the league is currently settled through, for diagnostics. */
export function payrollDueThrough(now: Date = new Date()): Date {
  return getMostRecentPayrollTime(now)
}
