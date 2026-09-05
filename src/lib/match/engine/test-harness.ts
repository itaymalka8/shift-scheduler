import { generateInitialSquad } from "@/lib/players/generate"
import { calculatePositionOverall } from "@/lib/players/overall"
import { extractPlayerAttributes } from "@/lib/players/attributes"
import { isPlayerPosition, type PlayerPosition } from "@/lib/players/positions"
import { DEFAULT_TACTICS, type TeamTactics } from "@/lib/players/tactics"
import { computeRecommendedLineup } from "@/lib/players/recommend"
import { DEFAULT_FORMATION, FORMATIONS, isFormationId, type FormationId } from "@/lib/players/formations"
import type { MatchSnapshot, SnapshotPlayer, SnapshotTeam } from "./snapshot"
import { simulateMatch, type EngineResult } from "./engine"

/**
 * Builds a fully synthetic team snapshot without touching the database, so
 * the balance suite can run tens of thousands of matches quickly. Squads
 * come from the real generator, so they're representative of what players
 * actually get.
 */
export function makeTestTeam(
  teamId: string,
  options: {
    /** Shifts every attribute by this many points - the "how much better is this side" dial. */
    qualityOffset?: number
    tactics?: Partial<TeamTactics>
    formation?: FormationId
    fitness?: number
  } = {}
): SnapshotTeam {
  const { qualityOffset = 0, formation = DEFAULT_FORMATION, fitness = 100 } = options
  const squad = generateInitialSquad()
  const slots = [...FORMATIONS[isFormationId(formation) ? formation : DEFAULT_FORMATION]]

  const adjusted = squad.map((p) => {
    const attributes = extractPlayerAttributes(p as unknown as Record<string, unknown>)
    if (qualityOffset !== 0) {
      for (const key of Object.keys(attributes) as (keyof typeof attributes)[]) {
        const value = attributes[key]
        if (value != null) attributes[key] = Math.max(1, Math.min(100, value + qualityOffset))
      }
    }
    const position = isPlayerPosition(p.primaryPosition) ? p.primaryPosition : "CM"
    return {
      id: `${teamId}-${p.shirtNumber}`,
      name: `${p.firstName} ${p.lastName}`,
      primaryPosition: position,
      secondaryPositions: p.secondaryPositions.filter(isPlayerPosition) as PlayerPosition[],
      attributes,
      overall: calculatePositionOverall(attributes, position),
      fitness,
    }
  })

  const assignments = computeRecommendedLineup(
    slots,
    adjusted.map((p) => ({
      id: p.id,
      primaryPosition: p.primaryPosition,
      secondaryPositions: p.secondaryPositions,
      overall: p.overall,
      fitness: p.fitness,
      status: "available",
    }))
  )
  const slotByPlayer = new Map(assignments.map((a) => [a.playerId, a.slotIndex]))

  const toSnapshot = (p: (typeof adjusted)[number]): SnapshotPlayer => {
    const slotIndex = slotByPlayer.get(p.id) ?? null
    return {
      ...p,
      slotIndex,
      assignedRole: slotIndex != null ? (slots[slotIndex]?.role ?? null) : null,
    }
  }

  const starters = adjusted.filter((p) => slotByPlayer.has(p.id)).map(toSnapshot)
  const bench = adjusted.filter((p) => !slotByPlayer.has(p.id)).map(toSnapshot)

  const captain = starters.reduce((best, p) =>
    (p.attributes.leadership ?? 0) > (best.attributes.leadership ?? 0) ? p : best
  )
  const bestBy = (key: "penalties" | "freeKicks" | "corners") =>
    starters.reduce((best, p) => ((p.attributes[key] ?? 0) > (best.attributes[key] ?? 0) ? p : best)).id

  return {
    teamId,
    name: teamId,
    starters,
    bench,
    formationSlots: slots,
    tactics: { ...DEFAULT_TACTICS, ...options.tactics },
    captainId: captain.id,
    penaltyTakerId: bestBy("penalties"),
    freeKickTakerId: bestBy("freeKicks"),
    cornerTakerId: bestBy("corners"),
  }
}

/**
 * Deep-copies a team so a test can change exactly one variable (fitness, a
 * single attribute, one tactic) and attribute the difference to it. Without
 * this, two separately-generated squads differ enough that squad noise
 * drowns out the effect being measured.
 */
