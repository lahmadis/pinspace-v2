/**
 * Shared wall layout math for 3D room and 2D floor editor.
 * 1 unit = 1 inch.
 */

import type { FloorTable } from '@/types'

export interface WallDimensions {
  height: number
  width: number
}

export type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

/** Optional per-wall override for position and rotation (inches, radians). When set, used instead of layout-derived position. */
export interface WallTransformOverride {
  x: number
  z: number
  rotationY: number
}

/**
 * A free-floating text label placed on a wall. Persisted in the wall-config
 * blob (NOT the DB / boards table). x/y use the SAME convention as boards:
 * normalized wall-relative, center anchor, clamped to [-0.5, 0.5]. fontSize is
 * in inches (1 unit = 1 inch, matching the scene scale).
 */
export interface WallTextItem {
  id: string
  wallIndex: number
  x: number
  y: number
  text: string
  fontSize: number
  side: 'front' | 'back'
}

export interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
  /** When set, wall positions/rotations use these overrides instead of layout math. */
  customTransforms?: WallTransformOverride[]
  /**
   * Fields below are part of the persisted wall-config blob but not the
   * geometry math. They were previously merged in ad-hoc at save time; typed
   * here so the stored shape is discoverable in one place.
   */
  /** Free-floating wall text labels (blob-persisted, not DB rows). */
  textItems?: WallTextItem[]
  /** Floor models/tables persisted alongside geometry. */
  tables?: FloorTable[]
  /**
   * The floor slab, as its own surface.
   *
   * OPTIONAL ON PURPOSE. The floor used to be derived — literally the bounding
   * box of the walls — so moving a wall outward dragged the floor with it and
   * the two could never disagree. Rooms saved before this field exists still
   * behave exactly that way, because `getFloorRect` falls back to the derived
   * bounds when it's absent. Once a floor is set here it is independent: walls
   * can sit off it, and resizing it does not move any wall.
   */
  floor?: FloorRect
  /** Optimistic-concurrency version stamped by the wall-config store. */
  version?: number
}

/**
 * Canonical fresh-room layout: 4 zigzag walls with hand-tuned customTransforms.
 * Used by the studio page on first entry and by the rooms-create endpoint to seed
 * new rooms so they don't inherit any sibling room's edited config.
 */
export const DEFAULT_WALL_CONFIG: WallConfig = {
  layoutType: 'zigzag',
  walls: [
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 },
    { height: 10, width: 8 },
  ],
  customTransforms: [
    { x: -43.90182462935905, z: -93.15280816860862, rotationY: 0 },
    { x: 1.5, z: -46.5, rotationY: 1.5707963267948966 },
    { x: 46.83620060511996, z: -1.2549356733049677, rotationY: 0 },
    { x: 91.85236286631033, z: 49.35139735216034, rotationY: 1.5707963267948966 },
  ],
}

const SCALE = 12 // feet to inches

/** Returns transform for a wall, using customTransforms override when present. */
export function getWallTransformResolved(
  wallConfig: WallConfig,
  index: number
): { x: number; z: number; rotationY: number; width: number; height: number } {
  const base = getWallTransform(wallConfig, index)
  const custom = wallConfig.customTransforms?.[index]
  if (custom) {
    return { ...base, x: custom.x, z: custom.z, rotationY: custom.rotationY }
  }
  return base
}

