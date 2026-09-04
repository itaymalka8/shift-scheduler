/**
 * Creating and advancing a championship playoff.
 *
 * The rules live in ./playoff.ts (scoring, ranking, pairings) and ./draw.ts
 * (the Official Sporting Draw); this module is the part that touches the
 * database. It is called only from the orchestrator's ACTIVE branch, which
 * already holds the Season row lock, so it takes no lock of its own and adds
 * no lock ordering.
 */
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isMatchFinished } from "@/lib/match/timing"
import { computeDeciderSchedule } from "./decider"
import {
  deriveDrawSeed,
  drawKnockout,
  parseKnockoutDraw,
  planKnockoutRound,
  type KnockoutDraw,
} from "./draw"
import {
  MAX_ROUND_ROBIN_ROUNDS,
  playoffMatchOutcome,
  roundRobinPairings,
  type PlayoffFixture,
} from "./playoff"

export interface PlayoffFixtureRow extends PlayoffFixture {
  id: string
  playoffPhase: "ROUND_ROBIN" | "KNOCKOUT"
  playoffRound: number
  scheduledAt: Date | null
  playedAt: Date | null
}

export interface PlayoffState {
  id: string
  divisionId: string
  drawSeed: string
  knockoutDraw: KnockoutDraw | null
  fixtures: PlayoffFixtureRow[]
}

const FIXTURE_SELECT = {
  id: true,
  homeTeamId: true,
  awayTeamId: true,
  homeScore: true,
  awayScore: true,
  homeShootoutScore: true,
  awayShootoutScore: true,
  playoffPhase: true,
  playoffRound: true,
  scheduledAt: true,
  playedAt: true,
} as const

function toState(row: {
  id: string
  divisionId: string
  drawSeed: string
  knockoutDraw: unknown
  fixtures: {
    id: string
    homeTeamId: string
    awayTeamId: string
    homeScore: number | null
    awayScore: number | null
    homeShootoutScore: number | null
    awayShootoutScore: number | null
    playoffPhase: "ROUND_ROBIN" | "KNOCKOUT" | null
    playoffRound: number | null
    scheduledAt: Date | null
    playedAt: Date | null
  }[]
}): PlayoffState {
  return {
    id: row.id,
    divisionId: row.divisionId,
    drawSeed: row.drawSeed,
    knockoutDraw: parseKnockoutDraw(row.knockoutDraw),
    fixtures: row.fixtures
      // A CHECK constraint guarantees both are set on a TITLE_PLAYOFF row, so
      // this narrows types rather than tolerating bad data.
      .filter((f): f is typeof f & { playoffPhase: "ROUND_ROBIN" | "KNOCKOUT"; playoffRound: number } =>
        f.playoffPhase !== null && f.playoffRound !== null
      )
      .map((f) => ({ ...f })),
  }
}

/** The whole playoff for a division, or null if it has never had one. */
export async function loadPlayoff(divisionId: string): Promise<PlayoffState | null> {
  const row = await prisma.championshipPlayoff.findUnique({
    where: { divisionId },
    select: { id: true, divisionId: true, drawSeed: true, knockoutDraw: true, fixtures: { select: FIXTURE_SELECT } },
  })
  return row ? toState(row) : null
}

/** Every playoff of a season, by divisionId. */
export async function loadPlayoffsForSeason(seasonId: string): Promise<Map<string, PlayoffState>> {
  const rows = await prisma.championshipPlayoff.findMany({
    where: { seasonId },
    select: { id: true, divisionId: true, drawSeed: true, knockoutDraw: true, fixtures: { select: FIXTURE_SELECT } },
  })
  return new Map(rows.map((r) => [r.divisionId, toState(r)]))
}

/** Fixtures of one phase and round, in kickoff order. */
export function fixturesOfRound(
  state: PlayoffState,
  phase: "ROUND_ROBIN" | "KNOCKOUT",
  round: number
): PlayoffFixtureRow[] {
  return state.fixtures
    .filter((f) => f.playoffPhase === phase && f.playoffRound === round)
    .sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0))
}

/** The highest round reached in a phase, or 0 if that phase has not started. */
export function latestRound(state: PlayoffState, phase: "ROUND_ROBIN" | "KNOCKOUT"): number {
  let max = 0
  for (const f of state.fixtures) {
    if (f.playoffPhase === phase && f.playoffRound > max) max = f.playoffRound
  }
  return max
}

/**
 * Has every fixture of this round actually finished?
 *
 * BOTH halves of the gate, as everywhere else in this project: the live
 * window has fully played out AND a usable result is stored. The engine
 * writes the score at kickoff, so a match two minutes into its live window
 * already has one - ranking a round on that would announce a result someone
 * is still watching.
 */
