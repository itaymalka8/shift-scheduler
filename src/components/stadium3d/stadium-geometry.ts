import * as THREE from "three"
import { type Stadium3DStructure } from "@/lib/stadium/stadium3d-config"
import {
  buildPitchMarkings,
  HALF_LENGTH,
  HALF_WIDTH,
  LINE_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
  SPOT_RADIUS,
} from "@/lib/stadium/pitch-geometry"

const ANGULAR_STEPS = 96

// --- Pitch surface ----------------------------------------------------------
const GRASS_BASE = "#15542A"
const GRASS_STRIPE_LIGHT = "rgba(210,255,220,0.045)"
const GRASS_STRIPE_DARK = "rgba(0,26,9,0.10)"
const PITCH_LINE_COLOR = "#E6F0E8"

/** Deterministic pseudo-random in [0,1) - a pure hash, so a texture built twice is identical. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

// GoalX brand tokens only, per the brief. Seating uses a deliberately
// PLANNED pattern, not a per-section random cycle: most of the bowl is deep
// navy-purple, the four corners are a white accent block (a real "wing"
// marking, like many real grounds), and VIP sections get their own distinct
// mid-purple. Concrete/roof/metal stay neutral so those materials read as
// structure, not brand color.
const SEAT_PRIMARY = "#241B4D"
const SEAT_CORNER_ACCENT = "#FFFFFF"
const VIP_COLOR = "#6C4FD9"
const VOMITORY_COLOR = "#181430"
// Warm-neutral (not blue-leaning) so it stays visually distinct from the
// cool/blue-family seat colors - a cool-gray concrete let light seat blocks
// blend into it at a distance, reading as bare gaps rather than blocks.
const CONCRETE_COLOR = "#A6A199"
const CONCRETE_DARK = "#878177"
// A distinct metallic tone (handrails/dividers, roof beams, light fixture
// bodies) - visually separate from both the warm concrete and the cool
// seat colors, so those elements read as "metal structure" at a glance.
const METAL_COLOR = "#767C87"

/** How much of each corner's bounding square the rounding circle eats into - grows with cornerFill (1 = large radius, closer to a continuous oval; 0 = tight, small radius). */
function cornerRadiusFor(halfLength: number, halfWidth: number, cornerFill: number): number {
  return Math.min(halfLength, halfWidth) * (0.12 + 0.3 * cornerFill)
}

/**
 * A point on the stand's actual boundary at a given angle: a true rounded
 * RECTANGLE (straight run along each side, quarter-circle at each corner) -
 * not a smooth superellipse, which has no genuinely straight segment
 * anywhere and reads as a diamond/oval, not "four stands with corners."
 * Found via ray-from-origin intersection against the two straight walls and
 * the two corner circles, taking whichever is actually inside its own valid
 * span.
 */
export function boundaryPoint(angle: number, halfLength: number, halfWidth: number, cornerFill: number): [number, number] {
  const r = cornerRadiusFor(halfLength, halfWidth, cornerFill)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const ac = Math.abs(c)
  const as_ = Math.abs(s)

  if (ac > 1e-9) {
    const t = halfLength / ac
    const zCandidate = s * t
    if (Math.abs(zCandidate) <= halfWidth - r + 1e-6) return [Math.sign(c) * halfLength, zCandidate]
  }
  if (as_ > 1e-9) {
    const t = halfWidth / as_
    const xCandidate = c * t
    if (Math.abs(xCandidate) <= halfLength - r + 1e-6) return [xCandidate, Math.sign(s) * halfWidth]
  }

  const cx = (Math.sign(c) || 1) * (halfLength - r)
  const cz = (Math.sign(s) || 1) * (halfWidth - r)
  const b = -2 * (c * cx + s * cz)
  const cCoef = cx * cx + cz * cz - r * r
  const disc = Math.max(0, b * b - 4 * cCoef)
  const t = (-b + Math.sqrt(disc)) / 2
  return [c * t, s * t]
}

/** The pitch's own sharp-rectangle boundary - used only for the concourse floor loft, which spans from this real edge out to the stand's rounded inner edge. */
function pitchBoundaryPoint(angle: number): [number, number] {
  const halfLength = PITCH_LENGTH / 2
  const halfWidth = PITCH_WIDTH / 2
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  if (Math.abs(c) < 1e-9) return [0, Math.sign(s) * halfWidth]
  if (Math.abs(s) < 1e-9) return [Math.sign(c) * halfLength, 0]
  const zAtX = s * (halfLength / Math.abs(c))
  if (Math.abs(zAtX) <= halfWidth) return [Math.sign(c) * halfLength, zAtX]
  const xAtZ = c * (halfWidth / Math.abs(s))
  return [xAtZ, Math.sign(s) * halfWidth]
}

/** 0 along the middle of a straight side, 1 at a true corner of the bounding rectangle - used to taper the corner stand height/depth down as cornerFill drops. */
export function cornerCloseness(x: number, z: number, halfLength: number, halfWidth: number): number {
  return Math.min(1, Math.abs(x / halfLength) * Math.abs(z / halfWidth))
}

/**
 * The stand's true outer-rim point at a given angle - the same corner-taper
 * math buildLoftedRing uses at its far (t=1) edge, factored out so anything
 * that needs to sit flush against the actual outer edge (facade, roof,
 * vomitories) agrees with where the ramp really ends.
 */
