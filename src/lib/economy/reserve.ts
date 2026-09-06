/**
 * THE FOUR-WEEK OPERATING RESERVE - what a club must keep back before it is
 * allowed to spend on anything it merely WANTS.
 *
 * WHAT IT IS: a club may commit discretionary money only down to four weeks of
 * its own current wage bill, never below. Four weeks because the payroll clock
 * runs weekly and a season's calendar puts roughly four wage payments between
 * one transfer window and a manager's next real chance to correct course - so
 * the reserve is "a month of wages", expressed in the units the game actually
 * pays in rather than in a round number of days.
 *
 * WHY IT EXISTS. The calibration deliberately left the economy able to produce
 * rare negative balances, and deliberately built no bankruptcy, no loans, no
 * administration and no automatic rescue. That combination only works if a
 * club cannot spend itself into insolvency in a single click. The reserve is
 * the one guard rail between "management involves consequences" and "one bad
 * purchase ends a save" - and it guards the wage bill specifically, because
 * wages are the charge that arrives every week whether or not the manager is
 * paying attention.
 *
 * IT SCALES WITH THE CLUB, NOT WITH THE LEAGUE. A club carrying a 400,000
 * weekly wage bill must hold back four times what a club on 100,000 does. That
 * is the point: the reserve is a function of the commitments a manager has
 * already taken on, so signing expensive players makes the NEXT signing harder
 * rather than being free until the balance runs out.
 *
 * WHAT IT NEVER BLOCKS. Mandatory charges - payroll, stadium maintenance,
 * match-day expenses, away travel and fan fines - ignore it completely. They
 * are not decisions and there is nothing to guard against; a reserve that
 * could block payroll would simply stop the economy rather than protect it.
 * Release ignores it too, and that one is deliberate to the point of being the
 * opposite rule: releasing a player is a club's CORRECTIVE action, the way out
 * of exactly the trouble the reserve exists to prevent, so it must stay
 * available to a club that is already under pressure - see release.ts.
 *
 * HUMAN AND BOT ARE IDENTICAL. The rule reads a balance and a wage bill and
 * knows nothing else; there is no club-type input for a future edit to reach
 * for.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma"
import { phase3rIsActive } from "./activation"

type DbClient = PrismaClient | Prisma.TransactionClient

/** How many weeks of the club's own wage bill must stay untouchable. */
export const OPERATING_RESERVE_WEEKS = 4

/** The cash a club must keep back, given its current weekly wage bill. */
export function operatingReserve(weeklyPayroll: number): number {
  return Math.max(0, Math.round(weeklyPayroll * OPERATING_RESERVE_WEEKS))
}

/**
 * What a club may actually commit to a discretionary purchase right now.
 * Never negative: a club already below its reserve has nothing to spend, it
 * does not owe the difference.
 */
export function discretionaryHeadroom(balance: number, weeklyPayroll: number): number {
  return Math.max(0, balance - operatingReserve(weeklyPayroll))
}

export interface ReserveDecision {
  allowed: boolean
  balance: number
  weeklyPayroll: number
  reserve: number
  headroom: number
  cost: number
}

export function evaluateDiscretionarySpend(balance: number, weeklyPayroll: number, cost: number): ReserveDecision {
  const reserve = operatingReserve(weeklyPayroll)
  const headroom = discretionaryHeadroom(balance, weeklyPayroll)
  return { allowed: cost <= headroom, balance, weeklyPayroll, reserve, headroom, cost }
}

/**
 * The club's CURRENT total weekly wage bill, read through the caller's own
 * transaction client.
 *
 * THE CLIENT MATTERS AND IS NOT A DETAIL. The balance and the wage bill must
 * be read under the same locks that will authorise the spend, or the rule is
 * decorative: a squad change committing between the two reads would let a
 * purchase be approved against a reserve the club no longer has. Every caller
 * therefore passes the transaction it is about to write in - never the global
 * client.
 */
export async function readWeeklyPayroll(db: DbClient, teamId: string): Promise<number> {
  const aggregate = await db.player.aggregate({
    where: { teamId, careerStatus: "ACTIVE" },
    _sum: { weeklySalary: true },
  })
  return aggregate._sum.weeklySalary ?? 0
}

/**
 * The one call a discretionary spend makes.
 *
 * BEFORE THE ACTIVATION BOUNDARY THIS ALLOWS EVERYTHING. The reserve is part
 * of the calibrated economy and turns on with the rest of it. Enforcing it
 * early would be strictly harsher than it will ever be again - pre-3R wage
 * bills are roughly twice their calibrated size, so a four-week reserve
 * computed against them would lock managers out of a market the current
 * economy was never balanced to restrict.
 */
export async function evaluateDiscretionarySpendForTeam(
  db: DbClient,
  teamId: string,
  balance: number,
  cost: number,
  at: Date = new Date()
): Promise<ReserveDecision> {
  if (!phase3rIsActive(at)) {
    return { allowed: true, balance, weeklyPayroll: 0, reserve: 0, headroom: balance, cost }
  }
  const weeklyPayroll = await readWeeklyPayroll(db, teamId)
  return evaluateDiscretionarySpend(balance, weeklyPayroll, cost)
}
