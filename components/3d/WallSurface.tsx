import * as THREE from 'three'
import { useMemo, useState } from 'react'
import { ThreeEvent } from '@react-three/fiber'

interface WallSurfaceProps {
  wallDimensions: { width: number; height: number } // feet
  side: 'front' | 'back'
  onSurfaceClick: (params: {
    side: 'front' | 'back'
    localPoint: THREE.Vector2
    worldPoint: THREE.Vector3
  }) => void
  /**
   * Fires on pointer-over. WallSystem uses this to kick off a fire-and-forget
   * texture pre-warm for boards on this side, so the user's subsequent
   * wall-click into edit mode doesn't show the grey skeleton placeholder.
   */
  onSurfaceHover?: (params: { side: 'front' | 'back' }) => void
  visibleOutline?: boolean
}

/**
 * Clickable, invisible plane representing one wall face (front/back).
 * Geometry is axis-aligned in local space; parent group handles rotation/position.
 */
export function WallSurface({
  wallDimensions,
  side,
  onSurfaceClick,
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

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // Local coordinates on the plane: x,y in plane space (centered)
    const local = e.intersections[0]?.uv
    if (!local) return
    // Convert uv (0..1) to centered (-0.5..0.5)
    const localPoint = new THREE.Vector2(local.x - 0.5, local.y - 0.5)
    const worldPoint = e.point.clone()
    onSurfaceClick({
      side,
      localPoint,
      worldPoint,
    })
  }

  return (
    <mesh
      position={[0, 0, zOffset]}
      rotation={[0, 0, 0]}
      onClick={handleClick}
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
        color={hovered && visibleOutline ? '#4b5563' : '#000000'}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

export default WallSurface
