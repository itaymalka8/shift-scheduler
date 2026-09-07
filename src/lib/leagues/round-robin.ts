export interface RoundRobinFixture {
  matchday: number
  homeTeamId: string
  awayTeamId: string
}

const BYE = "__BYE__"

/**
 * Standard "circle method" double round-robin: every team plays every other
 * team twice (once home, once away). Works for any team count; an odd count
 * gets a bye slot that's dropped from the output.
 */
export function generateDoubleRoundRobin(teamIds: string[]): RoundRobinFixture[] {
  const arr = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, BYE]
  const n = arr.length
  const rounds = n - 1
  const half = n / 2
  const firstLeg: RoundRobinFixture[] = []

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const home = arr[i]
      const away = arr[n - 1 - i]
      if (home === BYE || away === BYE) continue
      const matchday = round + 1
      firstLeg.push(
        round % 2 === 0
          ? { matchday, homeTeamId: home, awayTeamId: away }
          : { matchday, homeTeamId: away, awayTeamId: home }
      )
    }
    const last = arr.pop()!
    arr.splice(1, 0, last)
  }

  const secondLeg = firstLeg.map((f) => ({
    matchday: f.matchday + rounds,
    homeTeamId: f.awayTeamId,
    awayTeamId: f.homeTeamId,
  }))

  return [...firstLeg, ...secondLeg]
}
