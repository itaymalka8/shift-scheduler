import { LOCALES, TRANSLATIONS, type Locale, type TranslationKey } from "@/lib/i18n/translations"
import {
  ABILITY_METRICS,
  ATTRIBUTE_METRIC,
  CAREER_METRIC_GROUPS,
  COMPARE_PATH,
  MAX_PLAYER_ID_LENGTH,
  buildAbilityRows,
  buildComparisonRows,
  clearHref,
  compareAttributes,
  compareHref,
  comparisonCategories,
  favouredSide,
  isPlayerIdShape,
  isSameSelection,
  parseComparisonParams,
  selectHref,
  showsGoalkeeping,
  type CareerMetric,
  type ComparisonParams,
  type MetricMeta,
} from "./comparison"
import { buildPlayerCareer, type DatedCareerMatchRecord } from "./career"
import { MAX_SEARCH_LENGTH } from "./directory"

const DAY = 86_400_000
const START = new Date("2026-01-01T19:00:00.000Z")

function record(n: number, over: Partial<DatedCareerMatchRecord> = {}): DatedCareerMatchRecord {
  return {
    fixtureId: `f${n}`,
    kickoffAt: new Date(START.getTime() + n * DAY),
    teamId: "t-alpha",
    minutesPlayed: 90,
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
    ...over,
  }
}

const EMPTY_CAREER = buildPlayerCareer([])

const metricByKey = (key: string): CareerMetric => {
  for (const group of CAREER_METRIC_GROUPS) {
    const found = group.metrics.find((m) => m.key === key)
    if (found) return found
  }
  throw new Error(`no metric ${key}`)
}

const meta = (direction: MetricMeta["direction"]): MetricMeta => ({
  key: "x",
  labelKey: "playerProfile.goals",
  direction,
  format: "count",
})

