import { prisma } from "@/lib/prisma"
import { POSITION_GROUP, isPlayerPosition, type PositionGroup } from "@/lib/players/positions"
import { calculateTeamTotalQuality } from "@/lib/players/quality"
import {
  calculatePlayerAttackRating,
  calculatePlayerDefenseRating,
  calculateTacticSynergyMultiplier,
  averageAttribute,
  WIDTH_SYNERGY_ATTRIBUTES,
  PRESSING_SYNERGY_ATTRIBUTES,
} from "./attribute-strength"
import { ensureStadiumForTeam } from "@/lib/stadium/actions"
import { calculateAttendance, calculateMatchStadiumRevenue } from "@/lib/stadium/attendance"
import { calculateStadiumCapacity } from "@/lib/stadium/metrics"
import { toSeatCounts } from "@/lib/stadium/config"
import { calculateHomeMatchExpenses, calculateAwayTravelCost } from "@/lib/economy/match-expenses"
import { createFinancialTransaction } from "@/lib/economy/service"

// Only a domestic league exists so far - cup/international competitions
// (and their higher cost modifiers) plug in here once they're built.
const CURRENT_COMPETITION = "league" as const

const BASE_GOAL_RATE = 1.35
const HOME_ADVANTAGE = 1.15
const MIN_XG = 0.2
const MAX_XG = 5

interface TeamStrength {
  attack: number
  defense: number
}

const GROUP_WEIGHTS: Record<PositionGroup, { attack: number; defense: number }> = {
  GK: { attack: 0, defense: 1.2 },
  DF: { attack: 0.3, defense: 1.0 },
  MF: { attack: 0.7, defense: 0.6 },
  FW: { attack: 1.0, defense: 0.2 },
}

async function computeTeamStrength(teamId: string): Promise<TeamStrength> {
  const [team, slots] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId } }),
    prisma.lineupSlot.findMany({ where: { teamId }, include: { player: true } }),
  ])

  let attack: number
  let defense: number

  if (slots.length === 0) {
    const players = await prisma.player.findMany({ where: { teamId } })
    const avg = players.length ? players.reduce((sum, p) => sum + p.overall, 0) / players.length : 55
    attack = avg
    defense = avg
  } else {
    let attackSum = 0
    let attackWeight = 0
    let defenseSum = 0
    let defenseWeight = 0
    for (const slot of slots) {
      const group = isPlayerPosition(slot.player.primaryPosition) ? POSITION_GROUP[slot.player.primaryPosition] : "MF"
      const weights = GROUP_WEIGHTS[group]
      const fitnessFactor = slot.player.fitness / 100
      // Attack/defense contribution comes from the attributes that actually
      // matter for each (see attribute-strength.ts) rather than a flat
      // Overall - a defender and a striker at the same Overall now
      // genuinely differ in how much they add to each side of the game.
      attackSum += calculatePlayerAttackRating(slot.player) * fitnessFactor * weights.attack
      attackWeight += weights.attack
      defenseSum += calculatePlayerDefenseRating(slot.player) * fitnessFactor * weights.defense
      defenseWeight += weights.defense
    }
    attack = attackWeight ? attackSum / attackWeight : 55
    defense = defenseWeight ? defenseSum / defenseWeight : 55

    // Tactic <-> attribute synergy: a dial only pays off if the starting XI
    // actually has the attributes it calls for - previously width/pressing
    // were stored but never affected a match at all.
    const startingAttributes = slots.map((s) => s.player)
    if (team?.width === "wide") {
      attack *= calculateTacticSynergyMultiplier(averageAttribute(startingAttributes, WIDTH_SYNERGY_ATTRIBUTES))
    }
    if (team?.pressing === "high") {
      const pressingSynergy = calculateTacticSynergyMultiplier(averageAttribute(startingAttributes, PRESSING_SYNERGY_ATTRIBUTES))
      attack *= pressingSynergy
      defense *= pressingSynergy
    }
  }

  if (team?.mentality === "attacking") {
    attack *= 1.15
    defense *= 0.9
  } else if (team?.mentality === "defensive") {
    attack *= 0.88
    defense *= 1.12
  }

  return { attack, defense }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Knuth's algorithm - samples a Poisson-distributed goal count for a given expected value. */
function samplePoisson(lambda: number): number {
  const limit = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= Math.random()
  } while (p > limit)
  return k - 1
}

function randomMinute(): number {
  return Math.floor(Math.random() * 90) + 1
}

