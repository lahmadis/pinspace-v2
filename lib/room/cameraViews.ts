/**
 * Camera pose math for the 3D room — preset views and head-on wall framing.
 *
 * Pure functions, no React and no side effects, because three different mount
 * points need the same answers: the editor (components/3d/StudioRoom.tsx), the
 * read-only view page (app/studio/[id]/view/page.tsx), and CameraController
 * itself. Before this module the axonometric framing was written out three
 * times and two of the copies disagreed on distance, so "reset the camera" and
 * "how the room first loads" could land in different places.
 *
 * 1 unit = 1 inch, matching lib/wallLayout.ts and the rest of the scene.
 */

import * as THREE from 'three'
import { getWallTransformResolved, calculateFloorBounds, type WallConfig } from '@/lib/wallLayout'

/**
 * The room's resting camera FOV. Lives here rather than in CameraController so
 * the preset math and the component can share it without an import cycle;
 * CameraController re-exports it for its existing importers.
 */
export const ROOM_DEFAULT_FOV = 50

/**
 * FOV the camera settles at when framing a single wall head-on. Narrower than
 * the resting FOV so a wall fills more of the frame with less perspective
 * distortion — matches the value edit mode has always animated to.
 */
export const WALL_FOCUS_FOV = 45

/** Named camera angles the user can jump back to. */
export type RoomCameraPreset = 'axon' | 'fit'

export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

// Shared framing direction: a 3/4 view from above, the angle the room has
// always loaded at. Both presets use it so switching between them changes only
// distance, never the direction you're looking from.
const ELEVATION_RAD = 35 * (Math.PI / 180)
const AZIMUTH_RAD = 45 * (Math.PI / 180)

/** Baseline room the distance scaling is expressed relative to: 8ft wide. */
const BASE_WIDTH_INCHES = 8 * 12

/**
 * How much bigger rooms push the camera back. Layouts that wrap around the
 * viewer (zigzag/square/L) need more pull-back per wall than a single straight
 * run, so wall count only feeds the scale for those.
 */
function getDistanceScale(wallConfig: WallConfig): number {
  const widths = wallConfig.walls.map((w) => w.width)
  const maxWallWidthInches = (widths.length ? Math.max(...widths) : 8) * 12
  const wallCount = wallConfig.walls.length || 1
  const layoutType = wallConfig.layoutType ?? 'zigzag'
  const layoutFactor =
    layoutType === 'zigzag' || layoutType === 'square' || layoutType === 'lshape'
      ? Math.max(1, wallCount / 2)
      : 1
  return ((maxWallWidthInches * layoutFactor) / BASE_WIDTH_INCHES) || 1
}

/**
 * Aim point height — a little above mid-wall, where boards actually hang, so
 * zooming pulls toward the work rather than the floor.
 */
function getTargetHeight(wallConfig: WallConfig): number {
  const heights = wallConfig.walls.map((w) => w.height)
  const maxWallHeightInches = (heights.length ? Math.max(...heights) : 8) * 12
  return Math.max(60, Math.min(maxWallHeightInches * 0.65, maxWallHeightInches)) || 60
}

/**
 * Where the room's camera sits on first load. Kept as its own export because
 * StudioRoom and the view page both position their <PerspectiveCamera> from it
 * at mount, and the 'axon' preset has to land in exactly the same spot for
 * "reset the view" to mean anything.
 */
export function getInitialRoomPose(wallConfig: WallConfig): CameraPose {
  const distanceScale = getDistanceScale(wallConfig)
  const targetHeight = getTargetHeight(wallConfig)
  const baseDistance = 110 * distanceScale

  const horizontalDistance = baseDistance * Math.cos(ELEVATION_RAD)
  return {
    position: new THREE.Vector3(
      horizontalDistance * Math.sin(AZIMUTH_RAD),
      targetHeight + baseDistance * Math.sin(ELEVATION_RAD),
      horizontalDistance * Math.cos(AZIMUTH_RAD)
    ),
    // Deliberately the world origin, not the geometric centre of the walls —
    // this reproduces the load-time framing exactly, which is the whole point
    // of the 'axon' preset. 'fit' below is the one that centres on the room.
    target: new THREE.Vector3(0, targetHeight, 0),
    fov: ROOM_DEFAULT_FOV,
  }
}

/**
 * Frame the entire room. Unlike 'axon' this centres on the walls' real bounding
 * box and solves the distance needed to fit them, so long or L-shaped rooms
 * that overrun the load-time framing still land fully in shot.
 */
