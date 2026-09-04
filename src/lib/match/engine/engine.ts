import type { AttributeKey } from "@/lib/players/attributes"
import { ATTACKING_STYLE_ATTRIBUTES, type TeamTactics } from "@/lib/players/tactics"
import type { PlayerPosition } from "@/lib/players/positions"
import { DEFAULT_GAME_BALANCE_CONFIG, type ChanceQuality, type GameBalanceConfig } from "./config"
import { SeededRandom } from "./rng"
import type { MatchSnapshot, SnapshotPlayer, SnapshotTeam } from "./snapshot"
import {
  clamp,
  contestProbability,
  effectiveWeighted,
  groupEffectiveWeighted,
  type EffectiveContext,
  type LivePlayer,
} from "./effective"
import { calculateTacticalFit, calculateTacticalInteraction } from "./tactical-fit"
import { Momentum, calculateCrowdEffect } from "./crowd"

// --- Attribute demands per action -------------------------------------------
// Each action tests the attributes that action actually depends on. Overall
// appears nowhere in this file - that is the point.

const PASS_ATTRS: Partial<Record<AttributeKey, number>> = {
  passing: 30,
  vision: 22,
  technique: 18,
  decisions: 18,
  composure: 12,
}
const PASS_DEFENSE_ATTRS: Partial<Record<AttributeKey, number>> = {
  interceptions: 30,
  anticipation: 25,
  defensivePositioning: 25,
  concentration: 20,
}
const DRIBBLE_ATTRS: Partial<Record<AttributeKey, number>> = {
  dribbling: 30,
  technique: 22,
  ballControl: 20,
  agility: 15,
  acceleration: 13,
}
const DRIBBLE_DEFENSE_ATTRS: Partial<Record<AttributeKey, number>> = {
  tackling: 30,
  defensivePositioning: 25,
  pace: 23,
  strength: 22,
}
const AERIAL_ATTACK_ATTRS: Partial<Record<AttributeKey, number>> = {
  heading: 30,
  jumping: 25,
  strength: 20,
  aerialDuels: 15,
  attackingPositioning: 10,
}
const AERIAL_DEFENSE_ATTRS: Partial<Record<AttributeKey, number>> = {
  marking: 25,
  aerialDuels: 25,
  defensivePositioning: 20,
  jumping: 18,
  strength: 12,
}
const SHOT_ATTRS: Record<ChanceQuality, Partial<Record<AttributeKey, number>>> = {
  lowQuality: { shooting: 30, finishing: 25, technique: 25, composure: 20 },
  mediumQuality: { finishing: 32, shooting: 26, technique: 22, composure: 20 },
  highQuality: { finishing: 36, composure: 26, attackingPositioning: 20, technique: 18 },
  oneOnOne: { finishing: 34, composure: 34, technique: 20, attackingPositioning: 12 },
  header: AERIAL_ATTACK_ATTRS,
  longShot: { longShots: 38, shooting: 26, technique: 20, composure: 16 },
  setPiece: { freeKicks: 34, technique: 26, shooting: 22, composure: 18 },
}
const KEEPER_ATTRS: Record<ChanceQuality, Partial<Record<AttributeKey, number>>> = {
  lowQuality: { reflexes: 30, goalkeeperPositioning: 28, handling: 24, composure: 18 },
  mediumQuality: { reflexes: 32, goalkeeperPositioning: 28, diving: 22, handling: 18 },
  highQuality: { reflexes: 36, diving: 28, goalkeeperPositioning: 24, handling: 12 },
  oneOnOne: { oneOnOne: 40, reflexes: 26, goalkeeperPositioning: 24, composure: 10 },
  header: { reflexes: 30, goalkeeperPositioning: 28, aerialAbility: 26, handling: 16 },
  longShot: { goalkeeperPositioning: 34, reflexes: 30, handling: 24, diving: 12 },
  setPiece: { goalkeeperPositioning: 32, reflexes: 30, diving: 24, handling: 14 },
}
const PENALTY_TAKER_ATTRS: Partial<Record<AttributeKey, number>> = {
  penalties: 40,
  composure: 30,
  technique: 18,
  finishing: 12,
}
const PENALTY_KEEPER_ATTRS: Partial<Record<AttributeKey, number>> = {
  penaltySaving: 40,
  reflexes: 28,
  goalkeeperPositioning: 20,
  anticipation: 12,
}
const CORNER_DELIVERY_ATTRS: Partial<Record<AttributeKey, number>> = {
  corners: 36,
  crossing: 30,
  technique: 20,
  composure: 14,
}
const FREEKICK_DELIVERY_ATTRS: Partial<Record<AttributeKey, number>> = {
  freeKicks: 36,
  crossing: 30,
  technique: 22,
  composure: 12,
}
const FOUL_RISK_ATTRS: Partial<Record<AttributeKey, number>> = { aggression: 55, workRate: 20, pace: 25 }
const FOUL_CONTROL_ATTRS: Partial<Record<AttributeKey, number>> = { tackling: 40, decisions: 35, composure: 25 }
const CAPTAIN_ATTRS: Partial<Record<AttributeKey, number>> = {
  leadership: 40,
  composure: 25,
  teamwork: 20,
  experience: 15,
}
const OFFSIDE_TRAP_DEMANDS: Partial<Record<AttributeKey, number>> = {
  defensivePositioning: 26,
  anticipation: 24,
  concentration: 22,
  teamwork: 18,
  leadership: 10,
}