describe("the metric direction contract", () => {
  it("never highlights a neutral metric, however far apart the values are", () => {
    expect(favouredSide(meta("neutral"), 0, 1000)).toBeNull()
    expect(favouredSide(meta("neutral"), 1000, 0)).toBeNull()
  })

  it("favours the larger value only where higher is actually better", () => {
    expect(favouredSide(meta("higher"), 9, 4)).toBe("a")
    expect(favouredSide(meta("higher"), 4, 9)).toBe("b")
  })

  it("favours the SMALLER value on a lower-is-better metric", () => {
    expect(favouredSide(meta("lower"), 9, 4)).toBe("b")
    expect(favouredSide(meta("lower"), 4, 9)).toBe("a")
  })

  it("highlights nothing on an exact tie", () => {
    expect(favouredSide(meta("higher"), 7, 7)).toBeNull()
    expect(favouredSide(meta("lower"), 7, 7)).toBeNull()
  })

  it("treats a null as absent, NEVER as a zero", () => {
    // A player who never attempted a shot has no shot accuracy. If null were
    // read as 0 they would lose to anyone who ever hit the target once, which
    // would be a statement about a statistic that does not exist.
    expect(favouredSide(meta("higher"), null, 0)).toBeNull()
    expect(favouredSide(meta("higher"), 0.5, null)).toBeNull()
    expect(favouredSide(meta("lower"), null, 5)).toBeNull()
    expect(favouredSide(meta("higher"), null, null)).toBeNull()
  })

  it("marks MORE cards and MORE fouls as the worse value, not the better one", () => {
    for (const key of ["fouls", "yellowCards", "redCards"]) {
      const metric = metricByKey(key)
      expect(metric.direction).toBe("lower")
      expect(favouredSide(metric, 10, 1)).toBe("b")
    }
  })

  it("marks age as having no better end", () => {
    const age = ABILITY_METRICS.find((m) => m.key === "age")!
    expect(age.direction).toBe("neutral")
    expect(favouredSide(age, 19, 34)).toBeNull()
  })

  it("marks appearances and minutes as sample, not quality", () => {
    for (const key of ["appearances", "minutesPlayed"]) {
      expect(metricByKey(key).direction).toBe("neutral")
    }
  })

  it("marks role- and volume-driven counts as neutral", () => {
    // A keeper behind a great defence makes fewer saves; a defender in a
    // dominant side makes fewer tackles. More is not better.
    for (const key of ["tackles", "interceptions", "aerialDuelsWon", "saves", "shots", "shotsOnTarget", "keyPasses"]) {
      expect(metricByKey(key).direction).toBe("neutral")
    }
  })

  it("marks goals, assists, rating and every derived RATE as higher-is-better", () => {
    for (const key of [
      "goals",
      "assists",
      "averageRating",
      "goalsPerAppearance",
      "assistsPerAppearance",
      "goalsPer90",
      "assistsPer90",
      "shotAccuracy",
      "passAccuracy",
    ]) {
      expect(metricByKey(key).direction).toBe("higher")
    }
  })

  it("declares a direction for every metric, and only from the three allowed", () => {
    const every = [...CAREER_METRIC_GROUPS.flatMap((g) => g.metrics), ...ABILITY_METRICS, ATTRIBUTE_METRIC]
    for (const metric of every) {
      expect(["higher", "lower", "neutral"]).toContain(metric.direction)
    }
  })

  it("gives every neutral career metric a note saying why", () => {
    for (const group of CAREER_METRIC_GROUPS) {
      for (const metric of group.metrics) {
        if (metric.direction === "neutral") expect(metric.neutralNoteKey).toBeDefined()
      }
    }
  })

  it("uses metric keys that are unique across the whole contract", () => {
    const keys = [...CAREER_METRIC_GROUPS.flatMap((g) => g.metrics.map((m) => m.key)), ...ABILITY_METRICS.map((m) => m.key)]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("there is no overall verdict anywhere in the contract", () => {
  it("exposes no weight, no score and no winner", () => {
    const every = [...CAREER_METRIC_GROUPS.flatMap((g) => g.metrics), ...ABILITY_METRICS]
    for (const metric of every) {
      expect(metric).not.toHaveProperty("weight")
      expect(metric).not.toHaveProperty("score")
      expect(metric).not.toHaveProperty("points")
    }
  })

  it("never totals the per-row highlights into anything", () => {
    const strong = buildPlayerCareer([record(1, { goals: 5, assists: 5, rating: 9 })])
    const weak = buildPlayerCareer([record(2, { goals: 0, assists: 0, rating: 4 })])
    const rows = buildComparisonRows(CAREER_METRIC_GROUPS[0].metrics, strong, weak)
    // Rows carry a per-row mark and nothing else - no aggregate is returned.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["a", "b", "favoured", "metric"])
    }
  })
})

describe("career rows read the Phase 3H aggregation and never recompute it", () => {
  it("reads totals and rates straight off the career", () => {
    const career = buildPlayerCareer([
      record(1, { goals: 2, assists: 1, shots: 4, shotsOnTarget: 3, minutesPlayed: 90, rating: 8 }),
      record(2, { goals: 1, assists: 0, shots: 2, shotsOnTarget: 1, minutesPlayed: 45, rating: 6 }),
    ])
    const rows = buildComparisonRows(CAREER_METRIC_GROUPS[0].metrics, career, EMPTY_CAREER)
    const byKey = new Map(rows.map((r) => [r.metric.key, r]))
    expect(byKey.get("goals")!.a).toBe(career.totals.goals)
    expect(byKey.get("assists")!.a).toBe(career.totals.assists)
    expect(byKey.get("appearances")!.a).toBe(2)
    expect(byKey.get("minutesPlayed")!.a).toBe(135)
    // The UNROUNDED mean, exactly as the profile holds it.
    expect(byKey.get("averageRating")!.a).toBe(career.totals.averageRating)
  })

  it("returns the profile's own derived metrics, identically", () => {
    const career = buildPlayerCareer([
      record(1, { goals: 3, assists: 2, shots: 10, shotsOnTarget: 4, passesAttempted: 40, passesCompleted: 30, minutesPlayed: 90 }),
    ])
    const efficiency = CAREER_METRIC_GROUPS.find((g) => g.id === "efficiency")!
    const rows = buildComparisonRows(efficiency.metrics, career, EMPTY_CAREER)
    const byKey = new Map(rows.map((r) => [r.metric.key, r]))
    expect(byKey.get("goalsPer90")!.a).toBe(career.rates.goalsPer90)
    expect(byKey.get("shotAccuracy")!.a).toBe(career.rates.shotAccuracy)
    expect(byKey.get("passAccuracy")!.a).toBe(career.rates.passAccuracy)
  })

  it("leaves every rate NULL for a player with no appearances", () => {
    const efficiency = CAREER_METRIC_GROUPS.find((g) => g.id === "efficiency")!
    const rows = buildComparisonRows(efficiency.metrics, EMPTY_CAREER, EMPTY_CAREER)
    for (const row of rows) {
      expect(row.a).toBeNull()
      expect(row.b).toBeNull()
      expect(row.favoured).toBeNull()
    }
  })

  it("compares a one-appearance career against a hundred-appearance one without hiding either", () => {
    const one = buildPlayerCareer([record(1, { goals: 1, rating: 9 })])
    const many = buildPlayerCareer(Array.from({ length: 100 }, (_, i) => record(i + 2, { goals: 1, rating: 7 })))
    const rows = buildComparisonRows(CAREER_METRIC_GROUPS[0].metrics, one, many)
    const byKey = new Map(rows.map((r) => [r.metric.key, r]))
    expect(byKey.get("appearances")!.a).toBe(1)
    expect(byKey.get("appearances")!.b).toBe(100)
    // The one-game player's 9.00 really is the higher average. It is shown,
    // and the sample sits right above it rather than the average being hidden.
    expect(byKey.get("averageRating")!.favoured).toBe("a")
    expect(byKey.get("appearances")!.favoured).toBeNull()
    expect(one.smallSample).toBe(true)
    expect(many.smallSample).toBe(false)
  })
})

describe("current ability rows", () => {
  const A = { overall: 80, potential: 85, fitness: 90, age: 21 }
  const B = { overall: 74, potential: 95, fitness: 90, age: 33 }

  it("favours the higher overall, potential and fitness, and neither age", () => {
    const rows = buildAbilityRows(ABILITY_METRICS, A, B)
    const byKey = new Map(rows.map((r) => [r.metric.key, r]))
    expect(byKey.get("overall")!.favoured).toBe("a")
    expect(byKey.get("potential")!.favoured).toBe("b")
    expect(byKey.get("fitness")!.favoured).toBeNull() // equal
    expect(byKey.get("age")!.favoured).toBeNull() // neutral by contract
    expect(byKey.get("age")!.a).toBe(21)
    expect(byKey.get("age")!.b).toBe(33)
  })
})

describe("attributes across positions", () => {
  const OUTFIELD = { shooting: 70, passing: 60, goalkeeping: null }
  const KEEPER = { shooting: null, passing: 55, goalkeeping: 80, reflexes: 78 }

  it("uses the keeper categories for two keepers and the outfield ones for two outfielders", () => {
    expect(comparisonCategories("GK", "GK").some((c) => c.id === "goalkeeping")).toBe(true)
    expect(comparisonCategories("ST", "CB").some((c) => c.id === "goalkeeping")).toBe(false)
  })

  it("shows BOTH halves for a mixed pair rather than hiding either player's attributes", () => {
    const categories = comparisonCategories("GK", "ST")
    expect(categories.some((c) => c.id === "goalkeeping")).toBe(true)
    expect(categories.some((c) => c.id === "attacking")).toBe(true)
    expect(categories.some((c) => c.id === "physical")).toBe(true)
  })

  it("keeps a row where only ONE player has the attribute, with a null on the other side", () => {
    const rows = compareAttributes("ST", "GK", OUTFIELD, KEEPER).flatMap((c) => c.rows)
    const shooting = rows.find((r) => r.key === "shooting")!
    expect(shooting.a).toBe(70)
    expect(shooting.b).toBeNull()
    // Not a zero, and therefore not a comparison either.
    expect(shooting.favoured).toBeNull()
  })

  it("drops a row only when NEITHER player has the attribute", () => {
    const rows = compareAttributes("ST", "CB", { shooting: 70 }, { shooting: 40 }).flatMap((c) => c.rows)
    expect(rows.some((r) => r.key === "shooting")).toBe(true)
    expect(rows.some((r) => r.key === "finishing")).toBe(false)
  })

  it("favours the higher attribute - the one canonical 0-100 scale in the schema", () => {
    const rows = compareAttributes("ST", "CB", { shooting: 70 }, { shooting: 40 }).flatMap((r) => r.rows)
    expect(rows.find((r) => r.key === "shooting")!.favoured).toBe("a")
    expect(ATTRIBUTE_METRIC.direction).toBe("higher")
  })
})

describe("the goalkeeping section appears only where it says something", () => {
  it("appears when either player is a keeper", () => {
    expect(showsGoalkeeping("GK", "ST", 0, 0)).toBe(true)
    expect(showsGoalkeeping("ST", "GK", 0, 0)).toBe(true)
  })

  it("appears when an outfield player has actually made a save", () => {
    expect(showsGoalkeeping("CB", "ST", 1, 0)).toBe(true)
  })

  it("stays away when neither is a keeper and neither ever saved", () => {
    expect(showsGoalkeeping("CB", "ST", 0, 0)).toBe(false)
  })
})

describe("the request contract", () => {
  it("accepts the id shapes this schema produces", () => {
    expect(isPlayerIdShape("cme3k1x2y0000abcd1234efgh")).toBe(true)
    expect(isPlayerIdShape("0f9c2b1e-4b6a-4f1e-8f3a-2b7c9d1e0a5f")).toBe(true)
  })

  it("refuses an empty, over-long or metacharacter-bearing id", () => {
    expect(isPlayerIdShape("")).toBe(false)
    expect(isPlayerIdShape("a".repeat(MAX_PLAYER_ID_LENGTH + 1))).toBe(false)
    expect(isPlayerIdShape("abc%def")).toBe(false)
    expect(isPlayerIdShape("abc def")).toBe(false)
    expect(isPlayerIdShape("' OR 1=1 --")).toBe(false)
  })

  it("drops a malformed id to null rather than throwing", () => {
    const params = parseComparisonParams({ a: "' OR 1=1 --", b: "  " })
    expect(params.a).toBeNull()
    expect(params.b).toBeNull()
  })

  it("reads a repeated query parameter as its first value", () => {
    expect(parseComparisonParams({ a: ["p1", "p2"] }).a).toBe("p1")
  })

  it("trims and caps the search text at the directory's own limit", () => {
    const params = parseComparisonParams({ qa: `  ${"x".repeat(MAX_SEARCH_LENGTH + 20)}  ` })
    expect(params.qa.length).toBe(MAX_SEARCH_LENGTH)
  })

  it("returns an all-empty request for an empty query string", () => {
    expect(parseComparisonParams({})).toEqual({ a: null, b: null, qa: "", qb: "" })
  })

  it("recognises the same player on both sides", () => {
    expect(isSameSelection({ a: "p1", b: "p1" })).toBe(true)
    expect(isSameSelection({ a: "p1", b: "p2" })).toBe(false)
    // Two empty sides are not "the same player".
    expect(isSameSelection({ a: null, b: null })).toBe(false)
  })

  it("builds a bare path when nothing is selected", () => {
    expect(compareHref({})).toBe(COMPARE_PATH)
  })

  it("keeps the other side when one side is chosen", () => {
    const params: ComparisonParams = { a: "p1", b: null, qa: "", qb: "co" }
    expect(selectHref(params, "b", "p2")).toBe(`${COMPARE_PATH}?a=p1&b=p2`)
    expect(selectHref({ ...params, a: null }, "a", "p9")).toBe(`${COMPARE_PATH}?a=p9`)
  })

  it("keeps the other side when one side is cleared", () => {
    const params: ComparisonParams = { a: "p1", b: "p2", qa: "", qb: "" }
    expect(clearHref(params, "a")).toBe(`${COMPARE_PATH}?b=p2`)
    expect(clearHref(params, "b")).toBe(`${COMPARE_PATH}?a=p1`)
  })

  it("drops the search text once a player is chosen, so a stale term is never carried", () => {
    const params: ComparisonParams = { a: null, b: null, qa: "cohen", qb: "levi" }
    expect(selectHref(params, "a", "p1")).toBe(`${COMPARE_PATH}?a=p1`)
  })
})

describe("every label the comparison names exists in every locale", () => {
  const keys: TranslationKey[] = [
    ...CAREER_METRIC_GROUPS.flatMap((g) => [
      g.labelKey,
      ...g.metrics.map((m) => m.labelKey),
      ...g.metrics.map((m) => m.neutralNoteKey).filter((k): k is TranslationKey => k !== undefined),
    ]),
    ...ABILITY_METRICS.flatMap((m) => [m.labelKey, ...(m.neutralNoteKey ? [m.neutralNoteKey] : [])]),
  ]

  it.each(LOCALES)("%s has every metric label", (locale: Locale) => {
    // Read the locale's OWN dictionary. getTranslator falls back to Hebrew,
    // so a key missing only from English would render Hebrew and pass a
    // translator-based check while being broken on the page.
    const dictionary = TRANSLATIONS[locale]
    for (const key of keys) {
      expect({ locale, key, value: dictionary[key] }).not.toEqual({ locale, key, value: undefined })
    }
  })

  it.each(LOCALES)("%s has every page string the comparison renders", (locale: Locale) => {
    const dictionary = TRANSLATIONS[locale]
    const pageKeys: TranslationKey[] = [
      "compare.title",
      "compare.subtitle",
      "compare.action",
      "compare.compareThisPlayer",
      "compare.slotA",
      "compare.slotB",
      "compare.choosePlayer",
      "compare.searchPlaceholder",
      "compare.searchAction",
      "compare.searchHint",
      "compare.noResults",
      "compare.change",
      "compare.notFound",
      "compare.notFoundHint",
      "compare.samePlayer",
      "compare.samePlayerHint",
      "compare.needTwo",
      "compare.needOneMore",
      "compare.currentState",
      "compare.attributes",
      "compare.legendTitle",
      "compare.legendFavoured",
      "compare.legendNeutral",
      "compare.legendNoWinner",
      "compare.crossPositionNote",
      "compare.sampleNote",
    ]
    for (const key of pageKeys) {
      expect({ locale, key, value: dictionary[key] }).not.toEqual({ locale, key, value: undefined })
    }
  })
})
