import {
  buildPitchMarkings,
  cornerArcs,
  goalArea,
  goalLineX,
  goalMouth,
  penaltyArc,
  penaltyArea,
  penaltySpot,
  toNormalized,
  CIRCLE_RADIUS,
  CORNER_ARC_RADIUS,
  GOAL_AREA_DEPTH,
  GOAL_AREA_WIDTH,
  GOAL_WIDTH,
  HALF_LENGTH,
  HALF_WIDTH,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_WIDTH,
  PENALTY_SPOT_DISTANCE,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from "./pitch-geometry"

// These are the geometry gate for both renderers. They assert the pitch is
// a regulation pitch in world/meter space - deliberately NOT by sampling
// rendered pixels, which would only prove a screenshot matched itself.

describe("pitch dimensions", () => {
  it("is a regulation 105x68 pitch", () => {
    expect(PITCH_LENGTH).toBe(105)
    expect(PITCH_WIDTH).toBe(68)
    expect(HALF_LENGTH).toBe(52.5)
    expect(HALF_WIDTH).toBe(34)
  })

  it("derives box widths from the goal width, per the Laws", () => {
    expect(GOAL_WIDTH).toBeCloseTo(7.32, 5)
    expect(GOAL_AREA_WIDTH).toBeCloseTo(18.32, 5) // 7.32 + 2*5.5
    expect(PENALTY_AREA_WIDTH).toBeCloseTo(40.32, 5) // 7.32 + 2*16.5
  })
})

describe("halfway line and center", () => {
  it("puts the halfway line at exactly 50% of the pitch length", () => {
    const { halfwayLine } = buildPitchMarkings()
    expect(halfwayLine[0].x).toBe(0)
    expect(halfwayLine[1].x).toBe(0)
    // 0 in pitch space must be exactly halfway between the two goal lines.
    expect(halfwayLine[0].x - goalLineX(-1)).toBeCloseTo(goalLineX(1) - halfwayLine[0].x, 10)
    // ...and exactly 0.5 once normalized for a 2D renderer.
    expect(toNormalized(halfwayLine[0]).u).toBeCloseTo(0.5, 10)
  })

  it("spans the halfway line across the full pitch width", () => {
    const { halfwayLine } = buildPitchMarkings()
    expect(halfwayLine[0].y).toBeCloseTo(-HALF_WIDTH, 10)
    expect(halfwayLine[1].y).toBeCloseTo(HALF_WIDTH, 10)
  })

  it("centers the center circle exactly on the center spot", () => {
    const { centerCircle, centerSpot } = buildPitchMarkings()
    expect(centerCircle.cx).toBe(centerSpot.x)
    expect(centerCircle.cy).toBe(centerSpot.y)
    expect(centerSpot.x).toBe(0)
    expect(centerSpot.y).toBe(0)
    expect(centerCircle.radius).toBeCloseTo(9.15, 5)
  })

  it("puts the center spot at the exact geometric center", () => {
    const { centerSpot } = buildPitchMarkings()
    const n = toNormalized(centerSpot)
    expect(n.u).toBeCloseTo(0.5, 10)
    expect(n.v).toBeCloseTo(0.5, 10)
  })
})

describe("penalty and goal areas", () => {
  it("measures both penalty areas inward from their own goal line", () => {
    for (const end of [-1, 1] as const) {
      const box = penaltyArea(end)
      const nearEdge = box.cx + (end * box.width) / 2 // edge toward the goal line
      const farEdge = box.cx - (end * box.width) / 2 // edge toward midfield
      expect(nearEdge).toBeCloseTo(goalLineX(end), 10)
      expect(Math.abs(farEdge - goalLineX(end))).toBeCloseTo(PENALTY_AREA_DEPTH, 10)
    }
  })

  it("measures both goal areas inward from their own goal line", () => {
    for (const end of [-1, 1] as const) {
      const box = goalArea(end)
      const nearEdge = box.cx + (end * box.width) / 2
      expect(nearEdge).toBeCloseTo(goalLineX(end), 10)
      expect(box.width).toBeCloseTo(GOAL_AREA_DEPTH, 10)
      expect(box.height).toBeCloseTo(GOAL_AREA_WIDTH, 10)
    }
  })

  it("keeps penalty areas symmetric about both axes", () => {
    const [left, right] = [penaltyArea(-1), penaltyArea(1)]
    expect(left.cy).toBe(0)
    expect(right.cy).toBe(0)
    expect(left.cx).toBeCloseTo(-right.cx, 10) // mirrored across the halfway line
    expect(left.width).toBeCloseTo(right.width, 10)
    expect(left.height).toBeCloseTo(right.height, 10)
  })

  it("keeps goal areas symmetric about both axes", () => {
    const [left, right] = [goalArea(-1), goalArea(1)]
    expect(left.cy).toBe(0)
    expect(right.cy).toBe(0)
    expect(left.cx).toBeCloseTo(-right.cx, 10)
    expect(left.width).toBeCloseTo(right.width, 10)
    expect(left.height).toBeCloseTo(right.height, 10)
  })

  it("nests each goal area strictly inside its penalty area", () => {
    for (const end of [-1, 1] as const) {
      const outer = penaltyArea(end)
      const inner = goalArea(end)
      expect(inner.height).toBeLessThan(outer.height)
      expect(inner.width).toBeLessThan(outer.width)
      const outerFar = Math.abs(outer.cx - (end * outer.width) / 2 - goalLineX(end))
      const innerFar = Math.abs(inner.cx - (end * inner.width) / 2 - goalLineX(end))
      expect(innerFar).toBeLessThan(outerFar)
    }
  })

  it("keeps both boxes inside the pitch boundary", () => {
    for (const end of [-1, 1] as const) {
      const box = penaltyArea(end)
      expect(box.height / 2).toBeLessThan(HALF_WIDTH)
      expect(Math.abs(box.cx) + box.width / 2).toBeLessThanOrEqual(HALF_LENGTH + 1e-9)
    }
  })
})

describe("penalty marks and arcs", () => {
  it("places each penalty spot 11m from its own goal line, on the center axis", () => {
    for (const end of [-1, 1] as const) {
      const spot = penaltySpot(end)
      expect(Math.abs(spot.x - goalLineX(end))).toBeCloseTo(PENALTY_SPOT_DISTANCE, 10)
      expect(spot.y).toBe(0)
    }
  })

  it("mirrors the two penalty spots about the halfway line", () => {
    expect(penaltySpot(-1).x).toBeCloseTo(-penaltySpot(1).x, 10)
  })

  it("centers each penalty arc on its penalty spot at the 9.15m radius", () => {
    for (const end of [-1, 1] as const) {
      const arc = penaltyArc(end)
      const spot = penaltySpot(end)
      expect(arc.cx).toBeCloseTo(spot.x, 10)
      expect(arc.cy).toBeCloseTo(spot.y, 10)
      expect(arc.radius).toBeCloseTo(CIRCLE_RADIUS, 10)
    }
  })

  it("draws the arc only outside the penalty area", () => {
    for (const end of [-1, 1] as const) {
      const arc = penaltyArc(end)
      const boxEdgeX = goalLineX(end) - end * PENALTY_AREA_DEPTH
      // Both arc endpoints must sit exactly on the box edge; everything
      // between them bulges away from the goal (into midfield).
      for (const angle of [arc.startAngle, arc.endAngle]) {
        expect(arc.cx + Math.cos(angle) * arc.radius).toBeCloseTo(boxEdgeX, 8)
      }
      const midAngle = (arc.startAngle + arc.endAngle) / 2
      const midX = arc.cx + Math.cos(midAngle) * arc.radius
      // The apex is farther from the goal line than the box edge is.
      expect(Math.abs(midX - goalLineX(end))).toBeGreaterThan(PENALTY_AREA_DEPTH)
    }
  })
})

describe("goals and corners", () => {
  it("centers both goals on their goal line", () => {
    for (const end of [-1, 1] as const) {
      const { line } = goalMouth(end)
      expect(line[0].x).toBeCloseTo(goalLineX(end), 10)
      expect(line[1].x).toBeCloseTo(goalLineX(end), 10)
      expect(line[0].y).toBeCloseTo(-GOAL_WIDTH / 2, 10)
      expect(line[1].y).toBeCloseTo(GOAL_WIDTH / 2, 10)
      // Midpoint sits exactly on the center axis.
      expect((line[0].y + line[1].y) / 2).toBeCloseTo(0, 10)
    }
  })

  it("puts one 1m quarter-circle at each of the four corners", () => {
    const arcs = cornerArcs()
    expect(arcs).toHaveLength(4)
    for (const arc of arcs) {
      expect(arc.radius).toBeCloseTo(CORNER_ARC_RADIUS, 10)
      expect(Math.abs(arc.cx)).toBeCloseTo(HALF_LENGTH, 10)
      expect(Math.abs(arc.cy)).toBeCloseTo(HALF_WIDTH, 10)
      expect(arc.endAngle - arc.startAngle).toBeCloseTo(Math.PI / 2, 10)
    }
    // All four corners, each exactly once.
    const signature = arcs.map((a) => `${Math.sign(a.cx)},${Math.sign(a.cy)}`).sort()
    expect(signature).toEqual(["-1,-1", "-1,1", "1,-1", "1,1"])
  })

  it("opens every corner arc into the pitch, never outside it", () => {
    for (const arc of cornerArcs()) {
      const midAngle = (arc.startAngle + arc.endAngle) / 2
      const midX = arc.cx + Math.cos(midAngle) * arc.radius
      const midY = arc.cy + Math.sin(midAngle) * arc.radius
      // The arc's apex must be strictly inside the touchlines/goal lines.
      expect(Math.abs(midX)).toBeLessThan(HALF_LENGTH)
      expect(Math.abs(midY)).toBeLessThan(HALF_WIDTH)
    }
  })
})

describe("normalized mapping (2D renderers)", () => {
  it("maps the pitch corners to the unit square", () => {
    expect(toNormalized({ x: -HALF_LENGTH, y: HALF_WIDTH })).toEqual({ u: 0, v: 0 })
    expect(toNormalized({ x: HALF_LENGTH, y: -HALF_WIDTH })).toEqual({ u: 1, v: 1 })
  })

  it("preserves the 105:68 aspect ratio", () => {
    const a = toNormalized({ x: -HALF_LENGTH, y: 0 })
    const b = toNormalized({ x: HALF_LENGTH, y: 0 })
    const c = toNormalized({ x: 0, y: -HALF_WIDTH })
    const d = toNormalized({ x: 0, y: HALF_WIDTH })
    // Full span in both axes, so a renderer that multiplies by (w, h) with
    // w/h = 105/68 reproduces true proportions.
    expect(b.u - a.u).toBeCloseTo(1, 10)
    expect(c.v - d.v).toBeCloseTo(1, 10)
    expect(PITCH_LENGTH / PITCH_WIDTH).toBeCloseTo(105 / 68, 10)
  })

  it("keeps every derived marking inside the unit square", () => {
    const m = buildPitchMarkings()
    const points = [
      m.centerSpot,
      ...m.penaltySpots,
      ...m.penaltyAreas.flatMap((r) => [
        { x: r.cx - r.width / 2, y: r.cy - r.height / 2 },
        { x: r.cx + r.width / 2, y: r.cy + r.height / 2 },
      ]),
      ...m.goalAreas.flatMap((r) => [
        { x: r.cx - r.width / 2, y: r.cy - r.height / 2 },
        { x: r.cx + r.width / 2, y: r.cy + r.height / 2 },
      ]),
    ]
    for (const p of points) {
      const n = toNormalized(p)
      expect(n.u).toBeGreaterThanOrEqual(-1e-9)
      expect(n.u).toBeLessThanOrEqual(1 + 1e-9)
      expect(n.v).toBeGreaterThanOrEqual(-1e-9)
      expect(n.v).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})
