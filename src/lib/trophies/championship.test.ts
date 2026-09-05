/**
 * Championship provenance and the historical club name, over the one mapper
 * both cabinets share.
 */
import { byMostRecent, toChampionshipView } from "./championship"
import { MATCH_REAL_DURATION_MINUTES } from "@/lib/match/timing"

const at = (iso: string) => new Date(iso)
const KICKOFF = at("2026-11-25T19:00:00.000Z")
const NOW = new Date(KICKOFF.getTime() + (MATCH_REAL_DURATION_MINUTES + 1) * 60_000)

const team = {
  id: "team-1",
  name: "Maccabi Galaxy",
  crestShape: "shield",
  crestPattern: null,
  crestIcon: "trophy",
  crestColor: "#361d78",
  crestSecondaryColor: null,
  crestBorderColor: null,
  crestImageUrl: null,
}

function row(over: Partial<Parameters<typeof toChampionshipView>[0]> = {}) {
  return {
    id: "champ-1",
    teamId: "team-1",
    teamEraId: "era-1",
    decidedAt: KICKOFF,
    decidedByFixtureId: null,
    clubNameAtDecision: "Hapoel Ashdod B",
    season: { number: 1, countryCode: "IL" },
    division: { tier: 1, group: "A", name: "Premier" },
    team,
    decidedByFixture: null,
    ...over,
  } as Parameters<typeof toChampionshipView>[0]
}

function decider(over: Record<string, unknown> = {}) {
  return {
    id: "fx-1",
    stage: "TITLE_DECIDER" as const,
    playoffId: null,
    playoffPhase: null,
    playoffRound: null,
    scheduledAt: KICKOFF,
    playedAt: KICKOFF,
    homeTeamId: "team-1",
    awayTeamId: "team-2",
    homeShootoutScore: null,
    awayShootoutScore: null,
    ...over,
  }
}

describe("provenance", () => {
  it("no deciding fixture means the TABLE settled it", () => {
    expect(toChampionshipView(row(), NOW).decision).toBe("TABLE")
  })

  it("a TITLE_DECIDER is a DECIDER", () => {
    const view = toChampionshipView(row({ decidedByFixtureId: "fx-1", decidedByFixture: decider() }), NOW)
    expect(view.decision).toBe("DECIDER")
    expect(view.decidedByFixtureId).toBe("fx-1")
  })

  it("a TITLE_PLAYOFF is a PLAYOFF, carrying its phase and round", () => {
    const view = toChampionshipView(
      row({
        decidedByFixtureId: "fx-1",
        decidedByFixture: decider({
          stage: "TITLE_PLAYOFF",
          playoffId: "po-1",
          playoffPhase: "KNOCKOUT",
          playoffRound: 2,
        }),
      }),
      NOW
    )
    expect(view.decision).toBe("PLAYOFF")
    expect(view.playoffPhase).toBe("KNOCKOUT")
    expect(view.playoffRound).toBe(2)
  })

  it("a LEAGUE deciding fixture is still a table championship", () => {
    const view = toChampionshipView(
      row({ decidedByFixtureId: "fx-1", decidedByFixture: decider({ stage: "LEAGUE" }) }),
      NOW
    )
    expect(view.decision).toBe("TABLE")
  })

  it("carries no playoff data for a table title", () => {
    const view = toChampionshipView(row(), NOW)
    expect(view.playoffPhase).toBeNull()
    expect(view.playoffRound).toBeNull()
  })
})

describe("penalties", () => {
  it("shows the shootout and who won it", () => {
    const view = toChampionshipView(
      row({
        decidedByFixtureId: "fx-1",
        decidedByFixture: decider({ homeShootoutScore: 5, awayShootoutScore: 4 }),
      }),
      NOW
    )
    expect(view.shootout).toEqual({ home: 5, away: 4, winnerTeamId: "team-1" })
  })

  it("names the away side when they won the kicks", () => {
    const view = toChampionshipView(
      row({
        decidedByFixtureId: "fx-1",
        decidedByFixture: decider({ homeShootoutScore: 3, awayShootoutScore: 4 }),
      }),
      NOW
    )
    expect(view.shootout?.winnerTeamId).toBe("team-2")
  })

  it("is null when the match never went to penalties", () => {
    expect(toChampionshipView(row({ decidedByFixtureId: "fx-1", decidedByFixture: decider() }), NOW).shootout).toBeNull()
  })

  it("FAILS CLOSED on a level shootout rather than naming a winner", () => {
    const view = toChampionshipView(
      row({ decidedByFixtureId: "fx-1", decidedByFixture: decider({ homeShootoutScore: 4, awayShootoutScore: 4 }) }),
      NOW
    )
    expect(view.shootout).toBeNull()
  })

  it("FAILS CLOSED while the deciding match is still live", () => {
    const duringTheMatch = new Date(KICKOFF.getTime() + 2 * 60_000)
    const view = toChampionshipView(
      row({ decidedByFixtureId: "fx-1", decidedByFixture: decider({ homeShootoutScore: 5, awayShootoutScore: 4 }) }),
      duringTheMatch
    )
    expect(view.shootout).toBeNull()
  })

  it("FAILS CLOSED when the deciding match was never simulated", () => {
    const view = toChampionshipView(
      row({
        decidedByFixtureId: "fx-1",
        decidedByFixture: decider({ playedAt: null, homeShootoutScore: 5, awayShootoutScore: 4 }),
      }),
      NOW
    )
    expect(view.shootout).toBeNull()
  })
})

describe("the historical club name", () => {
  it("USES THE SNAPSHOT, not the club's current name", () => {
    const view = toChampionshipView(row(), NOW)
    expect(view.clubName).toBe("Hapoel Ashdod B")
    expect(view.clubNameIsHistorical).toBe(true)
    // The club has since been renamed; the title does not follow it.
    expect(team.name).toBe("Maccabi Galaxy")
  })

  it("falls back to the current name for a legacy row, and SAYS SO", () => {
    const view = toChampionshipView(row({ clubNameAtDecision: null }), NOW)
    expect(view.clubName).toBe("Maccabi Galaxy")
    expect(view.clubNameIsHistorical).toBe(false)
  })

  it("THE IDENTITY IS ALWAYS teamId, whatever the name says", () => {
    const view = toChampionshipView(row({ clubNameAtDecision: "A Completely Different Club" }), NOW)
    expect(view.teamId).toBe("team-1")
  })
})

describe("ordering", () => {
  it("is most recent first, by decidedAt", () => {
    const older = toChampionshipView(row({ id: "a", decidedAt: at("2026-01-01T00:00:00Z") }), NOW)
    const newer = toChampionshipView(row({ id: "b", decidedAt: at("2027-01-01T00:00:00Z") }), NOW)
    expect([older, newer].sort(byMostRecent).map((c) => c.id)).toEqual(["b", "a"])
  })
})
