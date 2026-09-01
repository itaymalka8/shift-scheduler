import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { TransferError } from "./errors"

// 1 initial attempt + up to 2 retries, Postgres serialization failures only.
// No other error - including every TransferError - is ever retried; a domain
// rejection or an unexpected error propagates on the first attempt.
const MAX_ATTEMPTS = 3

// Serialization failure (40001) and deadlock (40P01). Retrying these is only
// ever a backstop: the primary defence against a deadlock is the shared
// lock-ordering contract in src/lib/players/locks.ts, which stops the cycle
// from forming at all. 40001 is different - it is the normal, expected way a
// Serializable transaction loses a race, and is exactly what this policy
// exists to absorb.
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"])

function isSerializationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = (error as { code?: unknown }).code

  // Prisma's own mapped code, raised when a normal (non-raw) query loses.
  if (code === "P2034") return true

  // The same Postgres failure raised inside a raw query - $queryRaw, which
  // is how the shared Player row lock is taken - does NOT come back as
  // P2034. It arrives as P2010 with the real SQLSTATE in structured meta.
  // Read that field; never parse the free-text message, which is not a
  // stable contract.
  if (code !== "P2010") return false
  const meta = (error as { meta?: unknown }).meta
  if (!meta || typeof meta !== "object") return false
  const sqlState = (meta as { code?: unknown }).code
  return typeof sqlState === "string" && RETRYABLE_SQLSTATES.has(sqlState)
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
