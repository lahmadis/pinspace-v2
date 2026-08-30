import { getWallTransformResolved } from '@/lib/wallLayout'

export interface WallConfigLike {
  walls: Array<{ width: number; height: number }>
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
  customTransforms?: Array<{ x: number; z: number; rotationY: number }>
  /** The floor slab, when the room has an explicit one. See getFloorRect. */
  floor?: { centerX: number; centerZ: number; width: number; depth: number }
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

/**
 * Which ends of each wall are FREE — not butted up against another wall.
 *
 * Indexed by wall, `plus` is the local +X end (WallSegment's x1/z1) and `minus`
 * the local -X end (x2/z2), matching the sign convention the 3D wall panel is
 * built in so a caller can map an end straight onto a shape corner.
 *
 * This exists because "round the corners" is only ever true of a free end. A
 * radius where two walls MEET opens a notch at eye level — you see daylight
 * through the joint — which is why the panels were square in the first place.
 * Adjacency is geometric rather than positional (not "the first and last wall
 * in the array") so it stays right for a square layout, which is a closed loop
 * with no free ends at all, and for hand-placed customTransforms.
 *
 * `tolerance` is in inches and defaults to a wall's own thickness: two walls
 * that meet are modelled as centre-lines whose endpoints coincide, but a
 * hand-dragged wall can sit a hair off and still read as joined.
 */
export function wallFreeEnds(
  wallConfig: WallConfigLike,
  tolerance = 6,
): Array<{ plus: boolean; minus: boolean }> {
  const segs = wallSegments(wallConfig)
  const near = (ax: number, az: number, bx: number, bz: number) =>
    Math.hypot(ax - bx, az - bz) <= tolerance

  return segs.map((seg) => {
    let plus = true
    let minus = true
    for (const other of segs) {
      if (other.index === seg.index) continue
      // Either of the other wall's ends can land on either of ours.
      if (near(seg.x1, seg.z1, other.x1, other.z1) || near(seg.x1, seg.z1, other.x2, other.z2)) plus = false
      if (near(seg.x2, seg.z2, other.x1, other.z1) || near(seg.x2, seg.z2, other.x2, other.z2)) minus = false
    }
    return { plus, minus }
  })
}

/**
 * Wall thickness in inches — the 6 the 3D slab is extruded through. Used here
 * only as the tolerance that tells a JOINT apart from a CROSSING.
 */
const WALL_THICKNESS_IN = 6

/**
 * Slack on the parallel test, in inches.
 *
 * Two walls standing SIDE BY SIDE are flush when their centre-lines are exactly
 * one thickness apart — 3in of each meeting in the middle. That is a thing
 * people build (a double-sided pin-up bay is two walls back to back), so the
 * overlap test has to begin strictly INSIDE that distance, not at it. Without
 * the slack, `distance >= thickness` and `distance > thickness` differ by the
 * one value that matters and a wall could never be pushed up against its
 * neighbour: it stopped a hair short, every time.
 *
 * Half an inch, so a hand-dragged wall that lands a rounding error inside flush
 * still reads as flush rather than as a collision.
 */
const PARALLEL_TOUCH_TOLERANCE_IN = 0.5

/**
 * Do two wall centre-lines actually cross, as opposed to meet?
 *
 * The distinction is the whole point. A room is walls that touch: an L-joint
 * shares a corner, a T-joint lands one wall's end in another's span, and both
 * are things people build. What nobody builds is an X — two walls passing
 * THROUGH each other, each continuing out the far side.
 *
 * So the test is a PROPER intersection: the crossing point has to be strictly
 * interior to both segments, with the last half-thickness at each end excused.
 * That tolerance is what keeps a legitimate joint from reading as a collision —
 * two walls that meet at a corner do overlap, by exactly the 3in each of them
 * sticks past the centre-line.
 *
 * Parallel walls are handled separately: they never "intersect" by the
 * determinant test no matter how completely one lies on top of the other, and a
 * wall dragged flat onto another is as wrong as an X.
 */
function segmentsCross(a: WallSegment, b: WallSegment): boolean {
  const d1x = a.x2 - a.x1
  const d1z = a.z2 - a.z1
  const d2x = b.x2 - b.x1
  const d2z = b.z2 - b.z1
  const lenA = Math.hypot(d1x, d1z) || 1
  const lenB = Math.hypot(d2x, d2z) || 1

  // Half a wall's thickness, expressed as a fraction of each segment — the
  // amount of end-overlap a real joint is allowed to have.
  const epsA = WALL_THICKNESS_IN / 2 / lenA
  const epsB = WALL_THICKNESS_IN / 2 / lenB

  const denom = d1x * d2z - d1z * d2x
  if (Math.abs(denom) < 1e-9) {
    // Parallel. Crossing here means lying INSIDE each other: nearer than the one
    // thickness that separates two flush walls, AND overlapping along the
    // shared axis by more than the end tolerance a joint would explain.
    const ux = d1x / lenA
    const uz = d1z / lenA
    const perp = Math.abs((b.x1 - a.x1) * -uz + (b.z1 - a.z1) * ux)
    if (perp > WALL_THICKNESS_IN - PARALLEL_TOUCH_TOLERANCE_IN) return false
    const t1 = ((b.x1 - a.x1) * ux + (b.z1 - a.z1) * uz) / lenA
    const t2 = ((b.x2 - a.x1) * ux + (b.z2 - a.z1) * uz) / lenA
    const lo = Math.min(t1, t2)
    const hi = Math.max(t1, t2)
    return Math.min(hi, 1) - Math.max(lo, 0) > Math.max(epsA, epsB)
  }

  const t = ((b.x1 - a.x1) * d2z - (b.z1 - a.z1) * d2x) / denom
  const u = ((b.x1 - a.x1) * d1z - (b.z1 - a.z1) * d1x) / denom
  return t > epsA && t < 1 - epsA && u > epsB && u < 1 - epsB
}

/**
 * How many other walls the wall at `index` passes through.
 *
 * A COUNT rather than a boolean so a caller can reject a gesture that makes
 * things worse while still letting one that makes things better through. A
 * layout saved before this rule existed can already contain an X, and a plain
 * "is it crossing?" veto would weld those walls in place — every candidate
 * position crosses, so nothing could be dragged, including apart.
 */
export function countWallCrossings(wallConfig: WallConfigLike, index: number): number {
  const segs = wallSegments(wallConfig)
  const self = segs[index]
  if (!self) return 0
  let count = 0
  for (const other of segs) {
    if (other.index === index) continue
    if (segmentsCross(self, other)) count += 1
  }
  return count
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
