/**
 * THE GATE BETWEEN A FIXTURE AND ITS SIMULATION.
 *
 * Until now buildTeamSnapshot took whoever happened to hold a lineup slot,
 * the engine counted them, and a club left with eight starters by a
 * retirement played eight against eleven - silently, every week, with a real
 * result written to a real league table. Nothing checked, so nothing
 * complained.
 *
 * This runs first now. It REPAIRS both clubs through the canonical service,
 * then VALIDATES them against the canonical definition, and if either club
 * still cannot field a legal XI it FAILS CLOSED: no simulation, no
 * PlayerMatchStats, no MatchEvent, no money, and playedAt is left null so the
 * fixture is still outstanding and can be played the moment the squad is
 * fixed. A missing player is a problem to report, never a match to fake.
 */
import type { Prisma } from "@/generated/prisma"
import { repairTeamLineup, checkTeamLineup, type LineupCheck } from "@/lib/players/lineup-repair"

export type MatchPreflightCode = "OK" | "INSUFFICIENT_ELIGIBLE_PLAYERS" | "ILLEGAL_LINEUP"

export class MatchPreflightError extends Error {
  constructor(
    readonly code: Exclude<MatchPreflightCode, "OK">,
    readonly fixtureId: string,
    readonly teams: LineupCheck[]
  ) {
    const detail = teams
      .filter((team) => !team.legal)
      .map((team) => `${team.teamId}: ${team.starters}/${team.slotCount} starters, ${team.eligible} eligible [${team.problems.join(",")}]`)
      .join("; ")
    super(`${code} on fixture ${fixtureId} - ${detail}`)
    this.name = "MatchPreflightError"
  }
}

export interface MatchPreflightResult {
  code: MatchPreflightCode
  teams: LineupCheck[]
}

/**
 * Repairs then judges both clubs, against an open transaction so the repair
 * commits with whatever the caller is doing.
 *
 * The two codes are different problems and are reported as such:
 * INSUFFICIENT_ELIGIBLE_PLAYERS means the club does not own enough players
 * who may play (which this phase deliberately does not solve - see the squad
 * floor, out of scope); ILLEGAL_LINEUP means it does, and something else is
 * wrong, which is a bug rather than a squad problem.
 */
export async function preflightFixtureLineups(
  tx: Prisma.TransactionClient,
  fixtureId: string,
  teamIds: readonly string[]
): Promise<MatchPreflightResult> {
  for (const teamId of teamIds) {
    await repairTeamLineup(tx, teamId)
  }
  const teams: LineupCheck[] = []
  for (const teamId of teamIds) {
    teams.push(await checkTeamLineup(tx, teamId))
  }

  const broken = teams.filter((team) => !team.legal)
  if (broken.length === 0) return { code: "OK", teams }
  const code = broken.some((team) => team.eligible < team.slotCount)
    ? "INSUFFICIENT_ELIGIBLE_PLAYERS"
    : "ILLEGAL_LINEUP"
  return { code, teams }
}

/** Repairs, judges, and throws rather than returning a verdict nobody checked. */
export async function assertFixtureLineupsLegal(
  tx: Prisma.TransactionClient,
  fixtureId: string,
  teamIds: readonly string[]
): Promise<MatchPreflightResult> {
  const result = await preflightFixtureLineups(tx, fixtureId, teamIds)
  if (result.code !== "OK") throw new MatchPreflightError(result.code, fixtureId, result.teams)
  return result
}
