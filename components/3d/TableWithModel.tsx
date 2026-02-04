'use client'

import '@/components/3d/setupDraco'
import { Suspense, useMemo } from 'react'
import { useGLTF, Center } from '@react-three/drei'
import * as THREE from 'three'
import type { FloorTable } from '@/types'

const TABLE_HEIGHT = 18 // 1.5 feet in inches

function isModelUrlLoadable(url: string): boolean {
  return url.length > 0 && !url.startsWith('blob:')
}

const TABLE_TOP_MARGIN = 1.5 // inches – gap from table edge so model doesn't touch
const MAX_MODEL_HEIGHT = 30 // inches above table top – cap so it doesn't tower
const MODEL_COLOR = '#ffffff' // white

function applyWallColor(scene: THREE.Object3D) {
  const color = new THREE.Color(MODEL_COLOR)
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
      const mats = Array.isArray((child as THREE.Mesh).material)
        ? (child as THREE.Mesh).material as THREE.Material[]
        : [(child as THREE.Mesh).material as THREE.Material]
      mats.forEach((m) => {
        const standard = m as THREE.MeshStandardMaterial
        if (standard.color) standard.color.copy(color)
        // Clear textures so the solid color shows (they often darken the model)
        if (standard.map) standard.map = null
        if (standard.emissiveMap) standard.emissiveMap = null
        // Slight emissive so model isn't overly dark in shadow – matches walls
        if (standard.emissive) {
          standard.emissive.copy(color)
          standard.emissiveIntensity = 0.2
        }
      })
    }
  })
}

function ModelOnTable({ url, tableWidth, tableDepth }: { url: string; tableWidth: number; tableDepth: number }) {
  const { scene } = useGLTF(url)
  const { cloned, scale } = useMemo(() => {
    const c = scene.clone(true)
    applyWallColor(c)
    const box = new THREE.Box3().setFromObject(c)
    const size = box.getSize(new THREE.Vector3())
    const fitWidth = tableWidth - TABLE_TOP_MARGIN * 2
    const fitDepth = tableDepth - TABLE_TOP_MARGIN * 2
    const scaleX = size.x > 0 ? fitWidth / size.x : 1
    const scaleZ = size.z > 0 ? fitDepth / size.z : 1
    const scaleY = size.y > 0 ? MAX_MODEL_HEIGHT / size.y : 1
    return { cloned: c, scale: Math.min(scaleX, scaleZ, scaleY) }
  }, [scene, tableWidth, tableDepth])
  return (
    <group position={[0, TABLE_HEIGHT, 0]} scale={scale}>
      <Center>
        <primitive object={cloned} />
      </Center>
    </group>
  )
}

interface TableWithModelProps {
  table: FloorTable
  onTableClick?: (modelUrl: string) => void
}

export default function TableWithModel({ table, onTableClick }: TableWithModelProps) {
  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (table.modelUrl && isModelUrlLoadable(table.modelUrl) && onTableClick) onTableClick(table.modelUrl)
  }

  const rotationY = table.rotation ?? 0
  return (
    <group position={[table.x, 0, table.z]} rotation={[0, rotationY, 0]}>
      {/* Table: box from y=0 to y=18, center at y=9 - clickable when it has a model */}
      <mesh
        castShadow
        receiveShadow
        position={[0, TABLE_HEIGHT / 2, 0]}
        onClick={handleClick}
      >
        <boxGeometry args={[table.width, TABLE_HEIGHT, table.depth]} />
        <meshStandardMaterial
          color="#D8DEFF"
          roughness={0.9}
          metalness={0}
        />
      </mesh>
      {table.modelUrl && isModelUrlLoadable(table.modelUrl) && (
        <Suspense
          fallback={
            <mesh position={[0, TABLE_HEIGHT + 2, 0]}>
              <boxGeometry args={[4, 4, 4]} />
              <meshStandardMaterial color="#888" wireframe />
            </mesh>
          }
        >
          <ModelOnTable url={table.modelUrl} tableWidth={table.width} tableDepth={table.depth} />
        </Suspense>
      )}
    </group>
  )
}
