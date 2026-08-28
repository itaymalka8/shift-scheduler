import * as THREE from "three"
import { PITCH_LENGTH, PITCH_WIDTH, type Stadium3DStructure } from "@/lib/stadium/stadium3d-config"

const ANGULAR_STEPS = 96

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
function boundaryPoint(angle: number, halfLength: number, halfWidth: number, cornerFill: number): [number, number] {
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
function cornerCloseness(x: number, z: number, halfLength: number, halfWidth: number): number {
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
export function computeSeatingBlockInstances(structure: Stadium3DStructure): InstancedBlockData {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, visualRowCount, cornerFill, vipSections, tierCount } = structure
  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []

  const slots = buildSectionLayout(structure)
  const primaryColor = new THREE.Color(SEAT_PRIMARY)
  const accentColor = new THREE.Color(SEAT_CORNER_ACCENT)
  const vipColor = new THREE.Color(VIP_COLOR)
  const vomitoryColor = new THREE.Color(VOMITORY_COLOR)

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
      const cornerBlend = slot.isCorner ? Math.min(1, closeness * 1.6) : 0
      const color = isVip ? vipColor : primaryColor.clone().lerp(accentColor, cornerBlend)
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
        const rowShade = r % 2 === 0 ? 1 : 0.86
        colors.push(color.clone().multiplyScalar(rowShade))
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
  const frameColor = new THREE.Color(CONCRETE_DARK)

  for (const angle of vomitoryAngles) {
    const [cx, cz] = boundaryPoint(angle, innerHalfLength, innerHalfWidth, cornerFill)
    const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
    const localScale = 1 - closeness * (1 - cornerFill) * 0.85
    const depthHere = standDepth * localScale * vomitoryDepthFrac
    const heightHere = standHeight * localScale * vomitoryHeightFrac
    const len = Math.hypot(cx, cz) || 1
    const dirX = cx / len
    const dirZ = cz / len
    const tangentAngle = angle + Math.PI / 2
    const avgRadius = len + depthHere * 0.5
    const blockWidth = Math.max(1.5, 2 * avgRadius * Math.sin(vomitoryAngularHalfSpan))

    const posX = cx + dirX * depthHere * 0.5
    const posZ = cz + dirZ * depthHere * 0.5
    const posY = heightHere * 0.5

    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)

    // A slightly larger, lighter frame sitting just behind the dark opening -
    // reads as a real built portal (an arch/lintel around the tunnel mouth)
    // instead of a flat dark patch dropped onto the seating.
    const frameM = new THREE.Matrix4()
    frameM.compose(
      new THREE.Vector3(posX, posY + heightHere * 0.08, posZ),
      quat,
      new THREE.Vector3(blockWidth * 1.22, heightHere * 1.18, depthHere * 1.1)
    )
    matrices.push(frameM)
    colors.push(frameColor)

    const m = new THREE.Matrix4()
    m.compose(
      new THREE.Vector3(posX + dirX * 0.15, posY, posZ + dirZ * 0.15),
      quat,
      new THREE.Vector3(blockWidth, heightHere, depthHere)
    )
    matrices.push(m)
    colors.push(vomitoryColor)
  }

  return { matrices, colors }
}

/** A partial roof ring over the outer edge, growing out from the middle of each side as roofCoverage increases. */
export function buildRoofGeometry(structure: Stadium3DStructure): THREE.BufferGeometry | null {
  if (structure.roofCoverage <= 0.02) return null

  const overhang = Math.max(4, structure.standDepth * 0.18)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const halfArcPerSide = (Math.PI / 4) * structure.roofCoverage
  const sideCenters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]

  function isCovered(angle: number): boolean {
    return sideCenters.some((c) => {
      let d = Math.abs(angle - c)
      if (d > Math.PI) d = 2 * Math.PI - d
      return d <= halfArcPerSide
    })
  }

  let vertCount = 0
  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    if (!isCovered(angle)) continue

    const { x: ix, z: iz, height } = outerEdgeAt(angle, structure)
    const roofY = height * 1.06
    const len = Math.hypot(ix, iz) || 1
    const dirX = ix / len
    const dirZ = iz / len
    const ox = ix + dirX * overhang
    const oz = iz + dirZ * overhang

    positions.push(ix, roofY, iz, ox, roofY, oz)
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

  const thickness = Math.max(1.2, structure.standDepth * 0.045)
  const overhang = Math.max(4, structure.standDepth * 0.18)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const halfArcPerSide = (Math.PI / 4) * structure.roofCoverage
  const sideCenters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  function isCovered(angle: number): boolean {
    return sideCenters.some((c) => {
      let d = Math.abs(angle - c)
      if (d > Math.PI) d = 2 * Math.PI - d
      return d <= halfArcPerSide
    })
  }

  let vertCount = 0
  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    if (!isCovered(angle)) continue

    const { x: ix, z: iz, height } = outerEdgeAt(angle, structure)
    const roofY = height * 1.06 - thickness
    const len = Math.hypot(ix, iz) || 1
    const dirX = ix / len
    const dirZ = iz / len
    const ox = ix + dirX * overhang
    const oz = iz + dirZ * overhang

    positions.push(ix, roofY, iz, ox, roofY, oz)
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
 * A vertical support wall running from the top of the stand up to the roof's
 * underside, directly below the roof's inner edge - without this the roof
 * ring reads as a flat plate hovering disconnected above the bowl instead of
 * a structure actually resting on the stand.
 */
