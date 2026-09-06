import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { extractPlayerAttributes } from "@/lib/players/attributes"
import { isPlayerPosition, type PlayerPosition } from "@/lib/players/positions"
import { readTeamTactics } from "@/lib/players/tactics"
import { resolveFormationSlots } from "@/lib/players/formations"
import { readSeatsAsOf } from "@/lib/stadium/actions"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { resolveMatchAttendance } from "@/lib/stadium/match-attendance"
import { readLeagueNeutralQuality, readLeagueNeutralQualityAsOf } from "@/lib/stadium/neutral-quality"
import { economicStateAsOf } from "@/lib/economy/state-history"
import { phase3rIsActive } from "@/lib/economy/activation"
import type { MatchSnapshot, SnapshotPlayer, SnapshotTeam } from "./snapshot"

function toPosition(value: string): PlayerPosition {
  return isPlayerPosition(value) ? value : "CM"
}

/**
 * The client every read here goes through.
 *
 * The match hands in its own open transaction, so the squad the engine is
 * about to simulate is read under the same Player row locks the legality
 * check was made against. Passing nothing falls back to the global client,
 * which is what every non-match caller (and the tests) still want.
 */
export type SnapshotReader = Prisma.TransactionClient | typeof prisma

export async function buildTeamSnapshot(teamId: string, db: SnapshotReader = prisma): Promise<SnapshotTeam> {
  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { players: true, lineupSlots: true },
  })

  const slots = resolveFormationSlots(team.formation, team.customFormation)
  const slotByPlayerId = new Map(team.lineupSlots.map((s) => [s.playerId, s.slotIndex]))

  const toSnapshotPlayer = (p: (typeof team.players)[number]): SnapshotPlayer => {
    const slotIndex = slotByPlayerId.get(p.id) ?? null
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      primaryPosition: toPosition(p.primaryPosition),
      secondaryPositions: p.secondaryPositions.filter(isPlayerPosition),
      slotIndex,
      assignedRole: slotIndex != null ? (slots[slotIndex]?.role ?? null) : null,
      attributes: extractPlayerAttributes(p),
      overall: p.overall,
      fitness: p.fitness,
    }
  }

  const available = team.players.filter((p) => p.status === "available")
  const starters = available.filter((p) => slotByPlayerId.has(p.id)).map(toSnapshotPlayer)
  const bench = available.filter((p) => !slotByPlayerId.has(p.id)).map(toSnapshotPlayer)

  return {
    teamId: team.id,
    name: team.name,
    starters,
    bench,
    formationSlots: slots,
    tactics: readTeamTactics(team),
    captainId: team.captainId,
    penaltyTakerId: team.penaltyTakerId,
    freeKickTakerId: team.freeKickTakerId,
    cornerTakerId: team.cornerTakerId,
  }
}

/**
 * Freezes both teams exactly as they stand at kickoff. Everything the
 * engine needs comes from here and nothing else, so a squad or tactics
 * change made after kickoff can never retroactively rewrite a match - and
 * because it's built server-side from the database, a client can never
 * inject its own ratings, lineup, or result.
 */
export interface SnapshotOptions {
  /** True only for a championship decider - see MatchSnapshot.neutralVenue. */
  neutralVenue?: boolean
}

