/**
 * THE OFFICIAL SPORTING DRAW.
 *
 * Pure: no database, no clock, no Math.random. Everything here is a function
 * of a seed and a set of clubs, so a bracket can be recomputed and audited
 * for as long as the season's records exist.
 *
 * WHAT MAY NEVER DECIDE A BRACKET POSITION, and how each is excluded:
 *
 *   teamId ordering          the entrant list IS canonicalised by teamId
 *                            before shuffling - a technical device, stated
 *                            openly rather than hidden - but the shuffle then
 *                            destroys any correlation between id order and
 *                            bracket position. There is a test showing that
 *                            renaming the ids changes the bracket, and one
 *                            showing every club draws a bye equally often.
 *   Team.name                never read; no name reaches this module.
 *   localeCompare            never used.
 *   database insertion order never read; the seed derivation is COMMUTATIVE,
 *                            so the order rows come back in cannot matter.
 *   current owner            never read.
 *   runtime randomness       the only randomness is SeededRandom over a seed
 *                            derived from results that already happened.
 *
 * The draw decides BRACKET POSITION AND BYES ONLY. It never declares a
 * champion - every club still has to win its matches.
 */
import { SeededRandom } from "@/lib/match/engine/rng"

/** Bumped only if the draw's shape changes; a stored draw records the version that produced it. */
export const KNOCKOUT_DRAW_VERSION = 1

/** The minimum a finished league match must expose for the seed derivation. Note: no team identity. */
export interface SeedSourceFixture {
  scheduledAt: Date | null
  homeScore: number | null
  awayScore: number | null
}

/** FNV-1a over a string, as an unsigned 32-bit integer. Same hash family the match RNG uses. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * The seed of the Official Sporting Draw, derived from the division's own
 * completed league record - the record that produced the tie.
 *
 * The fold is a SUM, which is commutative. That is the whole point: because
 * addition does not care what order the fixtures arrive in, NO ORDERING
 * DECISION - technical or sporting - enters the seed at all, and the caller
 * is free to pass the rows in whatever order the database returned them.
 *
 * Team identity is deliberately absent from the digest input, so no club can
 * influence the seed by being who it is; only by what was scored, which has
 * already happened and cannot be revised.
 *
 * Auditable: anyone with read access can recompute this from the same rows
 * and compare it to the stored value.
 */
export function deriveDrawSeed(
  label: { countryCode: string; seasonNumber: number; tier: number; group: string },
  fixtures: SeedSourceFixture[]
): string {
  let acc = 0
  for (const fixture of fixtures) {
    if (!fixture.scheduledAt || fixture.homeScore === null || fixture.awayScore === null) continue
    const digest = fnv1a(`${fixture.scheduledAt.toISOString()}|${fixture.homeScore}|${fixture.awayScore}`)
    // Modular addition: commutative, and unlike XOR it does not cancel when
    // two fixtures happen to produce the same digest.
    acc = (acc + digest) >>> 0
  }
  const groupPart = label.group ? label.group : ""
  return `${label.countryCode}-S${label.seasonNumber}-T${label.tier}${groupPart}-${acc.toString(16).padStart(8, "0")}`
}

/** One knockout round's pairings, in bracket order. A club listed in `byes` sits the round out. */
export interface KnockoutRoundPlan {
  round: number
  pairings: { homeTeamId: string; awayTeamId: string }[]
  byes: string[]
}

/**
 * The realised draw, exactly as it is persisted to
 * ChampionshipPlayoff.knockoutDraw.
 *
 * THIS IS THE SPORTING FACT. The seed is kept so this can be re-verified, but
 * once written it is this structure - not a re-run of the algorithm - that
 * says who played whom. A future change to the RNG, the shuffle, the bye rule
 * or the canonicalisation must never be able to reinterpret a bracket that
 * has already been played.
 */
export interface KnockoutDraw {
  version: number
  /** The clubs that entered, in the canonical order the shuffle was applied to. */
  entrants: string[]
  /** The drawn bracket order. Position 0 plays position 1, 2 plays 3, and so on. */
  order: string[]
  /** Clubs that received a bye in round 1, in bracket order. */
  byes: string[]
  /** Round 1's pairings, already resolved. Later rounds are derived from `order` plus results. */
  firstRound: KnockoutRoundPlan
}

/** The next power of two at or above n. 1 -> 1, 3 -> 4, 5 -> 8. */
export function nextPowerOfTwo(n: number): number {
  let size = 1
  while (size < n) size *= 2
  return size
}