function outerEdgeAt(angle: number, structure: Stadium3DStructure): { x: number; z: number; height: number } {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, cornerFill } = structure
  const [ix, iz] = boundaryPoint(angle, innerHalfLength, innerHalfWidth, cornerFill)
  const closeness = cornerCloseness(ix, iz, innerHalfLength, innerHalfWidth)
  const localScale = 1 - closeness * (1 - cornerFill) * 0.85
  const len = Math.hypot(ix, iz) || 1
  const dirX = ix / len
  const dirZ = iz / len
  const depthHere = standDepth * localScale
  return { x: ix + dirX * depthHere, z: iz + dirZ * depthHere, height: standHeight * localScale }
}

/**
 * One continuous lofted ramp surface, plain concrete-colored - the stand's
 * structural shell: it's what shows through in the thin aisle gaps between
 * seating blocks and at vomitory openings, and gives the whole ring a solid
 * base even where a block's corner rounds off. Not the seats themselves -
 * those are separate instanced blocks on top of this shell.
 */
function buildLoftedRing(
  innerHalfLength: number,
  innerHalfWidth: number,
  depth: number,
  height: number,
  cornerFill: number,
  startFrac: number,
  endFrac: number
): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    const [ix, iz] = boundaryPoint(angle, innerHalfLength, innerHalfWidth, cornerFill)
    const closeness = cornerCloseness(ix, iz, innerHalfLength, innerHalfWidth)
    const localScale = 1 - closeness * (1 - cornerFill) * 0.85

    const depthHere = depth * localScale
    const heightHere = height * localScale
    const len = Math.hypot(ix, iz) || 1
    const dirX = ix / len
    const dirZ = iz / len

    const bx0 = ix + dirX * depthHere * startFrac
    const bz0 = iz + dirZ * depthHere * startFrac
    const by0 = heightHere * startFrac

    const bx1 = ix + dirX * depthHere * endFrac
    const bz1 = iz + dirZ * depthHere * endFrac
    const by1 = heightHere * endFrac

    positions.push(bx0, by0, bz0, bx1, by1, bz1)
    uvs.push(i / ANGULAR_STEPS, 0, i / ANGULAR_STEPS, 1)
  }

  for (let i = 0; i < ANGULAR_STEPS; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, c, b, c, d, b)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** The full stand shell (one per tier), concrete-colored - shows through the aisle gaps between seating blocks. */
export function buildStandShellGeometry(structure: Stadium3DStructure, tier: number): THREE.BufferGeometry {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, tierCount, cornerFill } = structure
  const concourseGap = tierCount > 1 ? 0.1 : 0
  const tierSpan = 1 / tierCount
  const start = tier * tierSpan
  const end = start + tierSpan * (1 - concourseGap)
  return buildLoftedRing(innerHalfLength, innerHalfWidth, standDepth, standHeight, cornerFill, start, end)
}

/** A slim wall right at the inner edge (facing the pitch) - the visible "this sits on a concrete base" riser under the first row. */
export function buildPodiumWallGeometry(structure: Stadium3DStructure): THREE.BufferGeometry {
  const { innerHalfLength, innerHalfWidth, standHeight, cornerFill } = structure
  const wallHeight = Math.max(1.4, standHeight * 0.05)
  return buildLoftedRing(innerHalfLength, innerHalfWidth, wallHeight * 3, wallHeight, cornerFill, 0, 1)
}

/**
 * The flat concourse floor between the pitch's own edge and the stand's
 * rounded inner edge (the standOffset gap) - a real dark surface instead of
 * empty space that showed the pale canvas background through it, which read
 * as a huge stray white void between the grass and the stands.
 */
export function buildConcourseFloorGeometry(structure: Stadium3DStructure): THREE.BufferGeometry {
  const { innerHalfLength, innerHalfWidth, cornerFill } = structure
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    const [ix, iz] = pitchBoundaryPoint(angle)
    const [ox, oz] = boundaryPoint(angle, innerHalfLength, innerHalfWidth, cornerFill)
    positions.push(ix, 0.05, iz, ox, 0.05, oz)
    uvs.push(i / ANGULAR_STEPS, 0, i / ANGULAR_STEPS, 1)
  }
  for (let i = 0; i < ANGULAR_STEPS; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, c, b, c, d, b)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A vertical outer wall from the ground up to the ramp's actual outer-top
 * edge, following the same corner taper as the shell - anchors the facade,
 * entrances and roof to real geometry instead of an open void, and gives
 * the bowl its "clear outer edge." Kept in the lighter (not dark) concrete
 * tone and lower than the full stand height so it reads as a base, not the
 * dominant element of the top-down view.
 */
export function buildOuterFacadeGeometry(structure: Stadium3DStructure): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const heightFrac = 0.55

  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    const { x, z, height } = outerEdgeAt(angle, structure)
    positions.push(x, 0, z, x, height * heightFrac, z)
    uvs.push(i / ANGULAR_STEPS, 0, i / ANGULAR_STEPS, 1)
  }
  for (let i = 0; i < ANGULAR_STEPS; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, c, b, c, d, b)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// --- Section layout ---------------------------------------------------------

export interface SectionSlot {
  centerAngle: number
  halfSpan: number
  isCorner: boolean
}

