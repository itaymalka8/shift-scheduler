// Display-only, like STADIUM_VISUAL_TIERS in config.ts - nothing here feeds
// capacity/cost/economy math. This is the single source of truth for how
// Stadium3D's structure scales with capacity: every number the 3D geometry
// needs lives here, not scattered across component code, so rebalancing the
// look of a size tier is a config edit.
//
// The pitch itself never changes size (see PITCH_LENGTH/PITCH_WIDTH below) -
// only the stand ring around it does. Capacity affects the stand through
// five structural knobs (standOffset, standDepth, standHeight, rowCount,
// cornerFill/roofCoverage) plus three step-changed counts (tierCount,
// vipSections, entranceCount) that only change at named tier boundaries,
// because you can't have "1.5 tiers."

export type Stadium3DTierId = "compact" | "small" | "medium" | "large" | "major" | "elite"

export interface Stadium3DTier {
  id: Stadium3DTierId
  maxCapacity: number
  labelKey: string
}

// The six capacity bands the brief calls out. maxCapacity is inclusive; the
// last tier has no ceiling.
export const STADIUM_3D_TIERS: Stadium3DTier[] = [
  { id: "compact", maxCapacity: 12_000, labelKey: "stadium3d.tier.compact" },
  { id: "small", maxCapacity: 20_000, labelKey: "stadium3d.tier.small" },
  { id: "medium", maxCapacity: 35_000, labelKey: "stadium3d.tier.medium" },
  { id: "large", maxCapacity: 50_000, labelKey: "stadium3d.tier.large" },
  { id: "major", maxCapacity: 70_000, labelKey: "stadium3d.tier.major" },
  { id: "elite", maxCapacity: Infinity, labelKey: "stadium3d.tier.elite" },
]

export function getStadium3DTier(capacity: number): Stadium3DTier {
  return STADIUM_3D_TIERS.find((t) => capacity <= t.maxCapacity) ?? STADIUM_3D_TIERS[STADIUM_3D_TIERS.length - 1]
}

// --- The fixed pitch -----------------------------------------------------
// Real full-size pitch proportions (meters) - identical for every stadium,
// at every capacity. Only the ring around it changes.
export const PITCH_LENGTH = 105
export const PITCH_WIDTH = 68

// --- Structural anchors ----------------------------------------------------
// One row per tier's reference capacity. Continuous fields (offset/depth/
// height/rowCount/cornerFill/roofCoverage) are piecewise-linearly
// interpolated between these capacities and clamped past the ends - so a
// 25,000-seat stadium sits smoothly between the medium and large anchors
// instead of snapping. Step fields (tierCount/vipSections/entranceCount)
// come from whichever tier bucket the capacity actually falls into (see
// STADIUM_3D_TIERS above), not from interpolation.
interface Stadium3DAnchor {
  capacity: number
  standOffset: number // meters, pitch edge to the first row
  standDepth: number // meters, first row to the back of the stand
  standHeight: number // meters, pitch level to the top of the stand
  rowCount: number
  cornerFill: number // 0 = open/sharp corners with a visible gap, 1 = a continuous oval bowl
  roofCoverage: number // 0-1, fraction of the ring's circumference roofed
}

// rowCount is sized so the geometry's own estimated seat count (see
// computeSeatingDebugInfo) actually lands near the tier's real capacity at
// a realistic ~0.55m seat pitch - not picked for looks and left to imply
// a much smaller ground than the capacity number claims.
const STADIUM_3D_ANCHORS: Stadium3DAnchor[] = [
  { capacity: 10_000, standOffset: 4, standDepth: 15, standHeight: 10, rowCount: 16, cornerFill: 0.3, roofCoverage: 0 },
  { capacity: 20_000, standOffset: 4.5, standDepth: 22, standHeight: 15, rowCount: 28, cornerFill: 0.55, roofCoverage: 0.15 },
  { capacity: 30_000, standOffset: 5, standDepth: 32, standHeight: 20, rowCount: 40, cornerFill: 0.75, roofCoverage: 0.35 },
  { capacity: 45_000, standOffset: 6, standDepth: 38, standHeight: 26, rowCount: 48, cornerFill: 0.9, roofCoverage: 0.55 },
  { capacity: 60_000, standOffset: 7, standDepth: 46, standHeight: 34, rowCount: 54, cornerFill: 1, roofCoverage: 0.75 },
  { capacity: 80_000, standOffset: 8, standDepth: 56, standHeight: 44, rowCount: 60, cornerFill: 1, roofCoverage: 0.9 },
]

