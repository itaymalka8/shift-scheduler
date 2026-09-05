/**
 * SPORTING RESOLUTION WHILE SEASON N IS STILL ACTIVE.
 *
 * Everything that can change who goes up or down is settled here, on the
 * squads that played the season - before PLAYER_LIFECYCLE ages a single
 * player, before a retirement, before youth, before replenishment. That
 * ordering is the whole reason this module exists in the ACTIVE branch rather
 * than in the offseason: a promotion decided by teams that no longer exist in
 * the form that earned the place would not be a promotion.
 *
 * THE TWO ROUNDS, in dependency order:
 *
 *   R1  every division's ranking is resolved to the precision the rules need.
 *       Rank 1 belongs to the EXISTING championship machinery and is not
 *       touched here - in a tier 2 group rank 1 is simultaneously the title
 *       and automatic promotion, ONE tie and ONE fixture. Every other
 *       outcome boundary (16 in tier 1; 2 and 3 in each tier 2 group) is
 *       settled by BOUNDARY_DECIDER fixtures.
 *
 *   R2  with final positions known, the promotion bracket is created:
 *       A2 v B3 and B2 v A3, stage PROMOTION_PLAYOFF, filed on season N's
 *       tier 1 Division. The four clubs stay tier 2 members throughout -
 *       FixtureStage says which competition a match belongs to, divisionId
 *       says which season's competition structure it hangs from.
 *
 * A CREATED FIXTURE HOLDS THE SEASON ACTIVE BY ITSELF, because
 * isSeasonReadyForOffseason counts every fixture of the season with no stage
 * filter. What it CANNOT see is a fixture that does not exist yet - which is
 * the entire reason isSportingResolutionComplete exists below.
 */
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { isMatchFinished } from "@/lib/match/timing"
import { computeDeciderSchedule, technicalHomeAway } from "../decider"
import { deriveDrawSeed } from "../draw"
import { playoffMatchOutcome } from "../playoff"
import { rankDivision, rungAtRank, type RankingRung } from "./ranking"
import { boundaryRanksFor, straddlesBoundary, type DivisionShape } from "./outcomes"
import { decideBoundary, roundRobinPairs, type BoundaryDecision, type BoundaryFixture } from "./boundary"
import { promotionBracketPairings, type FinalDivision, type PlayoffResult } from "./movement"

/** Everything one division contributes to resolution, read once. */
export interface DivisionResolutionState {
  divisionId: string
  tier: number
  group: string
  teamIds: string[]
  /** Ranking from the LEAGUE table alone, boundaries possibly still tied. */
  rungs: RankingRung[]
  /** BOUNDARY_DECIDER fixtures already created, by boundaryRank. */
  boundaryFixtures: Map<number, BoundaryFixture[]>
  /** Every boundary fixture's public-finished state, by fixture identity. */
  drawSeed: string
  anchorScheduledAt: Date | null
  lastMatchday: number
}

export interface SeasonResolutionState {
  seasonId: string
  countryCode: string
  seasonNumber: number
  divisions: DivisionResolutionState[]
  /** PROMOTION_PLAYOFF fixtures already created for this season. */
  promotionFixtures: {
    id: string
    homeTeamId: string
    awayTeamId: string
    scheduledAt: Date | null
    playedAt: Date | null
    homeScore: number | null
    awayScore: number | null
    homeShootoutScore: number | null
    awayShootoutScore: number | null
  }[]
}

/**
 * Reads everything resolution needs, in a handful of queries, OUTSIDE any
 * transaction. Nothing here writes; the caller re-asserts under the Season
 * lock before it does.
 */
