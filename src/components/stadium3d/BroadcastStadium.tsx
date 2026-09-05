"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import {
  computeBroadcastCamera,
  computeStyledStructure,
  getStyleArchitecture,
  type Stadium3DStructure,
} from "@/lib/stadium/stadium3d-config"
import { GOAL_HEIGHT, HALF_LENGTH, HALF_WIDTH, PITCH_LENGTH, PITCH_WIDTH } from "@/lib/stadium/pitch-geometry"
import {
  buildConcourseFloorGeometry,
  buildOuterFacadeGeometry,
  buildPodiumWallGeometry,
  buildRoofFasciaGeometry,
  buildRoofGeometry,
  buildRoofUndersideGeometry,
  buildStandShellGeometry,
  computeRoofBeamInstances,
  computeRoofLightInstances,
  computeSectionDividerInstances,
  computeSeatingBlockInstances,
  createPitchTexture,
  METAL_MATERIAL_COLOR,
} from "./stadium-geometry"
import {
  buildGoalFrames,
  computeBannerInstances,
  computeCrowdInstances,
  createSpectatorGeometry,
  computeFlagInstances,
  computeFloodlightMasts,
  computeLedBoardInstances,
  createNetTexture,
  GOAL_POST_RADIUS,
  LED_BOARD_HEIGHT,
  type CrowdLodGroup,
  type CrowdStyle,
  type SceneQuality,
} from "./broadcast-geometry"

/**
 * The Match Center's stadium: the same structural engine the /stadium page
 * uses, shot and dressed as a live broadcast instead of an architectural
 * model - night lighting, a gantry camera on the halfway line, a real crowd
 * in the stands, goals, and an LED perimeter.
 *
 * Everything is placed from the two existing coordinate systems (pitch meters,
 * stand angles); nothing is positioned by eye, and the pitch markings come
 * from pitch-geometry.ts, which is asserted by tests.
 */

// --- Quality / motion -------------------------------------------------------

/** Picks a rendering budget from the device, once. Architecture never changes with it - only density, shadows and pixel ratio. */
function useSceneQuality(): { quality: SceneQuality; dpr: [number, number]; shadows: boolean } {
  return useMemo(() => {
    if (typeof window === "undefined") return { quality: "medium" as const, dpr: [1, 1.5] as [number, number], shadows: true }
    const cores = navigator.hardwareConcurrency ?? 4
    const narrow = window.innerWidth < 700
    const coarse = window.matchMedia("(pointer: coarse)").matches

    if (narrow || (coarse && cores <= 4)) return { quality: "low" as const, dpr: [1, 1.5] as [number, number], shadows: false }
    if (cores <= 6 || coarse) return { quality: "medium" as const, dpr: [1, 1.75] as [number, number], shadows: true }
    return { quality: "high" as const, dpr: [1, 2] as [number, number], shadows: true }
  }, [])
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return reduced
}

/** True while the tab is actually visible - the whole render loop stops otherwise. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible")
    onChange()
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
  return visible
}

// --- Crowd ------------------------------------------------------------------

/**
 * Where the home support stands, in the stand's angular system. -PI/2 is the
 * touchline directly OPPOSITE the gantry - the bank that fills the top of
 * every broadcast frame. Behind a goal it would be geometrically tidier and
 * visually useless: from this lens the ends sit at the extreme edges, so an
 * ultras section there is something the manager is told about rather than
 * something they can see.
 */
const HOME_END_ANGLE = -Math.PI / 2


/**
 * The crowd, drawn as three instanced meshes - one per level of detail. Each
 * spectator is a head-and-shoulders silhouette, not a block; the rows nearest
 * the lens get the roundest one, the far bank a billboard.
 *
 * Movement is done in the vertex shader from a per-instance phase/amplitude
 * plus one time uniform, so animating tens of thousands of spectators costs
 * one uniform write per frame rather than a CPU loop. The great majority
 * carry an amplitude of zero and never move at all.
 */
