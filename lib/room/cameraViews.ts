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
import { getWallTransformResolved, calculateFloorBounds, getFloorRect, floorRectBounds, type WallConfig } from '@/lib/wallLayout'

/**
 * The room's lens, expressed the way a photographer would state it.
 *
 * three.js takes a VERTICAL field of view in degrees, which is a poor thing to
 * pick by feel — 50° and 35° are indistinguishable as numbers but are a 26mm
 * and a 38mm lens, and the room had drifted into using both. So the focal
 * length is the input and the angle is derived: on a full-frame 36×24mm frame,
 * half the frame height is 12mm, and vfov = 2·atan(12/f).
 *
 * 35mm is a mild wide angle — wide enough to hold a whole studio in shot, and
 * short of the visible convergence a 26mm was putting on the walls at the edges
 * of frame.
 */
const FULL_FRAME_HALF_HEIGHT_MM = 12
const ROOM_FOCAL_LENGTH_MM = 35

/** Vertical FOV for a focal length, in degrees. */
function fovForFocalLength(mm: number): number {
  return 2 * Math.atan(FULL_FRAME_HALF_HEIGHT_MM / mm) * (180 / Math.PI)
}

/**
 * The room's resting camera FOV — 35mm, so ≈37.9°. Lives here rather than in
 * CameraController so the preset math and the component can share it without an
 * import cycle; CameraController re-exports it for its existing importers.
 */
export const ROOM_DEFAULT_FOV = fovForFocalLength(ROOM_FOCAL_LENGTH_MM)

/**
 * FOV when framing a single wall head-on. DELIBERATELY THE SAME as the resting
 * FOV now: it used to narrow from 50° to 45° so a wall filled more of the frame
 * with less convergence, but that made the room change lens as you moved
 * through it. One focal length everywhere means a wall is the same shape when
 * you walk up to it as it was across the room, and the framing work is done by
 * moving the camera instead.
 *
 * Kept as its own name rather than folded into the constant above so the seam
 * survives — if head-on framing ever needs its own lens again, this is where it
 * goes, and no call site has to change.
 */
export const WALL_FOCUS_FOV = ROOM_DEFAULT_FOV

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
  // Frame the walls AND the slab: the floor is its own surface now and can
  // extend past the walls, so fitting to the walls alone would cut it off.
  const wallBounds = calculateFloorBounds(wallConfig)
  const fr = getFloorRect(wallConfig)
  const fBounds = floorRectBounds(fr)
  const hasWalls = wallConfig.walls.length > 0 && Number.isFinite(wallBounds.minX)
  const bounds = {
    floorWidth: hasWalls
      ? Math.max(wallBounds.maxX, fBounds.maxX) - Math.min(wallBounds.minX, fBounds.minX)
      : fr.width,
    floorDepth: hasWalls
      ? Math.max(wallBounds.maxZ, fBounds.maxZ) - Math.min(wallBounds.minZ, fBounds.minZ)
      : fr.depth,
    floorCenterX: hasWalls
      ? (Math.min(wallBounds.minX, fBounds.minX) + Math.max(wallBounds.maxX, fBounds.maxX)) / 2
      : fr.centerX,
    floorCenterZ: hasWalls
      ? (Math.min(wallBounds.minZ, fBounds.minZ) + Math.max(wallBounds.maxZ, fBounds.maxZ)) / 2
      : fr.centerZ,
  }
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
