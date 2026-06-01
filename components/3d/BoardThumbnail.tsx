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
// Transparent + low opacity so the wall shows through (reads as "loading" rather than "empty gray plate");
// a faint pulse confirms it's still working.
function BoardSkeletonMaterial({ hovered, isHighlighted }: { hovered: boolean; isHighlighted?: boolean }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  useFrame((state) => {
    if (!matRef.current) return
    const t = state.clock.getElapsedTime()
    // Faint opacity pulse: 0.18 → 0.30 over ~1.5s. The base is intentionally low.
    matRef.current.opacity = 0.24 + 0.06 * Math.sin(t * 4)
    matRef.current.emissiveIntensity = isHighlighted ? 0.18 : (hovered ? 0.12 : 0)
  })
  return (
    <meshStandardMaterial
      ref={matRef}
      color="#ffffff"
      transparent
      opacity={0.24}
      roughness={0.85}
      metalness={0.0}
      emissive={isHighlighted || hovered ? '#6366f1' : '#000000'}
      emissiveIntensity={0}
      depthWrite={false}
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

  // Phase 6: board rotation is no longer applied — boards render flat.
  // The DB column is preserved for non-destructive removal; we just ignore
  // any stored value on render.

  return (
    <group
      position={position}
      rotation={[0, 0, 0]}
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

      {/* Thin outline while the board is in its first-load skeleton state — gives the placeholder a discernible edge. */}
      {isInitialLoad && hasValidImage && !texture && !isPDF && (
        <lineSegments position={[0, 0, 0.003]}>
          <edgesGeometry
            attach="geometry"
            args={[new THREE.PlaneGeometry(width, height)]}
          />
          <lineBasicMaterial attach="material" color="#94a3b8" transparent opacity={0.5} />
        </lineSegments>
      )}

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