// Step counts per tier - deliberately not interpolated (see file header).
const TIER_COUNT: Record<Stadium3DTierId, number> = {
  compact: 1,
  small: 1,
  medium: 1,
  large: 2,
  major: 2,
  elite: 3,
}
const VIP_SECTIONS: Record<Stadium3DTierId, number> = {
  compact: 1,
  small: 1,
  medium: 2,
  large: 2,
  major: 3,
  elite: 4,
}
const ENTRANCE_COUNT: Record<Stadium3DTierId, number> = {
  compact: 6,
  small: 8,
  medium: 10,
  large: 12,
  major: 14,
  elite: 16,
}

// Seating is laid out per SIDE, not as one uniform ring divided evenly by
// angle - a real ground has more, narrower sections along its two long
// (touchline) sides than along its two short (behind-goal) sides, plus a
// few dedicated corner sections so the corners read as genuinely filled
// rather than as a gap between two side's sections. Total displayed
// sectionCount is derived from these three counts (see computeStadium3DStructure).
const LONG_SIDE_SECTIONS: Record<Stadium3DTierId, number> = {
  compact: 6,
  small: 8,
  medium: 10,
  large: 11,
  major: 12,
  elite: 14,
}
const SHORT_SIDE_SECTIONS: Record<Stadium3DTierId, number> = {
  compact: 4,
  small: 5,
  medium: 6,
  large: 7,
  major: 7,
  elite: 8,
}
const CORNER_SECTIONS: Record<Stadium3DTierId, number> = {
  compact: 1,
  small: 1,
  medium: 2,
  large: 2,
  major: 2,
  elite: 3,
}

// Geometric row cap - rowCount keeps growing for display/stat purposes, but
// building one instanced step per row stops paying off visually past this
// many (they'd be a few centimeters tall each) and starts costing real
// instance count for nothing, so the geometry caps here while rowCount
// (the number shown as a stat) does not.
const MAX_VISUAL_ROWS = 60

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Piecewise-linear interpolation across STADIUM_3D_ANCHORS, clamped at both ends. */
function interpolateAnchors(capacity: number): Omit<Stadium3DAnchor, "capacity"> {
  const anchors = STADIUM_3D_ANCHORS
  if (capacity <= anchors[0].capacity) return anchors[0]
  if (capacity >= anchors[anchors.length - 1].capacity) return anchors[anchors.length - 1]

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]
    const b = anchors[i + 1]
    if (capacity >= a.capacity && capacity <= b.capacity) {
      const t = (capacity - a.capacity) / (b.capacity - a.capacity)
      return {
        standOffset: lerp(a.standOffset, b.standOffset, t),
        standDepth: lerp(a.standDepth, b.standDepth, t),
        standHeight: lerp(a.standHeight, b.standHeight, t),
        rowCount: Math.round(lerp(a.rowCount, b.rowCount, t)),
        cornerFill: lerp(a.cornerFill, b.cornerFill, t),
        roofCoverage: lerp(a.roofCoverage, b.roofCoverage, t),
      }
    }
  }
  return anchors[anchors.length - 1]
}

export interface Stadium3DStructure {
  tier: Stadium3DTierId
  standOffset: number
  standDepth: number
  standHeight: number
  rowCount: number
  visualRowCount: number // rowCount capped for geometry - see MAX_VISUAL_ROWS
  tierCount: number
  cornerFill: number
  roofCoverage: number
  vipSections: number
  entranceCount: number
  longSideSections: number // sections per long (touchline) side
  shortSideSections: number // sections per short (behind-goal) side
  cornerSections: number // sections per corner, x4 corners
  sectionCount: number // 2*longSideSections + 2*shortSideSections + 4*cornerSections
  innerHalfLength: number // PITCH_LENGTH/2 + standOffset
  innerHalfWidth: number // PITCH_WIDTH/2 + standOffset
  outerHalfLength: number // innerHalfLength + standDepth
  outerHalfWidth: number // innerHalfWidth + standDepth
}

