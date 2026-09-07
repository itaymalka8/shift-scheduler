import * as THREE from "three"
import { type Stadium3DStructure } from "@/lib/stadium/stadium3d-config"
import {
  buildPitchMarkings,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  HALF_LENGTH,
  HALF_WIDTH,
  type PitchEnd,
} from "@/lib/stadium/pitch-geometry"
import { boundaryPoint, buildSectionLayout, cornerCloseness } from "./stadium-geometry"

/**
 * Everything that turns the structural bowl into a MATCH: the crowd in the
 * stands, the goals, the LED perimeter, and the floodlight masts.
 *
 * All of it is placed from the same two coordinate systems the rest of the
 * stadium already uses - pitch meters (pitch-geometry.ts) for anything on or
 * around the pitch, and the stand's angular boundary math (stadium-geometry.ts)
 * for anything in the stands - so nothing here is positioned by eye.
 *
 * WORLD AXES: world x = pitch x (along the length), world z = pitch y (across
 * the width), world y = up. The pitch plane is PITCH_LENGTH x PITCH_WIDTH and
 * the pitch is symmetric across both axes, so this mapping is direction-safe.
 */

/** Deterministic pseudo-random in [0,1) - a pure hash, never Math.random, so a crowd never re-shuffles between renders. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

// --- Crowd ------------------------------------------------------------------

export type CrowdStyle = "calm" | "ultras"

/** Rendering budget. Chosen by the device, not the design - see useSceneQuality. */
export type SceneQuality = "high" | "medium" | "low"

/** Spectators per stand row at each quality level. The stand geometry is identical; only the crowd density changes. */
const CROWD_PER_ROW: Record<SceneQuality, number> = { high: 26, medium: 16, low: 8 }
/** Hard ceiling on instances, so a huge stadium can never blow the budget. */
const CROWD_INSTANCE_CAP: Record<SceneQuality, number> = { high: 24_000, medium: 12_000, low: 5_000 }

/**
 * The crowd's base tones: charcoal, navy and grey, the way a stand actually
 * looks at night. Club colour is an ACCENT layered on top, never the base -
 * get that ratio wrong and the bowl stops reading as people and starts
 * reading as a coloured mosaic.
 */
const CROWD_NEUTRALS = ["#2E3138", "#343A45", "#26292F", "#3B3F47", "#2A303B", "#41454C"]
/** Muted clothing catching the floodlights - coats, grey knitwear, the odd off-white jacket. */
const CROWD_CLOTHING = ["#6C717A", "#787D86", "#585E68", "#8A8D93", "#616770", "#7E7A72", "#4C525B", "#93918B"]

/**
 * How far from the camera each level of detail gives out, in meters. Anything
 * nearer than NEAR reads as an individual person and gets a real silhouette;
 * past FAR a spectator is a couple of pixels and a billboard is honest.
 */
const CROWD_LOD_NEAR_M = 42
const CROWD_LOD_MID_M = 95

/** Share of the crowd that is actually moving at any moment. A whole stand bobbing in unison is the tell of a generated crowd. */
const CROWD_MOTION_SHARE = { calm: 0.03, ultras: 0.08 } as const

/** One level of detail's worth of spectators, ready to hand to a single instanced mesh. */
export interface CrowdLodGroup {
  matrices: THREE.Matrix4[]
  colors: THREE.Color[]
  /** Per-instance animation phase, fed to the shader so movement is a GPU job, not a per-frame CPU loop. */
  phases: Float32Array
  /** Per-instance motion amplitude in meters. Zero for the great majority - only a small share of any crowd is actually moving. */
  amplitudes: Float32Array
}

/**
 * The crowd, split by distance from the broadcast camera. Near spectators get
 * a real head-and-shoulders silhouette, mid ones a cheaper one, and the far
 * bank a flat billboard - so the rows you can actually resolve are people,
 * and the ones you cannot cost almost nothing.
 */
export interface CrowdInstances {
  near: CrowdLodGroup
  mid: CrowdLodGroup
  far: CrowdLodGroup
}