/**
 * Lays sections out per SIDE - more, narrower sections along the two long
 * (touchline) sides, fewer along the two short (behind-goal) sides, plus a
 * few dedicated sections in each corner - instead of dividing the whole
 * ring evenly by angle. This is what makes "long side: 8-12 sections, short
 * side: 5-8" an actual property of the model, and gives every corner its
 * own sections rather than leaving it as empty space between two sides.
 */
export function buildSectionLayout(structure: Stadium3DStructure): SectionSlot[] {
  const { innerHalfLength: L, innerHalfWidth: W, cornerFill, longSideSections, shortSideSections, cornerSections } = structure
  const r = cornerRadiusFor(L, W, cornerFill)
  const cornerStart = Math.atan2(W - r, L)
  const cornerEnd = Math.atan2(W, L - r)
  const slots: SectionSlot[] = []

  function fillRange(a0: number, a1: number, count: number, isCorner: boolean) {
    const span = a1 - a0
    const step = span / count
    for (let i = 0; i < count; i++) {
      slots.push({ centerAngle: a0 + step * (i + 0.5), halfSpan: (step / 2) * 0.88, isCorner })
    }
  }

  fillRange(-cornerStart, cornerStart, shortSideSections, false) // short side, right (angle ~0)
  fillRange(cornerStart, cornerEnd, cornerSections, true) // corner
  fillRange(cornerEnd, Math.PI - cornerEnd, longSideSections, false) // long side, top (angle ~90°)
  fillRange(Math.PI - cornerEnd, Math.PI - cornerStart, cornerSections, true) // corner
  fillRange(Math.PI - cornerStart, Math.PI + cornerStart, shortSideSections, false) // short side, left (angle ~180°)
  fillRange(Math.PI + cornerStart, Math.PI + cornerEnd, cornerSections, true) // corner
  fillRange(Math.PI + cornerEnd, 2 * Math.PI - cornerEnd, longSideSections, false) // long side, bottom (angle ~270°)
  fillRange(2 * Math.PI - cornerEnd, 2 * Math.PI - cornerStart, cornerSections, true) // corner

  return slots
}

/** Gap center angles between consecutive non-corner sections, every 3rd one - candidate spots for a vomitory tunnel. */
function computeVomitoryAngles(slots: SectionSlot[]): number[] {
  const angles: number[] = []
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i]
    const b = slots[(i + 1) % slots.length]
    if (a.isCorner || b.isCorner) continue
    if (i % 3 !== 1) continue
    angles.push(a.centerAngle + a.halfSpan + (b.centerAngle - b.halfSpan - (a.centerAngle + a.halfSpan)) / 2)
  }
  return angles
}

export interface InstancedBlockData {
  matrices: THREE.Matrix4[]
  colors: THREE.Color[]
}

/**
 * A low handrail that follows the actual rake of the stand along a section
 * boundary - built from the same per-row steps as the seating (a series of
 * short segments, each capping one row's back edge) rather than one single
 * box. A single box tall/deep enough to span the whole stand would show its
 * full tangential side face to this camera angle, reading as one huge dark
 * wedge cutting across the neighboring section instead of a thin divider.
 */
export function computeSectionDividerInstances(structure: Stadium3DStructure): THREE.Matrix4[] {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, cornerFill, visualRowCount } = structure
  const slots = buildSectionLayout(structure)
  const vomitoryAngleSet = new Set(computeVomitoryAngles(slots).map((a) => a.toFixed(4)))
  const matrices: THREE.Matrix4[] = []
  const effectiveRowCount = Math.max(1, visualRowCount)
  const railCapHeight = Math.max(0.3, standHeight * 0.012)

  for (let i = 0; i < slots.length; i++) {
    const a = slots[i]
    const b = slots[(i + 1) % slots.length]
    const gapAngle = a.centerAngle + a.halfSpan + (b.centerAngle - b.halfSpan - (a.centerAngle + a.halfSpan)) / 2
    if (vomitoryAngleSet.has(gapAngle.toFixed(4))) continue

    const [cx, cz] = boundaryPoint(gapAngle, innerHalfLength, innerHalfWidth, cornerFill)
    const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
    const localScale = 1 - closeness * (1 - cornerFill) * 0.85
    const depthHere = standDepth * localScale
    const heightHere = standHeight * localScale
    const len = Math.hypot(cx, cz) || 1
    const dirX = cx / len
    const dirZ = cz / len
    const tangentAngle = gapAngle + Math.PI / 2
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)

    for (let r = 0; r < effectiveRowCount; r++) {
      const t0 = r / effectiveRowCount
      const t1 = (r + 1) / effectiveRowCount
      const radiusOffset = depthHere * t0
      const stepDepth = depthHere * (t1 - t0)
      const rowTop = heightHere * t1

      const posX = cx + dirX * (radiusOffset + stepDepth * 0.5)
      const posZ = cz + dirZ * (radiusOffset + stepDepth * 0.5)
      const posY = rowTop + railCapHeight * 0.5

      const m = new THREE.Matrix4()
      m.compose(new THREE.Vector3(posX, posY, posZ), quat, new THREE.Vector3(0.3, railCapHeight, stepDepth * 0.98))
      matrices.push(m)
    }
  }

  return matrices
}