function getFitPose(wallConfig: WallConfig): CameraPose {
  const bounds = calculateFloorBounds(wallConfig)
  const heights = wallConfig.walls.map((w) => w.height)
  const maxWallHeightInches = (heights.length ? Math.max(...heights) : 8) * 12

  const center = new THREE.Vector3(
    bounds.floorCenterX,
    maxWallHeightInches / 2,
    bounds.floorCenterZ
  )

  // Radius of a sphere enclosing the room, then the distance at which that
  // sphere subtends the vertical FOV. Horizontal extent is covered because the
  // canvas is virtually always wider than it is tall; the margin below absorbs
  // the portrait-viewport case rather than plumbing aspect ratio through.
  const radius = Math.max(
    Math.hypot(bounds.floorWidth, bounds.floorDepth) / 2,
    maxWallHeightInches / 2,
    BASE_WIDTH_INCHES / 2
  )
  const halfFovRad = (ROOM_DEFAULT_FOV * (Math.PI / 180)) / 2
  const distance = (radius / Math.sin(halfFovRad)) * 1.15 // 15% breathing room

  const horizontalDistance = distance * Math.cos(ELEVATION_RAD)
  return {
    position: new THREE.Vector3(
      center.x + horizontalDistance * Math.sin(AZIMUTH_RAD),
      center.y + distance * Math.sin(ELEVATION_RAD),
      center.z + horizontalDistance * Math.cos(AZIMUTH_RAD)
    ),
    target: center,
    fov: ROOM_DEFAULT_FOV,
  }
}

export function getPresetPose(preset: RoomCameraPreset, wallConfig: WallConfig): CameraPose {
  return preset === 'fit' ? getFitPose(wallConfig) : getInitialRoomPose(wallConfig)
}

// Head-on distance clamp. Wide walls need more pull-back, but past a point the
// camera is so far the boards read small, and closer than the minimum you can't
// see the whole wall.
const MIN_WALL_FOCUS_DISTANCE_INCHES = 140
const MAX_WALL_FOCUS_DISTANCE_INCHES = 240

/**
 * Square-on framing from an already-resolved wall pose.
 *
 * The lowest-level primitive, because the two callers reach a wall pose by
 * different routes: edit mode is handed a live position/rotation as props
 * (which track wall drags), while read-only focus looks the wall up from the
 * config by index. Sharing this keeps the distance clamp and forward vector
 * identical between them, so the same wall frames the same way either way.
 *
 * `rotationY` must already account for which face is being viewed — the caller
 * adds the half-turn for a back face.
 */
export function getHeadOnPose(
  wallCenter: THREE.Vector3,
  rotationY: number,
  wallWidthInches: number
): CameraPose {
  const distance = THREE.MathUtils.clamp(
    wallWidthInches * 1.35,
    MIN_WALL_FOCUS_DISTANCE_INCHES,
    MAX_WALL_FOCUS_DISTANCE_INCHES
  )
  const forward = new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY)).normalize()

  const position = wallCenter.clone().add(forward.multiplyScalar(distance))
  position.y = wallCenter.y

  return {
    position,
    target: wallCenter.clone(),
    fov: WALL_FOCUS_FOV,
  }
}

/**
 * Square-on framing for one wall face, resolved from the room config. Used by
 * read-only wall focus, which has only an index and a side to go on.
 *
 * Returns null when the wall index isn't in the config (stale focus state after
 * a wall is deleted). A caller must treat that as "focus did not take" and NOT
 * hold the camera — CameraController tracks this in `focusPoseArmed`, because
 * disabling orbit on an unresolved focus leaves the camera locked on a stale
 * target.
 */
export function getWallFocusPose(
  wallConfig: WallConfig,
  wallIndex: number,
  side: 'front' | 'back'
): CameraPose | null {
  if (!wallConfig.walls[wallIndex]) return null

  const transform = getWallTransformResolved(wallConfig, wallIndex)
  // transform.width/height are already inches (getWallTransform applies the
  // feet->inches SCALE), so no second conversion here.
  const wallCenter = new THREE.Vector3(transform.x, transform.height / 2, transform.z)

  // The back face looks the opposite way; same half-turn WallSystem applies
  // when it reports a back-side double click.
  const rotation = side === 'back' ? transform.rotationY + Math.PI : transform.rotationY

  return getHeadOnPose(wallCenter, rotation, transform.width)
}