/**
 * Computes a fixture's full result (final score + minute-by-minute goal
 * events) the first time it's needed, once kickoff has passed. Deterministic
 * in the sense that it only ever runs once per fixture (guarded by
 * `playedAt`) - after that this is a no-op, so re-simulating never happens.
 * The live match view reveals these events progressively based on elapsed
 * real time rather than delaying this computation itself.
 */
export async function ensureFixtureSimulated(fixtureId: string): Promise<void> {
  const fixture = await prisma.fixture.findUnique({ where: { id: fixtureId } })
  if (!fixture || fixture.playedAt) return
  if (!fixture.scheduledAt || fixture.scheduledAt.getTime() > Date.now()) return

  const [home, away] = await Promise.all([
    computeTeamStrength(fixture.homeTeamId),
    computeTeamStrength(fixture.awayTeamId),
  ])

  const homeXG = clamp(BASE_GOAL_RATE * (home.attack / away.defense) * HOME_ADVANTAGE, MIN_XG, MAX_XG)
  const awayXG = clamp(BASE_GOAL_RATE * (away.attack / home.defense), MIN_XG, MAX_XG)

  const homeGoals = samplePoisson(homeXG)
  const awayGoals = samplePoisson(awayXG)

  const events = [
    ...Array.from({ length: homeGoals }, () => ({ minute: randomMinute(), teamId: fixture.homeTeamId })),
    ...Array.from({ length: awayGoals }, () => ({ minute: randomMinute(), teamId: fixture.awayTeamId })),
  ].sort((a, b) => a.minute - b.minute)

  // Gate attendance/revenue/expenses for the home side - self-heals a missing
  // Stadium row (e.g. a team created before the stadium system existed) the
  // same way generateSquad backfills a missing squad.
  const homeStadium = await ensureStadiumForTeam(fixture.homeTeamId)
  const homePlayers = await prisma.player.findMany({ where: { teamId: fixture.homeTeamId } })
  const capacity = calculateStadiumCapacity(toSeatCounts(homeStadium))
  const attendance = calculateAttendance(
    { isHome: true },
    { teamTotalQuality: calculateTeamTotalQuality(homePlayers) },
    { seats: toSeatCounts(homeStadium) }
  )
  const revenue = calculateMatchStadiumRevenue(attendance.bySeatType)
  const expenses = calculateHomeMatchExpenses({ capacity }, attendance.total, CURRENT_COMPETITION)
  const awayTravelCost = calculateAwayTravelCost(CURRENT_COMPETITION)

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.fixture.findUnique({ where: { id: fixtureId } })
    if (!fresh || fresh.playedAt) return

    await tx.matchEvent.createMany({
      data: events.map((e) => ({ fixtureId, minute: e.minute, teamId: e.teamId, type: "goal" })),
    })
    await tx.fixture.update({
      where: { id: fixtureId },
      data: {
        homeScore: homeGoals,
        awayScore: awayGoals,
        playedAt: new Date(),
        attendance: attendance.total,
        homeRevenue: revenue.total,
        homeMatchExpense: expenses.total,
      },
    })

    // Mandatory match-day costs/income - these must go through even if the
    // club's balance goes negative as a result; that pressure is the point.
    await createFinancialTransaction(tx, {
      teamId: fixture.homeTeamId,
      type: "matchRevenue",
      amount: revenue.total,
      description: "הכנסות קהל ממשחק בית",
      referenceId: `MATCH_${fixtureId}_HOME_REVENUE`,
    })
    await createFinancialTransaction(tx, {
      teamId: fixture.homeTeamId,
      type: "matchExpense",
      amount: -expenses.total,
      description: "הוצאות אירוח משחק בית",
      referenceId: `MATCH_${fixtureId}_HOME_EXPENSE`,
    })
    if (awayTravelCost > 0) {
      await createFinancialTransaction(tx, {
        teamId: fixture.awayTeamId,
        type: "matchExpense",
        amount: -awayTravelCost,
        description: "הוצאות נסיעה למשחק חוץ",
        referenceId: `MATCH_${fixtureId}_AWAY_TRAVEL`,
      })
    }
  })
}

/** Simulates every fixture in a division whose kickoff has passed but hasn't been computed yet. */
export async function settleDueFixtures(divisionId: string): Promise<void> {
  const due = await prisma.fixture.findMany({
    where: { divisionId, playedAt: null, scheduledAt: { lte: new Date() } },
    select: { id: true },
  })
  for (const fixture of due) {
    await ensureFixtureSimulated(fixture.id)
  }
}
