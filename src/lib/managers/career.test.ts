/**
 * Career aggregation: the sum of eras, and never a span across them.
 */
import {
  buildCareerSpells,
  clubRecord,
  currentSpell,
  spellsAtClub,
  sumRecords,
  summariseCareer,
  winPercentage,
  type CareerEra,
} from "./career"
import { computeManagerRecord, type FixtureResult } from "@/lib/teams/era"

const at = (iso: string) => new Date(iso)
const NOW = at("2030-01-01T00:00:00.000Z")

function match(teamId: string, opponent: string, kickoff: string, gf: number, ga: number): FixtureResult {
  return {
    homeTeamId: teamId,
    awayTeamId: opponent,
    scheduledAt: at(kickoff),
    playedAt: at(kickoff),
    homeScore: gf,
    awayScore: ga,
  }
}

const era = (id: string, teamId: string, startedAt: string, endedAt: string | null): CareerEra => ({
  id,
  teamId,
  startedAt: at(startedAt),
  endedAt: endedAt ? at(endedAt) : null,
  startedSeason: null,
  endedSeason: null,
})

// Team A seasons 1-3, leave, Team B seasons 5-7, return to Team A from 9.
const ERAS = [
  era("e1", "team-a", "2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
  era("e2", "team-b", "2026-05-01T00:00:00Z", "2026-09-01T00:00:00Z"),
  era("e3", "team-a", "2027-01-01T00:00:00Z", null),
]

const HISTORY: FixtureResult[] = [
  match("team-a", "x", "2026-02-01T19:00:00Z", 2, 0),
  match("team-a", "y", "2026-03-01T19:00:00Z", 1, 0),
  // The BOT gap on team A - never this manager's.
  match("team-a", "z", "2026-05-01T19:00:00Z", 0, 4),
  match("team-a", "z", "2026-07-01T19:00:00Z", 0, 5),
  match("team-a", "z", "2026-11-01T19:00:00Z", 0, 6),
  match("team-b", "p", "2026-06-01T19:00:00Z", 3, 1),
  match("team-b", "q", "2026-08-01T19:00:00Z", 1, 1),
  match("team-a", "r", "2027-02-01T19:00:00Z", 0, 2),
]

const TITLES = new Map([["e1", 1]])

describe("buildCareerSpells", () => {
  const spells = buildCareerSpells(ERAS, HISTORY, TITLES, NOW)

  it("produces one spell per era, in chronological order", () => {
    expect(spells.map((s) => s.id)).toEqual(["e1", "e2", "e3"])
  })

  it("measures each era independently", () => {
    expect(spells[0].record).toMatchObject({ matches: 2, wins: 2, draws: 0, losses: 0, goalsFor: 3, goalsAgainst: 0 })
    expect(spells[1].record).toMatchObject({ matches: 2, wins: 1, draws: 1, losses: 0, goalsFor: 4, goalsAgainst: 2 })
    expect(spells[2].record).toMatchObject({ matches: 1, wins: 0, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 2 })
  })

  it("sorts by startedAt rather than trusting the caller's order", () => {
    const shuffled = buildCareerSpells([ERAS[2], ERAS[0], ERAS[1]], HISTORY, TITLES, NOW)
    expect(shuffled.map((s) => s.id)).toEqual(["e1", "e2", "e3"])
  })

  it("marks only the OPEN era as current", () => {
    expect(spells.filter((s) => s.isCurrent).map((s) => s.id)).toEqual(["e3"])
  })

  it("attaches championships to the era that won them", () => {
    expect(spells.map((s) => s.championships)).toEqual([1, 0, 0])
  })

  it("A MANAGER RETURNING TO A CLUB GETS TWO SEPARATE SPELLS", () => {
    expect(spellsAtClub(spells, "team-a").map((s) => s.id)).toEqual(["e1", "e3"])
  })
})

describe("summariseCareer", () => {
  const spells = buildCareerSpells(ERAS, HISTORY, TITLES, NOW)
  const summary = summariseCareer(spells)

  it("totals are the SUM OF ERAS and the arithmetic closes", () => {
    expect(summary.record).toEqual({ matches: 5, wins: 3, draws: 1, losses: 1, goalsFor: 7, goalsAgainst: 4 })
    expect(summary.record.wins + summary.record.draws + summary.record.losses).toBe(summary.record.matches)
  })

  it("THE BOT INTERVAL IS EXCLUDED - 15 goals the bot conceded are not the manager's", () => {
    expect(summary.record.goalsAgainst).toBe(4)
  })

  it("counts DISTINCT clubs but every spell", () => {
    expect(summary.clubsManaged).toBe(2)
    expect(summary.spells).toBe(3)
  })

  it("career start is the first era, not a registration date", () => {
    expect(summary.careerStartedAt).toEqual(at("2026-01-01T00:00:00Z"))
  })

  it("sums championships across eras", () => {
    expect(summary.championships).toBe(1)
  })

  it("an empty career is empty rather than absent", () => {
    const empty = summariseCareer([])
    expect(empty.record).toEqual({ matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })
    expect(empty.winPercentage).toBeNull()
    expect(empty.clubsManaged).toBe(0)
    expect(empty.spells).toBe(0)
    expect(empty.careerStartedAt).toBeNull()
    expect(empty.championships).toBe(0)
  })
})

describe("THE SPAN SHORTCUT IS WRONG, and this is the test that says so", () => {
  it("min(startedAt)..max(endedAt) across two spells absorbs the bot era", () => {
    const spells = buildCareerSpells(ERAS, HISTORY, TITLES, NOW)
    const wrong = computeManagerRecord(
      { teamId: "team-a", startedAt: ERAS[0].startedAt, endedAt: ERAS[2].endedAt },
      HISTORY,
      NOW
    )
    const right = clubRecord(spells, "team-a")

    expect(wrong.matches).toBe(6)
    expect(right.matches).toBe(3)
    expect(right.matches).not.toBe(wrong.matches)
    // And the goals the bot conceded are the visible difference.
    expect(wrong.goalsAgainst).toBe(17)
    expect(right.goalsAgainst).toBe(2)
  })

  it("clubRecord sums that club's spells and nothing else", () => {
    const spells = buildCareerSpells(ERAS, HISTORY, TITLES, NOW)
    expect(clubRecord(spells, "team-a")).toEqual({ matches: 3, wins: 2, draws: 0, losses: 1, goalsFor: 3, goalsAgainst: 2 })
    expect(clubRecord(spells, "team-b")).toEqual({ matches: 2, wins: 1, draws: 1, losses: 0, goalsFor: 4, goalsAgainst: 2 })
    expect(clubRecord(spells, "never-managed")).toEqual({ matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })
  })
})

describe("currentSpell", () => {
  it("is the open era", () => {
    expect(currentSpell(buildCareerSpells(ERAS, HISTORY, TITLES, NOW))?.id).toBe("e3")
  })

  it("IS NULL FOR A MANAGER WHO HAS LEFT - no current club", () => {
    const departed = buildCareerSpells([ERAS[0], ERAS[1]], HISTORY, TITLES, NOW)
    expect(currentSpell(departed)).toBeNull()
  })

  it("is null for a career that never started", () => {
    expect(currentSpell([])).toBeNull()
  })
})

describe("winPercentage", () => {
  it("is wins over matches", () => {
    expect(winPercentage({ matches: 4, wins: 3, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 0 })).toBe(0.75)
  })

  it("IS NULL rather than zero when nothing has been played", () => {
    // A manager who has not played is not a 0% manager.
    expect(winPercentage({ matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })).toBeNull()
  })
})

describe("sumRecords", () => {
  it("adds field by field and starts from zero", () => {
    expect(sumRecords([])).toEqual({ matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 })
    expect(
      sumRecords([
        { matches: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 1 },
        { matches: 2, wins: 0, draws: 1, losses: 1, goalsFor: 1, goalsAgainst: 3 },
      ])
    ).toEqual({ matches: 3, wins: 1, draws: 1, losses: 1, goalsFor: 3, goalsAgainst: 4 })
  })
})

describe("no live match ever reaches a career", () => {
  it("a match inside its live window counts nowhere", () => {
    const kickoff = at("2026-02-10T19:00:00Z")
    const live = { ...match("team-a", "x", "2026-02-10T19:00:00Z", 3, 0) }
    const duringTheMatch = new Date(kickoff.getTime() + 2 * 60_000)
    const spells = buildCareerSpells([ERAS[0]], [live], new Map(), duringTheMatch)
    expect(spells[0].record.matches).toBe(0)
  })
})
