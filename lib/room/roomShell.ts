/**
 * Closed-room geometry for the fixed-camera room.
 *
 * The old room was an open zigzag of wall panels orbited by a free camera. This
 * one is a sealed volume: the viewer stands at the centre, at eye height, and
 * the room itself yaws so a different wall faces them. The camera never moves,
 * never translates and never changes lens — so every number here describes the
 * ROOM, and the only thing that ever animates is a single rotateY on the shell.
 *
 * Two ideas do all the work:
 *
 * 1. BAYS. A wall in the stored config is a double-sided partition — 43% of
 *    placed boards live on `position_side: 'back'` — so one configured wall
 *    yields up to two bays. Walking the ring front-to-back and then back-to-front
 *    is what walking around a row of partitions feels like, and it means no
 *    board has to move to survive the rewrite.
 *
 * 2. THE APOTHEM IS THE PERSPECTIVE DISTANCE. CSS projects an element at
 *    translateZ(-D) by P/(P+D), where P is the `perspective` value. If the shell
 *    is pushed forward by exactly P, the facing wall lands on the projection
 *    plane and renders 1:1 — no resampling, no blur on the sheets you are
 *    actually reading. Every other surface falls out of that for free. See
 *    projectRoom.
 *
 * 1 unit = 1 inch throughout, matching lib/wallLayout.ts.
 */

import type { Board } from '@/types'

const IN_PER_FT = 12

/** Eye height of a standing viewer. Fixes where the horizon sits on every wall. */
export const EYE_IN = 64

/** A room never has fewer bays than this; short configs are padded with blanks. */
const MIN_BAYS = 4

/** Bays are this much wider than the pin-up surface, so sheets never hit a corner. */
const BAY_MARGIN = 1.12

/** Rooms below these read as a broom closet regardless of what was configured. */
const MIN_HEIGHT_IN = 96
const MIN_APOTHEM_IN = 90

/** Horizontal field of view is clamped into this band, in degrees. */
const MIN_HFOV_DEG = 58
const MAX_HFOV_DEG = 104

/** Fraction of the viewport the facing bay is allowed to occupy. */
const FILL_H = 0.94
const FILL_V = 0.9

export type BaySide = 'front' | 'back'

export interface RoomBay {
  /** Stable key, also the identity used by navigation and deep links. */
  key: string
  /** Index into wallConfig.walls, or -1 for a padding bay. */
  wallIndex: number
  side: BaySide
  /** Configured pin-up surface for this bay, in inches. */
  widthIn: number
  heightIn: number
  /** True when no configured wall backs this bay — it exists to close the room. */
  blank: boolean
  /** Mono label painted above the bay, e.g. `WALL 02` / `WALL 02 · REVERSE`. */
  label: string
}

export interface RoomShell {
  bays: RoomBay[]
  /** Degrees of yaw between adjacent bays. */
  sliceDeg: number
  /** Centre-to-wall distance, inches. */
  apothemIn: number
  /** Full width of one bay face, inches. Always >= that bay's pin-up width. */
  faceWidthIn: number
  /** Floor-to-ceiling, inches. */
  heightIn: number
  eyeIn: number
}

export interface WallSpec {
  width: number
  height: number
}

export interface RoomShellConfig {
  walls: WallSpec[]
}

/**
 * Which bays a room needs.
 *
 * Front bays come first in wall order, then back bays in REVERSE wall order, so
 * the ring closes the way a walk around a row of partitions does: down one face,
 * around the end, back along the other. A back bay is only emitted when
 * something is pinned to it, or when `includeAllBacks` forces it — which edit
 * mode does, so a reverse face can be filled for the first time.
 */