/* ------------------------------------------------------------------ *
 * Swoosh timing — the wall-to-wall camera move
 * ------------------------------------------------------------------ */

/**
 * How long a camera move takes. Deliberately above the ~300ms ceiling that
 * applies to dropdowns and popovers: this is a large spatial translation, and
 * the *point* of animating it at all is that you keep track of which wall you
 * ended up facing. Cut it much below this and the room reads as a jump cut —
 * you arrive somewhere without having travelled, which is the exact
 * disorientation the animation exists to prevent. It used to be 950ms, which
 * is long enough that clicking a second wall felt like waiting your turn.
 */
export const SWOOSH_DURATION_SECONDS = 0.4

/**
 * Per-frame progression cap, so a transient stall (a save, a texture upload)
 * can't advance the whole move in one giant step and skip the travel.
 *
 * Scaled with the duration rather than left at the 1/45 that paired with the
 * old 950ms move. A cap this size is also a floor on how many frames the move
 * takes (duration / cap), and 1/45 against 400ms would mean 18 frames — so
 * anything under 45fps would stretch the swoosh in wall-clock time instead of
 * dropping frames (0.6s at 30fps). At 1/20 the floor is 8 frames: a single
 * frame still can't advance more than an eighth of the move, but the timing
 * only distorts below 20fps, where the whole scene is already struggling.
 */
export const MAX_SWOOSH_STEP_SECONDS = 1 / 20

/**
 * Cubic-bezier easing solver — the same curve model CSS `cubic-bezier()` uses,
 * with P0 and P3 pinned at (0,0) and (1,1) so only the two control points vary.
 *
 * Hand-rolled because these curves drive a Three.js camera inside the R3F frame
 * loop, not a CSS property, so there's no browser easing to lean on. Newton
 * iteration recovers the curve parameter for a given x, then we evaluate y.
 */
function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  // Polynomial coefficients for B(t) = A·t³ + B·t² + C·t (P0 = 0, P3 = 1).
  const coefA = (a: number, b: number) => 1 - 3 * b + 3 * a
  const coefB = (a: number, b: number) => 3 * b - 6 * a
  const coefC = (a: number) => 3 * a

  const sample = (t: number, a: number, b: number) =>
    ((coefA(a, b) * t + coefB(a, b)) * t + coefC(a)) * t
  const slope = (t: number, a: number, b: number) =>
    3 * coefA(a, b) * t * t + 2 * coefB(a, b) * t + coefC(a)

  return (x: number): number => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const dx = sample(t, x1, x2) - x
      if (Math.abs(dx) < 1e-6) break
      const d = slope(t, x1, x2)
      if (Math.abs(d) < 1e-6) break
      t -= dx / d
    }
    return sample(t, y1, y2)
  }
}

/**
 * The curve for a move that starts from a standing camera — easeInOutCubic.
 *
 * The gentle start is not politeness: it bounds the per-frame displacement at
 * the moment the entire viewport begins to move, which is what keeps a
 * room-crossing translation from strobing. Measured at 60fps over this
 * duration, this curve peaks at ~12% of the move per frame, against ~18-20%
 * for the more aggressive alternatives.
 *
 * Specifically NOT the "strong" ease-in-out (0.77, 0, 0.175, 1) that UI
 * guidance usually reaches for. On a move this large that curve is strictly
 * worse on both axes at once — it sits visibly still for ~67ms AND peaks
 * higher per frame (~20%), so it manages to feel sluggish and look steppy in
 * the same animation. This one gives up almost nothing at the start (~58ms
 * before the move reads, roughly the slack a camera taking up inertia would
 * have anyway) and is the smoothest of the candidates through the middle.
 */
export const EASE_SWOOSH_START = cubicBezierEasing(0.65, 0, 0.35, 1)

/**
 * The curve for a move that *interrupts* one already running. Strong ease-out:
 * full speed immediately, then decelerate into the new target.
 *
 * This is the whole interruption story. The camera is already travelling when
 * the second click lands, so replaying the ease-in ramp would brake it to a
 * stop and re-accelerate — a visible stall-then-lurch right where the user
 * expects the most responsiveness. Starting at speed instead approximates
 * carrying the existing velocity through the re-target.
 */
export const EASE_SWOOSH_REDIRECT = cubicBezierEasing(0.23, 1, 0.32, 1)
