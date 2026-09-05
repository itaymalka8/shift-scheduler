import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extractPlayerAttributes } from "@/lib/players/attributes"
import { isPlayerPosition } from "@/lib/players/positions"
import { topAttributesForPosition } from "@/lib/players/position-weights"
import { getActiveRosterCount, MAX_ACTIVE_ROSTER_SIZE } from "@/lib/players/roster"
import { settleIntakeDeadline } from "@/lib/youth/deadline"
import { handleYouthApiError } from "@/lib/youth/http"
import { findCurrentSeasonIdForTeam } from "@/lib/leagues/current-division"

const PROSPECT_ATTRIBUTE_HIGHLIGHT_COUNT = 4

/**
 * The manager's own current-season youth intake for an already-resolved,
 * trusted teamId - the only teamId this ever uses is the one the caller
 * passed in, never anything read from the request. Kept out of route.ts
 * (which may only export HTTP method handlers) so it can be exercised
 * directly in tests without mocking next-auth.
 *
 * A team that is a bot - which route.ts's own team lookup already makes
 * impossible, since a bot club has no User row to authenticate as - would
 * fall through this function exactly like a human team with no intake
 * generated yet, i.e. a domain-safe `intake: null`, never a crash.
 */
export async function handleGetYouthIntake(teamId: string): Promise<NextResponse> {
  const now = new Date()

  try {
    // The ACTIVE season, not "newest membership by joinedAt". Season N+1's
    // rows exist before that season is switched on, so the old query resolved
    // to N+1 during the offseason and reported "no intake" for an intake that
    // genuinely exists in season N - during WAITING_HUMANS, which is exactly
    // when a manager is trying to use it. The write path
    // (src/lib/youth/intake.ts) was always correctly season-scoped; only this
    // read was not.
    const club = await prisma.team.findUnique({ where: { id: teamId }, select: { countryCode: true } })
    const seasonId = await findCurrentSeasonIdForTeam(teamId, club?.countryCode ?? null)

    let intakeRow = seasonId
      ? await prisma.youthIntake.findUnique({ where: { teamId_seasonId: { teamId, seasonId } } })
      : null

    // Lazy deadline settlement: a GET must reflect the true CLOSED state of
    // an intake whose window has passed even if no orchestrator/cron has
    // touched it yet. This never creates or promotes anything - it only
    // ever transitions PENDING -> EXPIRED and OPEN -> CLOSED, the same as
    // any other deadline-triggered settlement in the youth domain.
    if (intakeRow) {
      intakeRow = await prisma.$transaction((tx) => settleIntakeDeadline(tx, intakeRow!, now)).then((r) => r.intake)
    }

    const [prospects, activeCount, season] = await Promise.all([
      intakeRow
        ? prisma.youthProspect.findMany({ where: { youthIntakeId: intakeRow.id }, orderBy: { createdAt: "asc" } })
        : Promise.resolve([]),
      getActiveRosterCount(prisma, teamId),
      seasonId ? prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, number: true } }) : Promise.resolve(null),
    ])

    return NextResponse.json({
      season: season ? { id: season.id, number: season.number } : null,
      intake: intakeRow
        ? {
            id: intakeRow.id,
            status: intakeRow.status,
            openedAt: intakeRow.openedAt.toISOString(),
            closesAt: intakeRow.closesAt.toISOString(),
            closedAt: intakeRow.closedAt?.toISOString() ?? null,
            promotedCount: intakeRow.promotedCount,
          }
        : null,
      prospects: prospects.map((p) => {
        const position = isPlayerPosition(p.primaryPosition) ? p.primaryPosition : "CM"
        const attributes = extractPlayerAttributes(p as unknown as Record<string, unknown>)
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          age: p.age,
          nationality: p.nationality,
          primaryPosition: p.primaryPosition,
          secondaryPositions: p.secondaryPositions,
          preferredFoot: p.preferredFoot,
          overall: p.overall,
          potential: p.potential,
          status: p.status,
          promotedPlayerId: p.promotedPlayerId,
          attributes: topAttributesForPosition(position, attributes, PROSPECT_ATTRIBUTE_HIGHLIGHT_COUNT),
        }
      }),
      roster: {
        activeCount,
        maxSize: MAX_ACTIVE_ROSTER_SIZE,
        availableSlots: Math.max(0, MAX_ACTIVE_ROSTER_SIZE - activeCount),
      },
      serverNow: now.toISOString(),
    })
  } catch (error) {
    return handleYouthApiError(error)
  }
}