export function roundIsComplete(fixtures: PlayoffFixtureRow[], now: Date): boolean {
  if (fixtures.length === 0) return false
  return fixtures.every(
    (f) => isMatchFinished(f.scheduledAt, now) && f.playedAt !== null && playoffMatchOutcome(f).kind === "decided"
  )
}

/** The winners of a knockout round, in the bracket order the stored draw fixed. */
export function knockoutSurvivors(
  draw: KnockoutDraw,
  roundFixtures: PlayoffFixtureRow[],
  byes: string[]
): string[] {
  const winners = new Set<string>(byes)
  for (const fixture of roundFixtures) {
    const outcome = playoffMatchOutcome(fixture)
    if (outcome.kind === "decided") winners.add(outcome.winnerTeamId)
  }
  // Ordered by the PERSISTED bracket, never re-derived - so a later round's
  // pairings cannot change if the draw algorithm ever does.
  return draw.order.filter((teamId) => winners.has(teamId))
}

/**
 * Creates the playoff row for a division, exactly once.
 *
 * drawSeed is derived here, at creation, from the division's completed LEAGUE
 * record, and written in the same INSERT - so there is never a moment where a
 * playoff exists without its seed, and no second write to race on.
 */
export async function ensureChampionshipPlayoff(
  tx: Prisma.TransactionClient,
  input: { seasonId: string; divisionId: string; countryCode: string; seasonNumber: number; tier: number; group: string }
): Promise<{ id: string; drawSeed: string; created: boolean }> {
  const existing = await tx.championshipPlayoff.findUnique({
    where: { divisionId: input.divisionId },
    select: { id: true, drawSeed: true },
  })
  if (existing) return { ...existing, created: false }

  const leagueFixtures = await tx.fixture.findMany({
    where: { divisionId: input.divisionId, stage: "LEAGUE" },
    select: { scheduledAt: true, homeScore: true, awayScore: true },
  })
  const drawSeed = deriveDrawSeed(
    { countryCode: input.countryCode, seasonNumber: input.seasonNumber, tier: input.tier, group: input.group },
    leagueFixtures
  )

  try {
    const created = await tx.championshipPlayoff.create({
      data: { seasonId: input.seasonId, divisionId: input.divisionId, drawSeed },
      select: { id: true, drawSeed: true },
    })
    return { ...created, created: true }
  } catch (error) {
    // The unique on divisionId won the race. Read back what the winner wrote.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await tx.championshipPlayoff.findUnique({
        where: { divisionId: input.divisionId },
        select: { id: true, drawSeed: true },
      })
      if (winner) return { ...winner, created: false }
    }
    throw error
  }
}

/** Schedules N pairings across consecutive calendar slots, one slot per round-robin slot. */
function scheduleFixtures(
  pairings: { homeTeamId: string; awayTeamId: string; slot: number }[],
  anchor: Date,
  lastMatchday: number,
  now: Date
): { homeTeamId: string; awayTeamId: string; scheduledAt: Date; matchday: number }[] {
  // The first slot obeys the same 24-hour preparation floor a two-club
  // decider does; every later slot follows it in the league's own cadence, so
  // the whole playoff reads as a continuation of the season's rhythm.
  const first = computeDeciderSchedule(anchor, lastMatchday, now)
  const slots = [...new Set(pairings.map((p) => p.slot))].sort((a, b) => a - b)
  const slotIndex = new Map(slots.map((slot, i) => [slot, i]))
  return pairings.map((p) => {
    const offset = slotIndex.get(p.slot) ?? 0
    const matchday = first.matchday + offset
    return {
      homeTeamId: p.homeTeamId,
      awayTeamId: p.awayTeamId,
      matchday,
      scheduledAt: computeDeciderSchedule(anchor, matchday - 1, now).scheduledAt,
    }
  })
}

async function scheduleAnchor(
  tx: Prisma.TransactionClient,
  divisionId: string
): Promise<{ anchor: Date; lastMatchday: number }> {
  const earliest = await tx.fixture.findFirst({
    where: { divisionId, stage: "LEAGUE" },
    orderBy: { scheduledAt: "asc" },
    select: { scheduledAt: true },
  })
  const last = await tx.fixture.findFirst({
    where: { divisionId },
    orderBy: { matchday: "desc" },
    select: { matchday: true },
  })
  if (!earliest?.scheduledAt || !last) {
    throw new Error(`Division ${divisionId} has no scheduled LEAGUE fixtures to anchor a playoff to.`)
  }
  return { anchor: earliest.scheduledAt, lastMatchday: last.matchday }
}

