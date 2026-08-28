import type { Prisma, PrismaClient } from "@/generated/prisma"

type DbClient = PrismaClient | Prisma.TransactionClient

export class InsufficientFundsError extends Error {
  constructor(public readonly balance: number, public readonly required: number) {
    super("INSUFFICIENT_FUNDS")
  }
}

/**
 * The only place any part of the game should touch Team.balance. Every
 * system that spends or earns club money (stadium construction today;
 * wages, transfers, ticket revenue elsewhere later) goes through this, so
 * "what changed a club's balance and why" never has to be reconstructed
 * from scattered direct writes.
 */
export async function adjustClubBalance(
  db: DbClient,
  teamId: string,
  delta: number,
  options: { allowNegative?: boolean } = {}
): Promise<number> {
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId }, select: { balance: true } })
  const nextBalance = team.balance + delta

  if (nextBalance < 0 && !options.allowNegative) {
    throw new InsufficientFundsError(team.balance, -delta)
  }

  const updated = await db.team.update({ where: { id: teamId }, data: { balance: nextBalance } })
  return updated.balance
}
