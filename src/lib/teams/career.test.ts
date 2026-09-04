/**
 * THE CAREER PROOF for the leave lifecycle.
 *
 * Pure - it runs the real era-boundary rule over a hand-built history, so
 * these assert the ARCHITECTURE rather than any one query. The scenario is
 * the one the leave transition exists to make possible: manage a club,
 * leave, manage another, come back.
 *
 * No UI, no profile reader, no aggregation module is built yet. What is
 * proved here is that when one is, summing per era gives the right answer
 * and the bot interval between two spells cannot leak into it.
 */
import { computeManagerRecord, fixtureBelongsToEra, type EraWindow, type FixtureResult } from "./era"

const TEAM_A = "team-a"
const TEAM_B = "team-b"
const USER = "user-1"

const at = (iso: string) => new Date(iso)
/** Finished by the time we measure - every fixture below is in the past. */
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

// --- THE CAREER --------------------------------------------------------
// Spell 1: Team A, seasons 1-3.        Then LEAVES.
// Bot gap: Team A unmanaged, seasons 4-8.
// Spell 2: Team B, seasons 5-7.        Then LEAVES.
// Spell 3: Team A again, from season 9.
//
// Note spell 2 OVERLAPS the bot gap in time, on a different club. Nothing
// forbids that: the one-open-era uniqueness is per TEAM, not per user.
const SPELL_1: EraWindow = { teamId: TEAM_A, startedAt: at("2026-01-01T00:00:00Z"), endedAt: at("2026-04-01T00:00:00Z") }
const BOT_GAP: EraWindow = { teamId: TEAM_A, startedAt: at("2026-04-01T00:00:00Z"), endedAt: at("2027-01-01T00:00:00Z") }
const SPELL_2: EraWindow = { teamId: TEAM_B, startedAt: at("2026-05-01T00:00:00Z"), endedAt: at("2026-09-01T00:00:00Z") }
const SPELL_3: EraWindow = { teamId: TEAM_A, startedAt: at("2027-01-01T00:00:00Z"), endedAt: null }

const HISTORY: FixtureResult[] = [
  // Spell 1 - two wins.
  match(TEAM_A, "x", "2026-02-01T19:00:00Z", 2, 0),
  match(TEAM_A, "y", "2026-03-01T19:00:00Z", 1, 0),
  // The BOT gap - three matches the manager was not there for.
  match(TEAM_A, "z", "2026-05-01T19:00:00Z", 0, 4),
  match(TEAM_A, "z", "2026-07-01T19:00:00Z", 0, 5),
  match(TEAM_A, "z", "2026-11-01T19:00:00Z", 0, 6),
  // Spell 2, a different club - one win, one draw.
  match(TEAM_B, "p", "2026-06-01T19:00:00Z", 3, 1),
  match(TEAM_B, "q", "2026-08-01T19:00:00Z", 1, 1),
  // Spell 3 - one loss.
  match(TEAM_A, "r", "2027-02-01T19:00:00Z", 0, 2),
]

describe("a returning manager's career", () => {
  const spell1 = computeManagerRecord(SPELL_1, HISTORY, NOW)
  const spell2 = computeManagerRecord(SPELL_2, HISTORY, NOW)
  const spell3 = computeManagerRecord(SPELL_3, HISTORY, NOW)

  it("each spell counts only its own matches", () => {
    expect(spell1).toMatchObject({ matches: 2, wins: 2, draws: 0, losses: 0, goalsFor: 3, goalsAgainst: 0 })
    expect(spell2).toMatchObject({ matches: 2, wins: 1, draws: 1, losses: 0, goalsFor: 4, goalsAgainst: 2 })
    expect(spell3).toMatchObject({ matches: 1, wins: 0, draws: 0, losses: 1, goalsFor: 0, goalsAgainst: 2 })
  })

  it("THE BOT INTERVAL IS EXCLUDED - 15 goals conceded by the bot are not the manager's", () => {
    const career = [spell1, spell2, spell3]
    const conceded = career.reduce((sum, r) => sum + r.goalsAgainst, 0)
    // The three bot matches conceded 4 + 5 + 6 = 15. None of it appears.
    expect(conceded).toBe(4)
    expect(career.reduce((sum, r) => sum + r.matches, 0)).toBe(5)
  })

  it("career totals are the SUM OF ERAS, and the arithmetic closes", () => {
    const career = [spell1, spell2, spell3].reduce((a, r) => ({
      matches: a.matches + r.matches,
      wins: a.wins + r.wins,
      draws: a.draws + r.draws,
      losses: a.losses + r.losses,
      goalsFor: a.goalsFor + r.goalsFor,
      goalsAgainst: a.goalsAgainst + r.goalsAgainst,
    }))
    expect(career).toEqual({ matches: 5, wins: 3, draws: 1, losses: 1, goalsFor: 7, goalsAgainst: 4 })
    expect(career.wins + career.draws + career.losses).toBe(career.matches)
  })

  it("THE TWO TEAM A SPELLS MUST NOT BE MERGED into one window", () => {
    // The failure mode this whole test exists for: computing a club record
    // as min(startedAt)..max(endedAt) would swallow the bot era whole.
    const merged: EraWindow = { teamId: TEAM_A, startedAt: SPELL_1.startedAt, endedAt: SPELL_3.endedAt }
    const wrong = computeManagerRecord(merged, HISTORY, NOW)
    expect(wrong.matches).toBe(6)

    // Done correctly - per era, then summed - Team A is three matches.
    const right = [spell1, spell3].reduce((a, r) => a + r.matches, 0)
    expect(right).toBe(3)
    expect(right).not.toBe(wrong.matches)
  })

  it("a club-specific record sums only that club's spells", () => {
    expect(spell1.matches + spell3.matches).toBe(3)
    expect(spell2.matches).toBe(2)
  })

  it("no match belongs to two eras, and none to none", () => {
    const eras = [SPELL_1, BOT_GAP, SPELL_2, SPELL_3]
    for (const fixture of HISTORY) {
      const owners = eras.filter((era) => fixtureBelongsToEra(fixture, era))
      expect(owners).toHaveLength(1)
    }
  })

  it("A MATCH KICKING OFF EXACTLY AT THE LEAVE INSTANT belongs to the BOT era", () => {
    // Half-open [startedAt, endedAt): the boundary instant is the new era's.
    const onTheBoundary = match(TEAM_A, "z", "2026-04-01T00:00:00Z", 0, 1)
    expect(fixtureBelongsToEra(onTheBoundary, SPELL_1)).toBe(false)
    expect(fixtureBelongsToEra(onTheBoundary, BOT_GAP)).toBe(true)
  })

  it("no match after the leave counts toward the departed manager", () => {
    const afterLeaving = HISTORY.filter((f) => f.scheduledAt! >= SPELL_1.endedAt!)
    expect(afterLeaving.some((f) => fixtureBelongsToEra(f, SPELL_1))).toBe(false)
  })

  it("the manager's record from before leaving is unchanged by anything after it", () => {
    // Re-measured with the bot's later matches present: still 2-0-0.
    const beforeOnly = HISTORY.filter((f) => f.scheduledAt! < SPELL_1.endedAt!)
    expect(computeManagerRecord(SPELL_1, beforeOnly, NOW)).toEqual(computeManagerRecord(SPELL_1, HISTORY, NOW))
  })
})
