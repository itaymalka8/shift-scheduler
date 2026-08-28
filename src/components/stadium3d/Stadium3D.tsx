"use client"

import { useMemo } from "react"
import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import * as THREE from "three"
import { computeCameraFraming, computeStadium3DStructure } from "@/lib/stadium/stadium3d-config"
import {
  buildRoofGeometry,
  buildStandGeometry,
  computeEntranceMatrices,
  computeFloodlightPositions,
  createPitchTexture,
  createStandTexture,
} from "./stadium-geometry"

const GOALX_PURPLE = "#3B2F7A"

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
  const standGeometry = useMemo(() => buildStandGeometry(structure), [structure])
  const standTexture = useMemo(() => createStandTexture(structure), [structure])
  const roofGeometry = useMemo(() => buildRoofGeometry(structure), [structure])
  const entranceMatrices = useMemo(() => computeEntranceMatrices(structure), [structure])
  const floodlights = useMemo(() => computeFloodlightPositions(structure), [structure])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[105, 68]} />
        <meshStandardMaterial map={pitchTexture} roughness={0.9} />
      </mesh>

      <mesh geometry={standGeometry} castShadow receiveShadow>
        <meshStandardMaterial map={standTexture} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>

      {roofGeometry && (
        <mesh geometry={roofGeometry}>
          <meshStandardMaterial color="#8892A6" side={THREE.DoubleSide} roughness={0.6} transparent opacity={0.9} />
        </mesh>
      )}

      <EntranceMarkers matrices={entranceMatrices} />

      {floodlights.map((pos, i) => (
        <Floodlight key={i} position={pos} />
      ))}
    </group>
  )
}

function EntranceMarkers({ matrices }: { matrices: THREE.Matrix4[] }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1.6, 3, 1.6), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: GOALX_PURPLE }), [])

  return (
    <instancedMesh
      key={matrices.length}
      args={[geometry, material, matrices.length]}
      ref={(mesh) => {
        if (!mesh) return
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
        mesh.instanceMatrix.needsUpdate = true
      }}
      castShadow
    />
  )
}

function Floodlight({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 2, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.5, 4, 8]} />
        <meshStandardMaterial color="#B9BEC9" />
      </mesh>
      <mesh position={[0, 4.2, 0]} castShadow>
        <boxGeometry args={[2.2, 0.6, 1.6]} />
        <meshStandardMaterial color="#EDEAF7" emissive="#FFF8DE" emissiveIntensity={0.4} />
      </mesh>
    </group>
  )
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
  const framing = useMemo(() => computeCameraFraming(structure), [structure])

  const polarRad = (framing.polarAngleDeg * Math.PI) / 180
  const camX = framing.distance * Math.sin(polarRad)
  const camY = framing.distance * Math.cos(polarRad)

  return (
    <div className={className}>
      <Canvas shadows camera={{ position: [camX, camY, camX], fov: 40, near: 1, far: framing.distance * 4 }}>
        <color attach="background" args={["#EEF0F7"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[80, 140, 60]} intensity={1.1} castShadow />
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