/**
 * A seeded Fisher-Yates shuffle.
 *
 * The input order matters to the OUTPUT (a different input order with the
 * same seed gives a different permutation), which is exactly why the caller
 * must canonicalise first - otherwise two runners could produce different
 * brackets from the same seed. It does NOT matter to fairness: the
 * permutation is uniform, so a club's position in the input tells you nothing
 * about its position in the output.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items]
  const rng = new SeededRandom(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Runs the draw.
 *
 * Byes go to the FIRST positions of the drawn order, so which clubs receive
 * them is decided by the shuffle and by nothing else. With n entrants there
 * are nextPowerOfTwo(n) - n byes, which is what makes every subsequent round
 * a clean power of two.
 */
export function drawKnockout(entrantTeamIds: string[], drawSeed: string): KnockoutDraw {
  if (entrantTeamIds.length < 2) {
    throw new Error(`A knockout needs at least two entrants, got ${entrantTeamIds.length}.`)
  }

  // Canonical order first. Technical only - see the header - and required so
  // that the same seed and the same clubs always produce the same bracket
  // however the entrants were assembled.
  const canonical = [...entrantTeamIds].sort()
  const order = seededShuffle(canonical, `${drawSeed}-knockout`)

  const byeCount = nextPowerOfTwo(order.length) - order.length
  const byes = order.slice(0, byeCount)
  const playing = order.slice(byeCount)

  const pairings: { homeTeamId: string; awayTeamId: string }[] = []
  for (let i = 0; i + 1 < playing.length; i += 2) {
    // Technical home/away within the pairing: the earlier bracket position.
    // Neutral venue, so this is presentation and a database requirement, and
    // carries no sporting meaning whatsoever.
    pairings.push({ homeTeamId: playing[i], awayTeamId: playing[i + 1] })
  }

  return {
    version: KNOCKOUT_DRAW_VERSION,
    entrants: canonical,
    order,
    byes,
    firstRound: { round: 1, pairings, byes },
  }
}

/**
 * The next knockout round, from the PERSISTED draw and the clubs that
 * survived - never from a re-draw.
 *
 * Survivors are given in bracket order by the caller (which reads that order
 * off the stored draw), so pairing them is just walking the list two at a
 * time. There is no second shuffle, and therefore nothing about a later round
 * that could change if the draw algorithm ever did.
 */
export function planKnockoutRound(round: number, survivorsInBracketOrder: string[]): KnockoutRoundPlan {
  if (survivorsInBracketOrder.length < 2) {
    throw new Error(`Round ${round} needs at least two survivors, got ${survivorsInBracketOrder.length}.`)
  }
  const byeCount = nextPowerOfTwo(survivorsInBracketOrder.length) - survivorsInBracketOrder.length
  const byes = survivorsInBracketOrder.slice(0, byeCount)
  const playing = survivorsInBracketOrder.slice(byeCount)
  const pairings: { homeTeamId: string; awayTeamId: string }[] = []
  for (let i = 0; i + 1 < playing.length; i += 2) {
    pairings.push({ homeTeamId: playing[i], awayTeamId: playing[i + 1] })
  }
  return { round, pairings, byes }
}

/**
 * Whether a stored draw still matches what the seed produces.
 *
 * The persisted draw is the sporting fact and always wins; this is how a
 * disagreement is DETECTED so it can be reported, never how it is resolved.
 * The production verifier fails closed on a mismatch rather than trusting
 * either side.
 */
export function drawMatchesSeed(stored: KnockoutDraw, drawSeed: string): boolean {
  if (stored.version !== KNOCKOUT_DRAW_VERSION) return false
  let recomputed: KnockoutDraw
  try {
    recomputed = drawKnockout(stored.entrants, drawSeed)
  } catch {
    return false
  }
  return (
    recomputed.order.join(",") === stored.order.join(",") &&
    recomputed.byes.join(",") === stored.byes.join(",") &&
    recomputed.firstRound.pairings.map((p) => `${p.homeTeamId}v${p.awayTeamId}`).join(",") ===
      stored.firstRound.pairings.map((p) => `${p.homeTeamId}v${p.awayTeamId}`).join(",")
  )
}

/** Narrows the Json column back to a KnockoutDraw, or null if it is not one. */
export function parseKnockoutDraw(value: unknown): KnockoutDraw | null {
  if (!value || typeof value !== "object") return null
  const draw = value as Partial<KnockoutDraw>
  if (typeof draw.version !== "number") return null
  if (!Array.isArray(draw.entrants) || !Array.isArray(draw.order) || !Array.isArray(draw.byes)) return null
  if (!draw.firstRound || !Array.isArray(draw.firstRound.pairings)) return null
  return draw as KnockoutDraw
}
