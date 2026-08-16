import * as THREE from 'three'
import { useMemo, useState } from 'react'
import { ThreeEvent } from '@react-three/fiber'
import { ENGINE_PALETTE } from './enginePalette'

// R3F reports `delta` on click-family events: pixels travelled since the last
// pointerdown. The browser already refuses to fire dblclick when the two clicks
// land far apart, so this only has to catch what it does allow — a small orbit
// drag repeated in place, which should rotate the camera, not open edit mode.
// Slightly looser than R3F's own internal threshold of 2 so a jittery-but-real
// double click still registers.
const DRAG_THRESHOLD_PX = 4

interface WallSurfaceProps {
  wallDimensions: { width: number; height: number } // feet
  side: 'front' | 'back'
  /**
   * Fires on DOUBLE click only — a single click on a wall is deliberately inert
   * so it stays free for orbit/drag. Wired to R3F's onDoubleClick, which maps to
   * the native dblclick event, so double-click timing is the browser's (and thus
   * the platform's) rather than a hand-rolled timer.
   */
  onSurfaceDoubleClick: (params: {
    side: 'front' | 'back'
    localPoint: THREE.Vector2
    worldPoint: THREE.Vector3
  }) => void
  /**
   * Fires on pointer-over. WallSystem uses this to kick off a fire-and-forget
   * texture pre-warm for boards on this side, so the user's subsequent
   * double-click into edit mode doesn't show the grey skeleton placeholder.
   */
  onSurfaceHover?: (params: { side: 'front' | 'back' }) => void
  visibleOutline?: boolean
}

/**
 * Invisible plane representing one wall face (front/back), activated by DOUBLE
 * click. Geometry is axis-aligned in local space; parent group handles
 * rotation/position.
 */
export function WallSurface({
  wallDimensions,
  side,
  onSurfaceDoubleClick,
  onSurfaceHover,
  visibleOutline = false,
}: WallSurfaceProps) {
  // Inches
  const width = wallDimensions.width * 12
  const height = wallDimensions.height * 12

  // Offset the plane slightly away from wall center so it sits in front/back of the visible wall mesh.
  // Wall depth is 6 inches, so surface is at 3 inches from center
  const zOffset = useMemo(() => (side === 'front' ? 3.01 : -3.01), [side])

  // Optional hover outline (very light)
  const [hovered, setHovered] = useState(false)

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // Ignore a double click that ended a drag — that gesture was an orbit.
    if (e.delta > DRAG_THRESHOLD_PX) return
    // Local coordinates on the plane: x,y in plane space (centered)
    const local = e.intersections[0]?.uv
    if (!local) return
    // Convert uv (0..1) to centered (-0.5..0.5)
    const localPoint = new THREE.Vector2(local.x - 0.5, local.y - 0.5)
    const worldPoint = e.point.clone()
    onSurfaceDoubleClick({
      side,
      localPoint,
      worldPoint,
    })
  }

  return (
    <mesh
      position={[0, 0, zOffset]}
      rotation={[0, 0, 0]}
      onDoubleClick={handleDoubleClick}
      onPointerOver={() => {
        setHovered(true)
        onSurfaceHover?.({ side })
      }}
      onPointerOut={() => setHovered(false)}
    >
      <planeGeometry args={[width, height, 1, 1]} />
      <meshBasicMaterial
        transparent
        opacity={0.01}
        color={hovered && visibleOutline ? ENGINE_PALETTE.wallOutline : ENGINE_PALETTE.black}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

export default WallSurface
