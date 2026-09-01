/**
 * The single source of truth for football pitch geometry, in METERS.
 *
 * Every marking below is derived from the IFAB Laws of the Game, not eyeballed
 * and not placed in pixels. Both renderers consume this same module:
 *   - the 3D pitch texture (components/stadium3d/stadium-geometry.ts)
 *   - the 2D tactical event pitch (app/match/[fixtureId]/pitch-view.tsx)
 * so the two can never disagree about where the halfway line is.
 *
 * COORDINATE SYSTEM
 *   Origin (0, 0) is the center spot - the exact geometric center.
 *   x runs along the pitch LENGTH,  -52.5 (left goal) .. +52.5 (right goal)
 *   y runs along the pitch WIDTH,   -34   (bottom)    .. +34   (top)
 * Renderers map this to their own axes (Three.js uses x/z, canvas uses px),
 * but the numbers themselves are always meters in this system.
 */

export const PITCH_LENGTH = 105
export const PITCH_WIDTH = 68

export const HALF_LENGTH = PITCH_LENGTH / 2 // 52.5
export const HALF_WIDTH = PITCH_WIDTH / 2 // 34

/** Law 1: goals are 7.32m between the posts, 2.44m to the underside of the crossbar. */
export const GOAL_WIDTH = 7.32
export const GOAL_HEIGHT = 2.44
/** How far the net is pulled back behind the goal line. Not in the Laws (they only cap it); this is a visual depth. */
export const GOAL_DEPTH = 2

/** Law 1: goal area is 5.5m from each post, 5.5m deep. */
export const GOAL_AREA_DEPTH = 5.5
export const GOAL_AREA_WIDTH = GOAL_WIDTH + 2 * GOAL_AREA_DEPTH // 18.32

/** Law 1: penalty area is 16.5m from each post, 16.5m deep. */
export const PENALTY_AREA_DEPTH = 16.5
export const PENALTY_AREA_WIDTH = GOAL_WIDTH + 2 * PENALTY_AREA_DEPTH // 40.32

/** Law 1: penalty mark is 11m from the goal line, centered. */
export const PENALTY_SPOT_DISTANCE = 11
/** Law 1: center circle and the penalty arc share the same 9.15m radius. */
export const CIRCLE_RADIUS = 9.15
/** Law 1: quarter circle of 1m radius at each corner. */
export const CORNER_ARC_RADIUS = 1
/** Law 1: lines must not be more than 12cm wide. */
export const LINE_WIDTH = 0.12
/** Painted spots (center + penalty marks) - a visual radius, the Laws only say "a mark". */
export const SPOT_RADIUS = 0.15

export interface Point {
  x: number
  y: number
}

export interface Rect {
  /** Center of the rectangle. */
  cx: number
  cy: number
  width: number // along x
  height: number // along y
}

export interface Arc {
  cx: number
  cy: number
  radius: number
  /** Radians, measured from +x toward +y. */
  startAngle: number
  endAngle: number
}

/** Which end of the pitch a marking belongs to. -1 = left goal (x<0), +1 = right goal (x>0). */
export type PitchEnd = -1 | 1

/** The goal line's x for an end - i.e. the outer boundary the boxes measure from. */
export function goalLineX(end: PitchEnd): number {
  return end * HALF_LENGTH
}

/** Penalty spot for an end: 11m infield from that end's goal line, on the center axis. */
export function penaltySpot(end: PitchEnd): Point {
  return { x: goalLineX(end) - end * PENALTY_SPOT_DISTANCE, y: 0 }
}

/** Penalty area rectangle for an end, measured inward from that end's goal line. */
export function penaltyArea(end: PitchEnd): Rect {
  return {
    cx: goalLineX(end) - (end * PENALTY_AREA_DEPTH) / 2,
    cy: 0,
    width: PENALTY_AREA_DEPTH,
    height: PENALTY_AREA_WIDTH,
  }
}

/** Goal (six-yard) area rectangle for an end, measured inward from that end's goal line. */
export function goalArea(end: PitchEnd): Rect {
  return {
    cx: goalLineX(end) - (end * GOAL_AREA_DEPTH) / 2,
    cy: 0,
    width: GOAL_AREA_DEPTH,
    height: GOAL_AREA_WIDTH,
  }
}