/**
 * The actual seating - one instanced box per (section, row, tier), each row
 * nearly filling its section's full angular and radial slot (seats should
 * dominate the stand, concrete should only show at aisles/stairs/tunnels -
 * not as large bare surfaces). Colored per section in a planned pattern
 * (deep purple by default, white corner sections, a distinct VIP shade near
 * the two halfway-line sections) rather than a per-section random cycle.
 * A handful of aisle gaps get a dark recessed vomitory block instead of
 * plain concrete, reading as a real tunnel mouth into the lower rows.
 */
export interface SeatingOptions extends SeatingPalette {
  /**
   * Optional test applied to each tunnel mouth's world position. Returning
   * false skips that vomitory entirely - used by the broadcast camera, which
   * sits INSIDE the near touchline stand: its own tunnels are then only ever
   * seen from behind and above, where they read as a black lump rather than
   * as an entrance.
   */
  includeVomitoryAt?: (x: number, z: number) => boolean
}

export interface SeatingPalette {
  /** The bowl's main seat colour. */
  primary?: string
  /** The corner "wing" blocks. */
  accent?: string
  /** The dedicated VIP sections near the halfway line. */
  vip?: string
  /** The recessed tunnel opening. */
  vomitory?: string
  /** The portal surround around a tunnel mouth. */
  frame?: string
}