export async function loadSeasonResolutionState(seasonId: string): Promise<SeasonResolutionState | null> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { id: true, countryCode: true, number: true },
  })
  if (!season) return null

  const divisions = await prisma.division.findMany({
    where: { seasonId },
    orderBy: [{ tier: "asc" }, { group: "asc" }],
    select: {
      id: true,
      tier: true,
      group: true,
      teams: { select: { teamId: true } },
      fixtures: {
        select: {
          id: true,
          stage: true,
          boundaryRank: true,
          boundaryRound: true,
          matchday: true,
          homeTeamId: true,
          awayTeamId: true,
          scheduledAt: true,
          playedAt: true,
          homeScore: true,
          awayScore: true,
          homeShootoutScore: true,
          awayShootoutScore: true,
        },
      },
    },
  })

  const promotionFixtures: SeasonResolutionState["promotionFixtures"] = []
  const states: DivisionResolutionState[] = []

  for (const division of divisions) {
    const league = division.fixtures.filter((f) => f.stage === "LEAGUE")
    const boundary = new Map<number, BoundaryFixture[]>()
    for (const fixture of division.fixtures) {
      if (fixture.stage === "PROMOTION_PLAYOFF") {
        promotionFixtures.push({
          id: fixture.id,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          scheduledAt: fixture.scheduledAt,
          playedAt: fixture.playedAt,
          homeScore: fixture.homeScore,
          awayScore: fixture.awayScore,
          homeShootoutScore: fixture.homeShootoutScore,
          awayShootoutScore: fixture.awayShootoutScore,
        })
        continue
      }
      if (fixture.stage !== "BOUNDARY_DECIDER") continue
      if (fixture.boundaryRank === null || fixture.boundaryRound === null) continue
      const bucket = boundary.get(fixture.boundaryRank) ?? []
      bucket.push({
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        homeShootoutScore: fixture.homeShootoutScore,
        awayShootoutScore: fixture.awayShootoutScore,
        boundaryRound: fixture.boundaryRound,
        scheduledAt: fixture.scheduledAt,
        playedAt: fixture.playedAt,
      })
      boundary.set(fixture.boundaryRank, bucket)
    }

    const anchor = league.reduce<Date | null>((min, f) => {
      if (!f.scheduledAt) return min
      return !min || f.scheduledAt < min ? f.scheduledAt : min
    }, null)
    const lastMatchday = division.fixtures.reduce((max, f) => Math.max(max, f.matchday), 0)

    states.push({
      divisionId: division.id,
      tier: division.tier,
      group: division.group ?? "",
      teamIds: division.teams.map((t) => t.teamId),
      rungs: rankDivision(
        division.teams.map((t) => t.teamId),
        league.map((f) => ({
          homeTeamId: f.homeTeamId,
          awayTeamId: f.awayTeamId,
          homeScore: f.homeScore,
          awayScore: f.awayScore,
        }))
      ),
      boundaryFixtures: boundary,
      drawSeed: deriveDrawSeed(
        {
          countryCode: season.countryCode,
          seasonNumber: season.number,
          tier: division.tier,
          group: division.group ?? "",
        },
        league.map((f) => ({ scheduledAt: f.scheduledAt, homeScore: f.homeScore, awayScore: f.awayScore }))
      ),
      anchorScheduledAt: anchor,
      lastMatchday,
    })
  }

  return {
    seasonId: season.id,
    countryCode: season.countryCode,
    seasonNumber: season.number,
    divisions: states,
    promotionFixtures,
  }
}

/** A boundary that needs work, with everything the writer needs to do it. */
export interface BoundaryWork {
  divisionId: string
  boundaryRank: number
  decision: BoundaryDecision
}

/** One boundary of one division, decided against what already exists. */
export function decideDivisionBoundaries(
  division: DivisionResolutionState,
  now: Date
): { work: BoundaryWork[]; resolvedOrder: string[] | null } {
  const shape: DivisionShape = {
    divisionId: division.divisionId,
    tier: division.tier,
    group: division.group,
  }
  const finished = (fixture: BoundaryFixture) =>
    fixture.playedAt !== null && isMatchFinished(fixture.scheduledAt, now)

  const work: BoundaryWork[] = []
  // Start from the statistical ranking and replace each tied rung that
  // straddles a boundary with the order its fixtures produced.
  const resolved: RankingRung[] = division.rungs.map((rung) => ({ ...rung, teamIds: [...rung.teamIds] }))

  for (const boundaryRank of boundaryRanksFor(shape)) {
    const rung = rungAtRank(resolved, boundaryRank)
    if (!rung || rung.teamIds.length === 1) continue
    if (!straddlesBoundary(rung.firstRank, rung.teamIds.length, boundaryRank)) continue

    const decision = decideBoundary(
      rung.teamIds,
      division.boundaryFixtures.get(boundaryRank) ?? [],
      finished,
      division.drawSeed
    )
    if (decision.kind === "settled") {
      rung.teamIds = decision.order
      continue
    }
    work.push({ divisionId: division.divisionId, boundaryRank, decision })
  }

  // Any rung still holding more than one club either does not straddle a
  // boundary (a genuine tie that changes nothing, and correctly plays no
  // match) or is still being settled. Only the second blocks resolution.
  if (work.length > 0) return { work, resolvedOrder: null }

  const order: string[] = []
  for (const rung of resolved) order.push(...rung.teamIds)
  return { work: [], resolvedOrder: order }
}