export interface CrowdOptions {
  crowdStyle: CrowdStyle
  quality: SceneQuality
  primaryColor: string
  secondaryColor: string
  /**
   * Which end the home support occupies, as an angle in the stand's own
   * angular system. Math.PI is the -x end; 0 is the +x end.
   */
  homeEndAngle?: number
  /**
   * Where the shot is taken from, in world meters. Only used to pick each
   * spectator's level of detail - the crowd itself is identical wherever the
   * camera stands, so moving it never re-shuffles anybody.
   */
  cameraPosition?: [number, number, number]
}

/**
 * The crowd: spectators standing on the real seat rows (the same section/row/
 * tier math computeSeatingBlockInstances uses), so people are always ON seats
 * - never floating, never in the aisles.
 *
 * Each person is sorted into a level of detail by their distance from the
 * camera, and the caller draws each level with its own silhouette geometry.
 * The placement, colour and motion of a given spectator never depend on that
 * distance, so the crowd is the same crowd at any camera - only the mesh it is
 * drawn with changes.
 *
 * Club colour concentrates in the home end (heavily for ultras); the rest of
 * the bowl stays in charcoal, navy and grey.
 */
export function computeCrowdInstances(structure: Stadium3DStructure, options: CrowdOptions): CrowdInstances {
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, visualRowCount, cornerFill, tierCount } = structure
  const { crowdStyle, quality, primaryColor, secondaryColor } = options
  const homeEndAngle = options.homeEndAngle ?? Math.PI
  const [camX, camY, camZ] = options.cameraPosition ?? [0, standHeight, innerHalfWidth + standDepth]

  const groups: Record<"near" | "mid" | "far", CrowdLodGroup & { phaseList: number[]; amplitudeList: number[] }> = {
    near: { matrices: [], colors: [], phases: new Float32Array(0), amplitudes: new Float32Array(0), phaseList: [], amplitudeList: [] },
    mid: { matrices: [], colors: [], phases: new Float32Array(0), amplitudes: new Float32Array(0), phaseList: [], amplitudeList: [] },
    far: { matrices: [], colors: [], phases: new Float32Array(0), amplitudes: new Float32Array(0), phaseList: [], amplitudeList: [] },
  }
  let placed = 0

  const slots = buildSectionLayout(structure)
  const perRow = CROWD_PER_ROW[quality]
  const cap = CROWD_INSTANCE_CAP[quality]

  const primary = new THREE.Color(primaryColor)
  const secondary = new THREE.Color(secondaryColor)
  const neutrals = CROWD_NEUTRALS.map((c) => new THREE.Color(c))
  const clothing = CROWD_CLOTHING.map((c) => new THREE.Color(c))

  const isUltras = crowdStyle === "ultras"
  // How far around the ring the home support spreads, and how strongly it
  // takes over the palette there.
  const homeEndSpread = isUltras ? 0.42 : 0.7
  const homeEndSaturation = isUltras ? 0.68 : 0.1
  const baseAmplitude = isUltras ? 0.1 : 0.045
  const motionShare = CROWD_MOTION_SHARE[isUltras ? "ultras" : "calm"]

  const concourseGap = tierCount > 1 ? 0.1 : 0
  const tierSpan = 1 / tierCount
  const effectiveRowCount = Math.max(1, visualRowCount)

  // Row stride keeps the crowd within budget without changing the stand:
  // at low quality we populate every other row rather than shrinking the bowl.
  const estimatedTotal = slots.length * effectiveRowCount * tierCount * perRow
  const rowStride = Math.max(1, Math.ceil(estimatedTotal / cap))

  let seed = 0

  for (let tier = 0; tier < tierCount; tier++) {
    const tierStart = tier * tierSpan
    const tierEnd = tierStart + tierSpan * (1 - concourseGap)
    const tierShade = 1 - tier * 0.18

    for (const slot of slots) {
      const centerAngle = slot.centerAngle
      const [cx, cz] = boundaryPoint(centerAngle, innerHalfLength, innerHalfWidth, cornerFill)
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
      const tangentX = Math.cos(tangentAngle)
      const tangentZ = Math.sin(tangentAngle)

      // Occupancy varies section to section: some blocks are packed, others
      // have visible gaps. An evenly-filled ring is the single biggest tell
      // that a crowd was generated rather than gathered.
      const sectionFill = 0.74 + pseudoRandom(slot.centerAngle * 37.7) * 0.26

      // Angular distance from this section to the home end, 0..1.
      const rawDelta = Math.abs(centerAngle - homeEndAngle) % (Math.PI * 2)
      const angularDelta = Math.min(rawDelta, Math.PI * 2 - rawDelta) / Math.PI
      const homeAffinity = Math.max(0, 1 - angularDelta / homeEndSpread)

      for (let r = 0; r < effectiveRowCount; r += rowStride) {
        const t0 = r / effectiveRowCount
        const t1 = (r + 1) / effectiveRowCount
        const radiusOffset = baseRadiusOffset + depthHere * t0
        const stepDepth = depthHere * (t1 - t0)
        const rowTopY = baseY + heightHere * t1

        const avgRadius = len + radiusOffset + stepDepth * 0.5
        const rowWidth = Math.max(1, 2 * avgRadius * Math.sin(slot.halfSpan))
        // Person size scales with the row's own step, so a shallow stand's
        // crowd never looks like giants and a deep one's never like ants.
        const personHeightBase = Math.min(1.3, Math.max(0.8, stepDepth * 1.5))
        const personWidth = Math.min(0.6, Math.max(0.3, (rowWidth / perRow) * 0.9))

        const rowCenterX = cx + dirX * (radiusOffset + stepDepth * 0.5)
        const rowCenterZ = cz + dirZ * (radiusOffset + stepDepth * 0.5)

        for (let p = 0; p < perRow; p++) {
          seed++
          // Sparse gaps - a real stand is never 100% occupied.
          const occupancyRoll = pseudoRandom(seed * 1.71)
          // Home-end support turns up; the far corners thin out.
          const occupancy = Math.min(0.97, sectionFill * (isUltras ? 1.12 : 1) + homeAffinity * 0.22)
          if (occupancyRoll > occupancy) continue

          const alongRow = ((p + 0.5) / perRow - 0.5) * rowWidth
          const jitter = (pseudoRandom(seed * 2.13 + 7) - 0.5) * personWidth * 0.5
          const offset = alongRow + jitter

          const px = rowCenterX + tangentX * offset
          const pz = rowCenterZ + tangentZ * offset
          const py = rowTopY + personHeightBase * 0.5

          // Height varies per person - some standing, some seated, some just
          // taller. A row of identical blocks is the other big giveaway.
          const personHeight = personHeightBase * (0.72 + pseudoRandom(seed * 10.7 + 41) * 0.62)
          // Everyone faces the pitch, with a few degrees of slop so a row is
          // never a rank of identically-aimed figures.
          const facing = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -tangentAngle + (pseudoRandom(seed * 12.4 + 61) - 0.5) * 0.5
          )
          const m = new THREE.Matrix4()
          m.compose(
            new THREE.Vector3(px, py - (personHeightBase - personHeight) * 0.5, pz),
            facing,
            new THREE.Vector3(personWidth, personHeight, personWidth)
          )

          // Level of detail from the real distance to the lens.
          const dist = Math.hypot(px - camX, py - camY, pz - camZ)
          const group = dist < CROWD_LOD_NEAR_M ? groups.near : dist < CROWD_LOD_MID_M ? groups.mid : groups.far
          group.matrices.push(m)

          // Palette. Three bands, in this order of frequency:
          //   1. dark silhouettes (always the majority - this is what makes it
          //      read as a crowd rather than as upholstery),
          //   2. muted clothing catching the floodlights,
          //   3. club colour, concentrated in the home end and a minority even
          //      there.
          const clubRoll = pseudoRandom(seed * 3.37 + 19)
          const clubChance = homeAffinity * homeEndSaturation
          let color: THREE.Color
          if (clubRoll < clubChance) {
            color = pseudoRandom(seed * 9.13 + 31) < 0.6 ? primary.clone() : secondary.clone()
            // Wide brightness spread so even a club-coloured block has grain -
            // and lifted in the home end, where the point is that you can see
            // it from the other side of the ground.
            color.multiplyScalar((isUltras ? 0.75 : 0.42) + pseudoRandom(seed * 4.11 + 3) * 0.5)
          } else if (clubRoll < clubChance + 0.42) {
            color = clothing[Math.floor(pseudoRandom(seed * 8.21 + 23) * clothing.length)].clone()
            color.multiplyScalar(0.6 + pseudoRandom(seed * 6.07 + 5) * 0.32)
          } else {
            color = neutrals[Math.floor(pseudoRandom(seed * 5.29 + 11) * neutrals.length)].clone()
            color.multiplyScalar(0.74 + pseudoRandom(seed * 6.07 + 5) * 0.42)
          }
          // Upper rows sit further from the light, exactly like the seats.
          color.multiplyScalar(0.98 * (0.82 + tierShade * 0.18) * (1 - t0 * 0.1))
          group.colors.push(color)

          group.phaseList.push(pseudoRandom(seed * 7.53 + 13) * Math.PI * 2)
          // Only a small share of any crowd is moving at a given moment, and
          // that share sits in the home end. Everyone else is still: a stand
          // where every spectator bobs is the clearest tell of a generated
          // crowd there is.
          const movingRoll = pseudoRandom(seed * 13.9 + 71)
          const movingChance = motionShare * (0.4 + homeAffinity * 2.2)
          group.amplitudeList.push(
            movingRoll < movingChance ? baseAmplitude * (0.6 + pseudoRandom(seed * 8.9 + 2) * 0.8) : 0
          )

          placed++
          if (placed >= cap) break
        }
        if (placed >= cap) break
      }
      if (placed >= cap) break
    }
    if (placed >= cap) break
  }

  const seal = (g: (typeof groups)["near"]): CrowdLodGroup => ({
    matrices: g.matrices,
    colors: g.colors,
    phases: new Float32Array(g.phaseList),
    amplitudes: new Float32Array(g.amplitudeList),
  })
  return { near: seal(groups.near), mid: seal(groups.mid), far: seal(groups.far) }
}