// --- Public result types ------------------------------------------------------

export interface EngineMatchEvent {
  minute: number
  teamId: string
  type: string
  playerId?: string
  secondaryPlayerId?: string
  outcome?: string
  context?: Record<string, unknown>
}

export interface EnginePlayerStats {
  playerId: string
  teamId: string
  minutesPlayed: number
  goals: number
  assists: number
  shots: number
  shotsOnTarget: number
  passesAttempted: number
  passesCompleted: number
  keyPasses: number
  dribblesAttempted: number
  dribblesCompleted: number
  tackles: number
  interceptions: number
  aerialDuelsWon: number
  fouls: number
  yellowCards: number
  redCards: number
  saves: number
  rating: number
}

export interface EngineTeamStats {
  possessionPercent: number
  attacks: number
  chances: number
  shots: number
  shotsOnTarget: number
  goals: number
  corners: number
  freeKicks: number
  penalties: number
  fouls: number
  yellowCards: number
  redCards: number
  offsides: number
  injuries: number
  substitutions: number
}

export interface EngineResult {
  homeGoals: number
  awayGoals: number
  events: EngineMatchEvent[]
  homeStats: EngineTeamStats
  awayStats: EngineTeamStats
  playerStats: EnginePlayerStats[]
  /**
   * Who was actually on the pitch at the final whistle, per side, in
   * formation-slot order.
   *
   * Purely additive OUTPUT - it changes no probability and consumes no
   * random draw, so a given seed and snapshot still produce the identical
   * match. It exists because a penalty shootout needs the eleven who
   * finished the game, and that cannot be recovered afterwards from
   * PlayerMatchStats: a substituted player and one still on at 90 both have
   * minutesPlayed > 0, so minutes alone would put a player who came off in
   * the 60th minute on the spot. The engine tracks this exactly; reporting
   * it is better than approximating it.
   *
   * Players sent off are excluded - they cannot take a penalty.
   */
  finalOnPitch: { home: string[]; away: string[] }
}

// --- Internal per-side state ---------------------------------------------------

interface SideState {
  snapshot: SnapshotTeam
  players: Map<string, LivePlayer>
  onPitch: LivePlayer[]
  stats: EngineTeamStats
  momentum: Momentum
  tacticalFitOverall: number
  substitutionsUsed: number
  isHome: boolean
}

function emptyTeamStats(): EngineTeamStats {
  return {
    possessionPercent: 0,
    attacks: 0,
    chances: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    corners: 0,
    freeKicks: 0,
    penalties: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    offsides: 0,
    injuries: 0,
    substitutions: 0,
  }
}

function emptyPlayerStats(playerId: string, teamId: string): EnginePlayerStats {
  return {
    playerId,
    teamId,
    minutesPlayed: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passesAttempted: 0,
    passesCompleted: 0,
    keyPasses: 0,
    dribblesAttempted: 0,
    dribblesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    aerialDuelsWon: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    rating: 6,
  }
}

function toLivePlayer(player: SnapshotPlayer, onPitch: boolean): LivePlayer {
  return {
    snapshot: player,
    energy: clamp(player.fitness / 100, 0.1, 1),
    onPitch,
    minutesPlayed: 0,
    yellowCards: 0,
    sentOff: false,
    injured: false,
    currentRole: onPitch ? player.assignedRole : null,
  }
}

const MAX_SUBSTITUTIONS = 3
const ATTACKING_ROLES = new Set<PlayerPosition>(["ST", "RW", "LW", "CAM"])
const DEFENSIVE_ROLES = new Set<PlayerPosition>(["CB", "RB", "LB", "CDM"])

function roleOf(p: LivePlayer): PlayerPosition {
  return p.currentRole ?? p.snapshot.primaryPosition
}

function outfieldOnPitch(side: SideState): LivePlayer[] {
  return side.onPitch.filter((p) => roleOf(p) !== "GK")
}

function keeperOf(side: SideState): LivePlayer | null {
  return side.onPitch.find((p) => roleOf(p) === "GK") ?? null
}

/**
 * Simulates one match, event by event. Critically, the engine never decides
 * a result up front and then invents events to fit - it plays out possession
 * after possession, and the scoreline is simply whatever those events
 * produced. Everything is drawn from a seeded RNG, so the same snapshot and
 * seed always reproduce the same match exactly.
 */