function buildBays(walls: WallSpec[], boards: Board[], includeAllBacks: boolean): RoomBay[] {
  const backHasContent = new Set<number>()
  for (const board of boards) {
    const pos = board.position
    if (!pos || (pos.side ?? 'front') !== 'back') continue
    if (typeof pos.wallIndex === 'number') backHasContent.add(pos.wallIndex)
  }

  const bayFor = (wallIndex: number, side: BaySide): RoomBay => {
    const wall = walls[wallIndex]
    const n = String(wallIndex + 1).padStart(2, '0')
    return {
      key: `${wallIndex}:${side}`,
      wallIndex,
      side,
      widthIn: wall.width * IN_PER_FT,
      heightIn: wall.height * IN_PER_FT,
      blank: false,
      label: side === 'back' ? `WALL ${n} · REVERSE` : `WALL ${n}`,
    }
  }

  const bays: RoomBay[] = walls.map((_, i) => bayFor(i, 'front'))
  for (let i = walls.length - 1; i >= 0; i--) {
    if (includeAllBacks || backHasContent.has(i)) bays.push(bayFor(i, 'back'))
  }

  // Pad to a believable room. A blank bay is a real wall with nothing on it,
  // which is what a studio with one pin-up wall genuinely looks like — better
  // than pretending the room is a two-sided sliver.
  const tallest = walls.reduce((m, w) => Math.max(m, w.height * IN_PER_FT), MIN_HEIGHT_IN)
  const widest = walls.reduce((m, w) => Math.max(m, w.width * IN_PER_FT), 0)
  let pad = 0
  while (bays.length < MIN_BAYS) {
    pad += 1
    bays.push({
      key: `blank:${pad}`,
      wallIndex: -1,
      side: 'front',
      widthIn: widest || 96,
      heightIn: tallest,
      blank: true,
      label: '',
    })
  }
  return bays
}

/**
 * Resolve a wall config plus its boards into the closed room they describe.
 *
 * `customTransforms` from the old floor editor is deliberately ignored: it
 * positioned panels in an open plan for an orbiting camera, and there is no open
 * plan any more. Wall COUNT and each wall's width/height still drive everything,
 * so the floor editor's add / remove / resize controls keep their meaning.
 */
export function buildRoomShell(
  config: RoomShellConfig | null | undefined,
  boards: Board[],
  opts?: { includeAllBacks?: boolean },
): RoomShell {
  const walls = config?.walls?.length ? config.walls : [{ width: 8, height: 10 }]
  const bays = buildBays(walls, boards, opts?.includeAllBacks ?? false)

  const sliceRad = (Math.PI * 2) / bays.length
  const halfSlice = Math.tan(sliceRad / 2)

  const heightIn = Math.max(MIN_HEIGHT_IN, ...bays.map((b) => b.heightIn))

  // The room has to be deep enough that the WIDEST bay still fits inside its
  // angular slice with margin. Solving faceWidth = 2 * d * tan(slice/2) for d.
  const widestIn = Math.max(...bays.map((b) => b.widthIn))
  const apothemIn = Math.max(MIN_APOTHEM_IN, (widestIn * BAY_MARGIN) / 2 / halfSlice)
  const faceWidthIn = 2 * apothemIn * halfSlice

  return {
    bays,
    sliceDeg: 360 / bays.length,
    apothemIn,
    faceWidthIn,
    heightIn,
    eyeIn: Math.min(EYE_IN, heightIn - 12),
  }
}

export interface RoomProjection {
  /** CSS `perspective`, px. Also the shell's translateZ — see the note up top. */
  perspectivePx: number
  /** Scale factor from inches to CSS px inside the shell. */
  pxPerIn: number
  faceWidthPx: number
  heightPx: number
  eyePx: number
  /** translateY that puts a floor-to-ceiling wall panel in the right place. */
  wallCenterYPx: number
  /** Resulting horizontal field of view, degrees. Informational. */
  hfovDeg: number
}

/**
 * Fit the room to a viewport.
 *
 * P is chosen so the facing bay fits the frame, then clamped into a sane field
 * of view — a four-bay room seen from its own centre genuinely is a wide-angle
 * view, and pretending otherwise would crop the wall. pxPerIn falls out of
 * P / apothem, which is what puts the facing wall at 1:1.
 */
