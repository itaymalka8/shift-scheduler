import {
  Goal,
  Target,
  Hand,
  Flag,
  Zap,
  ShieldAlert,
  Square,
  Ambulance,
  ArrowLeftRight,
  Footprints,
  AlertTriangle,
  CircleDot,
  type LucideIcon,
} from "lucide-react"
import type { TranslationKey } from "@/lib/i18n/translations"

export interface MatchEventView {
  id: string
  minute: number
  type: string
  teamId: string
  playerId: string | null
  playerName: string | null
  secondaryPlayerId: string | null
  secondaryPlayerName: string | null
  outcome: string | null
  context: unknown
}

/** Icon per event type - see the Match Engine audit for the exact set of types the engine actually emits. */
export function iconForEvent(type: string): LucideIcon {
  switch (type) {
    case "goal":
      return Goal
    case "penalty":
      return CircleDot
    case "shot":
      return Target
    case "save":
      return Hand
    case "corner":
      return Flag
    case "freeKick":
      return Zap
    case "foul":
      return ShieldAlert
    case "yellowCard":
    case "redCard":
      return Square
    case "injury":
      return Ambulance
    case "substitution":
      return ArrowLeftRight
    case "tackle":
      return Footprints
    case "offside":
      return AlertTriangle
    default:
      return CircleDot
  }
}

/** Icon tint - a card's own color is the one place this must be exact, not just thematic. */
export function colorForEvent(type: string, outcome: string | null): string {
  switch (type) {
    case "goal":
      return "text-emerald-500"
    case "penalty":
      return outcome === "scored" ? "text-emerald-500" : "text-muted-foreground"
    case "yellowCard":
      return "text-amber-500"
    case "redCard":
      return "text-red-600"
    case "save":
      return "text-sky-500"
    case "injury":
      return "text-red-500"
    default:
      return "text-muted-foreground"
  }
}

/** Translation key + interpolation vars for one event's feed/celebration description. */
export function describeEvent(
  event: MatchEventView,
  teamName: (teamId: string) => string
): { key: TranslationKey; vars: Record<string, string> } {
  const player = event.playerName ?? ""
  const secondary = event.secondaryPlayerName ?? ""
  const team = teamName(event.teamId)

  switch (event.type) {
    case "goal":
      return { key: "match.event.goal", vars: { player } }
    case "penalty":
      return {
        key: event.outcome === "scored" ? "match.event.penaltyScored" : "match.event.penaltyMissed",
        vars: { player },
      }
    case "shot":
      return { key: "match.event.shot", vars: { player } }
    case "save":
      // A save's playerName is the goalkeeper (see live-view.ts on why a
      // save's teamId is the defending side) - exactly who this event
      // should credit.
      return { key: "match.event.save", vars: { player } }
    case "corner":
      return { key: "match.event.corner", vars: { team } }
    case "freeKick":
      return { key: "match.event.freeKick", vars: { team } }
    case "foul":
      return { key: "match.event.foul", vars: { player } }
    case "yellowCard":
      return { key: "match.event.yellowCard", vars: { player } }
    case "redCard":
      return { key: "match.event.redCard", vars: { player } }
    case "injury":
      return { key: "match.event.injury", vars: { player } }
    case "substitution":
      return { key: "match.event.substitution", vars: { player, secondary } }
    case "tackle":
      return { key: "match.event.tackle", vars: { player } }
    case "offside":
      return { key: "match.event.offside", vars: { team } }
    default:
      return { key: "match.event.shot", vars: { player } }
  }
}

/** A goal from open play, or a converted penalty - kept in sync with live-view.ts's own definition. */
export function isGoalEvent(event: Pick<MatchEventView, "type" | "outcome">): boolean {
  return event.type === "goal" || (event.type === "penalty" && event.outcome === "scored")
}