export function simulateMatch(
  snapshot: MatchSnapshot,
  config: GameBalanceConfig = DEFAULT_GAME_BALANCE_CONFIG
): EngineResult {
  const rng = new SeededRandom(snapshot.seed)

  const makeSide = (team: SnapshotTeam, isHome: boolean): SideState => {
    const players = new Map<string, LivePlayer>()
    for (const p of team.starters) players.set(p.id, toLivePlayer(p, true))
    for (const p of team.bench) players.set(p.id, toLivePlayer(p, false))
    const onPitch = team.starters.map((p) => players.get(p.id)!)
    return {
      snapshot: team,
      players,
      onPitch,
      stats: emptyTeamStats(),
      momentum: new Momentum(config),
      tacticalFitOverall: calculateTacticalFit(team.starters, team.tactics).overall,
      substitutionsUsed: 0,
      isHome,
    }
  }

  const home = makeSide(snapshot.home, true)
  const away = makeSide(snapshot.away, false)

  const playerStats = new Map<string, EnginePlayerStats>()
  const statsFor = (side: SideState, playerId: string): EnginePlayerStats => {
    let s = playerStats.get(playerId)
    if (!s) {
      s = emptyPlayerStats(playerId, side.snapshot.teamId)
      playerStats.set(playerId, s)
    }
    return s
  }

  const events: EngineMatchEvent[] = []
  let homeGoals = 0
  let awayGoals = 0

  const homeInteraction = calculateTacticalInteraction(home.snapshot.tactics, away.snapshot.tactics)
  const awayInteraction = calculateTacticalInteraction(away.snapshot.tactics, home.snapshot.tactics)

  // How many possession sequences this match gets, driven by both sides' tempo.
  const tempoFactor =
    (config.tempoPossessionModifier[home.snapshot.tactics.tempo] +
      config.tempoPossessionModifier[away.snapshot.tactics.tempo]) /
    2
  const totalPossessions = Math.round(config.basePossessionsPerMatch * tempoFactor)

  let homePossessions = 0
  let awayPossessions = 0

  /** The situational multiplier applied to every effective attribute for a side right now. */
  const contextFor = (side: SideState, minute: number): EffectiveContext => {
    let multiplier = side.momentum.multiplier()

    // `isHome` alone is a DATABASE role. It only means "playing at home",
    // and therefore only earns home advantage, when the match is actually
    // at someone's ground. A championship decider is played on neutral
    // turf, so neither side gets either half of it.
    if (side.isHome && !snapshot.neutralVenue) {
      multiplier *= config.homeAdvantage
      multiplier *= calculateCrowdEffect(
        { minute, homeGoals, awayGoals },
        snapshot.fanType,
        snapshot.attendance,
        snapshot.stadiumCapacity,
        config
      )
    }

    // A captain's influence is not a constant background bonus - it only
    // shows up when the team is under real pressure (behind, or late on).
    const captain = side.snapshot.captainId ? side.players.get(side.snapshot.captainId) : null
    if (captain && captain.onPitch && !captain.sentOff) {
      const behind = side.isHome ? homeGoals < awayGoals : awayGoals < homeGoals
      const late = minute >= 75
      if (behind || late) {
        const baseContext: EffectiveContext = { teamMultiplier: 1, config }
        const leadership = effectiveWeighted(captain, CAPTAIN_ATTRS, baseContext)
        multiplier *= 1 + ((leadership - 50) / 50) * config.captainMaxEffect
      }
    }

    // Being a man down is modeled as a real, compounding loss rather than a
    // flat percentage penalty.
    const missing = Math.max(0, 11 - side.onPitch.length)
    if (missing > 0) multiplier *= Math.pow(1 - config.playerShortPenalty, missing)

    // How well this XI suits its instructions, and how those instructions
    // match up against the opponent's - both bounded small.
    const fitEdge = (side.tacticalFitOverall - 65) / 35
    multiplier *= 1 + clamp(fitEdge, -1, 1) * config.maxTacticalFitEffect
    const interaction = side === home ? homeInteraction : awayInteraction
    multiplier *= 1 + interaction * config.maxTacticalInteractionEffect

    return { teamMultiplier: clamp(multiplier, 0.5, 1.6), config }
  }

  const drainEnergy = (side: SideState, minutesElapsed: number) => {
    const t = side.snapshot.tactics
    const drain =
      config.baseEnergyDrainPerPossession *
      config.pressingEnergyMultiplier[t.pressing] *
      config.tempoEnergyMultiplier[t.tempo]
    for (const p of side.onPitch) {
      const stamina = (p.snapshot.attributes.stamina ?? 50) / 100
      const workRate = (p.snapshot.attributes.workRate ?? 50) / 100
      // Harder-working players cover more ground and tire faster; higher
      // stamina offsets it. Both are real attribute trade-offs.
      const personal = drain * (0.7 + workRate * 0.6) * (1 - stamina * config.staminaEnergyProtection)
      p.energy = clamp(p.energy - personal / 100, 0.15, 1)
      p.minutesPlayed += minutesElapsed
    }
  }

  const recordEvent = (event: EngineMatchEvent) => events.push(event)

  /** Picks who on the attacking side is involved, weighted toward advanced roles. */
  const pickAttacker = (side: SideState, weights: Partial<Record<AttributeKey, number>>, ctx: EffectiveContext) => {
    const candidates = outfieldOnPitch(side)
    if (candidates.length === 0) return null
    return rng.pickWeighted(candidates, (p) => {
      const roleBias = ATTACKING_ROLES.has(roleOf(p)) ? 2.4 : roleOf(p) === "CM" || roleOf(p) === "RM" || roleOf(p) === "LM" ? 1.4 : 0.5
      return effectiveWeighted(p, weights, ctx) * roleBias
    })
  }

  const pickDefender = (side: SideState, weights: Partial<Record<AttributeKey, number>>, ctx: EffectiveContext) => {
    const candidates = outfieldOnPitch(side)
    if (candidates.length === 0) return null
    return rng.pickWeighted(candidates, (p) => {
      const roleBias = DEFENSIVE_ROLES.has(roleOf(p)) ? 2.4 : 0.7
      return effectiveWeighted(p, weights, ctx) * roleBias
    })
  }

  const takerFor = (side: SideState, id: string | null, weights: Partial<Record<AttributeKey, number>>, ctx: EffectiveContext) => {
    const nominated = id ? side.players.get(id) : null
    if (nominated && nominated.onPitch && !nominated.sentOff) return nominated
    const candidates = outfieldOnPitch(side)
    if (candidates.length === 0) return null
    // No nominated taker available - the best remaining player on the pitch
    // for that specific skill steps up, not the highest-Overall player.
    return candidates.reduce((best, p) =>
      effectiveWeighted(p, weights, ctx) > effectiveWeighted(best, weights, ctx) ? p : best
    )
  }

  /** Resolves a shot into a goal, a save, or a miss. */
  const resolveShot = (
    attacking: SideState,
    defending: SideState,
    shooter: LivePlayer,
    quality: ChanceQuality,
    minute: number,
    assist: LivePlayer | null,
    attackCtx: EffectiveContext,
    defendCtx: EffectiveContext
  ) => {
    attacking.stats.shots++
    statsFor(attacking, shooter.snapshot.id).shots++

    const keeper = keeperOf(defending)
    const shotRating = effectiveWeighted(shooter, SHOT_ATTRS[quality], attackCtx)
    const keeperRating = keeper ? effectiveWeighted(keeper, KEEPER_ATTRS[quality], defendCtx) : 30

    const onTargetChance = clamp(config.baseOnTargetChance * (1 + (shotRating - 55) / 90), 0.12, 0.88)
    if (!rng.chance(onTargetChance)) {
      recordEvent({ minute, teamId: attacking.snapshot.teamId, type: "shot", playerId: shooter.snapshot.id, outcome: "off_target", context: { quality } })
      return false
    }

    attacking.stats.shotsOnTarget++
    statsFor(attacking, shooter.snapshot.id).shotsOnTarget++

    const scoreChance = contestProbability(shotRating, keeperRating, config.baseChanceConversion[quality], config)
    if (rng.chance(scoreChance)) {
      attacking.stats.goals++
      statsFor(attacking, shooter.snapshot.id).goals++
      if (assist && assist.snapshot.id !== shooter.snapshot.id) {
        statsFor(attacking, assist.snapshot.id).assists++
        statsFor(attacking, assist.snapshot.id).keyPasses++
      }
      if (attacking === home) homeGoals++
      else awayGoals++
      attacking.momentum.scored()
      defending.momentum.conceded()
      recordEvent({
        minute,
        teamId: attacking.snapshot.teamId,
        type: "goal",
        playerId: shooter.snapshot.id,
        secondaryPlayerId: assist?.snapshot.id,
        outcome: "goal",
        context: { quality },
      })
      return true
    }

    if (keeper) {
      statsFor(defending, keeper.snapshot.id).saves++
      recordEvent({
        minute,
        teamId: defending.snapshot.teamId,
        type: "save",
        playerId: keeper.snapshot.id,
        secondaryPlayerId: shooter.snapshot.id,
        outcome: "saved",
        context: { quality },
      })
    }
    return false
  }

  const resolvePenalty = (attacking: SideState, defending: SideState, minute: number, attackCtx: EffectiveContext, defendCtx: EffectiveContext) => {
    attacking.stats.penalties++
    const taker = takerFor(attacking, attacking.snapshot.penaltyTakerId, PENALTY_TAKER_ATTRS, attackCtx)
    const keeper = keeperOf(defending)
    if (!taker) return

    const takerRating = effectiveWeighted(taker, PENALTY_TAKER_ATTRS, attackCtx)
    const keeperRating = keeper ? effectiveWeighted(keeper, PENALTY_KEEPER_ATTRS, defendCtx) : 35
    attacking.stats.shots++
    attacking.stats.shotsOnTarget++
    statsFor(attacking, taker.snapshot.id).shots++
    statsFor(attacking, taker.snapshot.id).shotsOnTarget++

    if (rng.chance(contestProbability(takerRating, keeperRating, 0.76, config))) {
      attacking.stats.goals++
      statsFor(attacking, taker.snapshot.id).goals++
      if (attacking === home) homeGoals++
      else awayGoals++
      attacking.momentum.scored()
      defending.momentum.conceded()
      recordEvent({ minute, teamId: attacking.snapshot.teamId, type: "penalty", playerId: taker.snapshot.id, outcome: "scored" })
    } else {
      attacking.momentum.missedPenalty()
      if (keeper) statsFor(defending, keeper.snapshot.id).saves++
      recordEvent({
        minute,
        teamId: attacking.snapshot.teamId,
        type: "penalty",
        playerId: taker.snapshot.id,
        secondaryPlayerId: keeper?.snapshot.id,
        outcome: "missed",
      })
    }
  }

  /** A corner: delivery quality vs the aerial duel in the box, then the keeper. */
  const resolveCorner = (attacking: SideState, defending: SideState, minute: number, attackCtx: EffectiveContext, defendCtx: EffectiveContext) => {
    attacking.stats.corners++
    const taker = takerFor(attacking, attacking.snapshot.cornerTakerId, CORNER_DELIVERY_ATTRS, attackCtx)
    if (!taker) return
    recordEvent({ minute, teamId: attacking.snapshot.teamId, type: "corner", playerId: taker.snapshot.id })

    const delivery = effectiveWeighted(taker, CORNER_DELIVERY_ATTRS, attackCtx)
    const attackers = outfieldOnPitch(attacking)
    const target = attackers.length
      ? rng.pickWeighted(attackers, (p) => effectiveWeighted(p, AERIAL_ATTACK_ATTRS, attackCtx))
      : null
    if (!target) return

    const aerialAttack = effectiveWeighted(target, AERIAL_ATTACK_ATTRS, attackCtx)
    const aerialDefense = groupEffectiveWeighted(outfieldOnPitch(defending), AERIAL_DEFENSE_ATTRS, defendCtx)

    // A great delivery still needs someone who can win the header - and vice
    // versa. Neither alone produces a chance.
    const winChance = contestProbability((delivery + aerialAttack * 2) / 3, aerialDefense, 0.34, config)
    if (!rng.chance(winChance)) return

    statsFor(attacking, target.snapshot.id).aerialDuelsWon++
    attacking.stats.chances++
    resolveShot(attacking, defending, target, "header", minute, taker, attackCtx, defendCtx)
  }

  const resolveFreeKick = (attacking: SideState, defending: SideState, minute: number, attackCtx: EffectiveContext, defendCtx: EffectiveContext) => {
    attacking.stats.freeKicks++
    const taker = takerFor(attacking, attacking.snapshot.freeKickTakerId, SHOT_ATTRS.setPiece, attackCtx)
    if (!taker) return
    recordEvent({ minute, teamId: attacking.snapshot.teamId, type: "freeKick", playerId: taker.snapshot.id })

    // Roughly a third of free kicks are close enough to shoot; the rest are
    // deliveries into the box, where the aerial contest decides things.
    if (rng.chance(0.35)) {
      attacking.stats.chances++
      resolveShot(attacking, defending, taker, "setPiece", minute, null, attackCtx, defendCtx)
      return
    }

    const delivery = effectiveWeighted(taker, FREEKICK_DELIVERY_ATTRS, attackCtx)
    const attackers = outfieldOnPitch(attacking)
    const target = attackers.length
      ? rng.pickWeighted(attackers, (p) => effectiveWeighted(p, AERIAL_ATTACK_ATTRS, attackCtx))
      : null
    if (!target) return

    const aerialAttack = effectiveWeighted(target, AERIAL_ATTACK_ATTRS, attackCtx)
    const aerialDefense = groupEffectiveWeighted(outfieldOnPitch(defending), AERIAL_DEFENSE_ATTRS, defendCtx)
    if (!rng.chance(contestProbability((delivery + aerialAttack * 2) / 3, aerialDefense, 0.32, config))) return

    statsFor(attacking, target.snapshot.id).aerialDuelsWon++
    attacking.stats.chances++
    resolveShot(attacking, defending, target, "header", minute, taker, attackCtx, defendCtx)
  }

  /** A foul, and whether it draws a card - driven by aggression vs technique/decisions. */
  const resolveFoul = (side: SideState, opponent: SideState, minute: number, ctx: EffectiveContext) => {
    const candidates = outfieldOnPitch(side)
    if (candidates.length === 0) return
    // Aggressive players commit more fouls; good tacklers and good
    // decision-makers commit fewer. An aggressive player who CAN tackle is
    // an asset; an aggressive one who can't is a liability.
    const offender = rng.pickWeighted(candidates, (p) => {
      const risk = effectiveWeighted(p, FOUL_RISK_ATTRS, ctx)
      const control = effectiveWeighted(p, FOUL_CONTROL_ATTRS, ctx)
      // A booked player visibly pulls out of challenges - which is both
      // realistic and what keeps second yellows rare rather than routine.
      const bookedCaution = p.yellowCards > 0 ? 0.3 : 1
      return clamp((risk - control * 0.6) * bookedCaution, 2, 100)
    })

    side.stats.fouls++
    statsFor(side, offender.snapshot.id).fouls++
    recordEvent({ minute, teamId: side.snapshot.teamId, type: "foul", playerId: offender.snapshot.id })

    const control = effectiveWeighted(offender, FOUL_CONTROL_ATTRS, ctx)
    // Referees are also slower to produce a second yellow than a first.
    const bookedCaution = offender.yellowCards > 0 ? 0.45 : 1
    const cardModifier = clamp(1 + (55 - control) / 90, 0.5, 1.8) * bookedCaution

    if (rng.chance(config.redCardChanceOnFoul * cardModifier)) {
      sendOff(side, offender, minute, "red")
      return
    }
    if (rng.chance(config.yellowCardChanceOnFoul * cardModifier)) {
      offender.yellowCards++
      side.stats.yellowCards++
      statsFor(side, offender.snapshot.id).yellowCards++
      recordEvent({ minute, teamId: side.snapshot.teamId, type: "yellowCard", playerId: offender.snapshot.id })
      if (config.secondYellowIsRed && offender.yellowCards >= 2) {
        sendOff(side, offender, minute, "secondYellow")
      }
    }
  }

  function sendOff(side: SideState, player: LivePlayer, minute: number, reason: string) {
    player.sentOff = true
    player.onPitch = false
    side.onPitch = side.onPitch.filter((p) => p !== player)
    side.stats.redCards++
    statsFor(side, player.snapshot.id).redCards++
    side.momentum.redCard()
    recordEvent({ minute, teamId: side.snapshot.teamId, type: "redCard", playerId: player.snapshot.id, outcome: reason })
    reshapeAfterLoss(side)
  }

  /**
   * With a player missing, someone has to cover the vacated role. The
   * engine actually reassigns a role rather than applying an abstract
   * penalty - so being a man down really does mean somebody is now playing
   * out of position.
   */
  function reshapeAfterLoss(side: SideState) {
    const covered = new Set(side.onPitch.map((p) => roleOf(p)))
    const needed = side.snapshot.formationSlots.map((s) => s.role).filter((r) => r !== "GK")
    const uncovered = needed.filter((r) => !covered.has(r))
    if (uncovered.length === 0) return

    for (const role of uncovered) {
      const candidate = outfieldOnPitch(side).find((p) => p.snapshot.secondaryPositions.includes(role))
      if (candidate) {
        candidate.currentRole = role
        return
      }
    }
  }

  const resolveInjury = (side: SideState, minute: number) => {
    const candidates = outfieldOnPitch(side)
    if (candidates.length === 0) return
    // Tired players get hurt more often - which is part of why substitutions
    // and stamina matter.
    const victim = rng.pickWeighted(candidates, (p) => clamp((1 - p.energy) * 100 + 10, 1, 120))
    victim.injured = true
    side.stats.injuries++
    recordEvent({ minute, teamId: side.snapshot.teamId, type: "injury", playerId: victim.snapshot.id })
    trySubstitute(side, victim, minute, true)
  }

  /**
   * Brings on a fresh player. A substitute enters at full energy, so late
   * substitutions really do give a genuine physical edge over tired
   * opponents - making them a real tactical lever, not cosmetic.
   */
  function trySubstitute(side: SideState, out: LivePlayer, minute: number, forced: boolean) {
    if (side.substitutionsUsed >= MAX_SUBSTITUTIONS) {
      if (forced) {
        out.onPitch = false
        side.onPitch = side.onPitch.filter((p) => p !== out)
        reshapeAfterLoss(side)
      }
      return
    }

    const role = roleOf(out)
    const available = side.snapshot.bench
      .map((b) => side.players.get(b.id)!)
      .filter((p) => !p.onPitch && !p.injured && !p.sentOff)
    if (available.length === 0) {
      if (forced) {
        out.onPitch = false
        side.onPitch = side.onPitch.filter((p) => p !== out)
        reshapeAfterLoss(side)
      }
      return
    }

    // Prefer a like-for-like replacement, so the shape survives the change.
    const replacement =
      available.find((p) => p.snapshot.primaryPosition === role) ??
      available.find((p) => p.snapshot.secondaryPositions.includes(role)) ??
      available[0]

    out.onPitch = false
    side.onPitch = side.onPitch.filter((p) => p !== out)
    replacement.onPitch = true
    replacement.currentRole = role
    side.onPitch.push(replacement)
    side.substitutionsUsed++
    side.stats.substitutions++
    recordEvent({
      minute,
      teamId: side.snapshot.teamId,
      type: "substitution",
      playerId: replacement.snapshot.id,
      secondaryPlayerId: out.snapshot.id,
    })
  }

  /** Late in the match, tired outfield players get replaced if fresh legs are available. */
  const considerTacticalSubs = (side: SideState, minute: number) => {
    if (minute < 60 || side.substitutionsUsed >= MAX_SUBSTITUTIONS) return
    const exhausted = outfieldOnPitch(side)
      .filter((p) => p.energy < 0.55)
      .sort((a, b) => a.energy - b.energy)[0]
    if (exhausted && rng.chance(0.25)) trySubstitute(side, exhausted, minute, false)
  }

  /**
   * One attacking sequence, played out stage by stage. Every stage can end
   * the move - this is where the result actually comes from.
   */
  const runPossession = (attacking: SideState, defending: SideState, minute: number) => {
    const attackCtx = contextFor(attacking, minute)
    const defendCtx = contextFor(defending, minute)
    attacking.stats.attacks++

    const tactics = attacking.snapshot.tactics
    const styleAttrs = ATTACKING_STYLE_ATTRIBUTES[tactics.attackingStyle]

    // A foul can interrupt the move before it develops.
    if (rng.chance(config.baseFoulChance)) {
      resolveFoul(defending, attacking, minute, defendCtx)
      if (rng.chance(config.freeKickChance / config.baseFoulChance)) {
        resolveFreeKick(attacking, defending, minute, attackCtx, defendCtx)
        return
      }
    }

    // Stage 1 - build-up. The chosen attacking style decides which
    // attributes are tested here; the opponent's pressing decides what
    // they're tested against.
    const buildUp = groupEffectiveWeighted(outfieldOnPitch(attacking), styleAttrs, attackCtx)
    const pressResistance = groupEffectiveWeighted(outfieldOnPitch(defending), PASS_DEFENSE_ATTRS, defendCtx)

    const passer = pickAttacker(attacking, PASS_ATTRS, attackCtx)
    if (passer) {
      const ps = statsFor(attacking, passer.snapshot.id)
      ps.passesAttempted++
      if (rng.chance(contestProbability(buildUp, pressResistance, config.baseAdvanceChance, config))) {
        ps.passesCompleted++
      } else {
        const winner = pickDefender(defending, PASS_DEFENSE_ATTRS, defendCtx)
        if (winner) statsFor(defending, winner.snapshot.id).interceptions++
        return
      }
    }

    // Stage 2 - progression. Either a dribble or a pass into the final third,
    // depending on the manager's dribbling instruction.
    const dribbleBias = tactics.dribbleFrequency === "often" ? 0.5 : tactics.dribbleFrequency === "rarely" ? 0.15 : 0.3
    if (rng.chance(dribbleBias)) {
      const dribbler = pickAttacker(attacking, DRIBBLE_ATTRS, attackCtx)
      const marker = pickDefender(defending, DRIBBLE_DEFENSE_ATTRS, defendCtx)
      if (dribbler && marker) {
        const ds = statsFor(attacking, dribbler.snapshot.id)
        ds.dribblesAttempted++
        const dribbleRating = effectiveWeighted(dribbler, DRIBBLE_ATTRS, attackCtx)
        const markRating = effectiveWeighted(marker, DRIBBLE_DEFENSE_ATTRS, defendCtx)
        if (rng.chance(contestProbability(dribbleRating, markRating, 0.5, config))) {
          ds.dribblesCompleted++
        } else {
          statsFor(defending, marker.snapshot.id).tackles++
          recordEvent({
            minute,
            teamId: defending.snapshot.teamId,
            type: "tackle",
            playerId: marker.snapshot.id,
            secondaryPlayerId: dribbler.snapshot.id,
            outcome: "won",
          })
          if (rng.chance(config.cornerChance)) resolveCorner(attacking, defending, minute, attackCtx, defendCtx)
          return
        }
      }
    }

    // Attackers stray offside in any match; an explicit offside trap adds to
    // that, but only as much as the back line's coordination can actually
    // deliver - a badly-drilled trap barely helps and leaves space instead.
    const defenderTactics = defending.snapshot.tactics
    let offsideChance = config.baseOffsideChance
    if (defenderTactics.offsideTrap) {
      const trapQuality = groupEffectiveWeighted(
        outfieldOnPitch(defending).filter((p) => DEFENSIVE_ROLES.has(roleOf(p))),
        OFFSIDE_TRAP_DEMANDS,
        defendCtx
      )
      offsideChance += config.offsideTrapBonus * ((trapQuality - 50) / 50)
    }
    if (rng.chance(clamp(offsideChance, 0.005, 0.2))) {
      attacking.stats.offsides++
      const caught = pickAttacker(attacking, { attackingPositioning: 50, anticipation: 50 }, attackCtx)
      recordEvent({ minute, teamId: attacking.snapshot.teamId, type: "offside", playerId: caught?.snapshot.id })
      return
    }

    // Stage 3 - the final ball. The defensive block gets a last chance to
    // stop the move before a real chance exists.
    const creator = pickAttacker(attacking, PASS_ATTRS, attackCtx)
    const block = groupEffectiveWeighted(outfieldOnPitch(defending), AERIAL_DEFENSE_ATTRS, defendCtx)
    const finalBall = creator ? effectiveWeighted(creator, PASS_ATTRS, attackCtx) : 45

    if (!rng.chance(contestProbability(finalBall, block, 0.42, config))) {
      if (rng.chance(config.cornerChance)) resolveCorner(attacking, defending, minute, attackCtx, defendCtx)
      return
    }

    // Stage 4 - a chance exists. What KIND of chance depends on the style
    // that created it, which is what makes styles feel different rather than
    // just stronger or weaker.
    attacking.stats.chances++
    const quality = pickChanceQuality(tactics, rng)
    const shooterAttrs = SHOT_ATTRS[quality]
    const shooter = pickAttacker(attacking, shooterAttrs, attackCtx)
    if (!shooter) return

    if (creator && creator.snapshot.id !== shooter.snapshot.id) {
      statsFor(attacking, creator.snapshot.id).keyPasses++
    }

    // A clumsy challenge on a real chance can concede a penalty.
    if (rng.chance(config.penaltyChance / 0.5)) {
      resolveFoul(defending, attacking, minute, defendCtx)
      resolvePenalty(attacking, defending, minute, attackCtx, defendCtx)
      return
    }

    const scored = resolveShot(attacking, defending, shooter, quality, minute, creator, attackCtx, defendCtx)
    if (!scored && rng.chance(config.cornerChance * 2)) {
      resolveCorner(attacking, defending, minute, attackCtx, defendCtx)
    }
  }

  // --- The match loop ---------------------------------------------------------

  const minutesPerPossession = 90 / totalPossessions
  for (let i = 0; i < totalPossessions; i++) {
    const minute = Math.min(90, Math.max(1, Math.round((i + 1) * minutesPerPossession)))

    // Who has the ball is itself a contest - possession-oriented sides with
    // the players to back it up genuinely see more of it.
    const homeCtx = contextFor(home, minute)
    const awayCtx = contextFor(away, minute)
    const homeControl = groupEffectiveWeighted(
      outfieldOnPitch(home),
      ATTACKING_STYLE_ATTRIBUTES[home.snapshot.tactics.attackingStyle],
      homeCtx
    )
    const awayControl = groupEffectiveWeighted(
      outfieldOnPitch(away),
      ATTACKING_STYLE_ATTRIBUTES[away.snapshot.tactics.attackingStyle],
      awayCtx
    )
    const homeShare = clamp(0.5 + (homeControl - awayControl) / 200, 0.25, 0.75)

    if (rng.chance(homeShare)) {
      homePossessions++
      runPossession(home, away, minute)
    } else {
      awayPossessions++
      runPossession(away, home, minute)
    }

    drainEnergy(home, minutesPerPossession)
    drainEnergy(away, minutesPerPossession)
    home.momentum.decay()
    away.momentum.decay()

    if (rng.chance(config.baseInjuryChancePerMatch / totalPossessions)) resolveInjury(home, minute)
    if (rng.chance(config.baseInjuryChancePerMatch / totalPossessions)) resolveInjury(away, minute)

    considerTacticalSubs(home, minute)
    considerTacticalSubs(away, minute)
  }

  const totalPoss = homePossessions + awayPossessions || 1
  home.stats.possessionPercent = Math.round((homePossessions / totalPoss) * 100)
  away.stats.possessionPercent = 100 - home.stats.possessionPercent

  // Everyone who took the pitch gets their minutes recorded.
  for (const side of [home, away]) {
    for (const live of side.players.values()) {
      if (live.minutesPlayed > 0 || live.onPitch) {
        const s = statsFor(side, live.snapshot.id)
        s.minutesPlayed = Math.min(90, Math.round(live.minutesPlayed))
      }
    }
  }

  const allStats = [...playerStats.values()]
  for (const s of allStats) {
    s.rating = calculateMatchRating(s, s.teamId === home.snapshot.teamId ? homeGoals : awayGoals, s.teamId === home.snapshot.teamId ? awayGoals : homeGoals)
  }

  // Read off the state the engine already maintained all match - no extra
  // computation, no random draw, and therefore no effect on the result.
  const stillOn = (side: SideState) =>
    side.onPitch.filter((p) => !p.sentOff).map((p) => p.snapshot.id)

  return {
    homeGoals,
    awayGoals,
    events: events.sort((a, b) => a.minute - b.minute),
    homeStats: home.stats,
    awayStats: away.stats,
    playerStats: allStats,
    finalOnPitch: { home: stillOn(home), away: stillOn(away) },
  }
}