export function getWallTransform(
  wallConfig: WallConfig,
  index: number
): { x: number; z: number; rotationY: number; width: number; height: number } {
  const wall = wallConfig.walls[index]
  const width = wall.width * SCALE
  const height = wall.height * SCALE

  let x = 0
  let z = 0
  let rotationY = 0

  const { layoutType } = wallConfig

  switch (layoutType) {
    case 'zigzag': {
      const WALL_DEPTH = 6
      const OVERLAP = WALL_DEPTH / 2

      let currentX = 0
      let currentZ = 0

      for (let i = 0; i < index; i++) {
        const prevWidth = wallConfig.walls[i].width * SCALE
        if (i % 2 === 0) {
          currentX += prevWidth - (i > 0 ? OVERLAP : 0)
        } else {
          currentZ += prevWidth - OVERLAP
        }
      }

      if (index % 2 === 0) {
        x = currentX + width / 2 - (index > 0 ? OVERLAP / 2 : 0)
        z = currentZ
        rotationY = 0
      } else {
        x = currentX
        z = currentZ + width / 2 - OVERLAP / 2
        rotationY = Math.PI / 2
      }

      let totalXExtent = 0
      let totalZExtent = 0
      let tempX = 0
      let tempZ = 0
      for (let i = 0; i < wallConfig.walls.length; i++) {
        const w = wallConfig.walls[i].width * SCALE
        if (i % 2 === 0) {
          tempX += w - (i > 0 ? OVERLAP : 0)
          totalXExtent = Math.max(totalXExtent, tempX)
        } else {
          tempZ += w - OVERLAP
          totalZExtent = Math.max(totalZExtent, tempZ)
        }
      }
      x -= totalXExtent / 2
      z -= totalZExtent / 2
      break
    }

    case 'linear': {
      const spacing = width + 2
      x = index * spacing - (wallConfig.walls.length * spacing) / 2
      z = 0
      rotationY = 0
      break
    }

    case 'square': {
      const wallWidths = wallConfig.walls.map((w) => w.width * SCALE)
      if (index === 0) {
        x = 0
        z = wallWidths[0] / 2
        rotationY = 0
      } else if (index === 1) {
        x = wallWidths[0] / 2
        z = 0
        rotationY = Math.PI / 2
      } else if (index === 2) {
        x = 0
        z = -wallWidths[2] / 2
        rotationY = Math.PI
      } else if (index === 3) {
        x = -wallWidths[0] / 2
        z = 0
        rotationY = -Math.PI / 2
      }
      break
    }

    case 'lshape': {
      const wallWidths = wallConfig.walls.map((w) => w.width * SCALE)
      if (index === 0) {
        x = 0
        z = 0
        rotationY = 0
      } else if (index === 1) {
        x = wallWidths[0] / 2
        z = -wallWidths[1] / 2
        rotationY = Math.PI / 2
      } else if (index >= 2) {
        const prevWall = wallWidths[1]
        x = wallWidths[0] / 2
        z = -prevWall - (index - 1) * wallWidths[index]
        rotationY = Math.PI / 2
      }
      break
    }

    default: {
      const angle = (index * Math.PI) / 2
      const radius = 5 + (index - 4) * 2
      x = Math.cos(angle) * radius
      z = Math.sin(angle) * radius
      rotationY = angle + Math.PI / 2
    }
  }

  return { x, z, rotationY, width, height }
}

/** The floor slab in world inches, centre + size. */
export interface FloorRect {
  centerX: number
  centerZ: number
  width: number
  depth: number
}

/** Smallest floor we will store or draw, in inches. */
export const FLOOR_MIN_INCHES = 24

/**
 * The room's floor, explicit if it has one and derived from the walls if not.
 *
 * Every consumer must go through this rather than calling calculateFloorBounds
 * directly for floor purposes — that function answers "what do the walls span",
 * which is a DIFFERENT question now that the two can disagree. It is still the
 * right call for framing a camera around the walls themselves.
 */
export function getFloorRect(wallConfig: WallConfig): FloorRect {
  const f = wallConfig.floor
  if (
    f &&
    Number.isFinite(f.centerX) && Number.isFinite(f.centerZ) &&
    Number.isFinite(f.width) && Number.isFinite(f.depth) &&
    f.width >= FLOOR_MIN_INCHES && f.depth >= FLOOR_MIN_INCHES
  ) {
    return { centerX: f.centerX, centerZ: f.centerZ, width: f.width, depth: f.depth }
  }
  const b = calculateFloorBounds(wallConfig)
  // A wall-less room has infinite/NaN bounds; give it a real slab to stand on.
  if (!Number.isFinite(b.floorWidth) || !Number.isFinite(b.floorDepth) || b.floorWidth <= 0 || b.floorDepth <= 0) {
    return { centerX: 0, centerZ: 0, width: 12 * 12, depth: 12 * 12 }
  }
  return {
    centerX: b.floorCenterX,
    centerZ: b.floorCenterZ,
    width: Math.max(b.floorWidth, FLOOR_MIN_INCHES),
    depth: Math.max(b.floorDepth, FLOOR_MIN_INCHES),
  }
}

/** World-space extents of a floor rect, for unioning with wall bounds. */
export function floorRectBounds(f: FloorRect) {
  return {
    minX: f.centerX - f.width / 2,
    maxX: f.centerX + f.width / 2,
    minZ: f.centerZ - f.depth / 2,
    maxZ: f.centerZ + f.depth / 2,
  }
}

