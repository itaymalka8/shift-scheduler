import { prisma } from "@/lib/prisma"
import { isMatchFinished } from "@/lib/match/timing"

export interface StandingRow {
  teamId: string
  teamName: string
  isBot: boolean
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
}

/**
 * Read-only: computes the table strictly from results already in the
 * database. Never simulates or writes anything - a fixture whose kickoff
 * has passed but hasn't been played yet just doesn't count toward the table
 * until processDueFixtures() (run by the scheduler, not by this call) plays
 * it. See src/lib/match/simulate.ts for where that actually happens.
 */
export async function computeStandings(divisionId: string): Promise<StandingRow[]> {
  const [memberships, allFixtures] = await Promise.all([
    prisma.divisionTeam.findMany({ where: { divisionId }, include: { team: true } }),
    prisma.fixture.findMany({
      // stage: "LEAGUE" is load-bearing, not defensive. A championship
      // decider is a fixture OF this division, played by two of its clubs,
      // and it exists precisely because the table could not separate them -
      // so letting it into the table would change the very numbers it was
      // played to settle. Filtering on the stage rather than excluding a
      // list of known non-league types means a value added later (the
      // promotion playoff in src/lib/leagues/config.ts is the next one) is
      // excluded from the table on the day it is added, with no edit here.
      where: { divisionId, stage: "LEAGUE", homeScore: { not: null }, awayScore: { not: null } },
    }),
  ])
  // Only count matches whose live 10-minute window has actually played out,
  // so the table doesn't spoil a still-in-progress match's result.
  const fixtures = allFixtures.filter((f) => isMatchFinished(f.scheduledAt))

  const rows = new Map<string, StandingRow>()
  for (const m of memberships) {
    rows.set(m.teamId, {
      teamId: m.teamId,
      teamName: m.team.name,
      isBot: m.team.isBot,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
    })
  }

  for (const f of fixtures) {
    if (f.homeScore == null || f.awayScore == null) continue
    const home = rows.get(f.homeTeamId)
    const away = rows.get(f.awayTeamId)
    if (!home || !away) continue

    home.played++
    away.played++
    home.goalsFor += f.homeScore
    home.goalsAgainst += f.awayScore
    away.goalsFor += f.awayScore
    away.goalsAgainst += f.homeScore

    if (f.homeScore > f.awayScore) {
      home.won++
      home.points += 3
      away.lost++
    } else if (f.homeScore < f.awayScore) {
      away.won++
      away.points += 3
      home.lost++
    } else {
      home.drawn++
      away.drawn++
      home.points++
      away.points++
    }
  }

  const result = Array.from(rows.values())
  for (const r of result) r.goalDiff = r.goalsFor - r.goalsAgainst

  result.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.teamName.localeCompare(b.teamName)
  )
  return result
}