export interface SportingResolution {
  complete: boolean
  detail: string
  /** Per division, once every boundary that matters is settled. */
  finalDivisions: FinalDivision[]
  boundaryWork: BoundaryWork[]
  /** The bracket, once tier 2 is final. Empty until then. */
  bracket: { homeTeamId: string; awayTeamId: string }[]
  bracketCreated: boolean
  bracketFinished: boolean
  playoffResults: PlayoffResult[]
}

/**
 * The whole sporting picture for a season, in one answer.
 *
 * Deliberately reports rather than writes. The orchestrator does the writing,
 * inside the Season lock, exactly as it already does for title deciders.
 */
export function resolveSeasonSporting(state: SeasonResolutionState, now: Date): SportingResolution {
  const boundaryWork: BoundaryWork[] = []
  const finalDivisions: FinalDivision[] = []

  for (const division of state.divisions) {
    const outcome = decideDivisionBoundaries(division, now)
    boundaryWork.push(...outcome.work)
    if (outcome.resolvedOrder) {
      finalDivisions.push({
        divisionId: division.divisionId,
        tier: division.tier,
        group: division.group,
        order: outcome.resolvedOrder,
      })
    }
  }

  if (boundaryWork.length > 0) {
    return {
      complete: false,
      detail: `${boundaryWork.length} sporting boundary/ies still to settle`,
      finalDivisions,
      boundaryWork,
      bracket: [],
      bracketCreated: false,
      bracketFinished: false,
      playoffResults: [],
    }
  }

  const groupA = finalDivisions.find((d) => d.tier === 2 && d.group === "A")
  const groupB = finalDivisions.find((d) => d.tier === 2 && d.group === "B")
  if (!groupA || !groupB) {
    return {
      complete: false,
      detail: "tier 2 groups are not both resolved",
      finalDivisions,
      boundaryWork: [],
      bracket: [],
      bracketCreated: false,
      bracketFinished: false,
      playoffResults: [],
    }
  }

  const pairings = promotionBracketPairings(groupA, groupB)
  const bracket = pairings.map((p) => ({ homeTeamId: p.homeTeamId, awayTeamId: p.awayTeamId }))

  const matched = bracket.map((pair) =>
    state.promotionFixtures.find(
      (f) =>
        (f.homeTeamId === pair.homeTeamId && f.awayTeamId === pair.awayTeamId) ||
        (f.homeTeamId === pair.awayTeamId && f.awayTeamId === pair.homeTeamId)
    )
  )
  const bracketCreated = matched.every((f) => f !== undefined)
  if (!bracketCreated) {
    return {
      complete: false,
      detail: "promotion playoff bracket not created yet",
      finalDivisions,
      boundaryWork: [],
      bracket,
      bracketCreated: false,
      bracketFinished: false,
      playoffResults: [],
    }
  }

  const playoffResults: PlayoffResult[] = []
  for (const fixture of matched) {
    if (!fixture) continue
    if (fixture.playedAt === null || !isMatchFinished(fixture.scheduledAt, now)) {
      return {
        complete: false,
        detail: "promotion playoff still being played",
        finalDivisions,
        boundaryWork: [],
        bracket,
        bracketCreated: true,
        bracketFinished: false,
        playoffResults: [],
      }
    }
    const outcome = playoffMatchOutcome(fixture)
    if (outcome.kind !== "decided") {
      return {
        complete: false,
        detail: "a promotion playoff fixture finished without a readable winner",
        finalDivisions,
        boundaryWork: [],
        bracket,
        bracketCreated: true,
        bracketFinished: false,
        playoffResults: [],
      }
    }
    playoffResults.push({
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      winnerTeamId: outcome.winnerTeamId,
    })
  }

  return {
    complete: true,
    detail: "every sporting question is settled",
    finalDivisions,
    boundaryWork: [],
    bracket,
    bracketCreated: true,
    bracketFinished: true,
    playoffResults,
  }
}