/**
 * A spectator, as a head, shoulders and body: two stacked lathe-free primitives
 * merged into ONE geometry so the whole crowd is still a single instanced draw
 * call per level of detail.
 *
 * Built in a 1x1x1 box centred on the origin, because the instance matrices
 * scale it to each person's real width and height.
 *
 * @param detail 2 = near (rounded head, tapered torso), 1 = mid (coarser),
 *               0 = far (a flat billboard, which at that range is what a
 *               person occupying two pixels honestly is).
 */
export function createSpectatorGeometry(detail: 0 | 1 | 2): THREE.BufferGeometry {
  if (detail === 0) {
    // Far bank: an upright quad. Cheap, and from 100m the silhouette is all
    // that survives anyway.
    return new THREE.PlaneGeometry(1, 1)
  }

  const radial = detail === 2 ? 10 : 6
  const parts: THREE.BufferGeometry[] = []

  // Head: a little under a fifth of the body, sitting on top.
  const headR = 0.17
  const head = new THREE.SphereGeometry(headR, radial, detail === 2 ? 8 : 4)
  head.scale(1, 1.1, 0.92)
  head.translate(0, 0.5 - headR * 1.15, 0)
  parts.push(head)

  // Neck/shoulders: the taper from head to torso is what makes the silhouette
  // read as a person rather than as a pillar.
  const shoulders = new THREE.CylinderGeometry(0.19, 0.44, 0.14, radial, 1, true)
  shoulders.scale(1, 1, 0.78)
  shoulders.translate(0, 0.5 - headR * 2.3 - 0.07, 0)
  parts.push(shoulders)

  // Torso: wider at the shoulders than at the seat, and slightly flattened
  // front-to-back so a person is not a cylinder from above.
  const torso = new THREE.CylinderGeometry(0.44, 0.32, 0.74, radial, 1, false)
  torso.scale(1, 1, 0.74)
  torso.translate(0, -0.15, 0)
  parts.push(torso)

  const merged = mergeGeometries(parts)
  parts.forEach((p) => p.dispose())
  return merged
}

