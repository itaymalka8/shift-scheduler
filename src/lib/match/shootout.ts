/**
 * A penalty shootout, decided by the same seed that decided the match.
 *
 * Pure: no database, no clock, no Math.random. The only source of chance is
 * a SeededRandom built from the fixture's own matchSeed, so the same fixture
 * with the same players always produces exactly the same shootout - forever,
 * and without storing a kick-by-kick log to reproduce it from.
 *
 * WHY THIS EXISTS AT ALL. The match engine plays 90 minutes and can return a
 * draw. A championship decider that draws would leave the title unresolved
 * and the season stuck ACTIVE with no way forward, so a decider needs a
 * mechanism that CANNOT draw. This is it, and it is deliberately outside the
 * engine: simulateMatch, its probabilities and calculateMatchRating are all
 * untouched, and this runs on the engine's output rather than inside it.
 *
 * THE RULES ARE REAL FOOTBALL'S. Five kicks each, alternating, home first;
 * the round stops the moment the outcome is mathematically settled; if still
 * level after five each, sudden death round by round until one side scores
 * and the other does not. A draw is not a representable outcome of this
 * function - it always returns a winner.
 */
import { SeededRandom } from "./engine/rng"

/** What a taker needs to expose. Attributes only - no name, no club ownership. */
export interface ShootoutPlayer {
  playerId: string
  /** Player.penalties, 1-99. Missing attributes fall back to the neutral default. */
  penalties: number | null
}

/** What a keeper needs to expose. */
export interface ShootoutKeeper {
  playerId: string
  /** Player.penaltySaving, 1-99. */
  penaltySaving: number | null
}

export interface ShootoutSide {
  teamId: string
  /** In taking order. Cycled if the shootout runs longer than the list. */
  takers: ShootoutPlayer[]
  keeper: ShootoutKeeper | null
}

export interface ShootoutKick {
  /** 1-5 for the initial round, 6+ for sudden death. */
  round: number
  side: "home" | "away"
  teamId: string
  playerId: string
  scored: boolean
}

export interface ShootoutResult {
  homeScore: number
  awayScore: number
  winner: "home" | "away"
  winnerTeamId: string
  kicks: ShootoutKick[]
  /** True when it went past the initial five kicks each. */
  suddenDeath: boolean
}

export class ShootoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ShootoutError"
  }
}

/** Kicks each side takes before sudden death begins. */
export const INITIAL_ROUNDS = 5

/**
 * A hard stop on sudden death. Not a rule of football - a guard against a
 * bug turning this into an infinite loop. With any sane attribute values the
 * chance of reaching it is negligible; reaching it at all means something is
 * wrong, so it throws rather than inventing a winner.
 */
export const MAX_SUDDEN_DEATH_ROUNDS = 100

/** Neutral value for a player whose attribute was never generated. */
const DEFAULT_ATTRIBUTE = 50

const MIN_SCORE_CHANCE = 0.45
const MAX_SCORE_CHANCE = 0.92
/** A penalty is a striker's advantage: the midpoint sits well above even. */
const BASE_SCORE_CHANCE = 0.76
/** How far the taker's and keeper's attributes can pull that midpoint. */
const ATTRIBUTE_SWING = 0.3

function attr(value: number | null): number {
  return value == null ? DEFAULT_ATTRIBUTE : Math.max(1, Math.min(99, value))
}

/**
 * The probability this kick is scored, from the taker's penalties against
 * the keeper's penaltySaving.
 *
 * A pure function of the two attributes, clamped so neither a hopeless taker
 * nor a world-class keeper ever makes the outcome a foregone conclusion -
 * the whole point of a shootout is that it can go either way.
 */
export function scoreChance(taker: ShootoutPlayer, keeper: ShootoutKeeper | null): number {
  const takerSkill = attr(taker.penalties)
  // No keeper on the pitch (sent off, or an incomplete snapshot) is not a
  // free goal: an outfield player goes in goal, at the neutral default.
  const keeperSkill = attr(keeper?.penaltySaving ?? null)
  const edge = (takerSkill - keeperSkill) / 98 // -1..1
  const chance = BASE_SCORE_CHANCE + edge * ATTRIBUTE_SWING
  return Math.max(MIN_SCORE_CHANCE, Math.min(MAX_SCORE_CHANCE, chance))
}

