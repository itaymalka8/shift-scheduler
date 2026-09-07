/**
 * Gives every pre-existing club an ownership history, from sources already
 * in the database. Pure classification lives here; the script that runs it
 * against Production is scripts/production/backfill-team-eras.ts.
 *
 * DETERMINISTIC, NOT GUESSED. There are exactly three shapes a club can be
 * in, and each is decided by timestamps that already exist:
 *
 *  1. userId IS NULL                -> still a bot. One open BOT era from
 *                                      Team.createdAt.
 *
 *  2. userId set, Team.createdAt <  User.createdAt
 *                                   -> TAKEN OVER. The club existed before
 *                                      the person did, which only happens
 *                                      when it was seeded as a bot and later
 *                                      claimed. Registration creates the
 *                                      User as the FIRST statement of the
 *                                      same transaction that flips the club
 *                                      to human (see the takeover branch in
 *                                      src/app/api/register/route.ts), so
 *                                      User.createdAt IS the takeover
 *                                      instant, to within that transaction.
 *                                      BOT era  [Team.createdAt, User.createdAt)
 *                                      HUMAN era [User.createdAt, open)
 *
 *  3. userId set, Team.createdAt >= User.createdAt
 *                                   -> BORN HUMAN. The club was created
 *                                      after its owner: either an OAuth
 *                                      signup (ensureTeamForUser) or a
 *                                      credential signup with no bot slot
 *                                      free. Both create the club inside the
 *                                      user's own transaction, so the club
 *                                      never had a bot phase to record.
 *                                      One open HUMAN era from Team.createdAt.
 *
 * WHAT IS NEVER GUESSED. A club that is isBot = true AND has a userId is a
 * contradiction this code has no rule for - it cannot have arisen from any
 * path above. Such a club is REPORTED and SKIPPED, never assigned an era on
 * a hunch. Same for a club whose user row is missing.
 *
 * IDEMPOTENT. A club that already has any era is left completely alone -
 * not topped up, not re-timed. Running this twice changes nothing the
 * second time, and running it after some clubs have been handled by the
 * live code paths is safe.
 */

export interface BackfillTeamInput {
  id: string
  isBot: boolean
  createdAt: Date
  userId: string | null
  userCreatedAt: Date | null
  existingEraCount: number
}

export interface PlannedEra {
  teamId: string
  userId: string | null
  type: "BOT" | "HUMAN"
  startedAt: Date
  endedAt: Date | null
}

export interface BackfillPlan {
  eras: PlannedEra[]
  skippedAlreadyHasEras: string[]
  /** Clubs this code refuses to guess about. Each entry says why, in plain terms. */
  unresolved: { teamId: string; reason: string }[]
}

export function planTeamEraBackfill(teams: BackfillTeamInput[]): BackfillPlan {
  const plan: BackfillPlan = { eras: [], skippedAlreadyHasEras: [], unresolved: [] }

  for (const team of teams) {
    if (team.existingEraCount > 0) {
      plan.skippedAlreadyHasEras.push(team.id)
      continue
    }

    if (team.isBot && team.userId !== null) {
      plan.unresolved.push({
        teamId: team.id,
        reason: "isBot = true but userId is set. No known code path produces this, so the takeover instant cannot be derived. Left without eras.",
      })
      continue
    }

    if (team.userId === null) {
      if (!team.isBot) {
        plan.unresolved.push({
          teamId: team.id,
          reason: "isBot = false but userId is null - an unowned non-bot club. Ownership history cannot be derived. Left without eras.",
        })
        continue
      }
      plan.eras.push({ teamId: team.id, userId: null, type: "BOT", startedAt: team.createdAt, endedAt: null })
      continue
    }

    if (!team.userCreatedAt) {
      plan.unresolved.push({
        teamId: team.id,
        reason: "userId is set but the user row could not be read, so the takeover instant is unknown. Left without eras.",
      })
      continue
    }

    if (team.createdAt.getTime() < team.userCreatedAt.getTime()) {
      // Taken over: the club predates its owner.
      plan.eras.push({
        teamId: team.id,
        userId: null,
        type: "BOT",
        startedAt: team.createdAt,
        endedAt: team.userCreatedAt,
      })
      plan.eras.push({
        teamId: team.id,
        userId: team.userId,
        type: "HUMAN",
        startedAt: team.userCreatedAt,
        endedAt: null,
      })
      continue
    }

    // Born human: club created at or after its owner.
    plan.eras.push({
      teamId: team.id,
      userId: team.userId,
      type: "HUMAN",
      startedAt: team.createdAt,
      endedAt: null,
    })
  }

  return plan
}

/** Every club in the plan ends with exactly one open era - the property the partial unique index enforces in the database. */
export function planHasExactlyOneOpenEraPerTeam(plan: BackfillPlan): boolean {
  const openPerTeam = new Map<string, number>()
  for (const era of plan.eras) {
    if (era.endedAt === null) openPerTeam.set(era.teamId, (openPerTeam.get(era.teamId) ?? 0) + 1)
  }
  const teamsInPlan = new Set(plan.eras.map((era) => era.teamId))
  for (const teamId of teamsInPlan) {
    if (openPerTeam.get(teamId) !== 1) return false
  }
  return true
}