/**
 * Concatenates a few small non-indexed geometries into one. Three ships this
 * as an addon (BufferGeometryUtils); inlining the two attributes we actually
 * use keeps the crowd off a second import path.
 */
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  for (const g of geometries) {
    const src = g.index ? g.toNonIndexed() : g
    const pos = src.getAttribute("position")
    const nor = src.getAttribute("normal")
    const uv = src.getAttribute("uv")
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i))
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i))
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0)
    }
    if (src !== g) src.dispose()
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
  return out
}

// --- Flags and banners (ultras) ---------------------------------------------

export interface FlagInstance {
  position: THREE.Vector3
  rotationY: number
  width: number
  height: number
  color: string
  phase: number
}

/**
 * Large waving flags, concentrated in the home end - the visual signature of
 * an ultras section. Placed on the stand's own boundary, a few rows up, so
 * they rise out of the crowd rather than hovering over it.
 */
export function computeFlagInstances(structure: Stadium3DStructure, options: CrowdOptions): FlagInstance[] {
  const { crowdStyle, primaryColor, secondaryColor } = options
  const homeEndAngle = options.homeEndAngle ?? Math.PI
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, cornerFill } = structure

  const count = crowdStyle === "ultras" ? 18 : 2
  const spreadRad = crowdStyle === "ultras" ? 0.55 : 0.3
  const flags: FlagInstance[] = []

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const angle = homeEndAngle + (t - 0.5) * spreadRad
    const [cx, cz] = boundaryPoint(angle, innerHalfLength, innerHalfWidth, cornerFill)
    const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
    const localScale = 1 - closeness * (1 - cornerFill) * 0.85

    // Sit them partway up the stand, staggered so they don't form a line.
    const rowFrac = 0.25 + pseudoRandom(i * 3.7) * 0.45
    const len = Math.hypot(cx, cz) || 1
    const dirX = cx / len
    const dirZ = cz / len
    const radiusOffset = standDepth * localScale * rowFrac
    const y = standHeight * localScale * rowFrac

    const size = crowdStyle === "ultras" ? 3.4 + pseudoRandom(i * 5.1 + 2) * 2.2 : 2
    flags.push({
      position: new THREE.Vector3(cx + dirX * radiusOffset, y + size * 0.5 + 0.8, cz + dirZ * radiusOffset),
      rotationY: -(angle + Math.PI / 2),
      width: size,
      height: size * 0.68,
      color: i % 2 === 0 ? primaryColor : secondaryColor,
      phase: pseudoRandom(i * 7.9 + 4) * Math.PI * 2,
    })
  }

  return flags
}

