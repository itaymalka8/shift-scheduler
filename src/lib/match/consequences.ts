/**
 * WHAT A MATCH DOES TO THE PLAYERS WHO PLAYED IT. Pure: no Prisma, no clock,
 * no I/O, no unseeded randomness.
 *
 * Until now the engine computed fatigue, injuries and cards and then threw
 * every one of them away when the simulation returned. This module is the
 * arithmetic that makes them stick. It decides nothing about WHEN they stick
 * - that is the activation step's job, and it matters enormously (see
 * consequence-service.ts) - only by how much.
 */
import { SeededRandom } from "./engine/rng"
import { DEFAULT_GAME_BALANCE_CONFIG } from "./engine/config"

/**
 * Fitness lives on the same 1-100 scale as every other Player number in this
 * game. No new range is invented for it.
 *
 * The floor is 1 rather than 0 because the engine already clamps a player's
 * in-match energy to 0.1 (see engine.ts), so anything below 1 fitness would
 * change nothing about a match and would only look like a broken row.
 */
export const FITNESS_MIN = 1
export const FITNESS_MAX = 100

/**
 * THE COST OF A FULL 90 MINUTES, for a player with no Stamina at all.
 *
 * WHERE THE SHAPE COMES FROM, AND WHERE THE SIZE COMES FROM - they are not
 * the same place, and pretending otherwise would be dishonest.
 *
 * THE SHAPE is the engine's, exactly: its per-possession drain is
 *
 *   personal = drain x (0.7 + workRate x 0.6) x (1 - stamina x staminaEnergyProtection)
 *
 * so cost is linear in how long you were on the pitch and is blunted by
 * Stamina in proportion to staminaEnergyProtection. This module uses that
 * same linearity and imports that same constant from the engine's own config
 * rather than restating it, so the two can never drift apart. There is one
 * fatigue model in this codebase and this is the persisted half of it.
 *
 * THE SIZE is a product decision the engine cannot make, and this is said
 * plainly. The engine's 108 possessions of drain describe tiring WITHIN one
 * match, ending at a floor of 0.15, and are meant to be reset at the next
 * kickoff. Persisting that curve directly would leave an ever-present starter
 * at 15 fitness after one game and there is nothing in the engine that says
 * how fast a footballer recovers over two days. So the magnitude is chosen
 * against the FIXTURE CADENCE this game actually runs - Mon/Wed/Sat, three
 * matches a week - to make one specific trade-off true:
 *
 *   an ever-present with average Stamina (50) pays 20 x 0.775 = 15.5 and is
 *   given back REST_FITNESS_RECOVERY = 12, so they drift DOWN about 3.5 a
 *   match and need resting after a run of games;
 *
 *   an ever-present with elite Stamina (100) pays 20 x 0.55 = 11 against the
 *   same 12 back, so they can genuinely play every week.
 *
 * That is the whole point of the number: Stamina buys availability. Nothing
 * here is tuned for realism beyond making that one trade-off legible.
 */
export const FULL_MATCH_FITNESS_COST = 20

/**
 * What every ACTIVE player of a club gets back when that club's fixture
 * becomes publicly finished - the rest between two matches.
 *
 * Applied to EVERYONE, including the eleven who just played: a footballer
 * does not stop recovering because they played. The starter simply pays a
 * larger cost on top, and the net is what the trade-off above describes.
 */
export const REST_FITNESS_RECOVERY = 12

/** The engine's own Stamina protection, imported rather than restated. */
export const STAMINA_FITNESS_PROTECTION = DEFAULT_GAME_BALANCE_CONFIG.staminaEnergyProtection

export function clampFitness(value: number): number {
  return Math.max(FITNESS_MIN, Math.min(FITNESS_MAX, Math.round(value)))
}

/**
 * The fitness a match costs one player.
 *
 * A ZERO-MINUTE CAMEO COSTS NOTHING, and that is deliberate rather than an
 * accident of the arithmetic: a PlayerMatchStats row with minutesPlayed = 0
 * is somebody who came on in stoppage time and whose minutes rounded down
 * (the engine writes no row at all for a player who never came on), so they
 * were on the pitch for less than a minute of football. Charging them a
 * fraction of a match would be inventing exertion that did not happen.
 *
 * A PLAYER WHO DID NOT APPEAR IS NEVER PASSED TO THIS FUNCTION - the caller
 * only has rows for players who did. Their fitness moves by rest alone.
 */
export function matchFitnessCost(minutesPlayed: number, stamina: number | null | undefined): number {
  const minutes = Math.max(0, Math.min(90, minutesPlayed))
  if (minutes === 0) return 0
  const staminaRatio = Math.max(0, Math.min(100, stamina ?? 50)) / 100
  const protection = 1 - staminaRatio * STAMINA_FITNESS_PROTECTION
  return (FULL_MATCH_FITNESS_COST * (minutes / 90)) * protection
}

