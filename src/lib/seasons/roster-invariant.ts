/**
 * THE ONE JUDGEMENT: is this club's squad in a state the new season can start
 * from?
 *
 * Pure - no Prisma, no I/O. The rows are read by the caller, because there are
 * two callers with two different clients and only one of them can ever be the
 * app's own: the orchestrator's pre-CREATE_NEXT gate reads through
 * `@/lib/prisma`, and the production verifier reads through the read-only
 * production client. Only the READ differs. The verdict is here, once, so the
 * gate that blocks a season roll and the report a human reads before deploying
 * can never disagree about what "ready" means.
 */
import { MAX_ACTIVE_ROSTER_SIZE } from "@/lib/players/roster"
import { failedConstraints, type RosterCounts } from "@/lib/players/roster-floor"

export interface RosterInvariantFailure {
  teamId: string
  reason: string
}

/** Exactly what the verdict needs to know about one club's current lineup. */
export interface LineupReading {
  legal: boolean
  starters: number
  slotCount: number
  problems: string[]
}

export interface TeamRosterReading {
  teamId: string
  /** Whether this club has a SquadReplenishment row for the season being judged. */
  replenished: boolean
  counts: RosterCounts
  lineup: LineupReading
}

/**
 * The reason this club is not ready, or null when it is. Ordered deliberately:
 * a club with no ledger row has not been replenished at all, so its counts and
 * lineup are not evidence of anything yet.
 */
export function judgeTeamRoster(reading: TeamRosterReading): RosterInvariantFailure | null {
  if (!reading.replenished) {
    return { teamId: reading.teamId, reason: "no SquadReplenishment ledger row" }
  }
  const counts = reading.counts
  const failed = failedConstraints(counts)
  if (failed.length > 0) {
    return {
      teamId: reading.teamId,
      reason: `breaches ${failed.join(", ")} (total=${counts.total} GK=${counts.GK} DEF=${counts.DF} MID=${counts.MF} ATT=${counts.FW})`,
    }
  }
  if (counts.total > MAX_ACTIVE_ROSTER_SIZE) {
    return { teamId: reading.teamId, reason: `exceeds the roster cap: ${counts.total}` }
  }
  if (!reading.lineup.legal) {
    return {
      teamId: reading.teamId,
      reason: `no legal XI: ${reading.lineup.starters}/${reading.lineup.slotCount} [${reading.lineup.problems.join(",")}]`,
    }
  }
  return null
}