export function computeSeatingBlockInstances(
  structure: Stadium3DStructure,
  palette: SeatingOptions = {}
): InstancedBlockData {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, visualRowCount, cornerFill, vipSections, tierCount } = structure
  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []

  const slots = buildSectionLayout(structure)
  const primaryColor = new THREE.Color(palette.primary ?? SEAT_PRIMARY)
  const accentColor = new THREE.Color(palette.accent ?? SEAT_CORNER_ACCENT)
  const vipColor = new THREE.Color(palette.vip ?? VIP_COLOR)
  const vomitoryColor = new THREE.Color(palette.vomitory ?? VOMITORY_COLOR)

  const vipAnchorAngles = [Math.PI / 2, (3 * Math.PI) / 2]
  const nonCornerIndices = slots.map((slot, i) => ({ slot, i })).filter(({ slot }) => !slot.isCorner)
  const distToNearestVipAnchor = (angle: number) =>
    Math.min(...vipAnchorAngles.map((va) => Math.min(Math.abs(angle - va), Math.PI * 2 - Math.abs(angle - va))))
  const vipIndices = new Set(
    nonCornerIndices
      .slice()
      .sort((a, b) => distToNearestVipAnchor(a.slot.centerAngle) - distToNearestVipAnchor(b.slot.centerAngle))
      .slice(0, vipSections)
      .map(({ i }) => i)
  )

  const concourseGap = tierCount > 1 ? 0.1 : 0
  const tierSpan = 1 / tierCount
  const effectiveRowCount = Math.max(1, visualRowCount)

  for (let tier = 0; tier < tierCount; tier++) {
    const tierStart = tier * tierSpan
    const tierEnd = tierStart + tierSpan * (1 - concourseGap)
    // Higher decks are further from the light and read darker in every real
    // ground - this is the main cue that the stand has height.
    const tierShade = 1 - tier * 0.18

    slots.forEach((slot, slotIndex) => {
      const isVip = vipIndices.has(slotIndex)
      const centerAngle = slot.centerAngle
      const angularHalfSpan = slot.halfSpan

      const [cx, cz] = boundaryPoint(centerAngle, innerHalfLength, innerHalfWidth, cornerFill)
      const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
      const localScale = 1 - closeness * (1 - cornerFill) * 0.85

      // Blend by this slot's own geometric closeness to the true corner,
      // not by a hard "isCorner" switch - the purple-to-white transition
      // follows the same smooth curve the boundary itself sweeps through,
      // instead of one block suddenly turning white next to a purple one.
      // Club colour is an ACCENT on a dark bowl, never its base coat: even
      // the corners only take a partial tint, so the stand still reads as
      // seats lit at night rather than as a painted brand surface.
      const cornerBlend = slot.isCorner ? Math.min(0.5, closeness * 0.8) : 0
      const baseColor = primaryColor.clone().lerp(accentColor, cornerBlend)
      const depthHere = standDepth * localScale * (tierEnd - tierStart)
      const heightHere = standHeight * localScale * (tierEnd - tierStart)
      const baseY = standHeight * localScale * tierStart
      const baseRadiusOffset = standDepth * localScale * tierStart

      const len = Math.hypot(cx, cz) || 1
      const dirX = cx / len
      const dirZ = cz / len
      const tangentAngle = centerAngle + Math.PI / 2

      const avgRadius = len + baseRadiusOffset + depthHere * 0.5
      const blockWidth = Math.max(1, 2 * avgRadius * Math.sin(angularHalfSpan))

      const liftY = Math.max(0.3, standHeight * 0.015)
      const liftOut = Math.max(0.25, standDepth * 0.01)

      for (let r = 0; r < effectiveRowCount; r++) {
        const t0 = r / effectiveRowCount
        const t1 = (r + 1) / effectiveRowCount
        const radiusOffset = baseRadiusOffset + depthHere * t0
        const stepDepth = depthHere * (t1 - t0)
        const y0 = baseY + heightHere * t0
        const stepRise = heightHere * (t1 - t0)

        const posX = cx + dirX * (radiusOffset + stepDepth * 0.5 - liftOut)
        const posZ = cz + dirZ * (radiusOffset + stepDepth * 0.5 - liftOut)
        const posY = y0 + stepRise * 0.5 + liftY

        // Thin rows with only a subtle gap between them - dense/close up
        // reads as real individual rows, but from a distance they merge
        // into one clean block of color instead of a wireframe of stripes.
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
        const m = new THREE.Matrix4()
        m.compose(
          new THREE.Vector3(posX, posY, posZ),
          quat,
          new THREE.Vector3(blockWidth, Math.max(0.35, stepRise * 0.92), Math.max(0.4, stepDepth * 0.94))
        )
        matrices.push(m)
        // A subtle alternating shade per row - a deterministic depth/
        // separation cue that reads at any camera angle, unlike relying on
        // lighting alone to differentiate one thin row from the next.
        // Rows also fall off toward the back of each tier, so a single deck
        // is never one flat slab of colour either.
        const rowShade = (r % 2 === 0 ? 1 : 0.88) * (1 - t0 * 0.22)
        // Club colour appears as seat mosaics: a band across the VIP/centre
        // sections and the odd stripe elsewhere - the way real grounds pick
        // out a few rows, not whole stands.
        const bandRoll = pseudoRandom(slotIndex * 17.3 + r * 4.7 + tier * 3.1)
        const inVipBand = isVip && t0 >= 0.3 && t0 < 0.46
        const isAccentRow = inVipBand || bandRoll < 0.07
        const color = isAccentRow
          ? baseColor.clone().lerp(inVipBand ? vipColor : accentColor, inVipBand ? 0.8 : 0.5)
          : baseColor
        colors.push(color.clone().multiplyScalar(rowShade * tierShade))
      }
    })
  }

  // Vomitories - real recessed tunnel openings cut into a handful of aisle
  // gaps, not floating markers outside the bowl. Only the lower rows are
  // affected; seats continue normally above and to both sides.
  const vomitoryAngles = computeVomitoryAngles(slots)
  const vomitoryDepthFrac = 0.4
  const vomitoryHeightFrac = 0.22
  const vomitoryAngularHalfSpan = ((Math.PI * 2) / Math.max(8, slots.length)) * 0.32
  const frameColor = new THREE.Color(palette.frame ?? CONCRETE_DARK)

  for (const angle of vomitoryAngles) {
    const [cx, cz] = boundaryPoint(angle, innerHalfLength, innerHalfWidth, cornerFill)
    if (palette.includeVomitoryAt && !palette.includeVomitoryAt(cx, cz)) continue
    const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
    const localScale = 1 - closeness * (1 - cornerFill) * 0.85
    // Capped in METERS, not just as a fraction of the stand: a tunnel mouth is
    // a human-sized opening (a few meters), so on a deep stand the fraction
    // alone would produce a 15m block sitting out over the touchline.
    const depthHere = Math.min(5.5, standDepth * localScale * vomitoryDepthFrac)
    const heightHere = Math.min(4, standHeight * localScale * vomitoryHeightFrac)
    const len = Math.hypot(cx, cz) || 1
    const dirX = cx / len
    const dirZ = cz / len
    const tangentAngle = angle + Math.PI / 2
    const avgRadius = len + depthHere * 0.5
    // Capped in meters like the depth/height above: a tunnel mouth is a
    // doorway, so on a big bowl the angular span alone would widen it into a
    // shipping container parked on the touchline.
    const blockWidth = Math.min(7, Math.max(1.5, 2 * avgRadius * Math.sin(vomitoryAngularHalfSpan)))

    // Recessed INTO the stand: the opening's mouth sits flush with the stand's
    // inner boundary and the rest runs back under the seating, so nothing
    // protrudes out over the pitch.
    const posX = cx + dirX * depthHere * 0.5
    const posZ = cz + dirZ * depthHere * 0.5

    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
    const tangentX = Math.cos(tangentAngle)
    const tangentZ = Math.sin(tangentAngle)

    // A tunnel mouth built from its actual parts rather than one dark slab:
    // a recessed interior, a wall down each side, a lintel across the top and
    // a ramp rising out of it. It should read as somewhere people walk out of,
    // while staying quiet enough that it never competes with the pitch.
    const wallThickness = Math.max(0.35, blockWidth * 0.1)
    const lintelHeight = Math.max(0.4, heightHere * 0.16)
    const openingHeight = heightHere - lintelHeight
    const openingWidth = blockWidth - wallThickness * 2

    // 1. The interior: pushed well back under the seating and left dark, so
    //    the opening reads as depth rather than as a painted-on rectangle.
    const interiorM = new THREE.Matrix4()
    interiorM.compose(
      new THREE.Vector3(posX + dirX * depthHere * 0.35, openingHeight * 0.5, posZ + dirZ * depthHere * 0.35),
      quat,
      new THREE.Vector3(openingWidth, openingHeight, depthHere * 1.1)
    )
    matrices.push(interiorM)
    colors.push(vomitoryColor)

    // 2. Side walls flanking the opening.
    for (const side of [-1, 1]) {
      const offset = (openingWidth + wallThickness) * 0.5 * side
      const wallM = new THREE.Matrix4()
      wallM.compose(
        new THREE.Vector3(posX + tangentX * offset, openingHeight * 0.5, posZ + tangentZ * offset),
        quat,
        new THREE.Vector3(wallThickness, openingHeight, depthHere)
      )
      matrices.push(wallM)
      colors.push(frameColor)
    }

    // 3. Lintel across the top, tying the two walls together.
    const lintelM = new THREE.Matrix4()
    lintelM.compose(
      new THREE.Vector3(posX, openingHeight + lintelHeight * 0.5, posZ),
      quat,
      new THREE.Vector3(blockWidth, lintelHeight, depthHere * 0.9)
    )
    matrices.push(lintelM)
    colors.push(frameColor)

    // 4. The ramp climbing out of the tunnel toward the first row - a few
    //    stepped slabs, which is what actually sells it as an exit.
    const stepCount = 3
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
      const f = stepIndex / stepCount
      const stepM = new THREE.Matrix4()
      stepM.compose(
        new THREE.Vector3(
          posX - dirX * depthHere * (0.45 + f * 0.3),
          openingHeight * 0.16 * (stepCount - stepIndex),
          posZ - dirZ * depthHere * (0.45 + f * 0.3)
        ),
        quat,
        new THREE.Vector3(openingWidth * 0.92, Math.max(0.18, openingHeight * 0.1), depthHere * 0.3)
      )
      matrices.push(stepM)
      colors.push(frameColor)
    }
  }

  return { matrices, colors }
}