function CrowdLod({
  group,
  detail,
  timeUniform,
}: {
  group: CrowdLodGroup
  detail: 0 | 1 | 2
  timeUniform: React.RefObject<{ value: number }>
}) {
  const geometry = useMemo(() => {
    // A dedicated geometry per crowd mesh: instanced attributes live on the
    // geometry, so a shared one would leak this level's phases elsewhere.
    const g = createSpectatorGeometry(detail)
    g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(group.phases, 1))
    g.setAttribute("aAmplitude", new THREE.InstancedBufferAttribute(group.amplitudes, 1))
    return g
  }, [detail, group.phases, group.amplitudes])

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      roughness: 0.92,
      metalness: 0,
      // The far bank is flat quads; without this they vanish edge-on as the
      // bowl curves away from the lens.
      side: detail === 0 ? THREE.DoubleSide : THREE.FrontSide,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform.current
      shader.vertexShader = `
        uniform float uTime;
        attribute float aPhase;
        attribute float aAmplitude;
      ${shader.vertexShader}`
      // Re-implements the stock project_vertex chunk, adding a vertical bob
      // AFTER the instance transform so the offset is in real meters and is
      // not scaled by the instance's own size.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition.y += sin( uTime * 2.2 + aPhase ) * aAmplitude;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        `
      )
    }
    return m
  }, [detail, timeUniform])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  if (group.matrices.length === 0) return null

  return (
    <instancedMesh
      key={group.matrices.length}
      args={[geometry, material, group.matrices.length]}
      frustumCulled={false}
      ref={(mesh) => {
        if (!mesh) return
        group.matrices.forEach((m, i) => {
          mesh.setMatrixAt(i, m)
          mesh.setColorAt(i, group.colors[i])
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }}
    />
  )
}

function Crowd({
  structure,
  crowdStyle,
  quality,
  primaryColor,
  secondaryColor,
  animate,
  cameraPosition,
}: {
  structure: Stadium3DStructure
  crowdStyle: CrowdStyle
  quality: SceneQuality
  primaryColor: string
  secondaryColor: string
  animate: boolean
  cameraPosition: [number, number, number]
}) {
  const timeUniform = useRef({ value: 0 })

  const crowd = useMemo(
    () =>
      computeCrowdInstances(structure, {
        crowdStyle,
        quality,
        primaryColor,
        secondaryColor,
        cameraPosition,
        homeEndAngle: HOME_END_ANGLE,
      }),
    [structure, crowdStyle, quality, primaryColor, secondaryColor, cameraPosition]
  )

  useFrame((state) => {
    if (animate) timeUniform.current.value = state.clock.elapsedTime
  })

  return (
    <>
      <CrowdLod group={crowd.near} detail={2} timeUniform={timeUniform} />
      <CrowdLod group={crowd.mid} detail={1} timeUniform={timeUniform} />
      <CrowdLod group={crowd.far} detail={0} timeUniform={timeUniform} />
    </>
  )
}

/** Waving flags in the home end - few enough to animate on the CPU without cost. */
function Flags({
  structure,
  crowdStyle,
  primaryColor,
  secondaryColor,
  animate,
}: {
  structure: Stadium3DStructure
  crowdStyle: CrowdStyle
  primaryColor: string
  secondaryColor: string
  animate: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const flags = useMemo(
    () => computeFlagInstances(structure, { crowdStyle, quality: "high", primaryColor, secondaryColor, homeEndAngle: HOME_END_ANGLE }),
    [structure, crowdStyle, primaryColor, secondaryColor]
  )

  useFrame((state) => {
    if (!animate || !groupRef.current) return
    const t = state.clock.elapsedTime
    groupRef.current.children.forEach((child, i) => {
      const phase = flags[i]?.phase ?? 0
      child.rotation.z = Math.sin(t * 1.6 + phase) * 0.22
      child.position.y = (flags[i]?.position.y ?? 0) + Math.sin(t * 1.2 + phase) * 0.25
    })
  })

  return (
    <group ref={groupRef}>
      {flags.map((flag, i) => (
        <mesh key={i} position={flag.position} rotation={[0, flag.rotationY, 0]}>
          <planeGeometry args={[flag.width, flag.height]} />
          <meshStandardMaterial
            color={flag.color}
            side={THREE.DoubleSide}
            roughness={0.9}
            emissive={flag.color}
            emissiveIntensity={0.18}
          />
        </mesh>
      ))}
    </group>
  )
}

/** Tifo banners along the home end's front rail. */
function Banners({
  structure,
  crowdStyle,
  primaryColor,
  secondaryColor,
}: {
  structure: Stadium3DStructure
  crowdStyle: CrowdStyle
  primaryColor: string
  secondaryColor: string
}) {
  const { matrices, colors } = useMemo(
    () => computeBannerInstances(structure, { crowdStyle, quality: "high", primaryColor, secondaryColor, homeEndAngle: HOME_END_ANGLE }),
    [structure, crowdStyle, primaryColor, secondaryColor]
  )
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.8 }), [])
  if (matrices.length === 0) return null
  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => {
          mesh.setMatrixAt(i, m)
          mesh.setColorAt(i, colors[i])
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }}
    />
  )
}