/** Which kind of chance a style tends to produce - shapes how matches feel. */
function pickChanceQuality(tactics: TeamTactics, rng: SeededRandom): ChanceQuality {
  const roll = rng.next()
  switch (tactics.attackingStyle) {
    case "counterAttack":
      // Fewer, better chances - counters end in space.
      if (roll < 0.2) return "oneOnOne"
      if (roll < 0.5) return "highQuality"
      if (roll < 0.8) return "mediumQuality"
      return "lowQuality"
    case "directPlay":
      if (roll < 0.34) return "header"
      if (roll < 0.5) return "highQuality"
      if (roll < 0.78) return "mediumQuality"
      return "lowQuality"
    case "widePlay":
      if (roll < 0.38) return "header"
      if (roll < 0.56) return "highQuality"
      if (roll < 0.84) return "mediumQuality"
      return "lowQuality"
    case "centralPlay":
      if (roll < 0.12) return "oneOnOne"
      if (roll < 0.36) return "highQuality"
      if (roll < 0.7) return "mediumQuality"
      if (roll < 0.85) return "longShot"
      return "lowQuality"
    case "possession":
      // Lots of the ball, but patient build-up yields more half-chances.
      if (roll < 0.08) return "oneOnOne"
      if (roll < 0.3) return "highQuality"
      if (roll < 0.72) return "mediumQuality"
      return "lowQuality"
    case "shortPassing":
    default:
      if (roll < 0.1) return "oneOnOne"
      if (roll < 0.32) return "highQuality"
      if (roll < 0.7) return "mediumQuality"
      if (roll < 0.82) return "longShot"
      return "lowQuality"
  }
}

