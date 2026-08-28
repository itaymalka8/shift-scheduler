import * as THREE from "three"
import { PITCH_LENGTH, PITCH_WIDTH, type Stadium3DStructure } from "@/lib/stadium/stadium3d-config"

const ANGULAR_STEPS = 96
const SQUIRCLE_EXPONENT = 6 // 2 = pure ellipse, higher = closer to a sharp rectangle

// GoalX brand tokens only, per the brief - deep purple, brand-accent purple,
// white, light lavender-gray for seats; neutral grays for concrete/roof/metal
// so those materials read as structure, not brand color.
const SEAT_PALETTE = ["#2A2158", "#FFFFFF", "#EDEAF7", "#3B2F7A"]
const VIP_COLOR = "#6C4FD9"
// Warm-neutral (not blue-leaning) so it stays visually distinct from every
// entry in SEAT_PALETTE, all of which are cool/blue-family hues - a
// cool-gray concrete let the white/lavender seat blocks blend into it at a
// distance, reading as bare gaps in the seating rather than actual blocks.
const CONCRETE_COLOR = "#A6A199"
const CONCRETE_DARK = "#878177"

/** A point on a "squircle" (superellipse) boundary - a fixed rounded-rectangle-like footprint every stand shares. */
function squirclePoint(angle: number, halfLength: number, halfWidth: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / SQUIRCLE_EXPONENT) * halfLength
  const z = Math.sign(s) * Math.pow(Math.abs(s), 2 / SQUIRCLE_EXPONENT) * halfWidth
  return [x, z]
}

/** 0 along the middle of a straight side, 1 at a true corner of the bounding rectangle - used to taper the corner stand height/depth down as cornerFill drops. */
function cornerCloseness(x: number, z: number, halfLength: number, halfWidth: number): number {
  return Math.min(1, Math.abs(x / halfLength) * Math.abs(z / halfWidth))
}

/**
 * The stand's true outer-rim point at a given angle - same corner-tapering
 * math buildLoftedRing uses at its far (t=1) edge, factored out so anything
 * that needs to sit flush against the actual outer edge (the facade wall,
 * entrance portals) agrees with where the ramp really ends, instead of
 * assuming a fixed outerHalfLength/outerHalfWidth squircle that only holds
 * along the straight sides, not at the tapered corners.
 */
function outerEdgeAt(angle: number, structure: Stadium3DStructure): { x: number; z: number; height: number } {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, cornerFill } = structure
  const [ix, iz] = squirclePoint(angle, innerHalfLength, innerHalfWidth)
  const closeness = cornerCloseness(ix, iz, innerHalfLength, innerHalfWidth)
  const localScale = 1 - closeness * (1 - cornerFill) * 0.85
  const len = Math.hypot(ix, iz) || 1
  const dirX = ix / len
  const dirZ = iz / len
  const depthHere = standDepth * localScale
  return { x: ix + dirX * depthHere, z: iz + dirZ * depthHere, height: standHeight * localScale }
}

/**
 * One continuous lofted ramp surface, plain concrete-colored - this is the
 * stand's structural shell: it's what actually shows through in the aisle
 * gaps between seating blocks (see computeSeatingBlockInstances), and gives
 * the whole ring a solid base even where a seating block's corners round
 * off. Not the seats themselves - those are separate instanced blocks on
 * top of this shell.
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
    const [ix, iz] = squirclePoint(angle, innerHalfLength, innerHalfWidth)
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
 * A vertical outer wall from the ground up to the ramp's actual outer-top
 * edge, following the same corner taper as the shell. Without this, the
 * space beneath the sloped ramp is an open void - anything placed at ground
 * level near the outer radius (entrance portals) reads as floating debris
 * because there is nothing there for it to attach to. This wall also gives
 * the stand the "clear outer edge" the reference photo has.
 */
