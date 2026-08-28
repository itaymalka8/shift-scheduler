"use client"

import { useEffect, useMemo } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import {
  CAMERA_AZIMUTH_DEG,
  CAMERA_FOV_DEG,
  computeCameraFraming,
  computeStadium3DStructure,
  type Stadium3DStructure,
} from "@/lib/stadium/stadium3d-config"
import {
  buildOuterFacadeGeometry,
  buildPodiumWallGeometry,
  buildRoofFasciaGeometry,
  buildRoofGeometry,
  buildStandShellGeometry,
  computeEntranceInstances,
  computeFloodlightPositions,
  computeSeatingBlockInstances,
  createPitchTexture,
  CONCRETE_MATERIAL_COLOR,
  CONCRETE_MATERIAL_DARK,
} from "./stadium-geometry"

/** One tier's concrete shell (aisles/underside) - plain, unlit-neutral so it never competes with the seat colors. */
function StandShell({ structure, tier }: { structure: Stadium3DStructure; tier: number }) {
  const geometry = useMemo(() => buildStandShellGeometry(structure, tier), [structure, tier])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={CONCRETE_MATERIAL_COLOR} side={THREE.DoubleSide} roughness={0.95} metalness={0} />
    </mesh>
  )
}

/** The actual seating - real stepped rows, colored by section (block), not by row. */
function SeatingBlocks({ structure }: { structure: Stadium3DStructure }) {
  const { matrices, colors } = useMemo(() => computeSeatingBlockInstances(structure), [structure])
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }), [])

  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      castShadow
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

function EntrancePortals({ matrices }: { matrices: THREE.Matrix4[] }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: CONCRETE_MATERIAL_DARK, roughness: 0.9 }), [])

  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      castShadow
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.instanceMatrix.needsUpdate = true
      }}
    />
  )
}

// Rises from the ground (position.y is always 0 - see computeFloodlightPositions)
// to comfortably above the roofline, scaled to this stadium's own height so a
// 70,000-seat bowl gets a genuinely taller tower, not the same 4m post.
function Floodlight({ position, standHeight }: { position: [number, number, number]; standHeight: number }) {
  const poleHeight = standHeight * 1.35
  return (
    <group position={position}>
      <mesh position={[0, poleHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.7, poleHeight, 8]} />
        <meshStandardMaterial color="#B9BEC9" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, poleHeight + 1.2, 0]} castShadow>
        <boxGeometry args={[3, 1.6, 2.2]} />
        <meshStandardMaterial color="#EDEAF7" emissive="#FFF8DE" emissiveIntensity={0.35} />
      </mesh>
    </group>
  )
}

/**
 * The whole 3D structure for one capacity, as a THREE.Group - everything
 * below is derived from `capacity` through computeStadium3DStructure(), not
 * hardcoded, so a different capacity produces a genuinely different
 * structure (deeper/taller/more-tiered stand, more roof, more entrances),
 * not the same model with more seats painted on.
 */