/**
 * Tifo-style banners draped along the front rail of the home end. Abstract
 * blocks of club color, never lettering - readable as a supporters' display
 * at broadcast distance without pretending to render real text.
 */
export function computeBannerInstances(
  structure: Stadium3DStructure,
  options: CrowdOptions
): { matrices: THREE.Matrix4[]; colors: THREE.Color[] } {
  if (options.crowdStyle !== "ultras") return { matrices: [], colors: [] }

  const homeEndAngle = options.homeEndAngle ?? Math.PI
  const { innerHalfLength, innerHalfWidth, standDepth, standHeight, cornerFill } = structure
  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []

  const primary = new THREE.Color(options.primaryColor)
  const secondary = new THREE.Color(options.secondaryColor)
  const count = 9

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const angle = homeEndAngle + (t - 0.5) * 0.5
    const [cx, cz] = boundaryPoint(angle, innerHalfLength, innerHalfWidth, cornerFill)
    const closeness = cornerCloseness(cx, cz, innerHalfLength, innerHalfWidth)
    const localScale = 1 - closeness * (1 - cornerFill) * 0.85
    const len = Math.hypot(cx, cz) || 1
    const dirX = cx / len
    const dirZ = cz / len

    const rowFrac = 0.08 + (i % 2) * 0.05
    const radiusOffset = standDepth * localScale * rowFrac
    const y = standHeight * localScale * rowFrac
    const avgRadius = len + radiusOffset
    const width = Math.max(4, avgRadius * 0.17)

    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(angle + Math.PI / 2))
    const m = new THREE.Matrix4()
    m.compose(
      new THREE.Vector3(cx + dirX * radiusOffset, y + 0.9, cz + dirZ * radiusOffset),
      quat,
      new THREE.Vector3(width, 2.1, 0.12)
    )
    matrices.push(m)
    colors.push(i % 2 === 0 ? primary.clone() : secondary.clone().multiplyScalar(0.9))
  }

  return { matrices, colors }
}