/** The one function every Stadium3D piece (geometry, camera framing) reads structure from. */
export function computeStadium3DStructure(capacity: number): Stadium3DStructure {
  const tier = getStadium3DTier(capacity).id
  const { standOffset, standDepth, standHeight, rowCount, cornerFill, roofCoverage } = interpolateAnchors(capacity)

  return {
    tier,
    standOffset,
    standDepth,
    standHeight,
    rowCount,
    visualRowCount: Math.min(rowCount, MAX_VISUAL_ROWS),
    tierCount: TIER_COUNT[tier],
    cornerFill,
    roofCoverage,
    vipSections: VIP_SECTIONS[tier],
    entranceCount: ENTRANCE_COUNT[tier],
    longSideSections: LONG_SIDE_SECTIONS[tier],
    shortSideSections: SHORT_SIDE_SECTIONS[tier],
    cornerSections: CORNER_SECTIONS[tier],
    sectionCount: 2 * LONG_SIDE_SECTIONS[tier] + 2 * SHORT_SIDE_SECTIONS[tier] + 4 * CORNER_SECTIONS[tier],
    innerHalfLength: PITCH_LENGTH / 2 + standOffset,
    innerHalfWidth: PITCH_WIDTH / 2 + standOffset,
    outerHalfLength: PITCH_LENGTH / 2 + standOffset + standDepth,
    outerHalfWidth: PITCH_WIDTH / 2 + standOffset + standDepth,
  }
}

// --- Camera framing ---------------------------------------------------------

// The vertical FOV Stadium3D's camera actually uses - kept in sync here
// because the framing math below needs the real angle, not a guess at it.
export const CAMERA_FOV_DEG = 40
// A small tilt off straight-down, so raked rows and tier steps read as
// height rather than flattening into a pure map view.
export const CAMERA_POLAR_ANGLE_DEG = 42
// Corner-on azimuth (45°) - the classic broadcast-graphic stadium angle,
// showing all four sides at once instead of staring straight down one side.
export const CAMERA_AZIMUTH_DEG = 45

// How much of the frame the stadium should actually occupy at each capacity
// - this is the deliberate opposite of "auto-fit everything to look the
// same size": a bigger stadium is framed tighter (fills more of the shot),
// a smaller one is framed looser (more empty space around it), so the
// capacity difference is felt in the shot, not just in the geometry.
const FILL_ANCHORS: { capacity: number; fill: number }[] = [
  { capacity: 10_000, fill: 0.55 },
  { capacity: 20_000, fill: 0.7 },
  { capacity: 30_000, fill: 0.82 },
  { capacity: 45_000, fill: 0.92 },
  { capacity: 60_000, fill: 0.98 },
  { capacity: 80_000, fill: 1.05 },
]

function interpolateFillFraction(capacity: number): number {
  if (capacity <= FILL_ANCHORS[0].capacity) return FILL_ANCHORS[0].fill
  if (capacity >= FILL_ANCHORS[FILL_ANCHORS.length - 1].capacity) return FILL_ANCHORS[FILL_ANCHORS.length - 1].fill
  for (let i = 0; i < FILL_ANCHORS.length - 1; i++) {
    const a = FILL_ANCHORS[i]
    const b = FILL_ANCHORS[i + 1]
    if (capacity >= a.capacity && capacity <= b.capacity) {
      const t = (capacity - a.capacity) / (b.capacity - a.capacity)
      return lerp(a.fill, b.fill, t)
    }
  }
  return FILL_ANCHORS[FILL_ANCHORS.length - 1].fill
}

export interface CameraFraming {
  distance: number
  polarAngleDeg: number // from vertical (0 = straight down)
}

/**
 * Distance and tilt for a near-top-down view. Deliberately NOT a "keep
 * everything the same apparent size" auto-fit - distance is derived so the
 * stadium's outer radius fills a capacity-dependent fraction of the frame
 * (see FILL_ANCHORS): apparentSize = 2*radius/distance must equal
 * fill*2*tan(fov/2), so distance = radius / (fill*tan(fov/2)). Because fill
 * grows faster than radius does across the capacity range, a 70,000-seat
 * stadium ends up both physically bigger AND framed tighter than a
 * 10,000-seat one - the two effects compound instead of one masking the
 * other.
 */
export function computeCameraFraming(structure: Stadium3DStructure, capacity: number): CameraFraming {
  const outerRadius = Math.max(structure.outerHalfLength, structure.outerHalfWidth)
  const fill = interpolateFillFraction(capacity)
  const halfFovRad = (CAMERA_FOV_DEG / 2) * (Math.PI / 180)
  const distance = outerRadius / (fill * Math.tan(halfFovRad)) + structure.standHeight * 0.6
  return { distance, polarAngleDeg: CAMERA_POLAR_ANGLE_DEG }
}