export function buildOuterFacadeGeometry(structure: Stadium3DStructure): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (let i = 0; i <= ANGULAR_STEPS; i++) {
    const angle = (i / ANGULAR_STEPS) * Math.PI * 2
    const { x, z, height } = outerEdgeAt(angle, structure)
    positions.push(x, 0, z, x, height, z)
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

export interface InstancedBlockData {
  matrices: THREE.Matrix4[]
  colors: THREE.Color[]
}

/**
 * The actual seating - one instanced box per (section, row, tier), colored
 * per section (a genuine color-by-block palette, not color-by-row), with a
 * gap left between adjacent sections' angular slots so the concrete shell
 * shows through as an aisle. VIP sections cluster near the two halfway-line
 * points (touchline stands), like a real ground.
 */
export function computeSeatingBlockInstances(structure: Stadium3DStructure): InstancedBlockData {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, sectionCount, visualRowCount, cornerFill, vipSections, tierCount } =
    structure
  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []
  const seatFraction = 0.85 // rest of each section's angular slot is the aisle gap

  const palette = SEAT_PALETTE.map((c) => new THREE.Color(c))
  const vipColor = new THREE.Color(VIP_COLOR)
  const sectionAngularSpan = (Math.PI * 2) / sectionCount
  const vipAnchorAngles = [Math.PI / 2, (3 * Math.PI) / 2]

  const sectionAngle = (s: number) => (s + 0.5) * sectionAngularSpan
  const distToNearestVipAnchor = (s: number) => {
    const a = sectionAngle(s)
    return Math.min(...vipAnchorAngles.map((va) => Math.min(Math.abs(a - va), Math.PI * 2 - Math.abs(a - va))))
  }
  const vipSectionIndices = new Set(
    Array.from({ length: sectionCount }, (_, s) => s)
      .sort((a, b) => distToNearestVipAnchor(a) - distToNearestVipAnchor(b))
      .slice(0, vipSections)
  )

  const concourseGap = tierCount > 1 ? 0.1 : 0
  const tierSpan = 1 / tierCount

  for (let tier = 0; tier < tierCount; tier++) {
    const tierStart = tier * tierSpan
    const tierEnd = tierStart + tierSpan * (1 - concourseGap)

    for (let s = 0; s < sectionCount; s++) {
      const isVip = vipSectionIndices.has(s)
      const color = isVip ? vipColor : palette[s % palette.length]
      const centerAngle = sectionAngle(s)
      const angularHalfSpan = (sectionAngularSpan * seatFraction) / 2

      const [cx, cz] = squirclePoint(centerAngle, innerHalfLength, innerHalfWidth)
      const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
      const localScale = 1 - closeness * (1 - cornerFill) * 0.85
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

      // Individual rows are grouped into thicker "bands" of ROWS_PER_BAND for
      // the actual instanced step - one instance per row, at this angle and
      // distance, reads as fine hatching/wireframe rather than real steps.
      // Fewer, taller bands read as an actual staircase instead.
      const ROWS_PER_BAND = 2
      const bandCount = Math.max(1, Math.ceil(visualRowCount / ROWS_PER_BAND))

      // A real horizontal walkway (concourse) cutting across the stand partway
      // up - the shell shows through here as a bare concrete strip, breaking
      // the seating into a lower and upper block instead of one continuous
      // field of rows, even for a single-tier stand.
      const walkwayBand = bandCount >= 4 ? Math.round(bandCount * 0.55) : -1

      for (let band = 0; band < bandCount; band++) {
        if (band === walkwayBand) continue
        const r0 = band * ROWS_PER_BAND
        const r1 = Math.min(visualRowCount, r0 + ROWS_PER_BAND)
        const t0 = r0 / visualRowCount
        const t1 = r1 / visualRowCount
        const radiusOffset = baseRadiusOffset + depthHere * t0
        const stepDepth = depthHere * (t1 - t0)
        const y0 = baseY + heightHere * t0
        const stepRise = heightHere * (t1 - t0)

        // Seat blocks sit clearly ON the shell, not coincident with it - a
        // small lift (up + slightly forward, toward the pitch) keeps their
        // faces from z-fighting the shell surface right underneath them,
        // which otherwise washes every section color out to the shell's gray.
        const liftY = Math.max(0.35, standHeight * 0.02)
        const liftOut = Math.max(0.3, standDepth * 0.015)

        const posX = cx + dirX * (radiusOffset + stepDepth * 0.5 - liftOut)
        const posZ = cz + dirZ * (radiusOffset + stepDepth * 0.5 - liftOut)
        const posY = y0 + stepRise * 0.5 + liftY

        // A visible gap between one row's top and the next row's bottom -
        // the concrete shell shows through it as a riser line, which is
        // what actually reads as "many distinct rows rising" instead of one
        // solid sloped panel per section.
        const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
        const m = new THREE.Matrix4()
        m.compose(
          new THREE.Vector3(posX, posY, posZ),
          quat,
          new THREE.Vector3(blockWidth, Math.max(0.5, stepRise * 0.8), Math.max(0.5, stepDepth * 0.85))
        )
        matrices.push(m)
        colors.push(color)
      }
    }
  }

  return { matrices, colors }
}

