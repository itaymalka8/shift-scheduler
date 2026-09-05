import type { AttributeKey } from "@/lib/players/attributes"
import type { AttackingStyle, TeamTactics } from "@/lib/players/tactics"
import { ATTACKING_STYLE_ATTRIBUTES } from "@/lib/players/tactics"
import type { SnapshotPlayer } from "./snapshot"
import { calculateTacticalFit, scoreAgainstDemands, toFitRating, type FitRating } from "./tactical-fit"

export interface CoachAdvice {
  /** i18n key plus interpolation values - never a pre-built sentence. */
  key: string
  values?: Record<string, string>
}

export interface TacticalAssessment {
  fit: ReturnType<typeof calculateTacticalFit>
  rating: FitRating
  /** Why the current plan does or doesn't suit these players. */
  explanation: CoachAdvice
  /** Standing observations about the squad, independent of current tactics. */
  advice: CoachAdvice[]
  /** Attacking styles this squad is best suited to, best first. */
  bestStyles: { style: AttackingStyle; score: number; rating: FitRating }[]
}

const ATTACKERS = new Set(["ST", "RW", "LW", "CAM"])
const DEFENDERS = new Set(["CB", "RB", "LB"])
const MIDFIELD = new Set(["CM", "CDM", "CAM", "RM", "LM"])

function average(players: SnapshotPlayer[], keys: AttributeKey[]): number {
  const values = players.flatMap((p) => keys.map((k) => p.attributes[k]).filter((v): v is number => v != null))
  if (values.length === 0) return 50
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function group(players: SnapshotPlayer[], roles: Set<string>): SnapshotPlayer[] {
  const matched = players.filter((p) => roles.has(p.assignedRole ?? p.primaryPosition))
  return matched.length > 0 ? matched : players
}

/**
 * Reads a squad and reports, in plain language, what it's actually good at
 * and whether the manager's current plan suits it. Deliberately advisory:
 * it never changes a tactic on its own.
 */
export function assessTactics(starters: SnapshotPlayer[], tactics: TeamTactics): TacticalAssessment {
  const fit = calculateTacticalFit(starters, tactics)
  const rating = toFitRating(fit.overall)

  const outfield = starters.filter((p) => (p.assignedRole ?? p.primaryPosition) !== "GK")
  const attackers = group(outfield, ATTACKERS)
  const midfield = group(outfield, MIDFIELD)
  const defenders = group(starters, DEFENDERS)

  const attackerPace = average(attackers, ["pace", "acceleration"])
  const midfieldPassing = average(midfield, ["passing", "vision", "decisions"])
  const defenderPace = average(defenders, ["pace", "acceleration"])
  const aerial = average([...attackers, ...defenders], ["heading", "jumping", "aerialDuels"])
  const crossing = average(group(outfield, new Set(["RM", "LM", "RW", "LW", "RB", "LB"])), ["crossing"])
  const technique = average(outfield, ["technique", "ballControl"])
  const staminaWorkRate = average(outfield, ["stamina", "workRate"])

  // Which attacking style this squad is genuinely built for.
  const bestStyles = (Object.keys(ATTACKING_STYLE_ATTRIBUTES) as AttackingStyle[])
    .map((style) => {
      const score = scoreAgainstDemands(
        style === "widePlay" ? [...group(outfield, new Set(["RM", "LM", "RW", "LW", "RB", "LB"])), ...attackers] : outfield,
        ATTACKING_STYLE_ATTRIBUTES[style]
      )
      return { style, score, rating: toFitRating(score) }
    })
    .sort((a, b) => b.score - a.score)

  const explanation = explainCurrentPlan(tactics, rating, {
    attackerPace,
    midfieldPassing,
    aerial,
    crossing,
    technique,
    staminaWorkRate,
  })

  const advice: CoachAdvice[] = []
  if (bestStyles[0] && bestStyles[0].rating !== "weak") {
    advice.push({ key: `coach.suitedTo.${bestStyles[0].style}` })
  }
  if (aerial >= 72) advice.push({ key: "coach.strongInTheAir" })
  if (midfieldPassing >= 72) advice.push({ key: "coach.technicalMidfield" })
  if (attackerPace >= 74) advice.push({ key: "coach.paceUpFront" })
  // A high line with slow center backs is the classic self-inflicted wound.
  if (defenderPace <= 58 && tactics.defensiveLine === "high") advice.push({ key: "coach.slowDefendersHighLine" })
  if (staminaWorkRate <= 58 && tactics.pressing === "high") advice.push({ key: "coach.lowStaminaHighPress" })
  if (technique <= 58 && (tactics.attackingStyle === "possession" || tactics.attackingStyle === "shortPassing")) {
    advice.push({ key: "coach.lowTechniquePossession" })
  }
  if (tactics.offsideTrap && fit.offsideTrap < 60) advice.push({ key: "coach.poorlyDrilledTrap" })

  return { fit, rating, explanation, advice, bestStyles }
}

function explainCurrentPlan(
  tactics: TeamTactics,
  rating: FitRating,
  signals: {
    attackerPace: number
    midfieldPassing: number
    aerial: number
    crossing: number
    technique: number
    staminaWorkRate: number
  }
): CoachAdvice {
  const good = rating === "excellent" || rating === "good"

  switch (tactics.attackingStyle) {
    case "counterAttack":
      return good
        ? { key: "coach.explain.counterAttack.good" }
        : signals.attackerPace >= 70
          ? { key: "coach.explain.counterAttack.paceButNoSupply" }
          : { key: "coach.explain.counterAttack.weak" }
    case "widePlay":
      return good
        ? { key: "coach.explain.widePlay.good" }
        : signals.crossing >= 68 && signals.aerial < 62
          ? { key: "coach.explain.widePlay.crossesNoTargets" }
          : { key: "coach.explain.widePlay.weak" }
    case "directPlay":
      return good ? { key: "coach.explain.directPlay.good" } : { key: "coach.explain.directPlay.weak" }
    case "possession":
      return good ? { key: "coach.explain.possession.good" } : { key: "coach.explain.possession.weak" }
    case "centralPlay":
      return good ? { key: "coach.explain.centralPlay.good" } : { key: "coach.explain.centralPlay.weak" }
    case "shortPassing":
    default:
      return good ? { key: "coach.explain.shortPassing.good" } : { key: "coach.explain.shortPassing.weak" }
  }
}
