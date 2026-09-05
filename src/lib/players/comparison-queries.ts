/**
 * THE PLAYER COMPARISON READER.
 *
 * Read-only. No write path exists in this file and none is reachable from the
 * comparison page.
 *
 * IT OWNS NO ATTRIBUTION RULE. Every career figure on the comparison comes
 * back from loadPlayerProfile - the SAME reader the Player Profile uses, with
 * the same anti-spoiler gate, the same PlayerMatchStats.teamId attribution and
 * the same pure career layer behind it. Nothing about history is re-decided
 * here, which is the whole point: two readers would eventually disagree about
 * one person's career, and then one of the two pages would be wrong.
 *
 * WHY loadPlayerProfile TWICE RATHER THAN A BATCHED READER (§19).
 *
 * MEASURED, not assumed. Counted at PostgreSQL with log_statement='all':
 *
 *   one player, with a career      6 statements
 *   both players, 3 and 2 games    9 statements
 *   both players, 200 games each   9 statements
 *   both players, 0 and 1 game     7 statements
 *
 * NINE, AND FLAT. The count does not move between a five-appearance pair and
 * a four-hundred-appearance pair, because every read is either a findUnique or
 * an `IN (...)` over ids already in hand - there is no query per appearance,
 * per club or per stat field anywhere in the path.
 *
 * It is nine rather than eleven because the two profile loads are issued in
 * the SAME tick: Prisma coalesces concurrent findUnique calls on one model
 * into a single `IN` statement, so both players' identity rows - and both
 * their current-club relations - arrive in one statement each. Running them
 * sequentially would cost two more.
 *
 * A dedicated batched reader could shave the remaining pairs (the two
 * PlayerMatchStats reads and their fixture relations) down to about six. To
 * get there it would have to restate the eligibility predicate, the club
 * resolution and the record mapping - exactly the duplication §17 forbids.
 * §19 says not to chase a small constant without measured benefit: the
 * benefit here is three statements on a page nobody loads in a loop, and the
 * cost is a second copy of the rules that decide what a career IS.
 *
 * The one thing the profile does NOT carry is the attribute columns - it has
 * no use for 51 of them, and widening its select to serve this page would make
 * every profile view pay for them. So they are read here, for BOTH players, in
 * ONE statement.
 */
import { prisma } from "@/lib/prisma"
import {
  GOALKEEPING_ATTRIBUTES,
  OUTFIELD_ATTRIBUTES,
  extractPlayerAttributes,
  type AttributeKey,
  type PlayerAttributes,
} from "./attributes"
import { loadPlayerProfile, type PlayerProfile } from "./profile"

/**
 * Every attribute column, selected by name.
 *
 * Derived from the attribute lists rather than retyped, so a new attribute
 * cannot exist in the game and be silently missing from the comparison.
 */
const COMPARABLE_ATTRIBUTES: readonly AttributeKey[] = [...OUTFIELD_ATTRIBUTES, ...GOALKEEPING_ATTRIBUTES]

const ATTRIBUTE_SELECT = Object.fromEntries(COMPARABLE_ATTRIBUTES.map((key) => [key, true])) as Record<AttributeKey, true>

/**
 * One side of the comparison.
 *
 * "notFound" is a first-class, expected state - an id in a shared URL can name
 * a player who has since been deleted, and that is a page that asks for
 * another player, never a 500 and never an empty profile pretending somebody
 * exists (§20).
 */
export type ComparisonSide =
  | { state: "empty" }
  | { state: "notFound"; playerId: string }
  | { state: "loaded"; playerId: string; profile: PlayerProfile; attributes: PlayerAttributes }

export interface ComparisonData {
  a: ComparisonSide
  b: ComparisonSide
  /** The instant BOTH sides were measured from. One clock, one page. */
  measuredAt: Date
}

/**
 * Both sides, measured from one instant.
 *
 * Either id may be null (nothing selected on that side). The caller decides
 * what a repeated id means - this reader is not told, and would otherwise load
 * the same player twice.
 */
export async function loadComparison(
  aId: string | null,
  bId: string | null,
  now: Date = new Date()
): Promise<ComparisonData> {
  const ids = [...new Set([aId, bId].filter((id): id is string => id !== null))]

  if (ids.length === 0) {
    return { a: { state: "empty" }, b: { state: "empty" }, measuredAt: now }
  }

  // THREE READS FOR TWO WHOLE CAREERS, ISSUED TOGETHER. Concurrency is not
  // just for latency here: it is what lets Prisma coalesce the two profiles'
  // findUnique calls into one statement (see above). Never one query per
  // appearance, per club or per stat.
  const [aProfile, bProfile, attributeRows] = await Promise.all([
    aId ? loadPlayerProfile(aId, now) : Promise.resolve(null),
    bId ? loadPlayerProfile(bId, now) : Promise.resolve(null),
    prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, ...ATTRIBUTE_SELECT } }),
  ])

  const attributesById = new Map<string, PlayerAttributes>(
    attributeRows.map((row) => [row.id, extractPlayerAttributes(row)])
  )

  const side = (id: string | null, profile: PlayerProfile | null): ComparisonSide => {
    if (id === null) return { state: "empty" }
    if (profile === null) return { state: "notFound", playerId: id }
    return { state: "loaded", playerId: id, profile, attributes: attributesById.get(id) ?? {} }
  }

  return { a: side(aId, aProfile), b: side(bId, bProfile), measuredAt: now }
}
