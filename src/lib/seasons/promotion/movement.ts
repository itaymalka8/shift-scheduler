/**
 * WHO GOES UP, WHO GOES DOWN, AND WHICH GROUP THEY LAND IN.
 *
 * Pure: no Prisma, no clock, no Math.random. Given each division's FINAL
 * finishing order and the two promotion playoff results, it returns the
 * complete membership of every division of the next season - and it returns
 * the same answer every time, which is what makes the stage that writes it
 * idempotent without a ledger table.
 *
 * THE CONTRACT IT ENCODES (Phase 3Q, approved):
 *   tier 1     positions 17-20 are relegated. Four clubs, no playoff.
 *   tier 2 A   position 1 promotes automatically; 2 plays B3.
 *   tier 2 B   position 1 promotes automatically; 2 plays A3.
 *   both bracket winners promote. Four up, four down.
 *   no relegation out of tier 2 - there is no tier 3 to fall into.
 *
 * VACANCIES ARE DERIVED, NEVER ASSUMED 2 AND 2. If both bracket winners come
 * from group A, then A loses three clubs (A1, A2, A3) and B loses one, so the
 * four relegated clubs must be split 3/1 to put both groups back to twenty.
 * Assuming an even split is the single easiest way to produce a 19-club and a
 * 21-club division, so the split is computed from who actually went up.
 *
 * WHICH RELEGATED CLUB LANDS IN WHICH GROUP is decided by the Official
 * Sporting Draw - deriveDrawSeed over tier 1's own completed league record,
 * folded commutatively so no ordering decision enters it, then a seeded
 * shuffle. It is not a ranking criterion and must not behave like one: club
 * name, teamId order, database order, joinedAt, balance, squad strength and
 * Human/BOT status are all absent, and the entrant list is canonicalised by
 * teamId only so the shuffle has a definite input to destroy.
 */
import { SeededRandom } from "@/lib/match/engine/rng"
import {
  PROMOTION_COUNT,
  RELEGATION_COUNT,
  TIER1_LAST_SAFE_RANK,
  TIER2_AUTO_PROMOTION_RANK,
  TIER2_PLAYOFF_HIGH_RANK,
  TIER2_PLAYOFF_LOW_RANK,
} from "./outcomes"

/** One league division's final state, as movement needs to read it. */
export interface FinalDivision {
  divisionId: string
  tier: number
  group: string
  /** The division's clubs in finishing order, 1st first. Fully separated. */
  order: string[]
}

/** One promotion playoff match, once it has produced a winner. */
export interface PlayoffResult {
  homeTeamId: string
  awayTeamId: string
  winnerTeamId: string
}

/** Where every club plays next season, keyed by (tier, group). */
export interface MovementPlan {
  /** `${tier}|${group}` -> the clubs of that division next season. */
  byDivisionKey: Map<string, string[]>
  promoted: string[]
  relegated: string[]
  /** Vacancies each tier 2 group must fill, derived from who went up. */
  vacanciesByGroup: Map<string, number>
}

export function divisionKey(tier: number, group: string): string {
  return `${tier}|${group}`
}

export class MovementError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MovementError"
  }
}

/** The two bracket pairings the contract fixes: A2 v B3 and B2 v A3. */
export function promotionBracketPairings(
  groupA: FinalDivision,
  groupB: FinalDivision
): { homeGroup: string; homeTeamId: string; awayGroup: string; awayTeamId: string }[] {
  const at = (division: FinalDivision, rank: number) => {
    const teamId = division.order[rank - 1]
    if (!teamId) {
      throw new MovementError(
        `Tier 2 group ${division.group} has no club at position ${rank} (${division.order.length} clubs ranked)`
      )
    }
    return teamId
  }
  return [
    {
      homeGroup: groupA.group,
      homeTeamId: at(groupA, TIER2_PLAYOFF_HIGH_RANK),
      awayGroup: groupB.group,
      awayTeamId: at(groupB, TIER2_PLAYOFF_LOW_RANK),
    },
    {
      homeGroup: groupB.group,
      homeTeamId: at(groupB, TIER2_PLAYOFF_HIGH_RANK),
      awayGroup: groupA.group,
      awayTeamId: at(groupA, TIER2_PLAYOFF_LOW_RANK),
    },
  ]
}

/**
 * The complete next-season membership.
 *
 * Every club of season N appears exactly once in the result, and every
 * division ends at the size it started - both asserted here rather than
 * hoped for, because a movement that silently loses a club is the one bug
 * that cannot be spotted by looking at a table.
 */
