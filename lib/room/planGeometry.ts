import { getWallTransformResolved } from '@/lib/wallLayout'

export interface WallConfigLike {
  walls: Array<{ width: number; height: number }>
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
  customTransforms?: Array<{ x: number; z: number; rotationY: number }>
}

export interface WallSegment {
  index: number
  /** Endpoints in world XZ, inches. */
  x1: number
  z1: number
  x2: number
  z2: number
  /** Centre in world XZ. */
  cx: number
  cz: number
  rotationY: number
  width: number
}

/**
 * Wall centre-lines in world XZ, for top-down drawing (minimap and Plan view).
 *
 * A wall group sits at (x, _, z) rotated by rotationY about Y, with the panel
 * running along its local X. Rotating local +X by rotationY gives
 * (cos r, -sin r) in world XZ, so the endpoints are the centre plus and minus
 * half the width along that direction.
 *
 * Derived from getWallTransformResolved — the same function the 3D geometry
 * uses — so custom-positioned walls are correct here for free and no layout
 * math is duplicated.
 */
export function wallSegments(wallConfig: WallConfigLike): WallSegment[] {
  return wallConfig.walls.map((_wall, index) => {
    const t = getWallTransformResolved(wallConfig, index)
    const hx = (Math.cos(t.rotationY) * t.width) / 2
    const hz = (-Math.sin(t.rotationY) * t.width) / 2
    return {
      index,
      x1: t.x + hx,
      z1: t.z + hz,
      x2: t.x - hx,
      z2: t.z - hz,
      cx: t.x,
      cz: t.z,
      rotationY: t.rotationY,
      width: t.width,
    }
  })
}

export interface PlanBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  width: number
  depth: number
  centerX: number
  centerZ: number
}

/** Axis-aligned bounds of the wall set, with `pad` inches of margin. */
export function planBounds(segments: WallSegment[], pad = 24): PlanBounds {
  if (segments.length === 0) {
    return { minX: -pad, maxX: pad, minZ: -pad, maxZ: pad, width: pad * 2, depth: pad * 2, centerX: 0, centerZ: 0 }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2)
    maxX = Math.max(maxX, s.x1, s.x2)
    minZ = Math.min(minZ, s.z1, s.z2)
    maxZ = Math.max(maxZ, s.z1, s.z2)
  }
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad
  return {
    minX, maxX, minZ, maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  }
}

/** Live camera orientation, written per frame by the rig and read without re-rendering. */
export interface CameraPlanState {
  azimuth: number
  distance: number
}
