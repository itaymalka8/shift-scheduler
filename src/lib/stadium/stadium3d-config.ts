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

const STADIUM_3D_ANCHORS: Stadium3DAnchor[] = [
  { capacity: 10_000, standOffset: 6, standDepth: 14, standHeight: 9, rowCount: 10, cornerFill: 0.3, roofCoverage: 0 },
  { capacity: 20_000, standOffset: 7, standDepth: 20, standHeight: 13, rowCount: 16, cornerFill: 0.55, roofCoverage: 0.15 },
  { capacity: 30_000, standOffset: 8, standDepth: 28, standHeight: 18, rowCount: 22, cornerFill: 0.75, roofCoverage: 0.35 },
  { capacity: 45_000, standOffset: 9, standDepth: 36, standHeight: 24, rowCount: 28, cornerFill: 0.9, roofCoverage: 0.55 },
  { capacity: 60_000, standOffset: 10, standDepth: 44, standHeight: 32, rowCount: 34, cornerFill: 1, roofCoverage: 0.75 },
  { capacity: 80_000, standOffset: 11, standDepth: 54, standHeight: 42, rowCount: 42, cornerFill: 1, roofCoverage: 0.9 },
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
  tierCount: number
  cornerFill: number
  roofCoverage: number
  vipSections: number
  entranceCount: number
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
    tierCount: TIER_COUNT[tier],
    cornerFill,
    roofCoverage,
    vipSections: VIP_SECTIONS[tier],
    entranceCount: ENTRANCE_COUNT[tier],
    innerHalfLength: PITCH_LENGTH / 2 + standOffset,
    innerHalfWidth: PITCH_WIDTH / 2 + standOffset,
    outerHalfLength: PITCH_LENGTH / 2 + standOffset + standDepth,
    outerHalfWidth: PITCH_WIDTH / 2 + standOffset + standDepth,
  }
}

// --- Camera framing ---------------------------------------------------------

export interface CameraFraming {
  distance: number
  polarAngleDeg: number // from vertical (0 = straight down)
}

/**
 * Distance and tilt for a near-top-down view that keeps the whole structure
 * in frame regardless of size - a 70,000-seat stadium needs a visibly wider
 * framing than a 10,000-seat one, never the same zoom. polarAngle is fixed
 * (a slight tilt, not a straight-down map view) so height differences
 * between tiers actually read as height.
 */
export function computeCameraFraming(structure: Stadium3DStructure): CameraFraming {
  const outerRadius = Math.max(structure.outerHalfLength, structure.outerHalfWidth)
  // A perspective camera at this polar angle needs roughly this multiple of
  // the outer radius as distance to keep the full bowl (plus its height) in
  // frame with a standard ~50 deg vertical FOV - tuned empirically, not a
  // physically exact formula.
  const distance = outerRadius * 2.35 + structure.standHeight * 1.2
  return { distance, polarAngleDeg: 32 }
}