/**
 * Can this still be decided, or is it already over?
 *
 * Standard "best of the remaining kicks" arithmetic: a side that cannot be
 * caught even if it misses every remaining kick has won, and the shootout
 * stops there rather than playing out dead rubbers - exactly as a real one
 * does.
 */
export function isSettledEarly(
  homeScore: number,
  awayScore: number,
  homeTaken: number,
  awayTaken: number
): boolean {
  const homeRemaining = Math.max(0, INITIAL_ROUNDS - homeTaken)
  const awayRemaining = Math.max(0, INITIAL_ROUNDS - awayTaken)
  if (homeScore > awayScore + awayRemaining) return true
  if (awayScore > homeScore + homeRemaining) return true
  return false
}

/**
 * Runs the shootout.
 *
 * `seed` should be the fixture's stored matchSeed, salted by the caller so
 * the shootout draws a different stream from the match itself - the same
 * pattern the fan-incident roll already uses (`${seed}-fans`).
 */
export function runShootout(home: ShootoutSide, away: ShootoutSide, seed: string): ShootoutResult {
  if (home.takers.length === 0 || away.takers.length === 0) {
    // Fail closed. A shootout with nobody to take a kick is not a 0-0 or a
    // coin toss, it is a broken input, and inventing a champion from it
    // would be the worst possible outcome of this whole feature.
    throw new ShootoutError(
      `Cannot run a shootout without takers on both sides (home=${home.takers.length}, away=${away.takers.length}).`
    )
  }

  const rng = new SeededRandom(seed)
  const kicks: ShootoutKick[] = []
  let homeScore = 0
  let awayScore = 0
  let homeTaken = 0
  let awayTaken = 0

  const take = (side: "home" | "away", round: number): void => {
    const state = side === "home" ? home : away
    const opponent = side === "home" ? away : home
    const index = side === "home" ? homeTaken : awayTaken
    // Cycled, so a sudden death longer than the taker list simply comes back
    // round to the first taker - as it does in reality.
    const taker = state.takers[index % state.takers.length]
    const scored = rng.chance(scoreChance(taker, opponent.keeper))

    kicks.push({ round, side, teamId: state.teamId, playerId: taker.playerId, scored })
    if (side === "home") {
      homeTaken++
      if (scored) homeScore++
    } else {
      awayTaken++
      if (scored) awayScore++
    }
  }

  // --- The initial five each -------------------------------------------
  for (let round = 1; round <= INITIAL_ROUNDS; round++) {
    take("home", round)
    if (isSettledEarly(homeScore, awayScore, homeTaken, awayTaken)) break
    take("away", round)
    if (isSettledEarly(homeScore, awayScore, homeTaken, awayTaken)) break
  }

  // --- Sudden death ------------------------------------------------------
  let suddenDeath = false
  let round = INITIAL_ROUNDS
  while (homeScore === awayScore) {
    suddenDeath = true
    round++
    if (round - INITIAL_ROUNDS > MAX_SUDDEN_DEATH_ROUNDS) {
      throw new ShootoutError(
        `Shootout did not resolve within ${MAX_SUDDEN_DEATH_ROUNDS} sudden-death rounds - refusing to invent a winner.`
      )
    }
    // BOTH kicks are always taken in a sudden-death round, and the round is
    // only decisive if they differ. This is what guarantees termination
    // without ever producing a draw: the loop exits precisely when one side
    // scored and the other did not.
    take("home", round)
    take("away", round)
  }

  const winner: "home" | "away" = homeScore > awayScore ? "home" : "away"
  return {
    homeScore,
    awayScore,
    winner,
    winnerTeamId: winner === "home" ? home.teamId : away.teamId,
    kicks,
    suddenDeath,
  }
}