// --- Goals ------------------------------------------------------------------

/** Both goals: real posts and crossbar on the goal line, with a net box behind. */
function Goals() {
  const frames = useMemo(() => buildGoalFrames(), [])
  const netTexture = useMemo(() => createNetTexture(), [])
  useEffect(() => () => netTexture.dispose(), [netTexture])

  return (
    <group>
      {frames.map((frame, fi) => (
        <group key={fi}>
          {frame.bars.map((bar, bi) => (
            <mesh key={bi} position={bar.position} rotation={[bar.rotationX, 0, bar.rotationZ]} castShadow>
              <cylinderGeometry args={[GOAL_POST_RADIUS, GOAL_POST_RADIUS, bar.length, 10]} />
              {/* Posts read as the brightest white in the frame - at broadcast
                  distance they are the cue that tells you where the goal is,
                  so they are lit slightly rather than left to the floodlights. */}
              <meshStandardMaterial color="#FFFFFF" roughness={0.3} metalness={0.05} emissive="#FFFFFF" emissiveIntensity={0.34} />
            </mesh>
          ))}
          {frame.panels.map((panel, pi) => (
            <mesh key={pi} position={panel.position} rotation={[panel.rotationX, panel.rotationY, 0]}>
              <planeGeometry args={[panel.width, panel.height]} />
              {/* One tiled alpha texture per panel - a real mesh at a fraction
                  of the cost of modelling cord. The repeat is set from the
                  panel's own size so the mesh is the same gauge everywhere
                  instead of stretching on the wider panels. */}
              <meshBasicMaterial
                map={netTexture}
                transparent
                opacity={0.62}
                side={THREE.DoubleSide}
                depthWrite={false}
                color="#E8EDF7"
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/**
 * The two dugouts. They sit on the FAR touchline: on the near side they are
 * directly under the gantry and present nothing but their own dark backs,
 * which reads as two black slabs across the bottom of the frame. Across the
 * pitch they are seen from the front, small, and exactly where a viewer
 * expects them.
 */
function TechnicalArea() {
  const z = -(HALF_WIDTH + 2.9)
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 15, 0, z]}>
          {/* Shelter roof, back wall and two end panels. */}
          <mesh position={[0, 1.72, 0]} castShadow>
            <boxGeometry args={[7.4, 0.16, 2.1]} />
            <meshStandardMaterial color="#2A2E38" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.88, -0.97]}>
            <boxGeometry args={[7.4, 1.68, 0.14]} />
            <meshStandardMaterial color="#31353F" roughness={0.85} />
          </mesh>
          {[-1, 1].map((end) => (
            <mesh key={end} position={[end * 3.63, 0.88, 0]}>
              <boxGeometry args={[0.14, 1.68, 2.1]} />
              <meshStandardMaterial color="#31353F" roughness={0.85} />
            </mesh>
          ))}
          {/* Bench, catching just enough light to show the shelter is not solid. */}
          <mesh position={[0, 0.46, -0.35]}>
            <boxGeometry args={[6.6, 0.12, 0.44]} />
            <meshStandardMaterial color="#4A4F5C" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// --- LED perimeter ----------------------------------------------------------

/**
 * The LED advertising run around the pitch. Colors scroll slowly along the
 * boards in the club's palette - the movement is what makes a still frame
 * read as a live broadcast, and it costs one instanceColor update a few times
 * a second, not a per-frame loop.
 */
function LedBoards({ primaryColor, secondaryColor, animate }: { primaryColor: string; secondaryColor: string; animate: boolean }) {
  const boards = useMemo(() => computeLedBoardInstances(), [])
  const geometry = useMemo(() => new THREE.BoxGeometry(1, LED_BOARD_HEIGHT, 0.12), [])
  // Unlit on purpose: an LED board emits its own light, so it should not be
  // shaded by the scene at all - and MeshBasicMaterial lets every board carry
  // its own colour through instanceColor at full brightness.
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const offsetRef = useRef(0)
  const lastUpdate = useRef(0)

  const palette = useMemo(() => {
    const a = new THREE.Color(primaryColor)
    const b = new THREE.Color(secondaryColor)
    const w = new THREE.Color("#E8E4F5")
    // A steady club-colour rhythm with a single lighter beat, rather than a
    // scatter of white panels: a real LED run reads as one continuous ribbon
    // with content moving along it, not as a patchwork of boards.
    return [a, a.clone().multiplyScalar(1.2), b, a, b.clone().multiplyScalar(0.9), w]
  }, [primaryColor, secondaryColor])

  const paint = (offset: number) => {
    const mesh = meshRef.current
    if (!mesh) return
    boards.forEach((board, i) => {
      const m = new THREE.Matrix4()
      m.compose(
        board.position,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), board.rotationY),
        new THREE.Vector3(board.width, 1, 1)
      )
      mesh.setMatrixAt(i, m)
      const color = palette[(board.colorIndex + offset) % palette.length]
      mesh.setColorAt(i, color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }

  useEffect(() => {
    paint(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- repaint whenever the palette or the board set changes
  }, [palette, boards])

  useFrame((state) => {
    if (!animate) return
    if (state.clock.elapsedTime - lastUpdate.current < 0.45) return
    lastUpdate.current = state.clock.elapsedTime
    offsetRef.current = (offsetRef.current + 1) % palette.length
    paint(offsetRef.current)
  })

  return <instancedMesh ref={meshRef} key={boards.length} args={[geometry, material, boards.length]} />
}

// --- Floodlights ------------------------------------------------------------

/** A radial glow sprite - the cheap stand-in for real bloom, since no post-processing pass is available. */
function createGlowTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, "rgba(255,251,224,0.95)")
  g.addColorStop(0.35, "rgba(255,247,205,0.35)")
  g.addColorStop(1, "rgba(255,244,190,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

/** Broad, soft haze above the roofline - the glow a floodlit ground throws into the night sky. */
function SkyHaze({ structure }: { structure: Stadium3DStructure }) {
  const glow = useMemo(() => createGlowTexture(), [])
  useEffect(() => () => glow.dispose(), [glow])
  const y = structure.standHeight * 1.5 + 18
  const spread = structure.outerHalfLength * 1.1
  return (
    <group>
      {[-1, 0, 1].map((i) => (
        <sprite key={i} position={[i * spread * 0.55, y, -structure.outerHalfWidth * 0.5]} scale={[spread, spread * 0.5, 1]}>
          <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.13} />
        </sprite>
      ))}
    </group>
  )
}

/** Corner floodlight masts: pole, head, lamp array, and an additive glow so they actually look lit. */
function Floodlights({ structure, enabled }: { structure: Stadium3DStructure; enabled: boolean }) {
  const masts = useMemo(() => (enabled ? computeFloodlightMasts(structure) : []), [structure, enabled])
  const glow = useMemo(() => createGlowTexture(), [])
  useEffect(() => () => glow.dispose(), [glow])

  return (
    <group>
      {masts.map((mast, i) => (
        <group key={i} position={mast.position} rotation={[0, mast.rotationY, 0]}>
          <mesh position={[0, mast.height / 2, 0]} castShadow>
            <cylinderGeometry args={[0.5, 0.9, mast.height, 8]} />
            <meshStandardMaterial color={METAL_MATERIAL_COLOR} roughness={0.55} metalness={0.6} />
          </mesh>
          <mesh position={[0, mast.height + 1.6, 0]}>
            <boxGeometry args={[9, 3.4, 1.2]} />
            <meshStandardMaterial color="#2C3038" roughness={0.6} metalness={0.4} />
          </mesh>
          {Array.from({ length: mast.lampCount }, (_, li) => {
            const x = (li / (mast.lampCount - 1) - 0.5) * 7.4
            return (
              <group key={li} position={[x, mast.height + 1.6, 0.7]}>
                <mesh>
                  <boxGeometry args={[1.05, 1.5, 0.35]} />
                  <meshStandardMaterial color="#FFF9DC" emissive="#FFF3C4" emissiveIntensity={2.6} toneMapped={false} />
                </mesh>
                <sprite scale={[7, 7, 1]}>
                  <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.5} />
                </sprite>
              </group>
            )
          })}
          {/* Local pool of light on the pitch. No shadows here - one shadow
              caster for the whole scene keeps the budget predictable. */}
          <pointLight position={[0, mast.height, 0]} intensity={2600} distance={230} decay={2} color="#FFF6DA" />
        </group>
      ))}
    </group>
  )
}

// --- Structure (shared with the architectural view) -------------------------

// Night concrete. The architectural view's warm daylight concrete reads as
// bare beige under floodlights, which flattens the whole bowl - at night the
// structure should sit back and let the pitch and the crowd carry the frame.
const NIGHT_CONCRETE = "#3A3746"
const NIGHT_CONCRETE_DARK = "#26232F"

function StandShell({ structure, tier }: { structure: Stadium3DStructure; tier: number }) {
  const geometry = useMemo(() => buildStandShellGeometry(structure, tier), [structure, tier])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={NIGHT_CONCRETE} side={THREE.DoubleSide} roughness={1} metalness={0} />
    </mesh>
  )
}

function InstancedBoxes({
  matrices,
  color,
  roughness = 0.5,
  metalness = 0.5,
  castShadow = false,
}: {
  matrices: THREE.Matrix4[]
  color: string
  roughness?: number
  metalness?: number
  castShadow?: boolean
}) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness, metalness }), [color, roughness, metalness])
  if (matrices.length === 0) return null
  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      castShadow={castShadow}
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.instanceMatrix.needsUpdate = true
      }}
    />
  )
}