export async function buildMatchSnapshot(
  fixtureId: string,
  seed: string,
  options: SnapshotOptions = {},
  db: SnapshotReader = prisma
): Promise<MatchSnapshot> {
  const fixture = await db.fixture.findUniqueOrThrow({ where: { id: fixtureId } })
  // Sequential, not Promise.all: inside an interactive transaction the two
  // reads share one connection, and issuing them concurrently on the same
  // transaction client is exactly how a Prisma transaction gets confused.
  const home = await buildTeamSnapshot(fixture.homeTeamId, db)
  const away = await buildTeamSnapshot(fixture.awayTeamId, db)

  const homeTeam = await db.team.findUniqueOrThrow({ where: { id: fixture.homeTeamId } })
  // AS OF KICKOFF, NOT AS OF NOW. readSeatsAsOf corrects the Stadium row in
  // both directions against this fixture's own scheduledAt: a stand that was
  // not finished when the whistle blew is taken back out even if the settler
  // has since materialised it, and a stand that WAS finished is put in even
  // if the settler has not reached it yet. Without that, a club's capacity -
  // and therefore its attendance and its gate receipts - would depend on how
  // punctual the cron happened to be. See src/lib/stadium/as-of.ts.
  //
  // Deliberately NOT on `db`. readSeatsAsOf goes through ensureStadiumForTeam,
  // which creates on miss and recovers from a P2002 by re-reading - and a
  // failed statement poisons the rest of a Postgres transaction, so that
  // recovery cannot happen inside one. The stadium is not part of the XI, so
  // reading it outside the match's lock scope changes nothing.
  const { seats } = await readSeatsAsOf(fixture.homeTeamId, fixture.scheduledAt, homeTeam.name)
  const capacity = calculateStadiumCapacity(seats)

  // ACTIVE only, explicitly. The crowd is judging the squad the club is
  // actually paying for, which is the same population payroll charges and the
  // same one the league neutral is built from - three answers that have to
  // agree, so all three filter the same way rather than each relying on
  // retirement happening to null teamId.
  const homePlayers = await db.player.findMany({
    where: { teamId: fixture.homeTeamId, careerStatus: "ACTIVE" },
    select: { overall: true },
  })

  // THE NEUTRAL, READ FOR THIS FIXTURE'S OWN SEASON, under the same client the
  // squads were read through - so a league-wide settlement judges every club
  // against one number rather than re-reading it per fixture. Season-scoped
  // membership, never current Team state: see neutral-quality.ts.
  const division = await db.division.findUniqueOrThrow({
    where: { id: fixture.divisionId },
    select: { seasonId: true },
  })

  // THE ECONOMIC INSTANT OF A FIXTURE IS ITS KICKOFF, never the moment the
  // simulator got round to it. In the calibrated era both the home club's own
  // quality and the league neutral come from TeamEconomicState as of that
  // instant, so a match simulated thirty minutes late - or retried after a
  // rollback - draws the crowd the squads of the day earned, not the crowd
  // whoever transferred in the meantime would have drawn. Before the boundary
  // the live read stays the authority, unchanged.
  const economicInstant = fixture.scheduledAt ?? fixture.createdAt
  const phase3r = phase3rIsActive(economicInstant)
  const neutralQuality = phase3r
    ? await readLeagueNeutralQualityAsOf(db, division.seasonId, economicInstant)
    : await readLeagueNeutralQuality(db, division.seasonId)
  const homeQuality = phase3r
    ? (await economicStateAsOf(db, fixture.homeTeamId, economicInstant)).attendanceQuality
    : undefined

  // THE ONLY ATTENDANCE ROLL THIS FIXTURE WILL EVER GET. Seeded from the
  // fixture's own matchSeed, and carried whole on the snapshot so settlement
  // has no reason - and no means - to roll a second, different crowd.
  //
  // `at` is the fixture's KICKOFF, not `now`: a match settled late belongs to
  // the era its kickoff belonged to, and a delayed cron tick must not be what
  // decides which economy priced it.
  const attendance = resolveMatchAttendance({
    seed,
    homePlayers,
    seats,
    neutralQuality,
    homeQuality,
    at: economicInstant,
  })

  return {
    fixtureId,
    seed,
    home,
    away,
    attendance: attendance.total,
    attendanceBySeatType: attendance.bySeatType,
    stadiumCapacity: capacity,
    fanType: homeTeam.crowdStyle === "ultras" ? "ultras" : "calm",
    // Absent/false for every league fixture, so their snapshots - and
    // therefore their simulations - are unchanged.
    neutralVenue: options.neutralVenue ?? false,
  }
}
