// Deliberately duplicated from src/lib/seasons/next-season.ts's own
// expectedFixtureCount, rather than imported from it: that module imports
// @/lib/prisma (the app's DATABASE_URL-bound singleton) at the top level,
// and nothing under src/lib/production may import that, even transitively
// (see client.ts's own comment for why). The formula itself is one line and
// unlikely to ever change independently of the double round-robin rule it
// encodes - everyone plays everyone else home and away.
export function expectedFixtureCount(teamCount: number): number {
  return teamCount * Math.max(teamCount - 1, 0)
}

// The league's fixed shape: three divisions of 20 clubs each (60 DivisionTeam
// memberships), double round robin per division -> 3 * expectedFixtureCount(20)
// = 1140 LEAGUE fixtures. Centralized here so prod:preflight and
// prod:post-deploy-check check the exact same numbers instead of two copies
// that could quietly drift apart.
//
// THESE ARE PER-ACTIVE-SEASON, NOT GLOBAL, AND THEY COUNT LEAGUE FIXTURES ONLY.
// They were written when one season existed and every fixture was a league
// fixture, so a global count meant the same thing. It stops meaning the same
// thing twice over:
//
//   - the moment season 2 exists, a global count is 6 / 120 / 2280 and a
//     hard-coded 3 / 60 / 1140 fails preflight, blocking every deploy
//     including the one that would fix it;
//   - a title decider, a boundary decider and a promotion playoff are all
//     real, wanted fixtures that are not part of the double round robin.
//
// So the structural contract is scoped both ways, and non-LEAGUE fixtures are
// REPORTED rather than counted against it.
export const EXPECTED_LEAGUE_DIVISIONS = 3
export const EXPECTED_LEAGUE_MEMBERSHIPS = 60
export const EXPECTED_LEAGUE_FIXTURES = 1140

/** @deprecated Kept as the old names for one release; identical values. */
export const V1_EXPECTED_DIVISIONS = EXPECTED_LEAGUE_DIVISIONS
export const V1_EXPECTED_DIVISION_TEAM_MEMBERSHIPS = EXPECTED_LEAGUE_MEMBERSHIPS
export const V1_EXPECTED_TOTAL_FIXTURES = EXPECTED_LEAGUE_FIXTURES

/** One active season's structural reading, as any caller measures it. */
export interface LeagueStructureReading {
  activeSeasons: number
  divisions: number
  memberships: number
  leagueFixtures: number
  nonLeagueFixtures: number
}

export interface LeagueStructureVerdict {
  ok: boolean
  errors: string[]
  notes: string[]
}

/**
 * Judge one country's active season against the contract.
 *
 * Pure - the caller does the reading, so Production and the tests check the
 * same expectations rather than two copies that could drift. Non-LEAGUE
 * fixtures never produce an error: a decider or a promotion playoff is
 * evidence that the season lifecycle is working, not that the league is
 * malformed.
 */
export function judgeLeagueStructure(reading: LeagueStructureReading): LeagueStructureVerdict {
  const errors: string[] = []
  const notes: string[] = []

  if (reading.activeSeasons !== 1) {
    errors.push(`Expected exactly 1 active season, found ${reading.activeSeasons}.`)
  }
  if (reading.divisions !== EXPECTED_LEAGUE_DIVISIONS) {
    errors.push(`Expected ${EXPECTED_LEAGUE_DIVISIONS} Divisions in the active season, found ${reading.divisions}.`)
  }
  if (reading.memberships !== EXPECTED_LEAGUE_MEMBERSHIPS) {
    errors.push(
      `Expected ${EXPECTED_LEAGUE_MEMBERSHIPS} DivisionTeam memberships in the active season, found ${reading.memberships}.`
    )
  }
  if (reading.leagueFixtures !== EXPECTED_LEAGUE_FIXTURES) {
    errors.push(
      `Expected ${EXPECTED_LEAGUE_FIXTURES} LEAGUE Fixtures in the active season, found ${reading.leagueFixtures}.`
    )
  }
  if (reading.nonLeagueFixtures > 0) {
    notes.push(
      `${reading.nonLeagueFixtures} non-LEAGUE fixture(s) in the active season ` +
        `(title deciders, boundary deciders, promotion playoffs) - reported, not counted against the league.`
    )
  }

  return { ok: errors.length === 0, errors, notes }
}

export interface DivisionStructureCheck {
  teamCount: number
  fixtureCount: number
  expectedFixtures: number
  matches: boolean
}

export function checkDivisionStructure(input: { teamCount: number; fixtureCount: number }): DivisionStructureCheck {
  const expectedFixtures = expectedFixtureCount(input.teamCount)
  return { ...input, expectedFixtures, matches: input.fixtureCount === expectedFixtures }
}