/**
 * THE EXISTENCE GATE.
 *
 * isSeasonReadyForOffseason asks "is every fixture that EXISTS finished". That
 * is necessary and not sufficient: the promotion bracket cannot be created
 * until the tier 2 boundary ties are finished, so there is an instant at which
 * every existing fixture is finished and the bracket has never been written.
 * Transitioning there would skip promotion entirely - no exception, no log
 * line, just a league that did not change.
 *
 * This asks the other half: does every fixture that MUST exist exist, and has
 * it publicly finished. Both gates are re-asserted inside the Season row lock.
 */
export async function isSportingResolutionComplete(seasonId: string, now: Date = new Date()): Promise<boolean> {
  const state = await loadSeasonResolutionState(seasonId)
  if (!state) return false
  return resolveSeasonSporting(state, now).complete
}

/** Where a boundary fixture kicks off - the league's own Mon/Wed/Sat rhythm. */
function scheduleFor(division: DivisionResolutionState, now: Date): { scheduledAt: Date; matchday: number } {
  if (!division.anchorScheduledAt) {
    throw new Error(`Division ${division.divisionId} has no scheduled LEAGUE fixtures to anchor a boundary decider to.`)
  }
  return computeDeciderSchedule(division.anchorScheduledAt, division.lastMatchday, now)
}

/**
 * Creates the fixtures one boundary needs next, inside the caller's
 * transaction and under the caller's Season lock.
 *
 * Every write is idempotent against Fixture_boundary_pairing_key: a runner
 * that loses the race gets P2002 and treats it as "already created", which is
 * the same resolution ensureTitleDecider uses.
 */
export async function createBoundaryFixtures(
  tx: Prisma.TransactionClient,
  division: DivisionResolutionState,
  work: BoundaryWork,
  now: Date
): Promise<number> {
  const decision = work.decision
  if (decision.kind !== "needRoundRobin" && decision.kind !== "needLadderMatch") return 0

  const pairs: [string, string][] =
    decision.kind === "needRoundRobin" ? roundRobinPairs(decision.teamIds) : [decision.teamIds]

  let created = 0
  for (const pair of pairs) {
    const { homeTeamId, awayTeamId } = technicalHomeAway([...pair])
    const { scheduledAt, matchday } = scheduleFor(division, now)
    try {
      await tx.fixture.create({
        data: {
          divisionId: division.divisionId,
          stage: "BOUNDARY_DECIDER",
          boundaryRank: work.boundaryRank,
          boundaryRound: decision.round,
          matchday,
          homeTeamId,
          awayTeamId,
          scheduledAt,
        },
        select: { id: true },
      })
      created++
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue
      throw error
    }
  }
  return created
}

/**
 * Creates the two promotion playoff fixtures.
 *
 * FILED ON SEASON N's TIER 1 DIVISION, and the four clubs are NOT given tier 1
 * memberships. A Fixture must belong to a competition of its season, and this
 * is the promotion playoff to tier 1; FixtureStage is what says the match is
 * not a Ligat Ha'al league game, and every league-sensitive query in this
 * codebase already filters on it. The "both clubs are members of their own
 * division" rule is a LEAGUE rule and this is explicitly not the league.
 */
export async function createPromotionBracket(
  tx: Prisma.TransactionClient,
  input: {
    tier1: DivisionResolutionState
    bracket: { homeTeamId: string; awayTeamId: string }[]
    now: Date
  }
): Promise<number> {
  let created = 0
  for (const pair of input.bracket) {
    const { homeTeamId, awayTeamId } = technicalHomeAway([pair.homeTeamId, pair.awayTeamId])
    const { scheduledAt, matchday } = scheduleFor(input.tier1, input.now)
    try {
      await tx.fixture.create({
        data: {
          divisionId: input.tier1.divisionId,
          stage: "PROMOTION_PLAYOFF",
          matchday,
          homeTeamId,
          awayTeamId,
          scheduledAt,
        },
        select: { id: true },
      })
      created++
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue
      throw error
    }
  }
  return created
}