// --- Goals ------------------------------------------------------------------

export interface GoalFrame {
  /** Post/crossbar bar segments, as (position, rotation, length) in world space. */
  bars: { position: THREE.Vector3; rotationZ: number; rotationX: number; length: number }[]
  /** Net panels: back, two sides, and the roof of the net. */
  panels: { position: THREE.Vector3; rotationY: number; rotationX: number; width: number; height: number }[]
}

export const GOAL_POST_RADIUS = 0.06 // 12cm posts, per the Laws

/**
 * A real goal at each end: two posts, a crossbar, and a net box behind the
 * goal line. Built from the regulation goal mouth in pitch-geometry.ts, so
 * the posts land exactly on the goal line and exactly GOAL_WIDTH apart.
 */
export function buildGoalFrames(): GoalFrame[] {
  const markings = buildPitchMarkings()

  return markings.goals.map((goal, index) => {
    const end: PitchEnd = index === 0 ? -1 : 1
    const x = goal.line[0].x
    const halfW = GOAL_WIDTH / 2
    // The net extends AWAY from the pitch, behind the goal line.
    const backX = x + end * GOAL_DEPTH

    const bars: GoalFrame["bars"] = [
      // Two posts (vertical).
      { position: new THREE.Vector3(x, GOAL_HEIGHT / 2, -halfW), rotationZ: 0, rotationX: 0, length: GOAL_HEIGHT },
      { position: new THREE.Vector3(x, GOAL_HEIGHT / 2, halfW), rotationZ: 0, rotationX: 0, length: GOAL_HEIGHT },
      // Crossbar (horizontal, spanning the goal width along z).
      { position: new THREE.Vector3(x, GOAL_HEIGHT, 0), rotationZ: 0, rotationX: Math.PI / 2, length: GOAL_WIDTH },
    ]

    const panels: GoalFrame["panels"] = [
      // Back of the net.
      {
        position: new THREE.Vector3(backX, GOAL_HEIGHT / 2, 0),
        rotationY: Math.PI / 2,
        rotationX: 0,
        width: GOAL_WIDTH,
        height: GOAL_HEIGHT,
      },
      // Two sides.
      {
        position: new THREE.Vector3(x + (end * GOAL_DEPTH) / 2, GOAL_HEIGHT / 2, -halfW),
        rotationY: 0,
        rotationX: 0,
        width: GOAL_DEPTH,
        height: GOAL_HEIGHT,
      },
      {
        position: new THREE.Vector3(x + (end * GOAL_DEPTH) / 2, GOAL_HEIGHT / 2, halfW),
        rotationY: 0,
        rotationX: 0,
        width: GOAL_DEPTH,
        height: GOAL_HEIGHT,
      },
      // Roof of the net.
      {
        position: new THREE.Vector3(x + (end * GOAL_DEPTH) / 2, GOAL_HEIGHT, 0),
        rotationY: 0,
        rotationX: Math.PI / 2,
        width: GOAL_DEPTH,
        height: GOAL_WIDTH,
      },
    ]

    return { bars, panels }
  })
}