function SeatingBlocks({
  structure,
  primaryColor,
  secondaryColor,
}: {
  structure: Stadium3DStructure
  primaryColor: string
  secondaryColor: string
}) {
  // Seats are mostly DARK NEUTRAL, with the club's colours used only as an
  // accent (the corner wings and the VIP blocks). A bowl painted entirely in
  // two club colours stops looking like a stadium and starts looking like a
  // branded arena - and it also drowns the crowd sitting on top of it.
  const { matrices, colors } = useMemo(
    () =>
      computeSeatingBlockInstances(structure, {
        primary: "#35304A",
        accent: primaryColor,
        vip: secondaryColor,
        vomitory: "#0E0C16",
        frame: "#37333F",
        // The near touchline's tunnels sit under the camera and only ever
        // present their dark back face; the far side's read properly.
        includeVomitoryAt: (_x, z) => z < structure.innerHalfWidth * 0.45,
      }),
    [structure, primaryColor, secondaryColor]
  )
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 }), [])
  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      receiveShadow
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => {
          mesh.setMatrixAt(i, m)
          mesh.setColorAt(i, colors[i])
        })
        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }}
    />
  )
}

/** Emissive light fixtures hanging under a covered stand's roof lip. */
function RoofLights({ matrices }: { matrices: THREE.Matrix4[] }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#FFF8E0", emissive: "#FFF3C8", emissiveIntensity: 2.4, toneMapped: false }),
    []
  )
  if (matrices.length === 0) return null
  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.instanceMatrix.needsUpdate = true
      }}
    />
  )
}

