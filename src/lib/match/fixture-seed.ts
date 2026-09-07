/**
 * THE FIXTURE'S RANDOM DRAW, COMMITTED BEFORE THE MATCH IS PLAYED.
 *
 * A fixture's matchSeed decides everything stochastic about it - the engine's
 * events and, through a salted stream, the attendance roll. It used to be
 * persisted only by the same UPDATE that writes the score, which meant an
 * attempt that failed anywhere before that point left the column null, and the
 * retry generated a fresh seed. The same fixture, replayed, produced a
 * different crowd, different gate receipts and a different result, with nothing
 * anywhere recording that the first draw had existed.
 *
 * Committing the seed first makes it a fact about the FIXTURE rather than about
 * whichever attempt happened to succeed. A retry then replays the same match
 * instead of rolling a new one.
 */
import { prisma } from "@/lib/prisma"
import { generateMatchSeed } from "./engine/rng"

/**
 * Returns the fixture's seed, generating and committing one if it has none.
 *
 * ITS OWN TRANSACTION, deliberately. Inside the simulation transaction the
 * write would roll back with everything else on a failure, which is exactly
 * the defect this closes.
 *
 * CONCURRENCY. Two workers preparing the same fixture converge on one seed:
 *
 *   - Both issue the conditional UPDATE. It takes a row-level write lock, so
 *     one proceeds and the other blocks.
 *   - The winner matches `matchSeed IS NULL`, writes its seed and commits.
 *   - The loser is released, re-evaluates its WHERE against the newly committed
 *     row version (READ COMMITTED) and matches nothing, so it updates ZERO
 *     rows. It then reads the row back and adopts the winner's seed.
 *
 * The `AND "matchSeed" IS NULL` predicate is the whole mechanism. Without it
 * the loser's UPDATE would overwrite the winner's seed and the two workers
 * would simulate different matches.
 *
 * `known` lets the caller skip both statements when it has already read a
 * non-null seed - the overwhelmingly common case after the first attempt.
 */
export async function ensureFixtureSeed(fixtureId: string, known: string | null): Promise<string> {
  if (known) return known

  const candidate = generateMatchSeed()
  await prisma.$executeRaw`
    UPDATE "Fixture" SET "matchSeed" = ${candidate}
     WHERE "id" = ${fixtureId} AND "matchSeed" IS NULL
  `

  // Read back unconditionally rather than trusting the update count: whether we
  // won or lost the race, the committed value is the authority, and a loser
  // that used its own candidate would be simulating a different match.
  const row = await prisma.fixture.findUnique({ where: { id: fixtureId }, select: { matchSeed: true } })
  if (!row?.matchSeed) {
    throw new Error(`Fixture ${fixtureId} has no matchSeed after seed preparation`)
  }
  return row.matchSeed
}
