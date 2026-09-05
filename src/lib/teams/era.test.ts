import {
  computeManagerRecord,
  countsTowardRecord,
  fixtureBelongsToEra,
  instantBelongsToEra,
  type EraWindow,
  type FixtureResult,
} from "./era"
import { MATCH_REAL_DURATION_MINUTES } from "../match/timing"

const TEAM = "team-1"
const OPPONENT = "team-2"
const TAKEOVER = new Date("2026-09-05T12:00:00.000Z")
const minutes = (base: Date, n: number) => new Date(base.getTime() + n * 60_000)
const days = (base: Date, n: number) => new Date(base.getTime() + n * 24 * 60 * 60_000)

const BOT_ERA: EraWindow = { teamId: TEAM, startedAt: new Date("2026-08-01T00:00:00.000Z"), endedAt: TAKEOVER }
const HUMAN_ERA: EraWindow = { teamId: TEAM, startedAt: TAKEOVER, endedAt: null }

/** A fixture that has fully played out by `now` unless stated otherwise. */
function playedFixture(kickoff: Date, homeScore: number, awayScore: number, opts: { home?: boolean } = {}): FixtureResult {
  const home = opts.home ?? true
  return {
    homeTeamId: home ? TEAM : OPPONENT,
    awayTeamId: home ? OPPONENT : TEAM,
    scheduledAt: kickoff,
    playedAt: kickoff,
    homeScore,
    awayScore,
  }
}

/** "Now", far enough past a kickoff that its live window has closed. */
const after = (kickoff: Date) => minutes(kickoff, MATCH_REAL_DURATION_MINUTES + 1)

describe("era boundary - the half-open [startedAt, endedAt) window", () => {
  it("a match kicking off at the exact takeover instant belongs to the NEW era", () => {
    const fixture = playedFixture(TAKEOVER, 1, 0)
    expect(fixtureBelongsToEra(fixture, HUMAN_ERA)).toBe(true)
    expect(fixtureBelongsToEra(fixture, BOT_ERA)).toBe(false)
  })

  it("a match kicking off at endedAt does NOT belong to the era that ended there", () => {
    // Same instant, stated from the old era's side: endedAt is exclusive.
    expect(instantBelongsToEra(TAKEOVER, BOT_ERA)).toBe(false)
    expect(instantBelongsToEra(minutes(TAKEOVER, -1), BOT_ERA)).toBe(true)
  })

  it("every match falls in exactly one era - never both, never neither", () => {
    const kickoffs = [days(TAKEOVER, -30), minutes(TAKEOVER, -1), TAKEOVER, minutes(TAKEOVER, 1), days(TAKEOVER, 30)]
    for (const kickoff of kickoffs) {
      const fixture = playedFixture(kickoff, 0, 0)
      const matches = [BOT_ERA, HUMAN_ERA].filter((era) => fixtureBelongsToEra(fixture, era))
      expect(matches).toHaveLength(1)
    }
  })

  it("attributes by scheduledAt, never by playedAt", () => {
    // Kickoff sits in the bot era; the engine only got round to it after the
    // takeover. The match was managed by the bot, so it stays with the bot.
    const fixture: FixtureResult = {
      ...playedFixture(minutes(TAKEOVER, -60), 2, 0),
      playedAt: minutes(TAKEOVER, 120),
    }
    expect(fixtureBelongsToEra(fixture, BOT_ERA)).toBe(true)
    expect(fixtureBelongsToEra(fixture, HUMAN_ERA)).toBe(false)
  })

  it("a match this club did not play in never belongs to its era, whatever the timing", () => {
    const other: FixtureResult = {
      homeTeamId: "team-3",
      awayTeamId: OPPONENT,
      scheduledAt: minutes(TAKEOVER, 10),
      playedAt: minutes(TAKEOVER, 10),
      homeScore: 1,
      awayScore: 1,
    }
    expect(fixtureBelongsToEra(other, HUMAN_ERA)).toBe(false)
  })

  it("an unscheduled fixture belongs to no era rather than being guessed into one", () => {
    const unscheduled: FixtureResult = { ...playedFixture(TAKEOVER, 0, 0), scheduledAt: null }
    expect(fixtureBelongsToEra(unscheduled, HUMAN_ERA)).toBe(false)
    expect(fixtureBelongsToEra(unscheduled, BOT_ERA)).toBe(false)
  })
})

describe("countsTowardRecord - what may enter a managerial record", () => {
  it("a finished, simulated match counts", () => {
    const kickoff = minutes(TAKEOVER, 10)
    expect(countsTowardRecord(playedFixture(kickoff, 2, 1), after(kickoff))).toBe(true)
  })

  it("a live match does NOT count, even though its final score is already stored", () => {
    // The engine writes the whole result at kickoff. This is the exact
    // shape that would leak a result into a record mid-match.
    const kickoff = minutes(TAKEOVER, 10)
    expect(countsTowardRecord(playedFixture(kickoff, 3, 0), minutes(kickoff, 1))).toBe(false)
    expect(countsTowardRecord(playedFixture(kickoff, 3, 0), minutes(kickoff, MATCH_REAL_DURATION_MINUTES - 1))).toBe(false)
  })

  it("a past fixture the scheduler never simulated does not count", () => {
    const kickoff = minutes(TAKEOVER, 10)
    const never: FixtureResult = { ...playedFixture(kickoff, 0, 0), playedAt: null, homeScore: null, awayScore: null }
    expect(countsTowardRecord(never, after(kickoff))).toBe(false)
  })

  it("a half-written result (playedAt set, scores null) does not count", () => {
    const kickoff = minutes(TAKEOVER, 10)
    const half: FixtureResult = { ...playedFixture(kickoff, 0, 0), homeScore: null, awayScore: null }
    expect(countsTowardRecord(half, after(kickoff))).toBe(false)
  })
})