/** A running track ringing the pitch - only for the athletics ground type. */
function AthleticsTrack({ structure }: { structure: Stadium3DStructure }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    const outerX = HALF_LENGTH + structure.standOffset * 0.82
    const outerZ = HALF_WIDTH + structure.standOffset * 0.82
    shape.absarc(0, 0, 1, 0, Math.PI * 2, false)
    // Build as a ring: outer rounded rect minus the pitch rectangle.
    const outer = new THREE.Shape()
    const r = Math.min(outerX, outerZ) * 0.55
    outer.moveTo(-outerX + r, -outerZ)
    outer.lineTo(outerX - r, -outerZ)
    outer.quadraticCurveTo(outerX, -outerZ, outerX, -outerZ + r)
    outer.lineTo(outerX, outerZ - r)
    outer.quadraticCurveTo(outerX, outerZ, outerX - r, outerZ)
    outer.lineTo(-outerX + r, outerZ)
    outer.quadraticCurveTo(-outerX, outerZ, -outerX, outerZ - r)
    outer.lineTo(-outerX, -outerZ + r)
    outer.quadraticCurveTo(-outerX, -outerZ, -outerX + r, -outerZ)
    const hole = new THREE.Path()
    hole.moveTo(-HALF_LENGTH, -HALF_WIDTH)
    hole.lineTo(HALF_LENGTH, -HALF_WIDTH)
    hole.lineTo(HALF_LENGTH, HALF_WIDTH)
    hole.lineTo(-HALF_LENGTH, HALF_WIDTH)
    hole.lineTo(-HALF_LENGTH, -HALF_WIDTH)
    outer.holes.push(hole)
    return new THREE.ShapeGeometry(outer)
  }, [structure])

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
      <meshStandardMaterial color="#A44A33" roughness={0.95} emissive="#3A1710" emissiveIntensity={0.35} />
    </mesh>
  )
}