/**
 * Where the roof actually sits at a given angle. A real stadium roof
 * CANTILEVERS INWARD over the seating - that is the whole point of it, and
 * it's what makes a stand read as covered when you're sitting inside the
 * bowl looking across. (An outward-only roof is invisible from every seat in
 * the ground.) All four roof builders below read this one function, so the
 * deck, its underside, the fascia and the beams can never disagree.
 */
function roofSpanAt(
  angle: number,
  structure: Stadium3DStructure
): { innerX: number; innerZ: number; outerX: number; outerZ: number; innerY: number; outerY: number; standTopY: number } {
  const { x: ex, z: ez, height } = outerEdgeAt(angle, structure)
  const len = Math.hypot(ex, ez) || 1
  const dirX = ex / len
  const dirZ = ez / len

  // How far back over the seating the roof reaches, and how far it juts out
  // behind the stand.
  const inwardCover = structure.standDepth * 0.58
  const overhang = Math.min(6, structure.standDepth * 0.12)
  const clearance = Math.max(5, structure.standHeight * 0.22)

  return {
    innerX: ex - dirX * inwardCover,
    innerZ: ez - dirZ * inwardCover,
    outerX: ex + dirX * overhang,
    outerZ: ez + dirZ * overhang,
    // Slopes gently down toward the pitch-side lip, like a real cantilever.
    innerY: height + clearance * 0.66,
    outerY: height + clearance,
    standTopY: height,
  }
}

const ROOF_THICKNESS_FRAC = 0.045

function isRoofCoveredAngle(angle: number, roofCoverage: number): boolean {
  const halfArcPerSide = (Math.PI / 4) * roofCoverage
  return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].some((c) => {
    let d = Math.abs(angle - c)
    if (d > Math.PI) d = 2 * Math.PI - d
    return d <= halfArcPerSide
  })
}

