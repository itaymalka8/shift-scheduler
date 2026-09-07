/**
 * PLAYER COMPARISON - the shaping and the metric contract. Pure: no Prisma,
 * no clock, no I/O.
 *
 * THIS MODULE OWNS NO FACTS. Every career number it arranges was already
 * computed by the Phase 3H career layer (computeCareerTotals /
 * computeCareerRates), and every current-ability number was already on the
 * Player row. Nothing here re-derives, re-weights or re-averages anything: a
 * second formula for "goals per 90" would eventually disagree with the
 * profile's, and then one of the two pages would be lying.
 *
 * THERE IS NO WINNER. No score is computed, no weights exist, and no row is
 * summed into an overall verdict. The most this module will say about a pair
 * of numbers is which one the METRIC ITSELF favours - and for most metrics
 * the honest answer is "neither", which is exactly what it returns.
 */
import type { TranslationKey } from "@/lib/i18n/translations"
import { ATTRIBUTE_CATEGORIES, GOALKEEPER_ATTRIBUTE_CATEGORIES, type AttributeKey, type PlayerAttributes } from "./attributes"
import type { PlayerCareer } from "./career"
import { MAX_SEARCH_LENGTH } from "./directory"

/**
 * THE METRIC DIRECTION CONTRACT.
 *
 * Every comparable number on this page declares, explicitly and by hand,
 * whether one end of it is actually better. Nothing is inferred from the
 * value's type, its name, or the fact that it is a number - the default is
 * "neutral", and a metric becomes directional only when somebody wrote down
 * why.
 *
 *   higher   a larger value is better for the player, in any position, all
 *            else equal.
 *   lower    a smaller value is better, on the same terms.
 *   neutral  neither end is better. The two values are still shown, side by
 *            side, with NO highlight of any kind.
 *
 * THE TEST FOR "higher" IS DELIBERATELY STRICT. A counting stat is driven by
 * minutes, by role and by how the player's team plays, so "more" usually
 * means "more of that situation", not "better at football":
 *
 *   - A centre-back in a dominant side makes FEWER tackles than one in a
 *     side that defends all afternoon. The second is not the better defender.
 *   - A goalkeeper behind a great defence makes FEWER saves. Same problem.
 *   - A striker's two tackles against a centre-back's sixty is a fact about
 *     position, not about quality.
 *
 * Goals, assists and the match rating survive that test: a goal is the thing
 * the match is decided by, it is good whoever scores it, and the rating is
 * the engine's own verdict on the performance. The derived RATES survive it
 * too, because each one already divides by the volume that causes the
 * confound - accuracy is a quality, attempts are a circumstance.
 *
 * Fouls and cards are the only metrics where less is better, and they are the
 * reason this contract exists: a comparison that painted every larger number
 * green would tell the reader that the dirtier player is the better one.
 */
export type MetricDirection = "higher" | "lower" | "neutral"

/** How the page should render the number. The pure layer never formats. */
export type MetricFormat = "count" | "rating" | "rate" | "percent" | "score"

export interface MetricMeta {
  /** Stable identity for this metric. Used by tests and by React keys, never shown. */
  key: string
  labelKey: TranslationKey
  direction: MetricDirection
  format: MetricFormat
  /** Set where the label alone would not explain a "neutral" verdict. */
  neutralNoteKey?: TranslationKey
}

export type ComparisonSlot = "a" | "b"
export const COMPARISON_SLOTS: readonly ComparisonSlot[] = ["a", "b"] as const

/**
 * Which side this metric favours, or null.
 *
 * NULL IS THE COMMON ANSWER, and it means "no highlight": a neutral metric,
 * an exact tie, or a value that one of the two players does not have. A null
 * is NOT treated as a zero - a player who never attempted a shot has no shot
 * accuracy, and calling that 0% would lose to anybody who ever hit the target
 * once. See §27: null and zero are different facts.
 */