// --- Pitch zone (deliberately approximate) ----------------------------------
// MatchEvent carries no coordinates - the engine only ever resolves an
// event against a chance/action *type*, never a location. Rather than
// invent precision the data doesn't have, every event maps to one of a
// handful of coarse pitch zones (which third, which side), picked from the
// event's type and which team it belongs to. A small, stable per-event
// jitter (derived from the event id, not Math.random()) keeps repeated
// events from stacking exactly on top of one another without pretending to
// know anything more specific than "roughly here".
export interface PitchPoint {
  xPct: number
  yPct: number
}

function hashJitter(id: string, spread: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return ((h % 1000) / 1000 - 0.5) * 2 * spread
}

/**
 * Pitch orientation: home attacks toward y=0 (top, away's goal), away
 * attacks toward y=100 (bottom, home's goal) - a fixed convention for this
 * view only, independent of the engine's own per-team formation coordinates.
 */
export function zoneForEvent(event: MatchEventView, homeTeamId: string): PitchPoint {
  const isHomeTeam = event.teamId === homeTeamId
  const jitterX = hashJitter(event.id, 18)
  const jitterY = hashJitter(event.id + "y", 6)
  const clampPct = (v: number) => Math.max(4, Math.min(96, v))

  // Attacking zone for `event.teamId` (used by goal/shot/penalty/offside/
  // corner/freeKick, all recorded against the attacking side).
  const attackY = isHomeTeam ? 14 : 86
  // Own defensive/build-up zone for `event.teamId` (fouls, tackles,
  // injuries - recorded against whichever side the action belongs to,
  // without attack/defense framing).
  const ownHalfY = isHomeTeam ? 66 : 34

  switch (event.type) {
    case "goal":
    case "shot":
    case "offside":
      return { xPct: clampPct(50 + jitterX), yPct: clampPct(attackY + jitterY) }
    case "penalty":
      return { xPct: 50, yPct: isHomeTeam ? 10 : 90 }
    case "corner": {
      const side = hashJitter(event.id, 1) > 0 ? 92 : 8
      return { xPct: side, yPct: isHomeTeam ? 6 : 94 }
    }
    case "freeKick":
      return { xPct: clampPct(50 + jitterX * 1.4), yPct: clampPct((isHomeTeam ? 32 : 68) + jitterY) }
    case "save":
      // A save's teamId is the goalkeeper's (defending) side - the action
      // visually happens at THAT team's own goal, no flip needed here
      // (unlike the stats attribution in live-view.ts).
      return { xPct: clampPct(50 + jitterX), yPct: isHomeTeam ? 8 : 92 }
    case "foul":
    case "tackle":
      return { xPct: clampPct(50 + jitterX), yPct: clampPct(ownHalfY + jitterY) }
    case "yellowCard":
    case "redCard":
      return { xPct: clampPct(50 + jitterX), yPct: clampPct(ownHalfY + jitterY) }
    case "injury":
      return { xPct: clampPct(50 + jitterX), yPct: clampPct(50 + jitterY) }
    case "substitution":
      // Touchline marker on that team's own side, not mid-pitch.
      return { xPct: isHomeTeam ? 92 : 8, yPct: isHomeTeam ? 78 : 22 }
    default:
      return { xPct: 50, yPct: 50 }
  }
}

/**
 * How loudly an event should be told. A live feed is commentary, not a log:
 * a goal has to hit differently from a throw-in, or ninety rows of identical
 * type read as machine output.
 */
export type EventEmphasis = "headline" | "high" | "medium" | "low"

export function emphasisForEvent(type: string, outcome: string | null): EventEmphasis {
  switch (type) {
    case "goal":
      return "headline"
    case "penalty":
      // An awarded or converted penalty is a headline moment either way; a
      // missed one is still one of the loudest things in a match.
      return outcome === "scored" ? "headline" : "high"
    case "redCard":
      return "high"
    case "yellowCard":
    case "substitution":
    case "injury":
      return "medium"
    default:
      return "low"
  }
}