/**
 * A player's fitness after one of their club's fixtures.
 *
 * Rest first, then the cost of whatever they actually did in it. Bounded at
 * both ends, so no sequence of matches can drive it negative or above full.
 */
export function nextFitness(current: number, minutesPlayed: number | null, stamina: number | null | undefined): number {
  const rested = current + REST_FITNESS_RECOVERY
  const cost = minutesPlayed === null ? 0 : matchFitnessCost(minutesPlayed, stamina)
  return clampFitness(rested - cost)
}

// --- INJURIES -------------------------------------------------------------

/**
 * How long an injury the ENGINE ALREADY DECIDED HAPPENED keeps a player out,
 * in club fixtures.
 *
 * This module never decides WHETHER somebody got hurt - the engine did that
 * during the match, weighted by fatigue, and recorded it as a MatchEvent.
 * Rolling a second injury here would be a second injury model.
 *
 * Matches rather than days, for the same reason suspensions are counted in
 * matches: a postponed fixture must not heal anybody just because time
 * passed. Deliberately modest, and deliberately shallow - no injury types,
 * no body parts, no medical staff.
 */
export interface InjuryDurationBand {
  matches: number
  weight: number
}

export const INJURY_DURATION_BANDS: InjuryDurationBand[] = [
  { matches: 1, weight: 50 },
  { matches: 2, weight: 30 },
  { matches: 3, weight: 15 },
  { matches: 4, weight: 5 },
]

/**
 * The seed for one player's injury in one fixture.
 *
 * Derived from the fixture's OWN matchSeed - the same seed the simulation
 * ran on - so re-deriving the consequence of a match always produces the
 * same absence. There is no Math.random anywhere in this file.
 */
export function injurySeed(matchSeed: string, playerId: string): string {
  return `${matchSeed}-${playerId}-injury`
}

export function rollInjuryMatches(rng: SeededRandom): number {
  return rng.pickWeighted(INJURY_DURATION_BANDS, (band) => band.weight).matches
}

export function injuryMatchesFor(matchSeed: string, playerId: string): number {
  return rollInjuryMatches(new SeededRandom(injurySeed(matchSeed, playerId)))
}

// --- SUSPENSIONS ----------------------------------------------------------

/**
 * A sending-off costs one match. One, whichever kind it was.
 *
 * PlayerMatchStats CAN tell a straight red from a second yellow - the engine
 * increments yellowCards before it sends a player off, so a second-yellow
 * dismissal leaves yellowCards >= 2 alongside redCards >= 1, and a straight
 * red leaves redCards >= 1 with fewer than two yellows. The distinction is
 * therefore provable from the database and was not invented. V1 simply does
 * not USE it, because both are one match, and a rule with a distinction that
 * changes no outcome is a rule nobody can check.
 */
export const RED_CARD_SUSPENSION_MATCHES = 1

/**
 * Every Nth yellow card in a season costs one match.
 *
 * COUNTED, NEVER STORED. There is no accumulating column: the count is summed
 * from PlayerMatchStats, which is the canonical disciplinary record and is
 * already protected by the historical-retention trigger. A duplicate counter
 * would be a second source of truth about a player's season and would drift
 * the first time a fixture was reprocessed.
 */
export const YELLOW_CARDS_PER_SUSPENSION = 5

/**
 * The ban this fixture creates for one player.
 *
 * `yellowsBefore` is their season total BEFORE this match, `yellowsInMatch`
 * what they picked up in it. A threshold is crossed when the count passes a
 * multiple of YELLOW_CARDS_PER_SUSPENSION - expressed as a difference of
 * quotients, which is what makes it exactly-once without remembering
 * anything: reprocessing the same fixture recomputes the same two quotients.
 *
 * A player who is sent off for a second yellow can serve BOTH - the dismissal
 * and a threshold that same yellow crossed. That is the correct reading of
 * two separate rules, not double punishment for one card.
 */
export function suspensionFromMatch(input: {
  yellowsBefore: number
  yellowsInMatch: number
  redsInMatch: number
}): number {
  const red = input.redsInMatch > 0 ? RED_CARD_SUSPENSION_MATCHES : 0
  const before = Math.floor(input.yellowsBefore / YELLOW_CARDS_PER_SUSPENSION)
  const after = Math.floor((input.yellowsBefore + input.yellowsInMatch) / YELLOW_CARDS_PER_SUSPENSION)
  return red + Math.max(0, after - before)
}