/** The roof deck itself, cantilevered in over the seats. */
export function buildRoofGeometry(structure: Stadium3DStructure): THREE.BufferGeometry | null {
  if (structure.roofCoverage <= 0.02) return null

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const isCovered = (angle: number) => isRoofCoveredAngle(angle, structure.roofCoverage)

  let vertCount = 0
  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    if (!isCovered(angle)) continue

    const span = roofSpanAt(angle, structure)
    positions.push(span.innerX, span.innerY, span.innerZ, span.outerX, span.outerY, span.outerZ)
    uvs.push(i / ANGULAR_STEPS, 0, i / ANGULAR_STEPS, 1)

    if (vertCount > 0) {
      const a = vertCount * 2 - 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      const prevAngle = ((i - 1) / ANGULAR_STEPS) * Math.PI * 2
      if (isCovered(prevAngle)) indices.push(a, c, b, c, d, b)
    }
    vertCount++
  }

  if (positions.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** The roof's underside face, offset down by a real thickness from the top deck - gives the roof actual visual mass instead of a single infinitely-thin plate. */
export function buildRoofUndersideGeometry(structure: Stadium3DStructure): THREE.BufferGeometry | null {
  if (structure.roofCoverage <= 0.02) return null

  const thickness = Math.max(1.2, structure.standDepth * ROOF_THICKNESS_FRAC)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const isCovered = (angle: number) => isRoofCoveredAngle(angle, structure.roofCoverage)

  let vertCount = 0
  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    if (!isCovered(angle)) continue

    const span = roofSpanAt(angle, structure)
    positions.push(
      span.innerX,
      span.innerY - thickness,
      span.innerZ,
      span.outerX,
      span.outerY - thickness,
      span.outerZ
    )
    uvs.push(i / ANGULAR_STEPS, 0, i / ANGULAR_STEPS, 1)

    if (vertCount > 0) {
      const a = vertCount * 2 - 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      const prevAngle = ((i - 1) / ANGULAR_STEPS) * Math.PI * 2
      if (isCovered(prevAngle)) indices.push(a, b, c, c, b, d)
    }
    vertCount++
  }

  if (positions.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The roof's front fascia: the vertical face along its pitch-side lip. This
 * is the band a viewer inside the bowl actually sees running above the far
 * stand, and it's what stops the deck reading as an infinitely thin plate.
 */
export function buildRoofFasciaGeometry(structure: Stadium3DStructure): THREE.BufferGeometry | null {
  if (structure.roofCoverage <= 0.02) return null

  const thickness = Math.max(1.2, structure.standDepth * ROOF_THICKNESS_FRAC)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const isCovered = (angle: number) => isRoofCoveredAngle(angle, structure.roofCoverage)

  let vertCount = 0
  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    if (!isCovered(angle)) continue

    const span = roofSpanAt(angle, structure)
    positions.push(span.innerX, span.innerY - thickness, span.innerZ, span.innerX, span.innerY, span.innerZ)
    uvs.push(i / ANGULAR_STEPS, 0, i / ANGULAR_STEPS, 1)

    if (vertCount > 0) {
      const a = vertCount * 2 - 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      const prevAngle = ((i - 1) / ANGULAR_STEPS) * Math.PI * 2
      if (isCovered(prevAngle)) indices.push(a, c, b, c, d, b)
    }
    vertCount++
  }

  if (positions.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Thin radial support beams under the roof deck, from the fascia to the outer overhang edge - a basic visible metal frame instead of a plain floating plate. */
export function computeRoofBeamInstances(structure: Stadium3DStructure): THREE.Matrix4[] {
  if (structure.roofCoverage <= 0.02) return []
  const thickness = Math.max(1.2, structure.standDepth * ROOF_THICKNESS_FRAC)
  const halfArcPerSide = (Math.PI / 4) * structure.roofCoverage
  const sideCenters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  const matrices: THREE.Matrix4[] = []
  const stepRad = (6 * Math.PI) / 180

  for (const c of sideCenters) {
    for (let d = -halfArcPerSide; d <= halfArcPerSide + 1e-6; d += stepRad) {
      const angle = c + d
      const span = roofSpanAt(angle, structure)
      // One beam running the full cantilever, from the inner lip back to the
      // outer overhang - the visible truss under the deck.
      const midX = (span.innerX + span.outerX) / 2
      const midZ = (span.innerZ + span.outerZ) / 2
      const midY = (span.innerY + span.outerY) / 2 - thickness - 0.35
      const runLength = Math.hypot(span.outerX - span.innerX, span.outerZ - span.innerZ)
      const tangentAngle = angle + Math.PI / 2
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
      const m = new THREE.Matrix4()
      m.compose(new THREE.Vector3(midX, midY, midZ), quat, new THREE.Vector3(0.45, 0.55, runLength))
      matrices.push(m)
    }
  }
  return matrices
}

/** Small emissive light fixtures mounted under the roof edge, replacing free-standing floodlight poles entirely - always physically attached to the roof structure, never floating in open space. */
export function computeRoofLightInstances(structure: Stadium3DStructure): THREE.Matrix4[] {
  if (structure.roofCoverage <= 0.05) return []
  const thickness = Math.max(1.2, structure.standDepth * ROOF_THICKNESS_FRAC)
  const halfArcPerSide = (Math.PI / 4) * structure.roofCoverage
  const sideCenters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  const matrices: THREE.Matrix4[] = []
  // A run of fixtures along the roof's inner lip, aimed down at the pitch -
  // where a covered ground's lighting actually hangs.
  const fractions = [-0.85, -0.5, -0.17, 0.17, 0.5, 0.85]

  for (const c of sideCenters) {
    for (const frac of fractions) {
      const angle = c + frac * halfArcPerSide
      const span = roofSpanAt(angle, structure)
      const tangentAngle = angle + Math.PI / 2
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
      const m = new THREE.Matrix4()
      m.compose(
        new THREE.Vector3(span.innerX, span.innerY - thickness - 0.5, span.innerZ),
        quat,
        new THREE.Vector3(2.6, 0.7, 1.1)
      )
      matrices.push(m)
    }
  }
  return matrices
}

/** Procedural pitch texture (lines only - the pitch's own size/color never changes with capacity). */
/**
 * The pitch surface, drawn straight from the regulation marking set in
 * pitch-geometry.ts. Nothing here is placed by eye: every line comes out of
 * buildPitchMarkings() in meters and passes through the single mx()/my()
 * transform below, so the texture cannot drift from the geometry the tests
 * assert (and the plane it maps onto is exactly PITCH_LENGTH x PITCH_WIDTH,
 * meaning the texture edge IS the touchline - no inset fudge).
 */
export function createPitchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  const scale = 10 // px per meter
  canvas.width = PITCH_LENGTH * scale
  canvas.height = PITCH_WIDTH * scale
  const ctx = canvas.getContext("2d")!

  // meters (origin at the center spot) -> canvas pixels. The one transform.
  const mx = (x: number) => (x + HALF_LENGTH) * scale
  const my = (y: number) => (HALF_WIDTH - y) * scale
  const m = (v: number) => v * scale

  const markings = buildPitchMarkings()

  // --- Grass ---------------------------------------------------------------
  ctx.fillStyle = GRASS_BASE
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Mow stripes, banded across the length like a real groundsman's cut.
  const stripeCount = 16
  const stripeWidth = canvas.width / stripeCount
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? GRASS_STRIPE_LIGHT : GRASS_STRIPE_DARK
    ctx.fillRect(i * stripeWidth, 0, stripeWidth, canvas.height)
  }

  // Fine mottling so the surface reads as turf rather than flat paint. Seeded
  // by index (never Math.random) so the texture is identical every mount.
  for (let i = 0; i < 2600; i++) {
    const rx = pseudoRandom(i * 1.37) * canvas.width
    const ry = pseudoRandom(i * 2.71 + 91) * canvas.height
    const r = 1 + pseudoRandom(i * 3.13 + 17) * 2.5
    ctx.fillStyle = pseudoRandom(i * 5.51 + 43) > 0.5 ? "rgba(255,255,255,0.028)" : "rgba(0,26,8,0.05)"
    ctx.beginPath()
    ctx.arc(rx, ry, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Slight darkening toward the edges - the pitch centre reads brighter,
  // the way a floodlit surface actually falls off.
  const vignette = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.2,
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.95
  )
  vignette.addColorStop(0, "rgba(0,0,0,0)")
  vignette.addColorStop(1, "rgba(0,18,6,0.22)")
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // --- Markings ------------------------------------------------------------
  ctx.strokeStyle = PITCH_LINE_COLOR
  ctx.fillStyle = PITCH_LINE_COLOR
  ctx.lineWidth = m(LINE_WIDTH)
  ctx.lineCap = "butt"

  const strokeRect = (r: { cx: number; cy: number; width: number; height: number }) =>
    ctx.strokeRect(mx(r.cx - r.width / 2), my(r.cy + r.height / 2), m(r.width), m(r.height))

  // Boundary. Inset by half a line so the painted line sits inside the field
  // of play (the line belongs to the area it bounds), not half off-texture.
  const half = LINE_WIDTH / 2
  ctx.strokeRect(
    mx(-HALF_LENGTH + half),
    my(HALF_WIDTH - half),
    m(PITCH_LENGTH - LINE_WIDTH),
    m(PITCH_WIDTH - LINE_WIDTH)
  )

  ctx.beginPath()
  ctx.moveTo(mx(markings.halfwayLine[0].x), my(markings.halfwayLine[0].y))
  ctx.lineTo(mx(markings.halfwayLine[1].x), my(markings.halfwayLine[1].y))
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(mx(markings.centerCircle.cx), my(markings.centerCircle.cy), m(markings.centerCircle.radius), 0, Math.PI * 2)
  ctx.stroke()

  for (const box of markings.penaltyAreas) strokeRect(box)
  for (const box of markings.goalAreas) strokeRect(box)

  // Penalty arcs. my() flips the y axis, so a clockwise sweep in pitch space
  // is drawn counter-clockwise here - hence the negated angles.
  for (const arc of markings.penaltyArcs) {
    ctx.beginPath()
    ctx.arc(mx(arc.cx), my(arc.cy), m(arc.radius), -arc.endAngle, -arc.startAngle)
    ctx.stroke()
  }

  for (const arc of markings.cornerArcs) {
    ctx.beginPath()
    ctx.arc(mx(arc.cx), my(arc.cy), m(arc.radius), -arc.endAngle, -arc.startAngle)
    ctx.stroke()
  }

  for (const spot of [markings.centerSpot, ...markings.penaltySpots]) {
    ctx.beginPath()
    ctx.arc(mx(spot.x), my(spot.y), m(SPOT_RADIUS), 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

// --- Debug / consistency check ----------------------------------------------

export interface SeatingDebugInfo {
  sectionCount: number
  longSideSections: number
  shortSideSections: number
  cornerSections: number
  rowCount: number
  visualRowCount: number
  instanceCount: number
  estimatedSeats: number
}

/**
 * A real geometry-derived seat estimate (section width / an assumed seat
 * pitch, times the true row count), so we can check the visual model is
 * actually in the right ballpark for the capacity it claims - not just
 * trust the config number while the render shows a few thousand seats.
 */
export function computeSeatingDebugInfo(structure: Stadium3DStructure): SeatingDebugInfo {
  const SEAT_WIDTH_M = 0.55
  const slots = buildSectionLayout(structure)
  const { innerHalfLength, innerHalfWidth, standDepth, cornerFill, rowCount, visualRowCount, tierCount } = structure

  let estimatedSeats = 0
  for (const slot of slots) {
    const [cx, cz] = boundaryPoint(slot.centerAngle, innerHalfLength, innerHalfWidth, cornerFill)
    const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
    const localScale = 1 - closeness * (1 - cornerFill) * 0.85
    const depthHere = standDepth * localScale
    const len = Math.hypot(cx, cz) || 1
    const avgRadius = len + depthHere * 0.5
    const blockWidth = 2 * avgRadius * Math.sin(slot.halfSpan)
    const seatsPerRow = Math.max(1, Math.round(blockWidth / SEAT_WIDTH_M))
    estimatedSeats += seatsPerRow * rowCount
  }
  estimatedSeats *= tierCount

  return {
    sectionCount: structure.sectionCount,
    longSideSections: structure.longSideSections,
    shortSideSections: structure.shortSideSections,
    cornerSections: structure.cornerSections,
    rowCount,
    visualRowCount,
    instanceCount: slots.length * visualRowCount * tierCount,
    estimatedSeats: Math.round(estimatedSeats),
  }
}

export const CONCRETE_MATERIAL_COLOR = CONCRETE_COLOR
export const CONCRETE_MATERIAL_DARK = CONCRETE_DARK
export const METAL_MATERIAL_COLOR = METAL_COLOR