describe("computeManagerRecord - a human manager starts from zero", () => {
  // Bot FC's history: it won matches long before this manager existed.
  const botEraWins = [
    playedFixture(days(TAKEOVER, -20), 3, 0),
    playedFixture(days(TAKEOVER, -10), 2, 1),
    playedFixture(days(TAKEOVER, -5), 0, 0),
  ]

  it("ignores every match played under the bot era", () => {
    const now = days(TAKEOVER, 1)
    expect(computeManagerRecord(HUMAN_ERA, botEraWins, now)).toEqual({
      matches: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
    })
  })

  it("counts only matches from the takeover onwards, home and away", () => {
    const win = playedFixture(minutes(TAKEOVER, 10), 2, 0)
    const draw = playedFixture(days(TAKEOVER, 1), 1, 1)
    const lossAway = playedFixture(days(TAKEOVER, 2), 3, 1, { home: false })
    const now = days(TAKEOVER, 3)

    expect(computeManagerRecord(HUMAN_ERA, [...botEraWins, win, draw, lossAway], now)).toEqual({
      matches: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      goalsFor: 4, // 2 + 1 + 1 (away)
      goalsAgainst: 4, // 0 + 1 + 3 (away)
    })
  })

  it("a mid-season takeover leaves the club's earlier results out of the manager's record", () => {
    // Bot FC played matchdays 1-2 before the handover and 3 after it. The
    // club's league points are untouched by any of this - only who gets
    // credited changes.
    const beforeHandover = [playedFixture(days(TAKEOVER, -4), 1, 0), playedFixture(days(TAKEOVER, -2), 2, 2)]
    const afterHandover = [playedFixture(days(TAKEOVER, 2), 0, 1)]
    const now = days(TAKEOVER, 3)

    const human = computeManagerRecord(HUMAN_ERA, [...beforeHandover, ...afterHandover], now)
    expect(human).toMatchObject({ matches: 1, wins: 0, draws: 0, losses: 1 })

    // And the bot era still owns exactly the earlier two.
    const bot = computeManagerRecord(BOT_ERA, [...beforeHandover, ...afterHandover], now)
    expect(bot).toMatchObject({ matches: 2, wins: 1, draws: 1, losses: 0 })
  })

  it("a match still inside its live window does not enter the record early", () => {
    const finished = playedFixture(days(TAKEOVER, 1), 1, 0)
    const liveKickoff = days(TAKEOVER, 2)
    const live = playedFixture(liveKickoff, 4, 0)
    const midMatch = minutes(liveKickoff, 2)

    expect(computeManagerRecord(HUMAN_ERA, [finished, live], midMatch)).toMatchObject({
      matches: 1,
      wins: 1,
      goalsFor: 1,
    })

    // ...and enters it once the window has played out.
    expect(computeManagerRecord(HUMAN_ERA, [finished, live], after(liveKickoff))).toMatchObject({
      matches: 2,
      wins: 2,
      goalsFor: 5,
    })
  })
})

describe("PART G - the exact interval, to the millisecond", () => {
  const CLOSED: EraWindow = { teamId: TEAM, startedAt: BOT_ERA.startedAt, endedAt: TAKEOVER }

  it("startedAt is INCLUSIVE: a match at exactly startedAt is inside", () => {
    expect(instantBelongsToEra(CLOSED.startedAt, CLOSED)).toBe(true)
    expect(instantBelongsToEra(new Date(CLOSED.startedAt.getTime() - 1), CLOSED)).toBe(false)
  })

  it("endedAt is EXCLUSIVE: one millisecond before is inside, exactly on it is not", () => {
    expect(instantBelongsToEra(new Date(TAKEOVER.getTime() - 1), CLOSED)).toBe(true)
    expect(instantBelongsToEra(TAKEOVER, CLOSED)).toBe(false)
    expect(instantBelongsToEra(new Date(TAKEOVER.getTime() + 1), CLOSED)).toBe(false)
  })

  it("an open era has no upper bound - any instant from startedAt onwards is inside", () => {
    expect(instantBelongsToEra(TAKEOVER, HUMAN_ERA)).toBe(true)
    expect(instantBelongsToEra(days(TAKEOVER, 10_000), HUMAN_ERA)).toBe(true)
    expect(instantBelongsToEra(new Date(TAKEOVER.getTime() - 1), HUMAN_ERA)).toBe(false)
  })

  it("the manager record honours both boundaries to the millisecond", () => {
    const oneMsBefore = playedFixture(new Date(TAKEOVER.getTime() - 1), 5, 0)
    const exactlyAt = playedFixture(TAKEOVER, 1, 0)
    const now = days(TAKEOVER, 1)

    // The match one millisecond before the handover is the bot's, not the
    // manager's - a five-goal win the human did not earn.
    expect(computeManagerRecord(HUMAN_ERA, [oneMsBefore, exactlyAt], now)).toMatchObject({
      matches: 1,
      goalsFor: 1,
    })
    expect(computeManagerRecord(CLOSED, [oneMsBefore, exactlyAt], now)).toMatchObject({
      matches: 1,
      goalsFor: 5,
    })
  })
})