/**
 * A match rating built from what a player actually did - never from their
 * Overall. A 65-rated player who scores twice outranks a 90-rated one who
 * did nothing, which is the whole point.
 */
export function calculateMatchRating(stats: EnginePlayerStats, goalsFor: number, goalsAgainst: number): number {
  if (stats.minutesPlayed === 0) return 6

  let rating = 6
  rating += stats.goals * 1.15
  rating += stats.assists * 0.75
  rating += stats.keyPasses * 0.14
  rating += stats.shotsOnTarget * 0.1
  rating += stats.dribblesCompleted * 0.09
  rating += stats.tackles * 0.11
  rating += stats.interceptions * 0.1
  rating += stats.aerialDuelsWon * 0.08
  rating += stats.saves * 0.19

  const passAccuracy = stats.passesAttempted > 0 ? stats.passesCompleted / stats.passesAttempted : 0.7
  rating += (passAccuracy - 0.7) * 1.1

  rating -= stats.fouls * 0.07
  rating -= stats.yellowCards * 0.3
  rating -= stats.redCards * 1.4

  // A share of the team result, so defenders and keepers are credited for
  // clean sheets and marked down for heavy defeats.
  rating += (goalsFor - goalsAgainst) * 0.09
  if (goalsAgainst === 0 && stats.minutesPlayed >= 60) rating += 0.3

  return Math.round(clamp(rating, 1, 10) * 10) / 10
}
