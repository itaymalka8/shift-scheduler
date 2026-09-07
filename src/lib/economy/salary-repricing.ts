/**
 * PHASE 3R SALARY REPRICING - putting the league on the calibrated curve, and
 * keeping it there.
 *
 * WHAT THIS IS NOT: a migration. There is no "before" copy to restore and no
 * one-shot script to run by hand. Repricing is a CONVERGENCE, executed at the
 * top of every weekly settlement from the activation boundary onwards. The
 * first run moves the whole league onto the curve; every run after it finds
 * nothing to do and says so. That is a deliberately stronger guarantee than a
 * migration would give: the invariant "every active player's wage is exactly
 * what the salary authority says it is" is not established once and hoped
 * for, it is re-established weekly.
 *
 * WHY IT IS SAFE TO RUN AGAIN, ALWAYS. The target wage is a pure function of
 * four Player columns - overall, age, potential, primaryPosition - and of the
 * settlement instant. Player.weeklySalary is NEVER an input to its own
 * recalculation, so this is not a transformation of the stored value but a
 * recomputation of it from state this function does not modify. First run,
 * second run, a retry after a crash, a retry after a redeploy: same inputs,
 * same answer, and after the first one, zero writes. A wage derived from a
 * wage would compound on every retry and would be unrecoverable, because no
 * salary history is persisted anywhere in this codebase.
 *
 * WHY IT RUNS FIRST, INSIDE THE SETTLEMENT TRANSACTION. Sponsor income is
 * derived from the league's median weekly payroll and payroll is the wage
 * bill itself. If repricing ran alongside them - or in its own transaction -
 * a settlement could read a half-converted league and charge a wage bill that
 * never existed at any instant. Running it first, under the same lock and in
 * the same transaction, means every settlement in the calibrated era sees a
 * league that is wholly on the curve or wholly off it, and never in between.
 *
 * WHAT IT NEVER TOUCHES: FinancialTransaction rows and settled payroll. This
 * function writes Player.weeklySalary and nothing else. Repricing changes
 * what a club will pay NEXT; it has no opinion whatsoever about what a club
 * has already paid, and history is not rewritten to match a new curve.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma"
import { calculateAuthoritativeSalary, salaryAuthorityAt } from "./salary"
import { PHASE_3R_ACTIVATION_START } from "./config"

type DbClient = PrismaClient | Prisma.TransactionClient

export interface RepricingResult {
  /** Which authority priced this run - "legacy" means the run was a no-op by design. */
  authority: "legacy" | "phase3r"
  /** Active players examined. */
  examined: number
  /** Players whose stored wage already equalled the authority's answer. */
  alreadyCorrect: number
  /** Players this run actually rewrote. Zero on every run after the first. */
  repriced: number
  /** Wage bill before and after, for the report - never an input to anything. */
  weeklyBillBefore: number
  weeklyBillAfter: number
}

/**
 * Reprice every owned, career-ACTIVE player onto the authoritative curve for
 * `at`.
 *
 * BEFORE THE BOUNDARY THIS DOES NOTHING AT ALL. It does not reprice players
 * onto the legacy curve "for consistency": the legacy era's wages were set by
 * generation and by the season roll, including the initial-squad wage-bill
 * scaling that Phase 3R retires, and rewriting them would be a silent
 * economic change to a live league before the boundary that is supposed to
 * authorise it.
 */
export async function repriceLeagueSalaries(
  db: DbClient,
  at: Date,
  activationStart: Date = PHASE_3R_ACTIVATION_START
): Promise<RepricingResult> {
  const authority = salaryAuthorityAt(at, activationStart)
  if (authority === "legacy") {
    return {
      authority,
      examined: 0,
      alreadyCorrect: 0,
      repriced: 0,
      weeklyBillBefore: 0,
      weeklyBillAfter: 0,
    }
  }

  // Owned AND active. careerStatus is filtered explicitly rather than relying
  // on retirement happening to null teamId - the same reasoning payroll uses,
  // and for the same reason: a future phase that leaves a retired player
  // attached to a club must not silently get him repriced and paid.
  const players = await db.player.findMany({
    where: { teamId: { not: null }, careerStatus: "ACTIVE" },
    select: { id: true, overall: true, age: true, potential: true, primaryPosition: true, weeklySalary: true },
    orderBy: { id: "asc" },
  })

  let weeklyBillBefore = 0
  let weeklyBillAfter = 0
  let alreadyCorrect = 0

  // Grouped by TARGET wage, so the write cost is the number of distinct wages
  // in the league rather than the number of players. A first activation moves
  // over a thousand players in a few dozen statements instead of a thousand.
  const byTarget = new Map<number, string[]>()
  for (const player of players) {
    const target = calculateAuthoritativeSalary(player, at, undefined, activationStart)
    weeklyBillBefore += player.weeklySalary
    weeklyBillAfter += target
    if (player.weeklySalary === target) {
      alreadyCorrect++
      continue
    }
    const bucket = byTarget.get(target) ?? []
    bucket.push(player.id)
    byTarget.set(target, bucket)
  }

  let repriced = 0
  // Ascending target keeps the statement order deterministic, so two runs of
  // the same data issue the same statements in the same order - which is what
  // makes a partial failure reproducible rather than a new shape each time.
  for (const target of [...byTarget.keys()].sort((a, b) => a - b)) {
    const ids = byTarget.get(target) ?? []
    const updated = await db.player.updateMany({ where: { id: { in: ids } }, data: { weeklySalary: target } })
    repriced += updated.count
  }

  return { authority, examined: players.length, alreadyCorrect, repriced, weeklyBillBefore, weeklyBillAfter }
}
