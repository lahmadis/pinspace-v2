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

/**
 * How close the camera may dolly to its target, in inches — the zoom-IN floor.
 *
 * Effectively "no limit" at room scale: 6 inches from the aim point puts your
 * nose on a board. It replaces a room-scaled `80 * distanceScale`, which on an
 * ordinary four-wall room worked out to 160in — you could not get within
 * thirteen feet of the work, which is the wrong side of useless in a space
 * built for reading drawings.
 *
 * It is 6 and not 0 because of the camera's near plane, which is 5in on every
 * room surface and load-bearing at the OTHER end of the range: depth precision
 * goes as z²/(near·2²⁴), so the 0.1in three.js default left only ~8in
 * resolvable at maximum zoom-out and set the floor, grid and ground planes
 * flickering against each other. Anything inside the near plane is clipped
 * away, so this has to stay outside it. The zoom-OUT cap is untouched.
 */
export const ROOM_MIN_ZOOM_DISTANCE_INCHES = 6

/** Named camera angles the user can jump back to. */
export type RoomCameraPreset = 'axon' | 'fit'

export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

/**
 * Shared framing direction. Both presets use it, so switching between them
 * changes only distance, never the direction you're looking from.
 *
 * This used to be a 35°/45° three-quarter view from ABOVE — an axonometric of
 * the room, which showed you the layout but looked down onto the work rather
 * than at it. A space opens on a wall of drawings, and the first thing it
 * should read as is drawings, seen the way you would see them standing in front
 * of them. NOT a bird's-eye view.
 *
 * 7° sits the eye a little ABOVE the top of the walls — at the framing
 * distance a default room solves to (~570in) it puts the camera near 130in
 * against a 120in wall — which is what makes the far panels show a sliver of
 * their top face and the room read as a room rather than as an elevation
 * drawing. Below the tops it flattens; much above it and you are looking down
 * into the room again, which is the bird's-eye view this replaced.
 *
 * 12° of azimuth is just enough off-square to show the run folds and has depth,
 * without the diagonal foreshortening 45° put on every panel.
 *
 * Both angles were read off a screenshot of the framing that was asked for, so
 * they are the two numbers to nudge if it still sits wrong — nothing else in
 * the pose depends on them.
 */
const ELEVATION_RAD = 7 * (Math.PI / 180)
const AZIMUTH_RAD = 12 * (Math.PI / 180)

/** Baseline room, used as the floor on the enclosing radius: 8ft wide. */
const BASE_WIDTH_INCHES = 8 * 12

/**
 * Where the room's camera sits on first load — and the 'axon' preset, and
 * 'fit'. One pose, because they had all become the same request.
 *
 * This used to be a FIXED distance: 110 inches scaled by a fudge built from the
 * widest wall, the wall count and the layout type. That is a guess at how big
 * the room is, and it guessed wrong for anything the fudge did not anticipate —
 * a long single run, an L with one huge wall, a room whose slab overhangs its
 * walls. The room is right there to measure, so it is measured: the enclosing
 * radius of the walls AND the slab, and the distance at which that subtends the
 * lens. Whatever the layout, the whole room lands in frame with 15% of air
 * around it, which is what entering a space should show you.
 *
 * The target moved with it, from the world origin to the room's real centre.
 * The old comment here defended the origin on the grounds that 'axon' had to
 * reproduce load-time framing exactly — true then, moot now that load-time
 * framing IS this, and wrong in the first place for any room not built around
 * the origin.
 */
export function getInitialRoomPose(wallConfig: WallConfig): CameraPose {
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
  // Both presets resolve to the same pose now — see getInitialRoomPose. Kept as
  // two names because CameraController still asks for them by name, and because
  // a future 'fit' that differs from the opening view has somewhere to live.
  void preset
  return getInitialRoomPose(wallConfig)
}

// Head-on distance clamp. Wide walls need more pull-back, but past a point the
// camera is so far the boards read small, and closer than the minimum you can't
// see the whole wall.
//
// The ceiling used to be 240in, set when this distance was computed from WIDTH
// alone. Now that height can drive it (see getHeadOnPose), 240 would re-crop
// any wall over ~12ft tall — the exact bug the height term fixes. 280in fits a
// 14ft wall, past anything a studio builds, and is a small enough lift that
// very wide walls (which hit the ceiling on the width term) barely move.
const MIN_WALL_FOCUS_DISTANCE_INCHES = 140
const MAX_WALL_FOCUS_DISTANCE_INCHES = 280

/**
 * Breathing room above and below a wall framed head-on. 1.0 puts its edges
 * exactly on the frame edges, which reads as cropped rather than as fitted —
 * and a board pinned near the top then sits flush against the edit toolbar.
 *
 * Applied to the height term ONLY. The width term is already generous by the
 * same margin and then some (see below), and compounding the two would push
 * wide walls far enough back that the boards read small.
 */
const WALL_FOCUS_HEADROOM = 1.12

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
 *
 * HEIGHT IS PART OF THE FIT, and leaving it out is what made edit mode land too
 * close. The distance was `width * 1.35` alone, but three.js takes a VERTICAL
 * fov, so height is the dimension the frame is actually measured in — and the
 * default wall is taller than it is wide (10ft × 8ft, see DEFAULT_WALL_CONFIG).
 * That wall asked for 96 × 1.35 = 130in, floored to the 140in minimum, when
 * fitting its 120in height at a 35mm lens needs 175in. Every wall opened for
 * editing was framed ~20% too close and clipped top and bottom.
 *
 * Width still gets a say via the same 1.35 factor it always used: that happens
 * to be the exact horizontal fit at a 1.08 aspect ratio, so it stays correct
 * for any landscape viewport without this module having to know the aspect.
 * Whichever dimension needs more room wins.
 */
export function getHeadOnPose(
  wallCenter: THREE.Vector3,
  rotationY: number,
  wallWidthInches: number,
  wallHeightInches: number
): CameraPose {
  const halfFovTan = Math.tan((WALL_FOCUS_FOV * (Math.PI / 180)) / 2)
  const forHeight = ((wallHeightInches / 2) / halfFovTan) * WALL_FOCUS_HEADROOM
  const forWidth = wallWidthInches * 1.35

  const distance = THREE.MathUtils.clamp(
    Math.max(forWidth, forHeight),
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

  return getHeadOnPose(wallCenter, rotation, transform.width, transform.height)
}