// --- Scene ------------------------------------------------------------------

function BroadcastScene({
  capacity,
  stadiumStyle,
  crowdStyle,
  primaryColor,
  secondaryColor,
  quality,
  animate,
}: {
  capacity: number
  stadiumStyle: string | null
  crowdStyle: CrowdStyle
  primaryColor: string
  secondaryColor: string
  quality: SceneQuality
  animate: boolean
}) {
  const structure = useMemo(() => computeStyledStructure(capacity, stadiumStyle), [capacity, stadiumStyle])
  const architecture = useMemo(() => getStyleArchitecture(stadiumStyle), [stadiumStyle])

  // The crowd's level of detail is picked from the real lens position, which
  // is the same shot BroadcastCameraRig sets - so "near" means near in the
  // frame the viewer is actually looking at.
  const { size } = useThree()
  const cameraPosition = useMemo(
    () => computeBroadcastCamera(structure, size.width / Math.max(1, size.height)).position,
    [structure, size.width, size.height]
  )

  const pitchTexture = useMemo(() => createPitchTexture(), [])
  useEffect(() => () => pitchTexture.dispose(), [pitchTexture])

  const concourseGeometry = useMemo(() => buildConcourseFloorGeometry(structure), [structure])
  const podiumGeometry = useMemo(() => buildPodiumWallGeometry(structure), [structure])
  const facadeGeometry = useMemo(() => buildOuterFacadeGeometry(structure), [structure])
  const roofGeometry = useMemo(() => buildRoofGeometry(structure), [structure])
  const roofUndersideGeometry = useMemo(() => buildRoofUndersideGeometry(structure), [structure])
  const roofFasciaGeometry = useMemo(() => buildRoofFasciaGeometry(structure), [structure])
  const roofBeamMatrices = useMemo(
    () =>
      computeRoofBeamInstances(structure).filter((m) => {
        const z = new THREE.Vector3().setFromMatrixPosition(m).z
        return z < structure.innerHalfWidth * 0.6
      }),
    [structure]
  )
  // The near touchline's own roof fixtures hang directly beside the camera and
  // would fill the frame with white slabs, so only the far/end runs are kept -
  // exactly what a gantry operator sees.
  const roofLightMatrices = useMemo(
    () =>
      computeRoofLightInstances(structure).filter((m) => {
        const z = new THREE.Vector3().setFromMatrixPosition(m).z
        return z < structure.innerHalfWidth * 0.35
      }),
    [structure]
  )
  const dividerMatrices = useMemo(() => computeSectionDividerInstances(structure), [structure])

  return (
    <group>
      {/* Pitch - exactly PITCH_LENGTH x PITCH_WIDTH, markings from pitch-geometry. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[PITCH_LENGTH, PITCH_WIDTH]} />
        <meshStandardMaterial map={pitchTexture} roughness={0.88} metalness={0} />
      </mesh>

      {architecture.athleticsTrack && <AthleticsTrack structure={structure} />}

      <mesh geometry={concourseGeometry} receiveShadow>
        <meshStandardMaterial color={NIGHT_CONCRETE_DARK} side={THREE.DoubleSide} roughness={0.95} />
      </mesh>

      {Array.from({ length: structure.tierCount }, (_, tier) => (
        <StandShell key={tier} structure={structure} tier={tier} />
      ))}

      <SeatingBlocks structure={structure} primaryColor={primaryColor} secondaryColor={secondaryColor} />
      <InstancedBoxes matrices={dividerMatrices} color={METAL_MATERIAL_COLOR} roughness={0.35} metalness={0.7} />

      <Crowd
        structure={structure}
        crowdStyle={crowdStyle}
        quality={quality}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        animate={animate}
        cameraPosition={cameraPosition}
      />
      <Banners structure={structure} crowdStyle={crowdStyle} primaryColor={primaryColor} secondaryColor={secondaryColor} />
      <Flags
        structure={structure}
        crowdStyle={crowdStyle}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        animate={animate}
      />

      <mesh geometry={podiumGeometry} receiveShadow>
        <meshStandardMaterial color={NIGHT_CONCRETE_DARK} side={THREE.DoubleSide} roughness={0.95} />
      </mesh>
      <mesh geometry={facadeGeometry} receiveShadow castShadow>
        <meshStandardMaterial color="#232030" side={THREE.DoubleSide} roughness={0.9} />
      </mesh>

      {roofGeometry && (
        <mesh geometry={roofGeometry} castShadow>
          <meshStandardMaterial color="#14161E" side={THREE.DoubleSide} roughness={0.5} metalness={0.25} />
        </mesh>
      )}
      {roofUndersideGeometry && (
        <mesh geometry={roofUndersideGeometry}>
          <meshStandardMaterial color="#22252F" side={THREE.DoubleSide} roughness={0.85} metalness={0.05} />
        </mesh>
      )}
      {roofFasciaGeometry && (
        <mesh geometry={roofFasciaGeometry}>
          <meshStandardMaterial color="#2C3040" side={THREE.DoubleSide} roughness={0.65} metalness={0.2} />
        </mesh>
      )}
      <InstancedBoxes matrices={roofBeamMatrices} color={METAL_MATERIAL_COLOR} roughness={0.32} metalness={0.75} />
      <RoofLights matrices={roofLightMatrices} />

      <Goals />
      <TechnicalArea />
      <LedBoards primaryColor={primaryColor} secondaryColor={secondaryColor} animate={animate} />
      <Floodlights structure={structure} enabled={architecture.floodlightMasts} />
      <SkyHaze structure={structure} />
    </group>
  )
}

/** Positions the broadcast camera. Re-run when the shot's inputs change - never per frame, so it can't fight anything. */
function BroadcastCameraRig({ structure }: { structure: Stadium3DStructure }) {
  const { camera, size } = useThree()

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const shot = computeBroadcastCamera(structure, aspect)
    camera.position.set(...shot.position)
    camera.lookAt(...shot.target)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = shot.fov
      camera.far = shot.far
      camera.updateProjectionMatrix()
    }
  }, [camera, structure, size.width, size.height])

  return null
}

