import type { Prisma, PrismaClient } from "@/generated/prisma"
import { adjustClubBalance, InsufficientFundsError } from "@/lib/finance/balance"

type DbClient = PrismaClient | Prisma.TransactionClient

export const FINANCIAL_TRANSACTION_TYPES = [
  "matchRevenue",
  "matchExpense",
  "playerSalaries",
  "stadiumConstruction",
  "stadiumMaintenance",
  "transferPurchase",
  "transferSale",
  "sponsorIncome",
  "other",
] as const

export type FinancialTransactionType = (typeof FINANCIAL_TRANSACTION_TYPES)[number]

export interface FinancialTransactionInput {
  teamId: string
  type: FinancialTransactionType
  /** Signed: positive = income, negative = expense. */
  amount: number
  description: string
  /**
   * Idempotency key, unique per (teamId, referenceId) - e.g.
   * "MATCH_9842_HOME_EXPENSE" or "PAYROLL_2026_W35_CLUB_123". Calling this
   * again with a referenceId already used for this team is a safe no-op:
   * no second ledger row, no second balance change.
   */
  referenceId: string
  /** Discretionary spends (stadium construction) block on insufficient
   * funds; mandatory recurring costs (wages, match-day costs) don't -
   * running the balance negative there IS the economic-pressure signal the
   * game is meant to create. Defaults to true (mandatory). */
  allowNegative?: boolean
}

/**
 * The Economy Service - the only function in the codebase allowed to change
 * Team.balance. Every caller (stadium construction, match revenue/expenses,
 * payroll, and anything added later) goes through this, so "what changed a
 * club's balance and why" is always the FinancialTransaction table, never
 * scattered direct writes.
 *
 * Idempotent: relies on the (teamId, referenceId) unique constraint as the
 * real safety net (not just a pre-check, which a race could slip past) - a
 * duplicate call, even a genuinely concurrent one, always either creates
 * exactly one transaction or none. Ledger write and balance update happen
 * against the same `db` client, so if the caller wraps this in
 * prisma.$transaction, both commit or roll back together.
 */
export async function createFinancialTransaction(
  db: DbClient,
  input: FinancialTransactionInput
): Promise<{ id: string; balance: number } | null> {
  let createdId: string
  try {
    const created = await db.financialTransaction.create({
      data: {
        teamId: input.teamId,
        type: input.type,
        amount: input.amount,
        description: input.description,
        referenceId: input.referenceId,
      },
    })
    createdId = created.id
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      return null // already processed under this referenceId - safe no-op
    }
    throw error
  }

  const balance = await adjustClubBalance(db, input.teamId, input.amount, {
    allowNegative: input.allowNegative ?? true,
  })

  return { id: createdId, balance }
}

export { InsufficientFundsError }
