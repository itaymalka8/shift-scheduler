/**
 * Read-only: one manager's record for one era, from fixtures that already
 * exist. Writes nothing, and never triggers a simulation.
 *
 * ANTI-SPOILER, STRUCTURALLY. The query below cannot fetch a live match's
 * score, because it never selects a live match at all: `scheduledAt <=
 * now - MATCH_REAL_DURATION_MINUTES` is exactly `isMatchFinished`, pushed
 * down into SQL. A match still inside its 10-real-minute window is outside
 * the result set, so its stored final score - which the engine wrote at
 * kickoff - never reaches this process. computeManagerRecord then re-checks
 * with the real isMatchFinished helper as defence in depth, mirroring how
 * the /matches page and the Match Center API each isolate their own
 * finished-only reads.
 */
import { prisma } from "@/lib/prisma"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import { computeManagerRecord, type ManagerRecord } from "./era"

export type { ManagerRecord }

export interface EraRef {
  teamId: string
  startedAt: Date
  endedAt: Date | null
}

/**
 * The record a manager built up during one era.
 *
 * `now` is taken as a parameter (defaulting to the real clock) so a caller
 * rendering a page derives every number from one instant rather than from a
 * clock that moves between queries.
 */
export async function getManagerRecordForEra(era: EraRef, now: Date = new Date()): Promise<ManagerRecord> {
  const liveWindowCutoff = new Date(now.getTime() - MATCH_REAL_DURATION_MINUTES * 60_000)

  // An era that has not started yet, or whose whole window is still inside
  // the live cutoff, can have no finished match - skip the query entirely.
  if (era.startedAt.getTime() > liveWindowCutoff.getTime()) return computeManagerRecord(era, [], now)

  const fixtures = await prisma.fixture.findMany({
    where: {
      OR: [{ homeTeamId: era.teamId }, { awayTeamId: era.teamId }],
      // The era window, half-open, expressed in SQL exactly as the pure
      // rule expresses it (see era.ts).
      scheduledAt: {
        gte: era.startedAt,
        // Whichever is earlier: the end of the era, or the live-window
        // cutoff. `lt` for the era end keeps the window half-open; `lte`
        // for the cutoff matches isMatchFinished's `>=` on elapsed time.
        ...(era.endedAt && era.endedAt.getTime() <= liveWindowCutoff.getTime()
          ? { lt: era.endedAt }
          : { lte: liveWindowCutoff }),
      },
      // A fixture the scheduler never simulated has no result to count.
      playedAt: { not: null },
    },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      scheduledAt: true,
      playedAt: true,
      homeScore: true,
      awayScore: true,
    },
  })

  // The era's own end still has to be applied when it falls AFTER the
  // cutoff (the branch above widened to the cutoff in that case), which
  // computeManagerRecord does via fixtureBelongsToEra.
  return computeManagerRecord(era, fixtures, now)
}