/** The goal mouth itself, centered on the goal line. */
export function goalMouth(end: PitchEnd): { line: [Point, Point]; depth: number; height: number } {
  const x = goalLineX(end)
  return {
    line: [
      { x, y: -GOAL_WIDTH / 2 },
      { x, y: GOAL_WIDTH / 2 },
    ],
    depth: GOAL_DEPTH,
    height: GOAL_HEIGHT,
  }
}

/**
 * The penalty arc ("the D") for an end: the part of the 9.15m circle around
 * the penalty spot that falls OUTSIDE the penalty area. Returned as the
 * angular span to draw, in this module's coordinate system.
 */
export function penaltyArc(end: PitchEnd): Arc {
  const spot = penaltySpot(end)
  const boxEdgeX = goalLineX(end) - end * PENALTY_AREA_DEPTH
  // Horizontal distance from the spot out to the box edge; the arc is only
  // drawn beyond that, so the half-angle comes from acos(adjacent/radius).
  const dx = Math.abs(boxEdgeX - spot.x) // 16.5 - 11 = 5.5
  const halfAngle = Math.acos(dx / CIRCLE_RADIUS)
  // Facing infield: the left goal's arc opens toward +x (angle 0), the right
  // goal's toward -x (angle PI).
  const facing = end === -1 ? 0 : Math.PI
  return { cx: spot.x, cy: spot.y, radius: CIRCLE_RADIUS, startAngle: facing - halfAngle, endAngle: facing + halfAngle }
}

/** The four corner quarter-circles, each opening into the pitch. */
export function cornerArcs(): Arc[] {
  const corners: { x: number; y: number; start: number }[] = [
    { x: -HALF_LENGTH, y: -HALF_WIDTH, start: 0 }, // opens toward +x/+y
    { x: HALF_LENGTH, y: -HALF_WIDTH, start: Math.PI / 2 },
    { x: HALF_LENGTH, y: HALF_WIDTH, start: Math.PI },
    { x: -HALF_LENGTH, y: HALF_WIDTH, start: (3 * Math.PI) / 2 },
  ]
  return corners.map((c) => ({
    cx: c.x,
    cy: c.y,
    radius: CORNER_ARC_RADIUS,
    startAngle: c.start,
    endAngle: c.start + Math.PI / 2,
  }))
}

/** Everything a renderer needs to draw a regulation pitch, in meters. */
export interface PitchMarkings {
  /** Touchline/goal-line rectangle - the pitch boundary itself. */
  boundary: Rect
  /** The halfway line, as two endpoints. */
  halfwayLine: [Point, Point]
  centerCircle: { cx: number; cy: number; radius: number }
  centerSpot: Point
  penaltyAreas: Rect[]
  goalAreas: Rect[]
  penaltySpots: Point[]
  penaltyArcs: Arc[]
  cornerArcs: Arc[]
  goals: { line: [Point, Point]; depth: number; height: number }[]
}

const ENDS: PitchEnd[] = [-1, 1]

/**
 * The complete marking set, derived - never hand-placed. A renderer's only
 * job is to map these meters onto its own axes; if the camera or the canvas
 * size changes, this output does not.
 */
export function buildPitchMarkings(): PitchMarkings {
  return {
    boundary: { cx: 0, cy: 0, width: PITCH_LENGTH, height: PITCH_WIDTH },
    halfwayLine: [
      { x: 0, y: -HALF_WIDTH },
      { x: 0, y: HALF_WIDTH },
    ],
    centerCircle: { cx: 0, cy: 0, radius: CIRCLE_RADIUS },
    centerSpot: { x: 0, y: 0 },
    penaltyAreas: ENDS.map(penaltyArea),
    goalAreas: ENDS.map(goalArea),
    penaltySpots: ENDS.map(penaltySpot),
    penaltyArcs: ENDS.map(penaltyArc),
    cornerArcs: cornerArcs(),
    goals: ENDS.map(goalMouth),
  }
}

/**
 * Maps a pitch-space point (meters, origin at center) into a normalized
 * 0..1 pair, x rightward and y downward - the form a 2D canvas/SVG wants.
 * Renderers scale this by their own pixel size; they never re-derive
 * positions themselves.
 */
export function toNormalized(p: Point): { u: number; v: number } {
  return { u: (p.x + HALF_LENGTH) / PITCH_LENGTH, v: (HALF_WIDTH - p.y) / PITCH_WIDTH }
}