export function cloneTeam(team: SnapshotTeam, teamId: string, mutate?: (player: SnapshotPlayer) => void): SnapshotTeam {
  const clonePlayer = (p: SnapshotPlayer): SnapshotPlayer => {
    const copy: SnapshotPlayer = {
      ...p,
      id: p.id.replace(/^[^-]+/, teamId),
      secondaryPositions: [...p.secondaryPositions],
      attributes: { ...p.attributes },
    }
    mutate?.(copy)
    return copy
  }
  const remap = (id: string | null) => (id ? id.replace(/^[^-]+/, teamId) : null)
  return {
    ...team,
    teamId,
    name: teamId,
    starters: team.starters.map(clonePlayer),
    bench: team.bench.map(clonePlayer),
    formationSlots: [...team.formationSlots],
    tactics: { ...team.tactics },
    captainId: remap(team.captainId),
    penaltyTakerId: remap(team.penaltyTakerId),
    freeKickTakerId: remap(team.freeKickTakerId),
    cornerTakerId: remap(team.cornerTakerId),
  }
}

export function makeTestSnapshot(
  home: SnapshotTeam,
  away: SnapshotTeam,
  seed: string,
  options: { attendance?: number; capacity?: number; fanType?: "calm" | "ultras" } = {}
): MatchSnapshot {
  return {
    fixtureId: `test-${seed}`,
    seed,
    home,
    away,
    attendance: options.attendance ?? 7000,
    stadiumCapacity: options.capacity ?? 10600,
    fanType: options.fanType ?? "calm",
  }
}

export interface SeriesSummary {
  matches: number
  homeWins: number
  draws: number
  awayWins: number
  homeWinPercent: number
  drawPercent: number
  awayWinPercent: number
  avgHomeGoals: number
  avgAwayGoals: number
  avgTotalGoals: number
  avgShots: number
  avgShotsOnTarget: number
  avgCorners: number
  avgFouls: number
  avgYellowCards: number
  avgRedCards: number
  avgPenalties: number
  avgOffsides: number
  avgInjuries: number
  avgHomePossession: number
}

/** Runs N matches between two fixed teams, varying only the seed. */
export function runSeries(
  home: SnapshotTeam,
  away: SnapshotTeam,
  matches: number,
  seedPrefix = "s",
  snapshotOptions: Parameters<typeof makeTestSnapshot>[3] = {}
): SeriesSummary {
  let homeWins = 0
  let draws = 0
  let awayWins = 0
  let homeGoals = 0
  let awayGoals = 0
  let shots = 0
  let shotsOnTarget = 0
  let corners = 0
  let fouls = 0
  let yellows = 0
  let reds = 0
  let penalties = 0
  let offsides = 0
  let injuries = 0
  let homePossession = 0

  for (let i = 0; i < matches; i++) {
    const snapshot = makeTestSnapshot(home, away, `${seedPrefix}-${i}`, snapshotOptions)
    const r: EngineResult = simulateMatch(snapshot)
    if (r.homeGoals > r.awayGoals) homeWins++
    else if (r.homeGoals < r.awayGoals) awayWins++
    else draws++
    homeGoals += r.homeGoals
    awayGoals += r.awayGoals
    shots += r.homeStats.shots + r.awayStats.shots
    shotsOnTarget += r.homeStats.shotsOnTarget + r.awayStats.shotsOnTarget
    corners += r.homeStats.corners + r.awayStats.corners
    fouls += r.homeStats.fouls + r.awayStats.fouls
    yellows += r.homeStats.yellowCards + r.awayStats.yellowCards
    reds += r.homeStats.redCards + r.awayStats.redCards
    penalties += r.homeStats.penalties + r.awayStats.penalties
    offsides += r.homeStats.offsides + r.awayStats.offsides
    injuries += r.homeStats.injuries + r.awayStats.injuries
    homePossession += r.homeStats.possessionPercent
  }

  return {
    matches,
    homeWins,
    draws,
    awayWins,
    homeWinPercent: (homeWins / matches) * 100,
    drawPercent: (draws / matches) * 100,
    awayWinPercent: (awayWins / matches) * 100,
    avgHomeGoals: homeGoals / matches,
    avgAwayGoals: awayGoals / matches,
    avgTotalGoals: (homeGoals + awayGoals) / matches,
    avgShots: shots / matches,
    avgShotsOnTarget: shotsOnTarget / matches,
    avgCorners: corners / matches,
    avgFouls: fouls / matches,
    avgYellowCards: yellows / matches,
    avgRedCards: reds / matches,
    avgPenalties: penalties / matches,
    avgOffsides: offsides / matches,
    avgInjuries: injuries / matches,
    avgHomePossession: homePossession / matches,
  }
}
