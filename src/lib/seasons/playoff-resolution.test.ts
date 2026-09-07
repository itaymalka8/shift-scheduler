/**
 * What a loaded playoff needs next, and how the title is dated.
 *
 * decidedAt here is DELIBERATELY SIMPLE: a round is evaluated only once every
 * fixture in it has finished, and the title is dated from the last kickoff of
 * that round. There is no mathematical clinch detection - no "could anyone
 * still catch them" search - so there is no arithmetic subtle enough to crown
 * the wrong club early.
 */
import { decidePlayoff, decidingFixtureOfRound, winnersOf } from "./playoff-resolution"
import type { PlayoffState } from "./playoffs"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"
import { drawKnockout } from "./draw"

const NOW = new Date("2026-12-01T12:00:00Z")
const LIVE_MS = MATCH_REAL_DURATION_MINUTES * 60_000
/** A kickoff whose live window has fully played out. */
const done = (daysAgo: number) => new Date(NOW.getTime() - LIVE_MS - daysAgo * 86_400_000)

function fx(
  id: string,
  home: string,
  away: string,
  hs: number | null,
  as: number | null,
  opts: {
    phase?: "ROUND_ROBIN" | "KNOCKOUT"
    round?: number
    scheduledAt?: Date
    played?: boolean
    hp?: number | null
    ap?: number | null
  } = {}
) {
  return {
    id,
    homeTeamId: home,
    awayTeamId: away,
    homeScore: hs,
    awayScore: as,
    homeShootoutScore: opts.hp ?? null,
    awayShootoutScore: opts.ap ?? null,
    playoffPhase: opts.phase ?? ("ROUND_ROBIN" as const),
    playoffRound: opts.round ?? 1,
    scheduledAt: opts.scheduledAt ?? done(1),
    playedAt: opts.played === false ? null : new Date(),
  }
}

const state = (fixtures: ReturnType<typeof fx>[], extra: Partial<PlayoffState> = {}): PlayoffState => ({
  id: "po1",
  divisionId: "d1",
  drawSeed: "IL-S1-T1-deadbeef",
  knockoutDraw: null,
  fixtures,
  ...extra,
})

describe("decidingFixtureOfRound", () => {
  it("is the LAST kickoff of the round", () => {
    const chosen = decidingFixtureOfRound([
      { id: "a", scheduledAt: done(3) },
      { id: "b", scheduledAt: done(1) },
      { id: "c", scheduledAt: done(2) },
    ])
    expect(chosen?.id).toBe("b")
  })

  it("breaks a simultaneous-kickoff tie by fixture id - technical only, and only for provenance", () => {
    const same = done(1)
    const chosen = decidingFixtureOfRound([
      { id: "zzz", scheduledAt: same },
      { id: "aaa", scheduledAt: same },
    ])
    // The champion was already decided by the table before this runs; this
    // only selects WHICH row records it.
    expect(chosen?.id).toBe("aaa")
    expect(chosen?.scheduledAt).toEqual(same)
  })

  it("ignores unscheduled fixtures", () => {
    expect(decidingFixtureOfRound([{ id: "a", scheduledAt: null }])).toBeNull()
  })
})

describe("round robin decisions", () => {
  it("crowns the leader and dates the title from the round's LAST kickoff", () => {
    const last = done(1)
    const decision = decidePlayoff(
      state([
        fx("f1", "A", "B", 2, 0, { scheduledAt: done(3) }),
        fx("f2", "A", "C", 1, 0, { scheduledAt: done(2) }),
        fx("f3", "B", "C", 1, 1, { hp: 4, ap: 3, scheduledAt: last }),
      ]),
      NOW
    )
    expect(decision).toEqual({
      kind: "champion",
      teamId: "A",
      decidedAt: last,
      decidedByFixtureId: "f3",
    })
  })

  it("WAITS while any fixture of the round is unplayed", () => {
    const decision = decidePlayoff(
      state([
        fx("f1", "A", "B", 2, 0),
        fx("f2", "A", "C", null, null, { played: false }),
        fx("f3", "B", "C", 1, 0),
      ]),
      NOW
    )
    expect(decision.kind).toBe("waiting")
  })

  it("WAITS while a fixture is still inside its live window, even though its score is stored", () => {
    const live = new Date(NOW.getTime() - LIVE_MS / 2)
    const decision = decidePlayoff(
      state([
        fx("f1", "A", "B", 2, 0),
        fx("f2", "A", "C", 1, 0),
        fx("f3", "B", "C", 9, 0, { scheduledAt: live }),
      ]),
      NOW
    )
    expect(decision.kind).toBe("waiting")
  })

  it("asks for round 2 over ONLY the clubs still tied", () => {
    // A and B level at the top, C behind but the three-way head-to-head IS
    // the whole table, so it separates nothing... except it does here:
    // A beat B, so remove-and-recompute settles it. Use a perfect cycle
    // instead, which nothing can separate.
    const decision = decidePlayoff(
      state([
        fx("f1", "A", "B", 1, 0),
        fx("f2", "B", "C", 1, 0),
        fx("f3", "C", "A", 1, 0),
      ]),
      NOW
    )
    expect(decision).toEqual({ kind: "needRoundRobin", round: 2, teamIds: ["A", "B", "C"] })
  })

  it("AFTER ROUND 3 it asks for the knockout instead of a fourth round", () => {
    const decision = decidePlayoff(
      state([
        fx("f1", "A", "B", 1, 0, { round: 3 }),
        fx("f2", "B", "C", 1, 0, { round: 3 }),
        fx("f3", "C", "A", 1, 0, { round: 3 }),
      ]),
      NOW
    )
    expect(decision).toEqual({ kind: "needKnockout", entrants: ["A", "B", "C"] })
  })

  it("a shrinking tie carries only the survivors into the next round", () => {
    // D is clearly last; A, B, C cycle. The next round is the three of them.
    const decision = decidePlayoff(
      state([
        fx("f1", "A", "B", 1, 0),
        fx("f2", "B", "C", 1, 0),
        fx("f3", "C", "A", 1, 0),
        fx("f4", "A", "D", 5, 0),
        fx("f5", "B", "D", 5, 0),
        fx("f6", "C", "D", 5, 0),
      ]),
      NOW
    )
    expect(decision.kind).toBe("needRoundRobin")
    expect(decision.kind === "needRoundRobin" && decision.teamIds.sort()).toEqual(["A", "B", "C"])
  })

  it("BLOCKS rather than guesses when the playoff has no fixtures", () => {
    expect(decidePlayoff(state([]), NOW).kind).toBe("blocked")
  })
})