/** Inserts a set of playoff fixtures, tolerating the pairing index winning a race. */
async function createPlayoffFixtures(
  tx: Prisma.TransactionClient,
  input: {
    playoffId: string
    divisionId: string
    phase: "ROUND_ROBIN" | "KNOCKOUT"
    round: number
    scheduled: { homeTeamId: string; awayTeamId: string; scheduledAt: Date; matchday: number }[]
  }
): Promise<number> {
  let created = 0
  for (const fixture of input.scheduled) {
    try {
      await tx.fixture.create({
        data: {
          divisionId: input.divisionId,
          stage: "TITLE_PLAYOFF",
          playoffId: input.playoffId,
          playoffPhase: input.phase,
          playoffRound: input.round,
          matchday: fixture.matchday,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          scheduledAt: fixture.scheduledAt,
        },
      })
      created++
    } catch (error) {
      // Fixture_playoff_pairing_key refused a duplicate: another runner
      // already created this exact pairing for this round. Not an error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue
      throw error
    }
  }
  return created
}

/** Creates one round-robin round for the given clubs. Idempotent via the pairing index. */
export async function createRoundRobinRound(
  tx: Prisma.TransactionClient,
  input: { playoffId: string; divisionId: string; round: number; teamIds: string[]; now: Date }
): Promise<number> {
  if (input.round > MAX_ROUND_ROBIN_ROUNDS) {
    throw new Error(
      `Round-robin round ${input.round} exceeds the cap of ${MAX_ROUND_ROBIN_ROUNDS}; the knockout takes over instead.`
    )
  }
  const { anchor, lastMatchday } = await scheduleAnchor(tx, input.divisionId)
  const scheduled = scheduleFixtures(roundRobinPairings(input.teamIds), anchor, lastMatchday, input.now)
  return createPlayoffFixtures(tx, { ...input, phase: "ROUND_ROBIN", scheduled })
}

/**
 * Enters the knockout: runs the Official Sporting Draw once, PERSISTS it, and
 * creates the first knockout round from the persisted result.
 *
 * The order matters and is the whole point of Correction 1. The draw is
 * written before any fixture is created, in the same transaction, so a
 * bracket can never exist without the record of the draw that produced it -
 * and every later round reads that stored record rather than re-running the
 * algorithm.
 */
export async function ensureKnockoutEntered(
  tx: Prisma.TransactionClient,
  input: { playoffId: string; divisionId: string; drawSeed: string; entrants: string[]; now: Date }
): Promise<{ draw: KnockoutDraw; fixturesCreated: number; drawPersisted: boolean }> {
  const current = await tx.championshipPlayoff.findUnique({
    where: { id: input.playoffId },
    select: { knockoutDraw: true },
  })
  const stored = parseKnockoutDraw(current?.knockoutDraw)

  // NEVER re-draw. A stored draw is the sporting fact from the moment it is
  // written; the seed is kept only so it can be re-verified.
  const draw = stored ?? drawKnockout(input.entrants, input.drawSeed)
  let drawPersisted = false
  if (!stored) {
    await tx.championshipPlayoff.update({
      where: { id: input.playoffId },
      data: { knockoutDraw: draw as unknown as Prisma.InputJsonValue },
    })
    drawPersisted = true
  }

  const { anchor, lastMatchday } = await scheduleAnchor(tx, input.divisionId)
  const scheduled = scheduleFixtures(
    draw.firstRound.pairings.map((p, i) => ({ ...p, slot: i + 1 })),
    anchor,
    lastMatchday,
    input.now
  )
  const fixturesCreated = await createPlayoffFixtures(tx, {
    playoffId: input.playoffId,
    divisionId: input.divisionId,
    phase: "KNOCKOUT",
    round: 1,
    scheduled,
  })
  return { draw, fixturesCreated, drawPersisted }
}

/** Creates the next knockout round from the PERSISTED bracket. Never reshuffles. */
export async function createNextKnockoutRound(
  tx: Prisma.TransactionClient,
  input: {
    playoffId: string
    divisionId: string
    draw: KnockoutDraw
    round: number
    survivorsInBracketOrder: string[]
    now: Date
  }
): Promise<number> {
  const plan = planKnockoutRound(input.round, input.survivorsInBracketOrder)
  const { anchor, lastMatchday } = await scheduleAnchor(tx, input.divisionId)
  const scheduled = scheduleFixtures(
    plan.pairings.map((p, i) => ({ ...p, slot: i + 1 })),
    anchor,
    lastMatchday,
    input.now
  )
  return createPlayoffFixtures(tx, {
    playoffId: input.playoffId,
    divisionId: input.divisionId,
    phase: "KNOCKOUT",
    round: input.round,
    scheduled,
  })
}