/** Night sky + floodlit pitch. One shadow-casting light for the whole scene. */
function NightLighting({ structure, shadows }: { structure: Stadium3DStructure; shadows: boolean }) {
  const keyHeight = Math.max(70, structure.standHeight * 3)
  return (
    <>
      {/* Cool ambient bounce - a night ground is never pitch black, but it is
          far darker than the floodlit pitch at its centre. */}
      <hemisphereLight args={["#332C55", "#06050E", 0.42]} />
      <ambientLight intensity={0.08} color="#5C5880" />
      {/* The key light: stands in for the massed floodlights, and is the only
          shadow caster in the scene. */}
      <directionalLight
        position={[60, keyHeight, 40]}
        intensity={1.05}
        color="#FFF1CE"
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-140}
        shadow-camera-right={140}
        shadow-camera-top={140}
        shadow-camera-bottom={-140}
        shadow-camera-far={keyHeight * 3}
      />
      {/* A softer fill from the opposite side so the far stand isn't a black wall. */}
      <directionalLight position={[-70, keyHeight * 0.8, -50]} intensity={0.3} color="#9AA8E0" />
      {/* Stand wash: aimed at the far side specifically. Without it the crowd
          is technically there but reads as an empty dark bank. */}
      <directionalLight position={[0, keyHeight * 0.55, 120]} intensity={1.15} color="#C9C2E8" />
      {/* Pools the light onto the playing surface, keeping the pitch clearly
          brighter than the stands - the signature of a floodlit match. */}
      <spotLight
        position={[0, keyHeight * 0.9, 0]}
        angle={0.6}
        penumbra={0.82}
        intensity={52_000}
        distance={keyHeight * 3}
        decay={2}
        color="#FFF7E4"
      />
    </>
  )
}

