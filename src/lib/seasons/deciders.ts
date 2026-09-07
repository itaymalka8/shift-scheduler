/**
 * Creating the one fixture that settles a title the table could not.
 *
 * Writes, locking and idempotency live here; the rules for WHEN it kicks off
 * and WHO is nominally home are pure and live in ./decider.ts.
 */
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { computeDeciderSchedule, technicalHomeAway } from "./decider"

export interface CreatedDecider {
  fixtureId: string
  divisionId: string
  homeTeamId: string
  awayTeamId: string
  scheduledAt: Date
  matchday: number
  /** False when another runner had already created it - not an error. */
  created: boolean
}

/** The decider already on this division, if any. At most one can exist - the partial unique index says so. */
export async function findDecider(tx: Prisma.TransactionClient, divisionId: string) {
  return tx.fixture.findFirst({
    where: { divisionId, stage: "TITLE_DECIDER" },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      scheduledAt: true,
      matchday: true,
      playedAt: true,
      homeScore: true,
      awayScore: true,
      homeShootoutScore: true,
      awayShootoutScore: true,
    },
  })
}

/**
 * Ensures a division has exactly one title decider, and returns it.
 *
 * Called from inside the orchestrator's ACTIVE branch, which already holds
 * the Season row lock - so two runners are serialised before they get here
 * and the loser simply finds the fixture already present. The partial unique
 * index Fixture_divisionId_title_decider_key is the authority underneath
 * that: even a code path that never took the lock cannot produce a second
 * decider, it gets a P2002 and reads back the winner's row.
 *
 * Takes no Division lock and no Fixture lock, so it introduces no new lock
 * ordering and cannot deadlock against ensureFixtureSimulated (Fixture row)
 * or ensureDivisionFixtures (Division row).
 */
export async function ensureTitleDecider(
  tx: Prisma.TransactionClient,
  input: { divisionId: string; tiedTeamIds: string[]; now: Date }
): Promise<CreatedDecider> {
  const existing = await findDecider(tx, input.divisionId)
  if (existing) {
    return {
      fixtureId: existing.id,
      divisionId: input.divisionId,
      homeTeamId: existing.homeTeamId,
      awayTeamId: existing.awayTeamId,
      scheduledAt: existing.scheduledAt as Date,
      matchday: existing.matchday,
      created: false,
    }
  }

  const { homeTeamId, awayTeamId } = technicalHomeAway(input.tiedTeamIds)

  // The cadence is re-derived from the division's own league fixtures, so
  // the decider lands in the same Mon/Wed/Sat rhythm as every other match
  // and two runners computing it separately get the same answer.
  const anchor = await tx.fixture.findFirst({
    where: { divisionId: input.divisionId, stage: "LEAGUE" },
    orderBy: { scheduledAt: "asc" },
    select: { scheduledAt: true },
  })
  const last = await tx.fixture.findFirst({
    where: { divisionId: input.divisionId, stage: "LEAGUE" },
    orderBy: { matchday: "desc" },
    select: { matchday: true },
  })
  if (!anchor?.scheduledAt || !last) {
    throw new Error(`Division ${input.divisionId} has no scheduled LEAGUE fixtures to anchor a decider to.`)
  }

  const { scheduledAt, matchday } = computeDeciderSchedule(anchor.scheduledAt, last.matchday, input.now)

  try {
    const fixture = await tx.fixture.create({
      data: {
        divisionId: input.divisionId,
        stage: "TITLE_DECIDER",
        matchday,
        homeTeamId,
        awayTeamId,
        scheduledAt,
      },
      select: { id: true },
    })
    return { fixtureId: fixture.id, divisionId: input.divisionId, homeTeamId, awayTeamId, scheduledAt, matchday, created: true }
  } catch (error) {
    // The index won the race. Read back what the winner wrote rather than
    // failing - the same resolution upsertNextSeasonRow already uses.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findDecider(tx, input.divisionId)
      if (winner) {
        return {
          fixtureId: winner.id,
          divisionId: input.divisionId,
          homeTeamId: winner.homeTeamId,
          awayTeamId: winner.awayTeamId,
          scheduledAt: winner.scheduledAt as Date,
          matchday: winner.matchday,
          created: false,
        }
      }
    }
    throw error
  }
}

/** Every division of this season that already has a decider, by divisionId. */
export async function loadDecidersForSeason(seasonId: string) {
  const rows = await prisma.fixture.findMany({
    where: { stage: "TITLE_DECIDER", division: { seasonId } },
    select: {
      id: true,
      divisionId: true,
      homeTeamId: true,
      awayTeamId: true,
      scheduledAt: true,
      playedAt: true,
      homeScore: true,
      awayScore: true,
      homeShootoutScore: true,
      awayShootoutScore: true,
    },
  })
  return new Map(rows.map((r) => [r.divisionId, r]))
}
