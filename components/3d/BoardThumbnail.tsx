'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Board } from '@/types'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { PDFTextureMaterial } from './PDFTexture'
import { useBoardTexture } from './useBoardTexture'

interface BoardThumbnailProps {
  board: Board
  position: [number, number, number]
  width: number
  height: number
  onClick?: (board: Board) => void
  isHighlighted?: boolean
  onHover?: (hovered: boolean) => void // Callback when board hover state changes
}

const BOARD_THICKNESS = 0.08

// Skeleton material used only on the very first load (no prior texture exists).
// A pulsing emissive keeps it visually distinct from a solid gray placeholder.
function BoardSkeletonMaterial({ hovered, isHighlighted }: { hovered: boolean; isHighlighted?: boolean }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  useFrame((state) => {
    if (!matRef.current) return
    // Subtle ~1.5s pulse so the placeholder reads as "loading" without flashing.
    const t = state.clock.getElapsedTime()
    const pulse = 0.06 + 0.04 * Math.sin(t * 4)
    matRef.current.emissiveIntensity = isHighlighted ? 0.3 : (hovered ? 0.12 : pulse)
  })
  return (
    <meshStandardMaterial
      ref={matRef}
      color="#eef0f8"
      roughness={0.85}
      metalness={0.0}
      emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#c8cdde')}
      emissiveIntensity={0.08}
      depthWrite={true}
      depthTest={true}
    />
  )
}

function BoardImageMaterial({
  texture,
  hovered,
  isHighlighted,
}: {
  texture: THREE.Texture
  hovered: boolean
  isHighlighted?: boolean
}) {
  return (
    <meshStandardMaterial
      map={texture}
      roughness={0.7}
      metalness={0.0}
      emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
      emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
      depthWrite={true}
      depthTest={true}
    />
  )
}

export default function BoardThumbnail({ board, position, width, height, onClick, isHighlighted, onHover }: BoardThumbnailProps) {
  const [hovered, setHovered] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)
  const uploaderName =
    board.studentName?.trim() ||
    board.ownerName?.trim() ||
    board.studentEmail?.split('@')[0]?.trim() ||
    'Unknown uploader'

  const isHovered = hovered || !!isHighlighted

  useEffect(() => {
    onHover?.(hovered)
  }, [hovered, onHover])

  // Prefer thumbnail in 3D room for performance (smaller texture); fall back to full image
  const imageUrl = board.thumbnailUrl || board.fullImageUrl
  const isPDF = imageUrl?.toLowerCase().endsWith('.pdf')
  const hasValidImage = !!(imageUrl && (
    imageUrl.startsWith('/uploads/') ||
    imageUrl.startsWith('http://') ||
    imageUrl.startsWith('https://') ||
    imageUrl.startsWith('blob:')
  )) && !isPDF

  // Imperative texture loading — never remounts the mesh on URL change, so the
  // previous texture stays on screen until the new one resolves (no gray flash
  // on optimistic → thumbnail → full transitions).
  const { texture, isInitialLoad } = useBoardTexture(hasValidImage ? imageUrl : null)

  // Subtle animation on hover — skip when already at target to avoid per-frame writes on every board
  useFrame(() => {
    if (!meshRef.current) return
    const targetZ = isHovered ? 0.15 : 0
    const delta = targetZ - meshRef.current.position.z
    if (Math.abs(delta) > 0.001) {
      meshRef.current.position.z += delta * 0.1
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = (e: any) => {
    if (onClick) {
      e.stopPropagation()
      onClick(board)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePointerDown = (e: any) => {
    e.stopPropagation()
  }

  return (
    <group
      position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onPointerDown={handlePointerDown}
    >
      <mesh
        ref={meshRef}
        castShadow
        receiveShadow
        renderOrder={1}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry args={[width, height, BOARD_THICKNESS]} />
        {isPDF && imageUrl ? (
          <PDFTextureMaterial pdfUrl={imageUrl} hovered={isHovered} />
        ) : texture ? (
          <BoardImageMaterial texture={texture} hovered={isHovered} isHighlighted={isHighlighted} />
        ) : (
          // Show skeleton ONLY on the very first load (no prior texture available).
          // URL swaps after that keep the previous texture on screen via useBoardTexture.
          isInitialLoad && hasValidImage ? (
            <BoardSkeletonMaterial hovered={isHovered} isHighlighted={isHighlighted} />
          ) : (
            <meshStandardMaterial
              color={hovered ? '#f8f8f8' : '#ffffff'}
              roughness={0.7}
              metalness={0.0}
              emissive={isHighlighted ? '#6366f1' : (hovered ? '#6366f1' : '#000000')}
              emissiveIntensity={isHighlighted ? 0.3 : (hovered ? 0.12 : 0)}
            />
          )
        )}
      </mesh>

      {/* Uploader name tooltip - visible in 3D room hover */}
      {isHovered && (
        <Html
          position={[0, -height / 2 - 0.1, 0.1]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}>
            Uploaded by {uploaderName}
          </div>
        </Html>
      )}

      {/* Frame around board when hovered or highlighted */}
      {(isHovered || isHighlighted) && (
        <>
          <lineSegments position={[0, 0, 0.002]}>
            <edgesGeometry
              attach="geometry"
              args={[new THREE.PlaneGeometry(width + 0.03, height + 0.03)]}
            />
            <lineBasicMaterial attach="material" color="#6366f1" linewidth={3} />
          </lineSegments>

          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[width + 0.1, height + 0.1]} />
            <meshBasicMaterial
              color="#6366f1"
              transparent
              opacity={0.1}
            />
          </mesh>
        </>
      )}
    </group>
  )
}
