import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { YouthError } from "./errors"
import { generateYouthProspects } from "./generate"
import { INTAKE_WINDOW_HOURS, PROSPECTS_PER_INTAKE } from "./config"

export interface GenerateYouthIntakeInput {
  seasonId: string
  teamId: string
  /** Injectable for tests; defaults to the real current time. */
  now?: Date
}

export interface GenerateYouthIntakeResult {
  intakeId: string
  teamId: string
  seasonId: string
  prospectCount: number
  /** true when an intake for this club and season already existed - nothing was created. */
  alreadyExists: boolean
}

/**
 * Creates one club's youth intake for one season: the YouthIntake row and
 * all PROSPECTS_PER_INTAKE prospects, in a single transaction. Either the
 * whole intake exists or none of it does - there is no state where an intake
 * row exists with two prospects under it.
 *
 * The club must be a member of a division belonging to this season. A club
 * outside the season's league structure gets no intake at all, which is what
 * keeps clubs that were never entered into the competition out of it.
 *
 * Idempotent, and safe under real concurrency. The @@unique([teamId,
 * seasonId]) on YouthIntake is the authority: two concurrent callers both
 * pass the pre-check, both insert, and exactly one wins. The loser's whole
 * transaction rolls back - prospects included, since they are created in the
 * same transaction - and is reported as alreadyExists with the winner's
 * intake, never as a raw P2002.
 */
export async function generateYouthIntakeForTeam(input: GenerateYouthIntakeInput): Promise<GenerateYouthIntakeResult> {
  const now = input.now ?? new Date()

  const existing = await prisma.youthIntake.findUnique({
    where: { teamId_seasonId: { teamId: input.teamId, seasonId: input.seasonId } },
    select: { id: true, prospects: { select: { id: true } } },
  })
  if (existing) {
    return {
      intakeId: existing.id,
      teamId: input.teamId,
      seasonId: input.seasonId,
      prospectCount: existing.prospects.length,
      alreadyExists: true,
    }
  }

  // Membership is checked against the season's own divisions, never against
  // the Team table at large.
  const membership = await prisma.divisionTeam.findFirst({
    where: { teamId: input.teamId, division: { seasonId: input.seasonId } },
    select: { id: true },
  })
  if (!membership) {
    throw new YouthError(
      "TEAM_NOT_IN_SEASON",
      `Team ${input.teamId} is not in any division of season ${input.seasonId}`
    )
  }

  const prospects = generateYouthProspects(input.seasonId, input.teamId, PROSPECTS_PER_INTAKE)

  try {
    const intake = await prisma.$transaction(async (tx) => {
      const created = await tx.youthIntake.create({
        data: {
          teamId: input.teamId,
          seasonId: input.seasonId,
          openedAt: now,
          closesAt: new Date(now.getTime() + INTAKE_WINDOW_HOURS * 3600_000),
        },
        select: { id: true },
      })

      await tx.youthProspect.createMany({
        data: prospects.map((prospect) => ({ ...prospect, youthIntakeId: created.id })),
      })

      return created
    })

    return {
      intakeId: intake.id,
      teamId: input.teamId,
      seasonId: input.seasonId,
      prospectCount: prospects.length,
      alreadyExists: false,
    }
  } catch (error) {
    // Lost the insert race to a concurrent caller for the same club+season.
    // Our own transaction - prospects and all - already rolled back, so
    // reporting the winner's intake is the whole recovery.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      error.meta?.modelName === "YouthIntake"
    ) {
      const winner = await prisma.youthIntake.findUnique({
        where: { teamId_seasonId: { teamId: input.teamId, seasonId: input.seasonId } },
        select: { id: true, prospects: { select: { id: true } } },
      })
      if (winner) {
        return {
          intakeId: winner.id,
          teamId: input.teamId,
          seasonId: input.seasonId,
          prospectCount: winner.prospects.length,
          alreadyExists: true,
        }
      }
    }
    throw error
  }
}

export const DEFAULT_INTAKE_BATCH_SIZE = 10

export interface GenerateSeasonYouthIntakesOptions {
  batchSize?: number
  now?: Date
}

export interface GenerateSeasonYouthIntakesSummary {
  seasonId: string
  teamsFound: number
  created: number
  existing: number
  failed: { teamId: string; message: string }[]
}

/**
 * Every club in a season gets its intake. Clubs are found through the
 * season's own divisions - Season -> Division -> DivisionTeam - never by
 * reading the Team table, so a club that exists but was never entered into
 * this season's league structure is correctly skipped.
 *
 * Deliberately NOT one transaction: clubs are processed in small batches,
 * each intake committing on its own, so a run never holds a long-lived
 * transaction open. Resuming is just running it again - the per-club
 * uniqueness check means an already-generated club is reported as existing
 * and nothing is regenerated, so a run interrupted halfway picks up exactly
 * where it stopped.
 *
 * This is a domain-level service with no schedule of its own: it does not
 * read or write Season.status or Season.offseasonStage. Calling it at the
 * right point in the offseason is the future orchestrator's job.
 */
export async function generateSeasonYouthIntakes(
  seasonId: string,
  options: GenerateSeasonYouthIntakesOptions = {}
): Promise<GenerateSeasonYouthIntakesSummary> {
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true } })
  if (!season) {
    throw new YouthError("SEASON_NOT_FOUND", `No such season: ${seasonId}`)
  }

  const memberships = await prisma.divisionTeam.findMany({
    where: { division: { seasonId } },
    select: { teamId: true },
    orderBy: { teamId: "asc" },
  })
  const teamIds = [...new Set(memberships.map((m) => m.teamId))]

  const summary: GenerateSeasonYouthIntakesSummary = {
    seasonId,
    teamsFound: teamIds.length,
    created: 0,
    existing: 0,
    failed: [],
  }

  const batchSize = options.batchSize ?? DEFAULT_INTAKE_BATCH_SIZE
  for (let start = 0; start < teamIds.length; start += batchSize) {
    for (const teamId of teamIds.slice(start, start + batchSize)) {
      try {
        const result = await generateYouthIntakeForTeam({ seasonId, teamId, now: options.now })
        if (result.alreadyExists) summary.existing++
        else summary.created++
      } catch (error) {
        summary.failed.push({ teamId, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  return summary
}
