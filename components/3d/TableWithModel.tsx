'use client'

import '@/components/3d/setupDraco'
import { Suspense, useMemo, useEffect, useState } from 'react'
import { useGLTF, Center } from '@react-three/drei'
import * as THREE from 'three'
import type { FloorTable } from '@/types'
import { useRhino3dm } from '@/components/3d/useRhino3dm'
import { useStlLoader } from '@/components/3d/useStlLoader'

function is3dm(url: string) {
  return url.toLowerCase().endsWith('.3dm')
}

function isStl(url: string) {
  return url.toLowerCase().endsWith('.stl')
}

const TABLE_HEIGHT = 18 // 1.5 feet in inches

function isModelUrlLoadable(url: string): boolean {
  return url.length > 0 && !url.startsWith('blob:')
}

const TABLE_TOP_MARGIN = 0.5 // inches – minimal gap so model fills table
const MODEL_COLOR = '#ffffff' // white
const EMISSIVE_BASE = 0.2
const EMISSIVE_HOVER = 0.45

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
        if (standard.map) standard.map = null
        if (standard.emissiveMap) standard.emissiveMap = null
        if (standard.emissive) {
          standard.emissive.copy(color)
          standard.emissiveIntensity = EMISSIVE_BASE
        }
      })
    }
  })
}

type ModelOnTableProps = { url: string; tableWidth: number; tableDepth: number }

function useScaledClone(scene: THREE.Object3D, tableWidth: number, tableDepth: number) {
  return useMemo(() => {
    const c = scene.clone(true)
    applyWallColor(c)
    const box = new THREE.Box3().setFromObject(c)
    const sizeVec = box.getSize(new THREE.Vector3())
    const fitWidth = Math.max(1, tableWidth - TABLE_TOP_MARGIN * 2)
    const fitDepth = Math.max(1, tableDepth - TABLE_TOP_MARGIN * 2)
    const scaleX = sizeVec.x > 1e-6 ? fitWidth / sizeVec.x : 1
    const scaleZ = sizeVec.z > 1e-6 ? fitDepth / sizeVec.z : 1
    const scale = Math.min(scaleX, scaleZ)
    return { cloned: c, scale, size: sizeVec }
  }, [scene, tableWidth, tableDepth])
}

function ScaledModel({
  cloned, scale, size, hovered,
}: {
  cloned: THREE.Object3D
  scale: number
  size: THREE.Vector3
  hovered: boolean
}) {
  // Boost emissive on hover, revert on unhover
  useEffect(() => {
    const intensity = hovered ? EMISSIVE_HOVER : EMISSIVE_BASE
    cloned.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const mats = Array.isArray(mesh.material)
        ? (mesh.material as THREE.MeshStandardMaterial[])
        : [(mesh.material as THREE.MeshStandardMaterial)]
      mats.forEach((m) => {
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity = intensity
      })
    })
  }, [hovered, cloned])

  useEffect(() => {
    return () => {
      cloned.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((m) => (m as THREE.Material)?.dispose())
      })
    }
  }, [cloned])

  return (
    <group position={[0, TABLE_HEIGHT, 0]} scale={scale}>
      {/*
        Invisible hit-test volume — ensures clicks/pointerOver on the model mesh
        fire on this React element rather than passing through to walls behind.
        transparent+opacity=0 keeps it invisible while remaining raycastable.
      */}
      <mesh position={[0, size.y / 2, 0]}>
        <boxGeometry args={[size.x + 1, size.y + 1, size.z + 1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group position={[0, size.y / 2, 0]}>
        <Center>
          <primitive object={cloned} />
        </Center>
      </group>
    </group>
  )
}

function GlbModelOnTable({
  url, tableWidth, tableDepth, hovered,
}: ModelOnTableProps & { hovered: boolean }) {
  const { scene } = useGLTF(url)
  const { cloned, scale, size } = useScaledClone(scene, tableWidth, tableDepth)
  return <ScaledModel cloned={cloned} scale={scale} size={size} hovered={hovered} />
}

function RhinoModelOnTable({
  url, tableWidth, tableDepth, hovered,
}: ModelOnTableProps & { hovered: boolean }) {
  const { scene } = useRhino3dm(url)
  const { cloned, scale, size } = useScaledClone(scene, tableWidth, tableDepth)
  return <ScaledModel cloned={cloned} scale={scale} size={size} hovered={hovered} />
}

function StlModelOnTable({
  url, tableWidth, tableDepth, hovered,
}: ModelOnTableProps & { hovered: boolean }) {
  // STL carries no material/color; useStlLoader gives it a default gray
  // MeshStandardMaterial. It then goes through the same scale/center/recolor
  // (applyWallColor) treatment as every other on-table model, so it sits on the
  // table consistently with .glb/.3dm.
  const { scene } = useStlLoader(url)
  const { cloned, scale, size } = useScaledClone(scene, tableWidth, tableDepth)
  return <ScaledModel cloned={cloned} scale={scale} size={size} hovered={hovered} />
}

function ModelOnTable({
  url, tableWidth, tableDepth, hovered,
}: ModelOnTableProps & { hovered: boolean }) {
  if (is3dm(url)) return <RhinoModelOnTable url={url} tableWidth={tableWidth} tableDepth={tableDepth} hovered={hovered} />
  if (isStl(url)) return <StlModelOnTable url={url} tableWidth={tableWidth} tableDepth={tableDepth} hovered={hovered} />
  return <GlbModelOnTable url={url} tableWidth={tableWidth} tableDepth={tableDepth} hovered={hovered} />
}

interface TableWithModelProps {
  table: FloorTable
  onTableClick?: (modelUrl: string) => void
}

export default function TableWithModel({ table, onTableClick }: TableWithModelProps) {
  const [hovered, setHovered] = useState(false)
  const hasModel = Boolean(table.modelUrl && isModelUrlLoadable(table.modelUrl))

  const handleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    if (hasModel && table.modelUrl && onTableClick) onTableClick(table.modelUrl)
  }

  const handlePointerOver = (e: { stopPropagation: () => void }) => {
    if (!hasModel) return
    e.stopPropagation()
    setHovered(true)
    if (typeof document !== 'undefined') document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    setHovered(false)
    if (typeof document !== 'undefined') document.body.style.cursor = ''
  }

  const rotationY = table.rotation ?? 0
  return (
    <group
      position={[table.x, 0, table.z]}
      rotation={[0, rotationY, 0]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {/* Table pedestal */}
      <mesh castShadow receiveShadow position={[0, TABLE_HEIGHT / 2, 0]}>
        <boxGeometry args={[table.width, TABLE_HEIGHT, table.depth]} />
        <meshStandardMaterial color="#D8DEFF" roughness={0.9} metalness={0} />
      </mesh>

      {hasModel && (
        <Suspense
          fallback={
            <mesh position={[0, TABLE_HEIGHT + 2, 0]}>
              <boxGeometry args={[4, 4, 4]} />
              <meshStandardMaterial color="#888" wireframe />
            </mesh>
          }
        >
          <ModelOnTable
            url={table.modelUrl!}
            tableWidth={table.width}
            tableDepth={table.depth}
            hovered={hovered}
          />
        </Suspense>
      )}
    </group>
  )
}
