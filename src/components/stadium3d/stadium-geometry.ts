import * as THREE from "three"
import { PITCH_LENGTH, PITCH_WIDTH, type Stadium3DStructure } from "@/lib/stadium/stadium3d-config"

const ANGULAR_STEPS = 96
const SQUIRCLE_EXPONENT = 4 // 2 = pure ellipse, higher = closer to a sharp rectangle
const STRIPE_WORLD_WIDTH = 8 // meters per seat-color stripe repeat, so stripes stay a consistent size at any capacity

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
 * The stand ring as one lofted surface per tier - a ramp rising from the
 * inner edge (near the pitch, low) to the outer edge (away from the pitch,
 * high). Corners taper toward a thin sliver as cornerFill drops toward 0,
 * reading as "less developed" corners without literal holes in the mesh.
 * Row detail comes from a repeating texture (see createStandTexture), not
 * from extra geometry - this keeps the whole ring at ~2*(steps+1) vertices
 * per tier regardless of how many rows it visually shows.
 */
export function buildStandGeometry(structure: Stadium3DStructure): THREE.BufferGeometry {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, tierCount, cornerFill } = structure
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const concourseGap = tierCount > 1 ? 0.08 : 0

  for (let tier = 0; tier < tierCount; tier++) {
    const tierSpan = 1 / tierCount
    const tierStart = tier * tierSpan
    const tierEnd = tierStart + tierSpan * (1 - concourseGap)
    const vertsBefore = positions.length / 3

    for (let i = 0; i <= ANGULAR_STEPS; i++) {
      const angle = (i / ANGULAR_STEPS) * Math.PI * 2
      const [ix, iz] = squirclePoint(angle, innerHalfLength, innerHalfWidth)
      const closeness = cornerCloseness(ix, iz, innerHalfLength, innerHalfWidth)
      const localScale = 1 - closeness * (1 - cornerFill) * 0.85

      const depthHere = standDepth * localScale
      const heightHere = standHeight * localScale
      const len = Math.hypot(ix, iz) || 1
      const dirX = ix / len
      const dirZ = iz / len

      const bx0 = ix + dirX * depthHere * tierStart
      const bz0 = iz + dirZ * depthHere * tierStart
      const by0 = heightHere * tierStart

      const bx1 = ix + dirX * depthHere * tierEnd
      const bz1 = iz + dirZ * depthHere * tierEnd
      const by1 = heightHere * tierEnd

      positions.push(bx0, by0, bz0, bx1, by1, bz1)
      uvs.push(i / ANGULAR_STEPS, tier, i / ANGULAR_STEPS, tier + 1)
    }

    for (let i = 0; i < ANGULAR_STEPS; i++) {
      const a = vertsBefore + i * 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      indices.push(a, c, b, c, d, b)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Seat-colored rows, generated on an offscreen canvas - never a static image asset, rebuilt from rowCount/tierCount every time. */
export function createStandTexture(structure: Stadium3DStructure): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = "#EDEAF7"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Vertical purple accent stripes (GoalX brand color), sparse and even.
  ctx.fillStyle = "#3B2F7A"
  const stripeCount = 10
  const stripeWidth = canvas.width / stripeCount / 3
  for (let i = 0; i < stripeCount; i++) {
    const x = (i / stripeCount) * canvas.width
    ctx.fillRect(x, 0, stripeWidth, canvas.height)
  }

  // Horizontal row seams - one tier's worth, repeated once per tier via UV wrapping.
  const rowsPerTier = Math.max(3, Math.round(structure.rowCount / structure.tierCount))
  ctx.strokeStyle = "rgba(59, 47, 122, 0.35)"
  ctx.lineWidth = 1
  for (let r = 1; r < rowsPerTier; r++) {
    const y = (r / rowsPerTier) * canvas.height
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  const circumference = 2 * Math.PI * Math.max(structure.innerHalfLength, structure.innerHalfWidth)
  texture.repeat.set(Math.max(4, Math.round(circumference / STRIPE_WORLD_WIDTH)), 1)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A partial roof ring over the outer edge, growing out from the middle of each side as roofCoverage increases. */
export function buildRoofGeometry(structure: Stadium3DStructure): THREE.BufferGeometry | null {
  if (structure.roofCoverage <= 0.02) return null

  const { outerHalfLength, outerHalfWidth, standHeight } = structure
  const overhang = Math.max(4, structure.standDepth * 0.18)
  const roofY = standHeight * 1.04
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // Coverage grows outward (in angle) from each of the 4 side midpoints
  // (0, 90, 180, 270 deg) toward the corners as roofCoverage -> 1.
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

    const [ix, iz] = squirclePoint(angle, outerHalfLength, outerHalfWidth)
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
      // Only connect consecutive covered steps (a gap in coverage should not
      // bridge with a stray quad) - checked by re-deriving the previous
      // angle from vertCount.
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

/** One transform matrix per entrance marker, evenly spaced around the outer rim - fed straight into an InstancedMesh. */
export function computeEntranceMatrices(structure: Stadium3DStructure): THREE.Matrix4[] {
  const { outerHalfLength, outerHalfWidth, standHeight } = structure
  const matrices: THREE.Matrix4[] = []
  for (let i = 0; i < structure.entranceCount; i++) {
    const angle = (i / structure.entranceCount) * Math.PI * 2
    const [x, z] = squirclePoint(angle, outerHalfLength, outerHalfWidth)
    const m = new THREE.Matrix4()
    m.setPosition(x, standHeight * 0.18, z)
    matrices.push(m)
  }
  return matrices
}

/** Fixed floodlight tower positions - few enough (4) that individual meshes are fine; no instancing needed here. */
export function computeFloodlightPositions(structure: Stadium3DStructure): [number, number, number][] {
  const { outerHalfLength, outerHalfWidth, standHeight } = structure
  const corners = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]
  return corners.map((angle) => {
    const [x, z] = squirclePoint(angle, outerHalfLength * 1.05, outerHalfWidth * 1.05)
    return [x, standHeight, z] as [number, number, number]
  })
}

/** Procedural pitch texture (lines only - the pitch's own size/color never changes with capacity). */
export function createPitchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  const scale = 6 // px per meter
  canvas.width = PITCH_LENGTH * scale
  canvas.height = PITCH_WIDTH * scale
  const ctx = canvas.getContext("2d")!

  ctx.fillStyle = "#2E8B3D"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Mow stripes.
  ctx.fillStyle = "rgba(255,255,255,0.05)"
  const stripeCount = 12
  for (let i = 0; i < stripeCount; i += 2) {
    ctx.fillRect((i / stripeCount) * canvas.width, 0, canvas.width / stripeCount, canvas.height)
  }

  ctx.strokeStyle = "#FFFFFF"
  ctx.lineWidth = scale * 0.22
  const pad = scale * 2
  ctx.strokeRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2)
  ctx.beginPath()
  ctx.moveTo(canvas.width / 2, pad)
  ctx.lineTo(canvas.width / 2, canvas.height - pad)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(canvas.width / 2, canvas.height / 2, scale * 9.15, 0, Math.PI * 2)
  ctx.stroke()

  const boxW = scale * 16.5
  const boxH = scale * 40.3
  ctx.strokeRect(pad, canvas.height / 2 - boxH / 2, boxW, boxH)
  ctx.strokeRect(canvas.width - pad - boxW, canvas.height / 2 - boxH / 2, boxW, boxH)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