export function computeMovement(input: {
  divisions: FinalDivision[]
  playoffResults: PlayoffResult[]
  drawSeed: string
}): MovementPlan {
  const tier1 = input.divisions.find((d) => d.tier === 1)
  const groupA = input.divisions.find((d) => d.tier === 2 && d.group === "A")
  const groupB = input.divisions.find((d) => d.tier === 2 && d.group === "B")
  if (!tier1 || !groupA || !groupB) {
    throw new MovementError("Movement needs exactly tier 1, tier 2 group A and tier 2 group B")
  }

  const sizes = new Map(input.divisions.map((d) => [divisionKey(d.tier, d.group), d.order.length]))

  // --- Who goes down -------------------------------------------------------
  const relegated = tier1.order.slice(TIER1_LAST_SAFE_RANK)
  if (relegated.length !== RELEGATION_COUNT) {
    throw new MovementError(
      `Tier 1 must relegate ${RELEGATION_COUNT} clubs from a ${TIER1_LAST_SAFE_RANK}-safe table, found ${relegated.length}`
    )
  }
  const stayingInTier1 = tier1.order.slice(0, TIER1_LAST_SAFE_RANK)

  // --- Who goes up ---------------------------------------------------------
  const autoA = groupA.order[TIER2_AUTO_PROMOTION_RANK - 1]
  const autoB = groupB.order[TIER2_AUTO_PROMOTION_RANK - 1]
  if (!autoA || !autoB) throw new MovementError("Both tier 2 groups must have a champion to promote")

  const pairings = promotionBracketPairings(groupA, groupB)
  const bracketWinners: string[] = []
  for (const pairing of pairings) {
    const result = input.playoffResults.find(
      (r) =>
        (r.homeTeamId === pairing.homeTeamId && r.awayTeamId === pairing.awayTeamId) ||
        (r.homeTeamId === pairing.awayTeamId && r.awayTeamId === pairing.homeTeamId)
    )
    if (!result) {
      throw new MovementError(
        `No promotion playoff result for the pairing ${pairing.homeTeamId} v ${pairing.awayTeamId}`
      )
    }
    if (result.winnerTeamId !== pairing.homeTeamId && result.winnerTeamId !== pairing.awayTeamId) {
      throw new MovementError(`Promotion playoff winner ${result.winnerTeamId} did not play in its own fixture`)
    }
    bracketWinners.push(result.winnerTeamId)
  }

  const promoted = [autoA, autoB, ...bracketWinners]
  if (new Set(promoted).size !== PROMOTION_COUNT) {
    throw new MovementError(`Promotion must produce ${PROMOTION_COUNT} distinct clubs, got ${new Set(promoted).size}`)
  }

  // --- Vacancies, derived from who actually left each group ----------------
  const promotedSet = new Set(promoted)
  const groupOf = new Map<string, string>()
  for (const teamId of groupA.order) groupOf.set(teamId, "A")
  for (const teamId of groupB.order) groupOf.set(teamId, "B")

  const vacanciesByGroup = new Map<string, number>([
    ["A", 0],
    ["B", 0],
  ])
  for (const teamId of promoted) {
    const group = groupOf.get(teamId)
    if (!group) throw new MovementError(`Promoted club ${teamId} was not a member of either tier 2 group`)
    vacanciesByGroup.set(group, (vacanciesByGroup.get(group) ?? 0) + 1)
  }
  const totalVacancies = (vacanciesByGroup.get("A") ?? 0) + (vacanciesByGroup.get("B") ?? 0)
  if (totalVacancies !== relegated.length) {
    throw new MovementError(
      `Tier 2 has ${totalVacancies} vacancies but ${relegated.length} clubs are coming down - the two must match exactly`
    )
  }

  // --- The draw: which relegated club fills which vacancy ------------------
  const assignment = drawRelegatedIntoGroups(relegated, vacanciesByGroup, input.drawSeed)

  // --- Build the next season's divisions -----------------------------------
  const nextTier1 = [...stayingInTier1, ...promoted]
  const nextA = [...groupA.order.filter((id) => !promotedSet.has(id)), ...(assignment.get("A") ?? [])]
  const nextB = [...groupB.order.filter((id) => !promotedSet.has(id)), ...(assignment.get("B") ?? [])]

  const byDivisionKey = new Map<string, string[]>([
    [divisionKey(1, ""), nextTier1],
    [divisionKey(2, "A"), nextA],
    [divisionKey(2, "B"), nextB],
  ])

  // --- The invariants, asserted rather than assumed ------------------------
  for (const [key, members] of byDivisionKey) {
    const expected = sizes.get(key)
    if (expected === undefined) throw new MovementError(`No season N size known for division ${key}`)
    if (members.length !== expected) {
      throw new MovementError(`Division ${key} would have ${members.length} clubs next season, expected ${expected}`)
    }
    if (new Set(members).size !== members.length) {
      throw new MovementError(`Division ${key} would contain a duplicate club`)
    }
  }

  const before = new Set(input.divisions.flatMap((d) => d.order))
  const after = [...byDivisionKey.values()].flat()
  if (after.length !== before.size) {
    throw new MovementError(`Season N had ${before.size} clubs, the plan places ${after.length}`)
  }
  const afterSet = new Set(after)
  if (afterSet.size !== after.length) throw new MovementError("A club appears in two divisions of the next season")
  for (const teamId of before) {
    if (!afterSet.has(teamId)) throw new MovementError(`Club ${teamId} would disappear from the league`)
  }

  return { byDivisionKey, promoted, relegated, vacanciesByGroup }
}

/**
 * Deal the relegated clubs into the vacancies the promotions left.
 *
 * The list is canonicalised by teamId and then shuffled with SeededRandom over
 * the Official Sporting Draw's seed - the same device the championship
 * knockout draw uses, and defended there for the same reason: the sort makes
 * the input definite, the shuffle destroys any correlation between id order
 * and outcome. Group A is filled first purely because the deal has to start
 * somewhere; which club it takes is the draw's answer, not the order's.
 */
export function drawRelegatedIntoGroups(
  relegated: string[],
  vacanciesByGroup: Map<string, number>,
  drawSeed: string
): Map<string, string[]> {
  const rng = new SeededRandom(`${drawSeed}|relegation-assignment`)
  const pool = [...relegated].sort()
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  const assignment = new Map<string, string[]>()
  let cursor = 0
  for (const group of [...vacanciesByGroup.keys()].sort()) {
    const count = vacanciesByGroup.get(group) ?? 0
    assignment.set(group, pool.slice(cursor, cursor + count))
    cursor += count
  }
  if (cursor !== pool.length) {
    throw new MovementError(`Relegation draw placed ${cursor} of ${pool.length} clubs`)
  }
  return assignment
}
