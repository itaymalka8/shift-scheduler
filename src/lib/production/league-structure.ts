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