function StadiumScene({ capacity }: { capacity: number }) {
  const structure = useMemo(() => computeStadium3DStructure(capacity), [capacity])

  const pitchTexture = useMemo(() => createPitchTexture(), [])
  const podiumGeometry = useMemo(() => buildPodiumWallGeometry(structure), [structure])
  const facadeGeometry = useMemo(() => buildOuterFacadeGeometry(structure), [structure])
  const roofGeometry = useMemo(() => buildRoofGeometry(structure), [structure])
  const roofFasciaGeometry = useMemo(() => buildRoofFasciaGeometry(structure), [structure])
  const entranceMatrices = useMemo(() => computeEntranceInstances(structure), [structure])
  const floodlights = useMemo(() => computeFloodlightPositions(structure), [structure])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[105, 68]} />
        <meshStandardMaterial map={pitchTexture} roughness={0.95} />
      </mesh>

      {Array.from({ length: structure.tierCount }, (_, tier) => (
        <StandShell key={tier} structure={structure} tier={tier} />
      ))}

      <SeatingBlocks structure={structure} />

      <mesh geometry={podiumGeometry} receiveShadow>
        <meshStandardMaterial color={CONCRETE_MATERIAL_DARK} side={THREE.DoubleSide} roughness={0.95} />
      </mesh>

      <mesh geometry={facadeGeometry} receiveShadow castShadow>
        <meshStandardMaterial color={CONCRETE_MATERIAL_DARK} side={THREE.DoubleSide} roughness={0.9} />
      </mesh>

      {roofGeometry && (
        <mesh geometry={roofGeometry}>
          <meshStandardMaterial color="#454C58" side={THREE.DoubleSide} roughness={0.5} metalness={0.15} transparent opacity={0.95} />
        </mesh>
      )}
      {roofFasciaGeometry && (
        <mesh geometry={roofFasciaGeometry}>
          <meshStandardMaterial color="#3A3F49" side={THREE.DoubleSide} roughness={0.6} metalness={0.2} />
        </mesh>
      )}

      <EntrancePortals matrices={entranceMatrices} />

      {floodlights.map((pos, i) => (
        <Floodlight key={i} position={pos} standHeight={structure.standHeight} />
      ))}
    </group>
  )
}

// Sets the camera's initial position/target once per capacity - deliberately
// not run every render, so it never fights the user's own OrbitControls drag.
function CameraRig({ structure, capacity }: { structure: Stadium3DStructure; capacity: number }) {
  const { camera } = useThree()

  useEffect(() => {
    const framing = computeCameraFraming(structure, capacity)
    const polarRad = (framing.polarAngleDeg * Math.PI) / 180
    const azimuthRad = (CAMERA_AZIMUTH_DEG * Math.PI) / 180
    // Real spherical->cartesian conversion - a previous version reused one
    // value for both X and Z, which silently made the true camera-to-target
    // distance ~16% longer than `framing.distance` (sqrt(1+sin^2) fudge),
    // undercutting the deliberate per-capacity frame-fill tuning.
    const horizontalRadius = framing.distance * Math.sin(polarRad)
    const camX = horizontalRadius * Math.cos(azimuthRad)
    const camZ = horizontalRadius * Math.sin(azimuthRad)
    const camY = framing.distance * Math.cos(polarRad)
    camera.position.set(camX, camY, camZ)
    camera.lookAt(0, structure.standHeight * 0.3, 0)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = CAMERA_FOV_DEG
      camera.far = framing.distance * 4
      camera.updateProjectionMatrix()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity])

  return null
}

export function Stadium3D({
  capacity,
  className,
  interactive = true,
}: {
  capacity: number
  className?: string
  interactive?: boolean
}) {
  const structure = useMemo(() => computeStadium3DStructure(capacity), [capacity])
  const framing = useMemo(() => computeCameraFraming(structure, capacity), [structure, capacity])

  return (
    <div className={className}>
      <Canvas shadows camera={{ fov: CAMERA_FOV_DEG, near: 1, far: framing.distance * 4 }}>
        <color attach="background" args={["#DCE0EC"]} />
        <hemisphereLight args={["#F4F6FB", "#B7BCC8", 0.75]} />
        <ambientLight intensity={0.35} />
        {/* Two directional lights from opposite corners so the stand facing
            away from the key light still reads its true section colors,
            instead of going flat/gray relative to the lit side. */}
        <directionalLight position={[80, 140, 60]} intensity={1.1} castShadow />
        <directionalLight position={[-80, 100, -60]} intensity={0.55} />
        <CameraRig structure={structure} capacity={capacity} />
        <StadiumScene capacity={capacity} />
        {interactive && (
          <OrbitControls
            target={[0, structure.standHeight * 0.3, 0]}
            enablePan={false}
            minDistance={framing.distance * 0.4}
            maxDistance={framing.distance * 1.8}
            maxPolarAngle={Math.PI / 2.05}
          />
        )}
      </Canvas>
    </div>
  )
}