export function calculateFloorBounds(wallConfig: WallConfig): {
  floorWidth: number
  floorDepth: number
  floorCenterX: number
  floorCenterZ: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  const wallDepth = 6

  wallConfig.walls.forEach((_, index) => {
    const transform = getWallTransformResolved(wallConfig, index)
    const halfWidth = transform.width / 2
    const halfDepth = wallDepth / 2

    const cos = Math.cos(transform.rotationY)
    const sin = Math.sin(transform.rotationY)

    const corners = [
      { x: -halfWidth, z: -halfDepth },
      { x: halfWidth, z: -halfDepth },
      { x: -halfWidth, z: halfDepth },
      { x: halfWidth, z: halfDepth },
    ]

    corners.forEach((corner) => {
      const worldX = transform.x + corner.x * cos - corner.z * sin
      const worldZ = transform.z + corner.x * sin + corner.z * cos
      minX = Math.min(minX, worldX)
      maxX = Math.max(maxX, worldX)
      minZ = Math.min(minZ, worldZ)
      maxZ = Math.max(maxZ, worldZ)
    })
  })

  const floorWidth = maxX - minX
  const floorDepth = maxZ - minZ
  const floorCenterX = (minX + maxX) / 2
  const floorCenterZ = (minZ + maxZ) / 2

  return {
    floorWidth,
    floorDepth,
    floorCenterX,
    floorCenterZ,
    minX,
    maxX,
    minZ,
    maxZ,
  }
}

/**
 * Which vertical edges of each wall butt into a neighbouring wall.
 *
 * The 3D room rounds a wall's corners only where the wall actually ends in
 * open air. Rounding every corner is what the reference art does, but the
 * reference is two free-standing panels — a real room joins its walls (zigzag
 * and lshape chain them with an explicit OVERLAP, square closes a loop), and a
 * rounded corner at a junction opens a notch at eye level.
 *
 * Two-stage on purpose. The layout says which pairs are MEANT to meet; the
 * distance check then confirms they still do, which is what makes this correct
 * under customTransforms — drag a wall off the chain and both sides of that
 * junction round, without the neighbour needing to know it was moved.
 *
 * 'linear' and any unknown layout are treated as free throughout: those place
 * walls as separate objects rather than as a continuous surface, so their ends
 * are ends even when they happen to sit close together.
 */
const CHAINED_LAYOUTS: ReadonlySet<string> = new Set(['zigzag', 'square', 'lshape'])

/**
 * How close two wall ends must be to count as joined, in inches. Walls that
 * meet are built to coincide (the chain layouts overlap them by half the 6"
 * wall depth), so this only has to absorb the half-overlap fudge in that math —
 * not bridge a real gap.
 */
const JOIN_TOLERANCE_IN = 12

/** A wall's two vertical edges in world XZ, at the wall's mid-height. */
function wallEndpoints(t: { x: number; z: number; rotationY: number; width: number }) {
  const half = t.width / 2
  const c = Math.cos(t.rotationY)
  const s = Math.sin(t.rotationY)
  return {
    left: { x: t.x - half * c, z: t.z + half * s },
    right: { x: t.x + half * c, z: t.z - half * s },
  }
}

export function getWallEdgeJoins(
  wallConfig: WallConfig
): { left: boolean; right: boolean }[] {
  const n = wallConfig.walls.length
  const joins = Array.from({ length: n }, () => ({ left: false, right: false }))
  if (!CHAINED_LAYOUTS.has(wallConfig.layoutType)) return joins

  const ends = wallConfig.walls.map((_, i) =>
    wallEndpoints(getWallTransformResolved(wallConfig, i))
  )

  // Intended chain: i meets i+1, and square additionally closes n-1 back to 0.
  const pairs: [number, number][] = []
  for (let i = 0; i < n - 1; i++) pairs.push([i, i + 1])
  if (wallConfig.layoutType === 'square' && n > 2) pairs.push([n - 1, 0])

  const near = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(a.x - b.x, a.z - b.z) <= JOIN_TOLERANCE_IN

  for (const [a, b] of pairs) {
    // All four end pairings are tested, and they are NOT interchangeable in
    // practice: zigzag as getWallTransform actually builds it joins wall0's
    // right to wall1's RIGHT and wall1's left to wall2's LEFT, so the
    // right-to-left case below often misses and a later branch carries it.
    // Square coincides exactly. Do not "simplify" this to one comparison.
    if (near(ends[a].right, ends[b].left)) { joins[a].right = true; joins[b].left = true }
    else if (near(ends[a].right, ends[b].right)) { joins[a].right = true; joins[b].right = true }
    else if (near(ends[a].left, ends[b].left)) { joins[a].left = true; joins[b].left = true }
    else if (near(ends[a].left, ends[b].right)) { joins[a].left = true; joins[b].right = true }
  }

  return joins
}