/**
 * One entry-block per aisle, built flush against the outer facade wall (see
 * buildOuterFacadeGeometry) at ground level, protruding outward from it -
 * like a real gatehouse attached to the stadium's outer wall, not a chip
 * floating in the open void the sloped ramp leaves underneath itself.
 */
export function computeEntranceInstances(structure: Stadium3DStructure): THREE.Matrix4[] {
  const { standHeight, entranceCount } = structure
  const matrices: THREE.Matrix4[] = []
  const portalHeight = Math.max(3, standHeight * 0.28)
  const portalDepth = 5
  for (let i = 0; i < entranceCount; i++) {
    const angle = (i / entranceCount) * Math.PI * 2
    const { x, z } = outerEdgeAt(angle, structure)
    const len = Math.hypot(x, z) || 1
    const dirX = x / len
    const dirZ = z / len
    const tangentAngle = angle + Math.PI / 2
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -tangentAngle)
    const m = new THREE.Matrix4()
    m.compose(
      // Center the block ON the wall (half embedded, half protruding out),
      // at ground level, so it's always attached to solid geometry.
      new THREE.Vector3(x + dirX * (portalDepth * 0.4), portalHeight * 0.5, z + dirZ * (portalDepth * 0.4)),
      quat,
      new THREE.Vector3(5, portalHeight, portalDepth)
    )
    matrices.push(m)
  }
  return matrices
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

    // The roof's inner edge must sit exactly on the stand's real (corner-
    // tapered) rim - using the untapered outerHalfLength/outerHalfWidth
    // squircle here instead left a growing gap away from each side's center,
    // where the actual rim (shorter near corners) fell inside of it.
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

    // Same corner-tapered rim as the roof plate's inner edge (outerEdgeAt) -
    // must match exactly, or this wall's top and the roof's inner edge sit
    // at different radii/heights and visibly fail to meet.
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

/**
 * Fixed floodlight tower base positions, at GROUND level just outside the
 * facade wall - a previous version anchored these at y=standHeight (already
 * near the roofline), leaving only the tiny emissive head poking out above
 * the bowl as a small disconnected box with no visible tower beneath it.
 * Few enough (4) that individual meshes are fine; no instancing needed here.
 */
export function computeFloodlightPositions(structure: Stadium3DStructure): [number, number, number][] {
  const { outerHalfLength, outerHalfWidth } = structure
  const corners = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
  return corners.map((angle) => {
    const [x, z] = squirclePoint(angle, outerHalfLength * 1.12, outerHalfWidth * 1.12)
    return [x, 0, z] as [number, number, number]
  })
}

/** Procedural pitch texture (lines only - the pitch's own size/color never changes with capacity). */
export function createPitchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  const scale = 8 // px per meter
  canvas.width = PITCH_LENGTH * scale
  canvas.height = PITCH_WIDTH * scale
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = "#1F7A34"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Mow stripes, richer contrast than a flat fill.
  const stripeCount = 14
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"
    ctx.fillRect((i / stripeCount) * canvas.width, 0, canvas.width / stripeCount, canvas.height)
  }

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

export const CONCRETE_MATERIAL_COLOR = CONCRETE_COLOR
export const CONCRETE_MATERIAL_DARK = CONCRETE_DARK
