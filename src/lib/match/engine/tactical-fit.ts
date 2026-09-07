import type { AttributeKey } from "@/lib/players/attributes"
import {
  ATTACKING_STYLE_ATTRIBUTES,
  PRESSING_ATTRIBUTES,
  DEFENSIVE_LINE_ATTRIBUTES,
  OFFSIDE_TRAP_ATTRIBUTES,
  CREATIVE_FREEDOM_ATTRIBUTES,
  DRIBBLE_ATTRIBUTES,
  PASSING_TYPE_ATTRIBUTES,
  FULLBACK_OVERLAP_ATTRIBUTES,
  WIDTH_ATTRIBUTES,
  TEMPO_ATTRIBUTES,
  type TeamTactics,
} from "@/lib/players/tactics"
import type { SnapshotPlayer } from "./snapshot"

/**
 * How well a group of players suits a set of attribute demands, as a 0-100
 * score. This is the mechanism that makes every tactic conditional: a
 * tactic never grants a flat bonus, it just decides which attributes get
 * scored here.
 */
export function scoreAgainstDemands(players: SnapshotPlayer[], demands: Partial<Record<AttributeKey, number>>): number {
  if (players.length === 0) return 50
  let total = 0
  for (const player of players) {
    let sum = 0
    let weight = 0
    for (const [key, w] of Object.entries(demands)) {
      if (w == null) continue
      sum += (player.attributes[key as AttributeKey] ?? 45) * w
      weight += w
    }
    total += weight > 0 ? sum / weight : 50
  }
  return total / players.length
}

export type FitRating = "excellent" | "good" | "average" | "weak"

export function toFitRating(score: number): FitRating {
  if (score >= 76) return "excellent"
  if (score >= 66) return "good"
  if (score >= 56) return "average"
  return "weak"
}

export interface TacticalFitBreakdown {
  attackingStyle: number
  pressing: number
  defensiveLine: number
  offsideTrap: number
  creativeFreedom: number
  dribbling: number
  passingType: number
  width: number
  tempo: number
  fullbackOverlaps: number
  /** The single headline number shown to the manager. */
  overall: number
}

const ATTACKERS = new Set(["ST", "RW", "LW", "CAM"])
const DEFENDERS = new Set(["CB", "RB", "LB"])
const WIDE = new Set(["RB", "LB", "RM", "LM", "RW", "LW"])

function subset(players: SnapshotPlayer[], roles: Set<string>): SnapshotPlayer[] {
  const matched = players.filter((p) => roles.has(p.assignedRole ?? p.primaryPosition))
  return matched.length > 0 ? matched : players
}

/**
 * How well this starting XI suits the manager's chosen instructions. Each
 * dial is scored against the players it actually asks something of - a high
 * defensive line is judged on the defenders and keeper, overlapping
 * fullbacks on the fullbacks, and so on.
 */
