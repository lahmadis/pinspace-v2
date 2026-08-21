'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Board } from '@/types'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { PDFTextureMaterial } from './PDFTexture'
import { useBoardTexture } from './useBoardTexture'
import { useDisposableGeometry } from './useDisposableGeometry'
import VideoBadge from './VideoBadge'
import { ROOM_SKY } from '@/lib/room/palette'

interface BoardThumbnailProps {
  board: Board
  position: [number, number, number]
  width: number
  height: number
  onClick?: (board: Board) => void
  isHighlighted?: boolean
  onHover?: (hovered: boolean) => void // Callback when board hover state changes
  /**
   * Hide the callout-count badge. The badge is an <Html> DOM overlay living
   * OUTSIDE the canvas at z-index 60; the panels that cover the room (the
   * lightbox and the floor-plan editor) are z-50 fixed overlays and the room
   * stays mounted behind them, so every badge in the room would otherwise paint
   * on top of the open panel. The count is a 3D-room-only summary — in 2D the
   * anchored numbered pins are the callout UI. Affects the count badge ONLY; the
   * board, its texture, and every other overlay render exactly as before.
   */
  suppressCountBadge?: boolean
  /**
   * Wall focus: this board is on a wall that isn't the focused one, so it should
   * recede. Still clickable — you can open a ghosted board directly rather than
   * having to leave focus first — it just stops competing for attention.
   */
  dimmed?: boolean
}

const BOARD_THICKNESS = 0.08

/**
 * Wall-focus ghosting for a board's material.
 *
 * `map` textures are multiplied by `color`, and a multiply can only ever darken
 * — so tinting alone would push a de-emphasised board toward black, making it
 * heavier and MORE conspicuous than the boards it's receding behind. Instead
 * pair a gentle multiply (drains contrast) with an emissive wash in the sky
 * colour (lifts the whole quad toward the background), which reads as fading
 * into the room rather than falling into shadow. No transparency involved, so
 * there's no depth-sort order to get wrong between overlapping boards.
 */
const BOARD_DIM_MULTIPLY = '#D7DEEB'
const BOARD_DIM_WASH = 0.5

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
      emissive={isHighlighted || hovered ? '#3B6EF6' : '#000000'}
      emissiveIntensity={0}
      depthWrite={false}
    />
  )
}

function BoardImageMaterial({
  texture,
  hovered,
  isHighlighted,
  dimmed,
}: {
  texture: THREE.Texture
  hovered: boolean
  isHighlighted?: boolean
  dimmed?: boolean
}) {
  // While ghosted the board ignores hover/highlight emphasis — lighting up a
  // board the user is deliberately looking away from defeats the point — and
  // washes toward the sky instead. See BOARD_DIM_* above.
  return (
    <meshStandardMaterial
      map={texture}
      color={dimmed ? BOARD_DIM_MULTIPLY : '#ffffff'}
      roughness={0.7}
      metalness={0.0}
      emissive={dimmed ? ROOM_SKY : (isHighlighted || hovered ? '#3B6EF6' : '#000000')}
      emissiveIntensity={dimmed ? BOARD_DIM_WASH : (isHighlighted ? 0.3 : (hovered ? 0.12 : 0))}
      depthWrite={true}
      depthTest={true}
    />
  )
}