/** A net texture: a fine mesh grid, transparent between the strands. Cheaper and cleaner than modelling strands. */
export function createNetTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = "rgba(255,255,255,0.82)"
  ctx.lineWidth = 1.2
  const cells = 16
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * size
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(6, 3)
  return texture
}

// --- LED advertising boards -------------------------------------------------

export interface LedBoardInstance {
  position: THREE.Vector3
  rotationY: number
  width: number
  colorIndex: number
}

const LED_HEIGHT = 0.95
const LED_MARGIN = 2.6 // meters from the touchline/goal line out to the boards

/**
 * The LED perimeter: a continuous run of boards around all four sides of the
 * pitch, standing just outside the lines and facing in. Segment positions come
 * from the pitch rectangle itself, so the run always frames the real playing
 * area rather than an approximate oval.
 */
export function computeLedBoardInstances(): LedBoardInstance[] {
  const boards: LedBoardInstance[] = []
  const outerX = HALF_LENGTH + LED_MARGIN
  const outerZ = HALF_WIDTH + LED_MARGIN

  // Long sides (touchlines) - the ones a broadcast camera actually sees.
  const longRun = PITCH_LENGTH_RUN
  const longSegments = 22
  const longWidth = longRun / longSegments
  for (let i = 0; i < longSegments; i++) {
    const x = -longRun / 2 + longWidth * (i + 0.5)
    boards.push({ position: new THREE.Vector3(x, LED_HEIGHT / 2, -outerZ), rotationY: 0, width: longWidth * 0.94, colorIndex: i })
    boards.push({ position: new THREE.Vector3(x, LED_HEIGHT / 2, outerZ), rotationY: Math.PI, width: longWidth * 0.94, colorIndex: i + 1 })
  }

  // Short sides (behind each goal).
  const shortRun = PITCH_WIDTH_RUN
  const shortSegments = 14
  const shortWidth = shortRun / shortSegments
  for (let i = 0; i < shortSegments; i++) {
    const z = -shortRun / 2 + shortWidth * (i + 0.5)
    boards.push({
      position: new THREE.Vector3(-outerX, LED_HEIGHT / 2, z),
      rotationY: Math.PI / 2,
      width: shortWidth * 0.94,
      colorIndex: i,
    })
    boards.push({
      position: new THREE.Vector3(outerX, LED_HEIGHT / 2, z),
      rotationY: -Math.PI / 2,
      width: shortWidth * 0.94,
      colorIndex: i + 1,
    })
  }

  return boards
}

// The LED run is slightly longer/wider than the pitch so it wraps the corners.
const PITCH_LENGTH_RUN = HALF_LENGTH * 2 + LED_MARGIN * 1.2
const PITCH_WIDTH_RUN = HALF_WIDTH * 2 - LED_MARGIN * 0.4

export const LED_BOARD_HEIGHT = LED_HEIGHT

// --- Floodlight masts -------------------------------------------------------

export interface FloodlightMast {
  position: THREE.Vector3
  height: number
  /** World-space point the mast's lamps aim at. */
  target: THREE.Vector3
  lampCount: number
  rotationY: number
}

/**
 * Corner floodlight masts, for grounds whose roof doesn't already carry the
 * lighting. Placed just outside the bowl's own corner, angled in at the
 * center of the pitch, so they read as part of the ground's structure.
 */
export function computeFloodlightMasts(structure: Stadium3DStructure): FloodlightMast[] {
  const { outerHalfLength, outerHalfWidth, standHeight } = structure
  const mastHeight = Math.max(28, standHeight * 1.9)
  const corners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]

  return corners.map(([sx, sz]) => {
    const x = sx * (outerHalfLength * 0.92)
    const z = sz * (outerHalfWidth * 0.92)
    return {
      position: new THREE.Vector3(x, 0, z),
      height: mastHeight,
      target: new THREE.Vector3(0, 0, 0),
      lampCount: 6,
      rotationY: Math.atan2(-z, -x),
    }
  })
}
