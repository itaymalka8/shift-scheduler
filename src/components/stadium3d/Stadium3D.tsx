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
  buildConcourseFloorGeometry,
  buildOuterFacadeGeometry,
  buildPodiumWallGeometry,
  buildRoofFasciaGeometry,
  buildRoofGeometry,
  buildRoofUndersideGeometry,
  buildStandShellGeometry,
  computeRoofBeamInstances,
  computeRoofLightInstances,
  computeSeatingBlockInstances,
  computeSectionDividerInstances,
  createPitchTexture,
  CONCRETE_MATERIAL_COLOR,
  CONCRETE_MATERIAL_DARK,
  METAL_MATERIAL_COLOR,
} from "./stadium-geometry"

/** One tier's concrete shell (aisles/underside) - plain, unlit-neutral so it never competes with the seat colors. */
function StandShell({ structure, tier }: { structure: Stadium3DStructure; tier: number }) {
  const geometry = useMemo(() => buildStandShellGeometry(structure, tier), [structure, tier])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={CONCRETE_MATERIAL_COLOR} side={THREE.DoubleSide} roughness={1} metalness={0} />
    </mesh>
  )
}

/** The actual seating - real stepped rows, colored by section (block), not by row. Includes recessed vomitory blocks in the same instanced mesh. */
function SeatingBlocks({ structure }: { structure: Stadium3DStructure }) {
  const { matrices, colors } = useMemo(() => computeSeatingBlockInstances(structure), [structure])
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 }), [])

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

/** Thin metal dividers at every section boundary - a physical handrail-like separation between adjacent blocks. */
function SectionDividers({ matrices }: { matrices: THREE.Matrix4[] }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: METAL_MATERIAL_COLOR, roughness: 0.35, metalness: 0.7 }), [])
  if (matrices.length === 0) return null
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

/** Thin radial beams under the roof deck - a basic visible frame instead of a plain floating plate. */
function RoofBeams({ matrices }: { matrices: THREE.Matrix4[] }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: METAL_MATERIAL_COLOR, roughness: 0.32, metalness: 0.75 }), [])
  if (matrices.length === 0) return null
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

/** Small emissive fixtures mounted under the roof edge - lighting attached to the structure, never a free-floating pole. */
function RoofLights({ matrices }: { matrices: THREE.Matrix4[] }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#EDEAF7", emissive: "#FFF8DE", emissiveIntensity: 0.4 }),
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

/**
 * The whole 3D structure for one capacity, as a THREE.Group - everything
 * below is derived from `capacity` through computeStadium3DStructure(), not
 * hardcoded, so a different capacity produces a genuinely different
 * structure (deeper/taller/more-tiered stand, more roof, more sections),
 * not the same model with more seats painted on.
 */
function StadiumScene({ capacity }: { capacity: number }) {
  const structure = useMemo(() => computeStadium3DStructure(capacity), [capacity])

  const pitchTexture = useMemo(() => createPitchTexture(), [])
  const concourseGeometry = useMemo(() => buildConcourseFloorGeometry(structure), [structure])
  const podiumGeometry = useMemo(() => buildPodiumWallGeometry(structure), [structure])
  const facadeGeometry = useMemo(() => buildOuterFacadeGeometry(structure), [structure])
  const roofGeometry = useMemo(() => buildRoofGeometry(structure), [structure])
  const roofUndersideGeometry = useMemo(() => buildRoofUndersideGeometry(structure), [structure])
  const roofFasciaGeometry = useMemo(() => buildRoofFasciaGeometry(structure), [structure])
  const roofBeamMatrices = useMemo(() => computeRoofBeamInstances(structure), [structure])
  const roofLightMatrices = useMemo(() => computeRoofLightInstances(structure), [structure])
  const dividerMatrices = useMemo(() => computeSectionDividerInstances(structure), [structure])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[105, 68]} />
        <meshStandardMaterial map={pitchTexture} roughness={0.95} />
      </mesh>

      <mesh geometry={concourseGeometry} receiveShadow>
        <meshStandardMaterial color={CONCRETE_MATERIAL_DARK} side={THREE.DoubleSide} roughness={0.95} />
      </mesh>

      {Array.from({ length: structure.tierCount }, (_, tier) => (
        <StandShell key={tier} structure={structure} tier={tier} />
      ))}

      <SeatingBlocks structure={structure} />
      <SectionDividers matrices={dividerMatrices} />

      <mesh geometry={podiumGeometry} receiveShadow>
        <meshStandardMaterial color={CONCRETE_MATERIAL_DARK} side={THREE.DoubleSide} roughness={0.95} />
      </mesh>

      <mesh geometry={facadeGeometry} receiveShadow castShadow>
        <meshStandardMaterial color={CONCRETE_MATERIAL_COLOR} side={THREE.DoubleSide} roughness={0.9} />
      </mesh>

      {roofGeometry && (
        <mesh geometry={roofGeometry} castShadow>
          <meshStandardMaterial color="#3D4450" side={THREE.DoubleSide} roughness={0.4} metalness={0.25} />
        </mesh>
      )}
      {roofUndersideGeometry && (
        <mesh geometry={roofUndersideGeometry}>
          <meshStandardMaterial color="#2A2E36" side={THREE.DoubleSide} roughness={0.75} metalness={0.1} />
        </mesh>
      )}
      {roofFasciaGeometry && (
        <mesh geometry={roofFasciaGeometry}>
          <meshStandardMaterial color="#3A3F49" side={THREE.DoubleSide} roughness={0.6} metalness={0.2} />
        </mesh>
      )}
      <RoofBeams matrices={roofBeamMatrices} />
      <RoofLights matrices={roofLightMatrices} />
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