export function favouredSide(meta: MetricMeta, a: number | null, b: number | null): ComparisonSlot | null {
  if (meta.direction === "neutral") return null
  if (a === null || b === null) return null
  if (a === b) return null
  const aFavoured = meta.direction === "higher" ? a > b : a < b
  return aFavoured ? "a" : "b"
}

export interface ComparisonRow {
  metric: MetricMeta
  a: number | null
  b: number | null
  /** Presentation only. Never a ranking, never summed with any other row. */
  favoured: ComparisonSlot | null
}

// --- CURRENT ABILITY ------------------------------------------------------

/**
 * The comparable part of current ability. Everything here is on the Player
 * row RIGHT NOW; none of it is history and none of it explains a past rating.
 */
export interface CurrentAbilityValues {
  overall: number
  potential: number
  fitness: number
  age: number
}

export interface AbilityMetric extends MetricMeta {
  read: (values: CurrentAbilityValues) => number
}

export const ABILITY_METRICS: AbilityMetric[] = [
  // Overall and potential are the game's OWN ability scale, computed per
  // position with position weights (calculatePlayerOverall) - so they are the
  // one place where a cross-position number is meant to be comparable.
  { key: "overall", labelKey: "playerProfile.overall", direction: "higher", format: "score", read: (v) => v.overall },
  { key: "potential", labelKey: "playerProfile.potential", direction: "higher", format: "score", read: (v) => v.potential },
  { key: "fitness", labelKey: "playerProfile.fitness", direction: "higher", format: "score", read: (v) => v.fitness },
  // AGE HAS NO BETTER END. A 33-year-old is not worse than a 19-year-old, and
  // the 19-year-old is not worse than the 33-year-old; which one you want
  // depends entirely on what you are building.
  { key: "age", labelKey: "playerProfile.age", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralAge", read: (v) => v.age },
]

// --- CAREER ---------------------------------------------------------------

export interface CareerMetric extends MetricMeta {
  read: (career: PlayerCareer) => number | null
}

export interface CareerMetricGroup {
  id: string
  labelKey: TranslationKey
  metrics: CareerMetric[]
  /**
   * True when the group only makes sense for a goalkeeper. The page still
   * shows the real value for an outfield player when a keeper is on the other
   * side (§12); this only keeps an all-irrelevant section off a page where
   * neither player is a keeper and neither ever made a save.
   */
  goalkeeping?: boolean
}

export const CAREER_METRIC_GROUPS: CareerMetricGroup[] = [
  {
    id: "summary",
    labelKey: "playerProfile.careerSummary",
    metrics: [
      // NEUTRAL: appearances and minutes measure how much football somebody
      // has played, which is sample size and opportunity, not quality. They
      // are shown first precisely because every average below depends on them.
      {
        key: "appearances",
        labelKey: "playerProfile.appearances",
        direction: "neutral",
        format: "count",
        neutralNoteKey: "compare.neutralSample",
        read: (c) => c.totals.appearances,
      },
      {
        key: "minutesPlayed",
        labelKey: "playerProfile.minutes",
        direction: "neutral",
        format: "count",
        neutralNoteKey: "compare.neutralSample",
        read: (c) => c.totals.minutesPlayed,
      },
      { key: "goals", labelKey: "playerProfile.goals", direction: "higher", format: "count", read: (c) => c.totals.goals },
      { key: "assists", labelKey: "playerProfile.assists", direction: "higher", format: "count", read: (c) => c.totals.assists },
      // Null with no appearances - a dash, never a 0.00 that would read as
      // the worst career ever recorded.
      { key: "averageRating", labelKey: "playerProfile.averageRating", direction: "higher", format: "rating", read: (c) => c.totals.averageRating },
    ],
  },
  {
    id: "efficiency",
    labelKey: "compare.careerEfficiency",
    metrics: [
      // EVERY RATE HERE IS THE PROFILE'S OWN, read straight off
      // computeCareerRates. No formula is restated in this file.
      { key: "goalsPerAppearance", labelKey: "playerProfile.goalsPerApp", direction: "higher", format: "rate", read: (c) => c.rates.goalsPerAppearance },
      { key: "assistsPerAppearance", labelKey: "playerProfile.assistsPerApp", direction: "higher", format: "rate", read: (c) => c.rates.assistsPerAppearance },
      { key: "goalsPer90", labelKey: "playerProfile.goalsPer90", direction: "higher", format: "rate", read: (c) => c.rates.goalsPer90 },
      { key: "assistsPer90", labelKey: "playerProfile.assistsPer90", direction: "higher", format: "rate", read: (c) => c.rates.assistsPer90 },
      { key: "shotAccuracy", labelKey: "playerProfile.shotAccuracy", direction: "higher", format: "percent", read: (c) => c.rates.shotAccuracy },
      { key: "passAccuracy", labelKey: "playerProfile.passAccuracy", direction: "higher", format: "percent", read: (c) => c.rates.passAccuracy },
    ],
  },
  {
    id: "attacking",
    labelKey: "compare.attackingContribution",
    metrics: [
      // ATTEMPTS ARE NEUTRAL. Taking more shots is a licence, not an
      // achievement - the accuracy row above is where quality lives.
      { key: "shots", labelKey: "playerProfile.shots", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralVolume", read: (c) => c.totals.shots },
      { key: "shotsOnTarget", labelKey: "playerProfile.shotsOnTarget", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralVolume", read: (c) => c.totals.shotsOnTarget },
    ],
  },
  {
    id: "technical",
    labelKey: "compare.technicalContribution",
    metrics: [
      { key: "keyPasses", labelKey: "playerProfile.keyPasses", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralVolume", read: (c) => c.totals.keyPasses },
      { key: "passesCompleted", labelKey: "compare.passesCompleted", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralVolume", read: (c) => c.totals.passesCompleted },
      { key: "passesAttempted", labelKey: "compare.passesAttempted", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralVolume", read: (c) => c.totals.passesAttempted },
      { key: "dribblesCompleted", labelKey: "playerProfile.dribbles", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralVolume", read: (c) => c.totals.dribblesCompleted },
      { key: "dribblesAttempted", labelKey: "compare.dribblesAttempted", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralVolume", read: (c) => c.totals.dribblesAttempted },
    ],
  },
  {
    id: "defensive",
    labelKey: "compare.defensiveContribution",
    metrics: [
      // All neutral, and this is the clearest case in the contract: these
      // counts rise when your team defends more, and they rise with the
      // position you were picked in.
      { key: "tackles", labelKey: "playerProfile.tackles", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralRole", read: (c) => c.totals.tackles },
      { key: "interceptions", labelKey: "playerProfile.interceptions", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralRole", read: (c) => c.totals.interceptions },
      { key: "aerialDuelsWon", labelKey: "playerProfile.aerials", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralRole", read: (c) => c.totals.aerialDuelsWon },
    ],
  },
  {
    id: "discipline",
    labelKey: "compare.discipline",
    metrics: [
      // THE ONLY "lower" METRICS IN THE APPLICATION. A comparison that
      // highlighted the larger number here would be telling the reader that
      // the player with more red cards is the better one.
      { key: "fouls", labelKey: "playerProfile.fouls", direction: "lower", format: "count", read: (c) => c.totals.fouls },
      { key: "yellowCards", labelKey: "playerProfile.yellowCards", direction: "lower", format: "count", read: (c) => c.totals.yellowCards },
      { key: "redCards", labelKey: "playerProfile.redCards", direction: "lower", format: "count", read: (c) => c.totals.redCards },
    ],
  },
  {
    id: "goalkeeping",
    labelKey: "compare.goalkeeperContribution",
    goalkeeping: true,
    metrics: [
      // Neutral for the reason above: a keeper behind a great defence makes
      // fewer saves and is not the worse keeper for it.
      { key: "saves", labelKey: "playerProfile.saves", direction: "neutral", format: "count", neutralNoteKey: "compare.neutralRole", read: (c) => c.totals.saves },
    ],
  },
]

export function buildComparisonRows(metrics: readonly CareerMetric[], a: PlayerCareer, b: PlayerCareer): ComparisonRow[] {
  return metrics.map((metric) => {
    const av = metric.read(a)
    const bv = metric.read(b)
    return { metric, a: av, b: bv, favoured: favouredSide(metric, av, bv) }
  })
}

export function buildAbilityRows(metrics: readonly AbilityMetric[], a: CurrentAbilityValues, b: CurrentAbilityValues): ComparisonRow[] {
  return metrics.map((metric) => {
    const av = metric.read(a)
    const bv = metric.read(b)
    return { metric, a: av, b: bv, favoured: favouredSide(metric, av, bv) }
  })
}

/**
 * Whether a goalkeeping section is worth rendering at all.
 *
 * This is NOT positional normalisation and it hides no real value: when
 * either player is a keeper, or either has ever made a save, the section
 * renders with BOTH real numbers in it - including a striker's honest 0. It
 * only keeps a section of two zeroes off a page comparing two strikers.
 */
export function showsGoalkeeping(aPosition: string, bPosition: string, aSaves: number, bSaves: number): boolean {
  return aPosition === "GK" || bPosition === "GK" || aSaves > 0 || bSaves > 0
}

// --- ATTRIBUTES -----------------------------------------------------------

export interface AttributeComparisonRow {
  key: AttributeKey
  a: number | null
  b: number | null
  favoured: ComparisonSlot | null
}

export interface AttributeComparisonCategory {
  id: string
  labelKey: TranslationKey
  rows: AttributeComparisonRow[]
}

/**
 * Player attributes are the one genuinely 0-100 scale in the schema, and
 * higher is better on every one of them by construction - they are the inputs
 * calculatePlayerOverall weighs, not outcomes shaped by a team's shape.
 */
export const ATTRIBUTE_METRIC: MetricMeta = {
  key: "attribute",
  labelKey: "playerProfile.currentAbility",
  direction: "higher",
  format: "score",
}

const GOALKEEPING_CATEGORY = GOALKEEPER_ATTRIBUTE_CATEGORIES.find((c) => c.id === "goalkeeping")!

/**
 * Which attribute categories a PAIR of players needs.
 *
 * Two keepers get the keeper categories; two outfielders get the outfield
 * ones. A MIXED PAIR gets the union - the goalkeeping block plus every
 * outfield block - because hiding either half would hide a real attribute of
 * a real player, and §12 says cross-position comparison is not to be hidden.
 * The outfield list already contains the five general attributes a keeper
 * carries (passing, technique, composure, concentration, leadership), so the
 * union needs no de-duplication.
 */
export function comparisonCategories(aPosition: string, bPosition: string) {
  const aIsKeeper = aPosition === "GK"
  const bIsKeeper = bPosition === "GK"
  if (aIsKeeper && bIsKeeper) return GOALKEEPER_ATTRIBUTE_CATEGORIES
  if (!aIsKeeper && !bIsKeeper) return ATTRIBUTE_CATEGORIES
  return [GOALKEEPING_CATEGORY, ...ATTRIBUTE_CATEGORIES]
}

/**
 * The attribute table.
 *
 * A ROW IS OMITTED ONLY WHEN NEITHER PLAYER HAS THE ATTRIBUTE - two dashes
 * carry no information. When ONE of them has it the row stays, showing the
 * real number on one side and a dash on the other: a keeper genuinely has no
 * finishing attribute, and printing 0 for that would be inventing a fact.
 */
export function compareAttributes(
  aPosition: string,
  bPosition: string,
  aAttributes: PlayerAttributes,
  bAttributes: PlayerAttributes
): AttributeComparisonCategory[] {
  const categories: AttributeComparisonCategory[] = []
  for (const category of comparisonCategories(aPosition, bPosition)) {
    const rows: AttributeComparisonRow[] = []
    for (const key of category.keys) {
      const attributeKey = key as AttributeKey
      const av = aAttributes[attributeKey] ?? null
      const bv = bAttributes[attributeKey] ?? null
      if (av === null && bv === null) continue
      rows.push({ key: attributeKey, a: av, b: bv, favoured: favouredSide(ATTRIBUTE_METRIC, av, bv) })
    }
    if (rows.length > 0) categories.push({ id: category.id, labelKey: category.labelKey as TranslationKey, rows })
  }
  return categories
}

// --- REQUEST CONTRACT -----------------------------------------------------

export const COMPARE_PATH = "/players/compare"

/** Bounded so no unbounded string reaches the database. A cuid is 25 chars. */
export const MAX_PLAYER_ID_LENGTH = 64

/**
 * The shape an id may have.
 *
 * A SUPERSET of every id this schema produces - cuid, cuid2 and uuid all fit
 * inside [A-Za-z0-9_-] - so no legitimate player id is ever rejected. It is a
 * bound on what reaches Prisma, not a validation of existence: an id that
 * passes this and names nobody is a normal, safe, empty result (§20), which
 * the page reports as "not found" rather than as an error.
 */
export function isPlayerIdShape(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PLAYER_ID_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
}

export interface ComparisonParams {
  /** The id asked for on the left, or null. Never a name, never an index. */
  a: string | null
  b: string | null
  /** The search text typed into each side's selector. Empty means no search. */
  qa: string
  qb: string
}

export const EMPTY_COMPARISON_PARAMS: ComparisonParams = { a: null, b: null, qa: "", qb: "" }

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function readId(value: string | string[] | undefined): string | null {
  const raw = first(value)
  if (raw === null) return null
  const trimmed = raw.trim()
  return isPlayerIdShape(trimmed) ? trimmed : null
}

function readSearch(value: string | string[] | undefined): string {
  return (first(value) ?? "").trim().slice(0, MAX_SEARCH_LENGTH)
}

/**
 * Reads a request into a valid ComparisonParams.
 *
 * FAILS SAFE, LIKE THE DIRECTORY. A page route cannot answer 400, so a
 * malformed id is dropped to null and the page asks for a player instead of
 * throwing. The parsed result always describes a renderable page.
 */
export function parseComparisonParams(searchParams: Record<string, string | string[] | undefined>): ComparisonParams {
  return {
    a: readId(searchParams.a),
    b: readId(searchParams.b),
    qa: readSearch(searchParams.qa),
    qb: readSearch(searchParams.qb),
  }
}

/** True when both sides name the same player - which is not a comparison. */
export function isSameSelection(params: Pick<ComparisonParams, "a" | "b">): boolean {
  return params.a !== null && params.a === params.b
}

/** Only non-empty state is emitted, so the bare page is exactly /players/compare. */
export function compareHref(params: Partial<ComparisonParams>): string {
  const search = new URLSearchParams()
  if (params.a) search.set("a", params.a)
  if (params.b) search.set("b", params.b)
  if (params.qa) search.set("qa", params.qa)
  if (params.qb) search.set("qb", params.qb)
  const query = search.toString()
  return query ? `${COMPARE_PATH}?${query}` : COMPARE_PATH
}

/** The href that puts `playerId` into `slot`, keeping the other side and dropping both searches. */
export function selectHref(params: ComparisonParams, slot: ComparisonSlot, playerId: string): string {
  return compareHref(slot === "a" ? { a: playerId, b: params.b } : { a: params.a, b: playerId })
}

/** The href that empties `slot`, keeping the other side. */
export function clearHref(params: ComparisonParams, slot: ComparisonSlot): string {
  return compareHref(slot === "a" ? { b: params.b } : { a: params.a })
}