export function calculateTacticalFit(starters: SnapshotPlayer[], tactics: TeamTactics): TacticalFitBreakdown {
  const outfield = starters.filter((p) => (p.assignedRole ?? p.primaryPosition) !== "GK")
  const defenders = subset(starters, DEFENDERS)
  const defendersAndKeeper = starters.filter(
    (p) => DEFENDERS.has(p.assignedRole ?? p.primaryPosition) || (p.assignedRole ?? p.primaryPosition) === "GK"
  )
  const wide = subset(outfield, WIDE)
  const fullbacks = subset(starters, new Set(["RB", "LB"]))

  const attackingStyle = scoreAgainstDemands(
    tactics.attackingStyle === "widePlay"
      ? // Wide play is judged on the wide players AND whoever attacks the
        // cross - crossing quality alone is not enough, per the spec.
        [...wide, ...subset(outfield, ATTACKERS)]
      : outfield,
    ATTACKING_STYLE_ATTRIBUTES[tactics.attackingStyle]
  )

  const pressing =
    tactics.pressing === "normal" ? 65 : scoreAgainstDemands(outfield, PRESSING_ATTRIBUTES[tactics.pressing])

  const defensiveLine =
    tactics.defensiveLine === "normal"
      ? 65
      : scoreAgainstDemands(defendersAndKeeper, DEFENSIVE_LINE_ATTRIBUTES[tactics.defensiveLine])

  const offsideTrap = tactics.offsideTrap ? scoreAgainstDemands(defenders, OFFSIDE_TRAP_ATTRIBUTES) : 65

  const creativeFreedom =
    tactics.creativeFreedom === "balanced"
      ? 65
      : scoreAgainstDemands(outfield, CREATIVE_FREEDOM_ATTRIBUTES[tactics.creativeFreedom])

  const dribbling = tactics.dribbleFrequency === "often" ? scoreAgainstDemands(outfield, DRIBBLE_ATTRIBUTES) : 65

  const passingType =
    tactics.passingType === "mixed" ? 65 : scoreAgainstDemands(outfield, PASSING_TYPE_ATTRIBUTES[tactics.passingType])

  const width =
    tactics.width === "balanced"
      ? 65
      : scoreAgainstDemands(tactics.width === "wide" ? wide : outfield, WIDTH_ATTRIBUTES[tactics.width])

  const tempo = tactics.tempo === "normal" ? 65 : scoreAgainstDemands(outfield, TEMPO_ATTRIBUTES[tactics.tempo])

  const fullbackOverlapsScore =
    tactics.fullbackOverlaps === "often" ? scoreAgainstDemands(fullbacks, FULLBACK_OVERLAP_ATTRIBUTES) : 65

  // The attacking style is the manager's headline choice, so it carries the
  // most weight in the single number shown back to them.
  const overall =
    attackingStyle * 0.3 +
    pressing * 0.12 +
    defensiveLine * 0.12 +
    creativeFreedom * 0.08 +
    passingType * 0.08 +
    width * 0.08 +
    tempo * 0.08 +
    dribbling * 0.05 +
    offsideTrap * 0.05 +
    fullbackOverlapsScore * 0.04

  return {
    attackingStyle,
    pressing,
    defensiveLine,
    offsideTrap,
    creativeFreedom,
    dribbling,
    passingType,
    width,
    tempo,
    fullbackOverlaps: fullbackOverlapsScore,
    overall,
  }
}

/**
 * How one side's plan matches up against the other's - a rock/paper/scissors
 * layer, but deliberately a weak one. It nudges the odds; it never decides
 * a match on its own, and no style is a hard counter to another.
 *
 * Returns a small signed value per side, later scaled by
 * maxTacticalInteractionEffect.
 */
export function calculateTacticalInteraction(attacking: TeamTactics, defending: TeamTactics): number {
  let edge = 0

  // Counter-attacking thrives on space behind a high line.
  if (attacking.attackingStyle === "counterAttack") {
    if (defending.defensiveLine === "high") edge += 0.6
    if (defending.defensiveLine === "low") edge -= 0.4
  }

  // Width stretches a narrow opponent; it struggles against a wide one.
  if (attacking.attackingStyle === "widePlay" || attacking.width === "wide") {
    if (defending.width === "narrow") edge += 0.4
    if (defending.width === "wide") edge -= 0.2
  }

  // Playing through the middle runs into a packed, narrow block.
  if (attacking.attackingStyle === "centralPlay" && defending.width === "narrow") edge -= 0.35

  // Going direct is the classic way to bypass a high press.
  if (attacking.attackingStyle === "directPlay" && defending.pressing === "high") edge += 0.5

  // Trying to play short through a high press is the risky answer to it.
  if (
    (attacking.attackingStyle === "shortPassing" || attacking.attackingStyle === "possession") &&
    defending.pressing === "high"
  ) {
    edge -= 0.45
  }

  // A low block concedes territory to a possession side but is hard to break down.
  if (attacking.attackingStyle === "possession" && defending.defensiveLine === "low") edge -= 0.3

  // A deep block gives a direct/long side aerial targets to aim at.
  if (attacking.attackingStyle === "directPlay" && defending.defensiveLine === "low") edge -= 0.25

  return Math.max(-1, Math.min(1, edge))
}