export function BroadcastStadium({
  capacity,
  stadiumStyle,
  crowdStyle = "calm",
  primaryColor = "#5D4890",
  secondaryColor = "#D3CEDD",
  className,
}: {
  capacity: number
  stadiumStyle: string | null
  crowdStyle?: CrowdStyle
  primaryColor?: string | null
  secondaryColor?: string | null
  className?: string
}) {
  const { quality, dpr, shadows } = useSceneQuality()
  const reducedMotion = usePrefersReducedMotion()
  const visible = usePageVisible()
  const animate = !reducedMotion

  const structure = useMemo(() => computeStyledStructure(capacity, stadiumStyle), [capacity, stadiumStyle])

  return (
    <div className={className}>
      <Canvas
        shadows={shadows}
        dpr={dpr}
        // The whole loop stops when the tab is hidden; a single "demand"
        // render still paints the last state if motion is switched off.
        frameloop={!visible ? "never" : animate ? "always" : "demand"}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.15
        }}
        camera={{ fov: 38, near: 0.5, far: 2000 }}
      >
        <color attach="background" args={["#06050F"]} />
        {/* Fog gives the far side of a big ground real distance instead of
            every stand reading at the same depth. */}
        <fog attach="fog" args={["#0B0A1C", 190, 620]} />
        <NightLighting structure={structure} shadows={shadows} />
        <BroadcastCameraRig structure={structure} />
        <BroadcastScene
          capacity={capacity}
          stadiumStyle={stadiumStyle}
          crowdStyle={crowdStyle}
          primaryColor={primaryColor || "#5D4890"}
          secondaryColor={secondaryColor || "#D3CEDD"}
          quality={quality}
          animate={animate}
        />
      </Canvas>
    </div>
  )
}

export const BROADCAST_GOAL_HEIGHT = GOAL_HEIGHT