export default function BoardThumbnail({ board, position, width, height, onClick, isHighlighted, onHover, suppressCountBadge, dimmed = false }: BoardThumbnailProps) {
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

  // Source geometries for the outline edges, memoized on size and disposed when
  // the size changes / on unmount (R3F never disposes a geometry passed inline as
  // an <edgesGeometry> constructor arg).
  const skeletonEdgeGeometry = useDisposableGeometry(
    () => new THREE.PlaneGeometry(width, height),
    [width, height],
  )
  const frameEdgeGeometry = useDisposableGeometry(
    () => new THREE.PlaneGeometry(width + 0.03, height + 0.03),
    [width, height],
  )

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

  // The wall's invisible raycast plane sits directly behind every board (board
  // z ±3.2 vs plane ±3.01) and opens 2D edit mode on double click. R3F
  // dispatches each event name independently and only stops the walk when the
  // hit object actually HAS that handler — so handleClick's stopPropagation
  // does nothing for dblclick, and without this a double click on a board would
  // open the lightbox AND drop edit mode behind it. Swallow it unconditionally:
  // a board occludes the wall, so a double click there is never meant for it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDoubleClick = (e: any) => {
    e.stopPropagation()
  }

  // Board rotation (radians) applied as rotation.z about the board center —
  // re-enabled after Phase 6. Physically correct for both sides: a board rotated
  // by R reads as -R when viewed from behind (the back render sits at -Z), which
  // is exactly what walking around a real rotated board shows.
  const boardRotation = board.position?.rotation ?? 0

  return (
    <group
      position={position}
      rotation={[0, 0, boardRotation]}
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
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry args={[width, height, BOARD_THICKNESS]} />
        {isPDF && imageUrl ? (
          <PDFTextureMaterial pdfUrl={imageUrl} hovered={isHovered} />
        ) : texture ? (
          <BoardImageMaterial texture={texture} hovered={isHovered} isHighlighted={isHighlighted} dimmed={dimmed} />
        ) : (
          // Show skeleton ONLY on the very first load (no prior texture available).
          // URL swaps after that keep the previous texture on screen via useBoardTexture.
          isInitialLoad && hasValidImage ? (
            <BoardSkeletonMaterial hovered={isHovered} isHighlighted={isHighlighted} />
          ) : (
            <meshStandardMaterial
              color={dimmed ? BOARD_DIM_MULTIPLY : (hovered ? '#f8f8f8' : '#ffffff')}
              roughness={0.7}
              metalness={0.0}
              emissive={dimmed ? ROOM_SKY : (isHighlighted || hovered ? '#3B6EF6' : '#000000')}
              emissiveIntensity={dimmed ? BOARD_DIM_WASH : (isHighlighted ? 0.3 : (hovered ? 0.12 : 0))}
            />
          )
        )}
      </mesh>

      {/* Thin outline while the board is in its first-load skeleton state — gives the placeholder a discernible edge. */}
      {isInitialLoad && hasValidImage && !texture && !isPDF && (
        <lineSegments position={[0, 0, 0.003]}>
          <edgesGeometry
            attach="geometry"
            args={[skeletonEdgeGeometry]}
          />
          <lineBasicMaterial attach="material" color="#8A8FA0" transparent opacity={0.5} />
        </lineSegments>
      )}

      {/* Callout count badge — an accent marker at the top-right corner, the
          same blue every other marker and active state in the app uses, so a
          callout reads the same way regardless of which view you're in.
          Only rendered for viewers permitted to see callouts (the server omits
          the count for guests/public, so calloutCount is undefined for them) and
          only when at least one callout exists. NO distanceFactor: like a real UI
          marker it renders at a CONSTANT screen size regardless of camera
          distance (with distanceFactor it shrank to a few px in the zoomed-out
          room view — the whole point of a badge is to stay legible there). Still
          billboards to the camera (DOM overlay). pointerEvents:'none' so clicks
          pass through to the board and open the lightbox. Top-right corner — the
          linkUrl VideoBadge sits top-LEFT, so the two never collide.

          suppressCountBadge hides it while a 2D panel is open over the room (the
          lightbox, or the floor-plan editor): this <Html> is a DOM overlay at
          z-index 60 and those panels are z-50, so with the room still mounted
          behind them every badge would bleed through onto the panel. Conditional
          render rather than a style toggle, so the badge can't catch pointer
          events either. 3D-room-only by design. */}
      {!suppressCountBadge && typeof board.calloutCount === 'number' && board.calloutCount > 0 && (
        <Html
          position={[width / 2, height / 2, BOARD_THICKNESS / 2 + 0.05]}
          center
          zIndexRange={[60, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            aria-label={`${board.calloutCount} callout${board.calloutCount === 1 ? '' : 's'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '22px',
              height: '22px',
              padding: '0 6px',
              borderRadius: '11px',
              // The one accent blue, same as every other active/marker state in
              // the app. Was the redline red, which stood out as the only warm
              // colour left in the room. The white ring keeps it legible on
              // BOTH the grey and white walls.
              background: '#3B6EF6',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              lineHeight: 1,
              border: '1px solid rgba(255, 255, 255, 0.85)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {board.calloutCount}
          </div>
        </Html>
      )}

      {/* Video link badge — opens the attached video in a new tab. */}
      {board.linkUrl && <VideoBadge url={board.linkUrl} width={width} height={height} />}

      {/* Uploader name tooltip - visible in 3D room hover */}
      {isHovered && (
        <Html
          position={[0, -height / 2 - 0.1, 0.1]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(22, 24, 29, 0.85)',
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
              args={[frameEdgeGeometry]}
            />
            <lineBasicMaterial attach="material" color="#3B6EF6" linewidth={3} />
          </lineSegments>

          <mesh position={[0, 0, -0.001]}>
            <planeGeometry args={[width + 0.1, height + 0.1]} />
            <meshBasicMaterial
              color="#3B6EF6"
              transparent
              opacity={0.1}
            />
          </mesh>
        </>
      )}
    </group>
  )
}