export function buildRoofFasciaGeometry(structure: Stadium3DStructure): THREE.BufferGeometry | null {
  if (structure.roofCoverage <= 0.02) return null

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const halfArcPerSide = (Math.PI / 4) * structure.roofCoverage
  const sideCenters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  function isCovered(angle: number): boolean {
    return sideCenters.some((c) => {
      let d = Math.abs(angle - c)
      if (d > Math.PI) d = 2 * Math.PI - d
      return d <= halfArcPerSide
    })
  }

  let vertCount = 0
  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    if (!isCovered(angle)) continue

    const { x: ix, z: iz, height } = outerEdgeAt(angle, structure)
    const roofY = height * 1.06
    positions.push(ix, height, iz, ix, roofY, iz)
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
  const overhang = Math.max(4, structure.standDepth * 0.18)
  const halfArcPerSide = (Math.PI / 4) * structure.roofCoverage
  const sideCenters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  const matrices: THREE.Matrix4[] = []
  const stepRad = (6 * Math.PI) / 180

  for (const c of sideCenters) {
    for (let d = -halfArcPerSide; d <= halfArcPerSide + 1e-6; d += stepRad) {
      const angle = c + d
      const { x: ix, z: iz, height } = outerEdgeAt(angle, structure)
      const roofY = height * 1.06
      const len = Math.hypot(ix, iz) || 1
      const dirX = ix / len
      const dirZ = iz / len
      const midX = ix + dirX * overhang * 0.5
      const midZ = iz + dirZ * overhang * 0.5
      const tangentAngle = angle + Math.PI / 2
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
      const m = new THREE.Matrix4()
      m.compose(new THREE.Vector3(midX, roofY - 0.35, midZ), quat, new THREE.Vector3(0.45, 0.5, overhang))
      matrices.push(m)
    }
  }
  return matrices
}

/** Small emissive light fixtures mounted under the roof edge, replacing free-standing floodlight poles entirely - always physically attached to the roof structure, never floating in open space. */
export function computeRoofLightInstances(structure: Stadium3DStructure): THREE.Matrix4[] {
  if (structure.roofCoverage <= 0.05) return []
  const overhang = Math.max(4, structure.standDepth * 0.18)
  const halfArcPerSide = (Math.PI / 4) * structure.roofCoverage
  const sideCenters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
  const matrices: THREE.Matrix4[] = []

  for (const c of sideCenters) {
    for (const frac of [-0.6, 0, 0.6]) {
      const angle = c + frac * halfArcPerSide
      const { x: ix, z: iz, height } = outerEdgeAt(angle, structure)
      const roofY = height * 1.06
      const len = Math.hypot(ix, iz) || 1
      const dirX = ix / len
      const dirZ = iz / len
      const lightX = ix + dirX * overhang * 0.3
      const lightZ = iz + dirZ * overhang * 0.3
      const tangentAngle = angle + Math.PI / 2
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
      const m = new THREE.Matrix4()
      m.compose(new THREE.Vector3(lightX, roofY - 0.9, lightZ), quat, new THREE.Vector3(2.4, 0.8, 1.2))
      matrices.push(m)
    }
  }
  return matrices
}

/** Procedural pitch texture (lines only - the pitch's own size/color never changes with capacity). */
export function createPitchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  const scale = 8 // px per meter
  canvas.width = PITCH_LENGTH * scale
  canvas.height = PITCH_WIDTH * scale
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = "#1B7031"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Mow stripes, richer contrast than a flat fill.
  const stripeCount = 14
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)"
    ctx.fillRect((i / stripeCount) * canvas.width, 0, canvas.width / stripeCount, canvas.height)
  }

  // Subtle vignette toward the touchlines/end-lines - a flat fill read as
  // thin and synthetic; a little darkening at the edges gives the grass
  // real depth instead of looking like a solid color card.
  const vignette = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.15,
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.75
  )
  vignette.addColorStop(0, "rgba(0,0,0,0)")
  vignette.addColorStop(1, "rgba(0,20,6,0.16)")
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.strokeStyle = "#F5FFF7"
  ctx.lineWidth = scale * 0.2
  const pad = scale * 2
  ctx.strokeRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2)
  ctx.beginPath()
  ctx.moveTo(canvas.width / 2, pad)
  ctx.lineTo(canvas.width / 2, canvas.height - pad)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(canvas.width / 2, canvas.height / 2, scale * 9.15, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(canvas.width / 2, canvas.height / 2, scale * 0.3, 0, Math.PI * 2)
  ctx.fillStyle = "#F5FFF7"
  ctx.fill()

  const boxW = scale * 16.5
  const boxH = scale * 40.3
  const sixYardW = scale * 5.5
  const sixYardH = scale * 18.3
  ctx.strokeRect(pad, canvas.height / 2 - boxH / 2, boxW, boxH)
  ctx.strokeRect(pad, canvas.height / 2 - sixYardH / 2, sixYardW, sixYardH)
  ctx.strokeRect(canvas.width - pad - boxW, canvas.height / 2 - boxH / 2, boxW, boxH)
  ctx.strokeRect(canvas.width - pad - sixYardW, canvas.height / 2 - sixYardH / 2, sixYardW, sixYardH)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
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