describe("knockout decisions", () => {
  const draw = drawKnockout(["A", "B", "C"], "IL-S1-T1-deadbeef")

  it("WAITS while a knockout round is unfinished", () => {
    const decision = decidePlayoff(
      state(
        [fx("k1", draw.firstRound.pairings[0].homeTeamId, draw.firstRound.pairings[0].awayTeamId, null, null, { phase: "KNOCKOUT", played: false })],
        { knockoutDraw: draw }
      ),
      NOW
    )
    expect(decision.kind).toBe("waiting")
  })

  it("advances the winner plus the byes into the next round, in the PERSISTED bracket order", () => {
    const pairing = draw.firstRound.pairings[0]
    const decision = decidePlayoff(
      state([fx("k1", pairing.homeTeamId, pairing.awayTeamId, 2, 0, { phase: "KNOCKOUT" })], {
        knockoutDraw: draw,
      }),
      NOW
    )
    expect(decision.kind).toBe("needKnockoutRound")
    if (decision.kind === "needKnockoutRound") {
      expect(decision.round).toBe(2)
      // One winner + one bye = two survivors, ordered by the stored draw.
      expect(decision.survivorsInBracketOrder).toHaveLength(2)
      expect(decision.survivorsInBracketOrder).toContain(pairing.homeTeamId)
      expect(decision.survivorsInBracketOrder).toContain(draw.byes[0])
      const order = draw.order.filter((id) => decision.survivorsInBracketOrder.includes(id))
      expect(decision.survivorsInBracketOrder).toEqual(order)
    }
  })

  it("THE FINAL crowns the champion and dates it from the final's kickoff", () => {
    const finalKickoff = done(1)
    const decision = decidePlayoff(
      state([fx("kf", "A", "B", 1, 0, { phase: "KNOCKOUT", round: 2, scheduledAt: finalKickoff })], {
        knockoutDraw: drawKnockout(["A", "B"], "seed"),
      }),
      NOW
    )
    expect(decision).toEqual({
      kind: "champion",
      teamId: "A",
      decidedAt: finalKickoff,
      decidedByFixtureId: "kf",
    })
  })

  it("a final settled on penalties still crowns its winner", () => {
    const decision = decidePlayoff(
      state([fx("kf", "A", "B", 1, 1, { phase: "KNOCKOUT", round: 2, hp: 3, ap: 5 })], {
        knockoutDraw: drawKnockout(["A", "B"], "seed"),
      }),
      NOW
    )
    expect(decision.kind === "champion" && decision.teamId).toBe("B")
  })

  it("BLOCKS when knockout fixtures exist but no draw was persisted", () => {
    const decision = decidePlayoff(
      state([fx("k1", "A", "B", 1, 0, { phase: "KNOCKOUT" })], { knockoutDraw: null }),
      NOW
    )
    expect(decision).toEqual({
      kind: "blocked",
      reason: "knockout fixtures exist but no draw is persisted",
    })
  })

  it("the knockout takes precedence over any earlier round-robin round", () => {
    const decision = decidePlayoff(
      state(
        [
          fx("r1", "A", "B", 1, 0, { round: 1 }),
          fx("kf", "A", "B", 2, 0, { phase: "KNOCKOUT", round: 1 }),
        ],
        { knockoutDraw: drawKnockout(["A", "B"], "seed") }
      ),
      NOW
    )
    expect(decision.kind).toBe("champion")
  })
})

describe("winnersOf", () => {
  it("returns 90-minute and shootout winners alike, and skips unresolved matches", () => {
    expect(
      winnersOf([
        { homeTeamId: "A", awayTeamId: "B", homeScore: 1, awayScore: 0, homeShootoutScore: null, awayShootoutScore: null },
        { homeTeamId: "C", awayTeamId: "D", homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4 },
        { homeTeamId: "E", awayTeamId: "F", homeScore: null, awayScore: null, homeShootoutScore: null, awayShootoutScore: null },
      ])
    ).toEqual(["A", "D"])
  })
})
