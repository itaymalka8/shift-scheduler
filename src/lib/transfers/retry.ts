import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { TransferError } from "./errors"

// 1 initial attempt + up to 2 retries, P2034 (Postgres serialization
// failure) only. No other error - including every TransferError - is ever
// retried; a domain rejection or an unexpected error propagates on the
// first attempt.
const MAX_ATTEMPTS = 3

function isSerializationFailure(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2034"
}

/**
 * Retry policy in isolation from Prisma, so it can be unit-tested with a
 * plain function instead of a real transaction. Re-runs `run` from scratch
 * on each P2034; after MAX_ATTEMPTS consecutive P2034s, raises a domain
 * TRANSFER_CONFLICT instead of letting the raw Prisma error escape.
 */
export async function withSerializableRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (!isSerializationFailure(error)) throw error
      if (attempt === MAX_ATTEMPTS) {
        throw new TransferError("TRANSFER_CONFLICT", "Too many concurrent transfer conflicts - please retry")
      }
      // else: loop again, running `run` fully from scratch.
    }
  }
  /* istanbul ignore next - unreachable, the loop above always returns or throws */
  throw new Error("unreachable")
}

/**
 * Runs `fn` inside a fresh Postgres Serializable transaction, with the
 * P2034 retry policy above wrapped around the whole thing.
 */
export function runSerializableTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withSerializableRetry(() =>
    prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  )
}