export function projectRoom(shell: RoomShell, viewportW: number, viewportH: number): RoomProjection {
  const w = Math.max(viewportW, 320)
  const h = Math.max(viewportH, 240)
  const halfSlice = Math.tan((shell.sliceDeg * Math.PI) / 360)

  const byWidth = (FILL_H * w) / (2 * halfSlice)
  const byHeight = (FILL_V * h * shell.apothemIn) / shell.heightIn

  const pMax = w / 2 / Math.tan((MIN_HFOV_DEG * Math.PI) / 360)
  const pMin = w / 2 / Math.tan((MAX_HFOV_DEG * Math.PI) / 360)
  const perspectivePx = Math.min(pMax, Math.max(pMin, Math.min(byWidth, byHeight)))

  const pxPerIn = perspectivePx / shell.apothemIn
  return {
    perspectivePx,
    pxPerIn,
    faceWidthPx: shell.faceWidthIn * pxPerIn,
    heightPx: shell.heightIn * pxPerIn,
    eyePx: shell.eyeIn * pxPerIn,
    wallCenterYPx: (shell.eyeIn - shell.heightIn / 2) * pxPerIn,
    hfovDeg: (2 * Math.atan(w / 2 / perspectivePx) * 180) / Math.PI,
  }
}

export interface BayPlanSegment {
  bayIndex: number
  /** Wall line in plan space, centred on the origin. Units are inches. */
  x1: number
  y1: number
  x2: number
  y2: number
  /** Midpoint, and the outward normal, for label placement. */
  midX: number
  midY: number
  normalX: number
  normalY: number
}

export interface RoomPlan {
  segments: BayPlanSegment[]
  /** Half-extent of the plan in inches, for framing an SVG viewBox. */
  radiusIn: number
}

/**
 * The room's footprint, as a plan.
 *
 * Same convention as the shell: bay `i` sits at bearing `-i * slice` and plan
 * +Y runs INTO the screen (away from the viewer), so a plan drawn straight from
 * these numbers is oriented the way the viewer is standing. Feeding the compass
 * and the Plan view from here means all three surfaces can never disagree about
 * the room's shape.
 */
export function roomPlan(shell: RoomShell): RoomPlan {
  const half = shell.faceWidthIn / 2
  const segments: BayPlanSegment[] = shell.bays.map((_, i) => {
    // The shell places bay i with rotateY(-i*slice) translateZ(-apothem), which
    // lands it at world (d*sin a, -d*cos a). Plan +Y is world -Z, so the plan
    // centre is (d*sin a, d*cos a) and the outward normal is (sin a, cos a).
    const a = (i * shell.sliceDeg * Math.PI) / 180
    const nx = Math.sin(a)
    const ny = Math.cos(a)
    const midX = nx * shell.apothemIn
    const midY = ny * shell.apothemIn
    // Wall runs perpendicular to its normal.
    const tx = Math.cos(a)
    const ty = -Math.sin(a)
    return {
      bayIndex: i,
      x1: midX - tx * half,
      y1: midY - ty * half,
      x2: midX + tx * half,
      y2: midY + ty * half,
      midX,
      midY,
      normalX: nx,
      normalY: ny,
    }
  })
  return { segments, radiusIn: Math.hypot(shell.apothemIn, half) }
}

/** Bay index a board belongs to, or -1 when it is unplaced / on a missing bay. */
export function bayIndexForBoard(bays: RoomBay[], board: Board): number {
  const pos = board.position
  if (!pos || typeof pos.wallIndex !== 'number') return -1
  const side = pos.side === 'back' ? 'back' : 'front'
  return bays.findIndex((b) => b.wallIndex === pos.wallIndex && b.side === side)
}

/**
 * Shortest signed number of steps from bay `from` to bay `to` around the ring.
 * Navigation adds this to an UNWRAPPED counter so the shell always takes the
 * short way round and the CSS transition never unwinds 350 degrees.
 */
export function shortestStep(from: number, to: number, count: number): number {
  if (count <= 0) return 0
  let d = (to - from) % count
  if (d > count / 2) d -= count
  if (d < -count / 2) d += count
  return d
}

/** Wrap an unbounded facing counter onto a real bay index. */
export function wrapBay(facing: number, count: number): number {
  if (count <= 0) return 0
  return ((Math.round(facing) % count) + count) % count
}
