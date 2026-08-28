'use client'

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { getWallTransformResolved } from '@/lib/wallLayout'
import { wallSegments, planBounds } from '@/lib/room/planGeometry'
import { ROOM_DEFAULT_FOV } from '@/lib/room/cameraViews'

export type RoomCameraMode = 'walk' | 'overview'

const DEG = Math.PI / 180

/**
 * Polar angle is measured from +Y, so a pitch above the horizon of P degrees is
 * a polar angle of (90 - P). Walk is pinned exactly level; Overview is clamped
 * to a 16..58 degree pitch band.
 */
export const WALK_POLAR = 90 * DEG
export const OVERVIEW_POLAR_MIN = (90 - 58) * DEG
export const OVERVIEW_POLAR_MAX = (90 - 16) * DEG

/** Radians per second the snap sweeps at; ~0.35s for a 90-degree turn. */
const SNAP_EASE = 6.5
/** Fov assumed when the active camera is not perspective. */
const ROOM_FALLBACK_FOV = ROOM_DEFAULT_FOV
/** Extra room around the wall so it never touches the frame edge. */
const WALL_FRAMING_MARGIN = 1.12
/** Below this the snap is considered finished and the rig stops writing. */
const SNAP_EPSILON_IN = 0.35

interface WallLike {
  walls: Array<{ width: number; height: number }>
  layoutType: 'zigzag' | 'square' | 'linear' | 'lshape'
  customTransforms?: Array<{ x: number; z: number; rotationY: number }>
}

/** Shortest signed delta from a to b, wrapped to (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

export interface WallStation {
  /** Wall centre in world space — where the camera looks. */
  centerX: number
  centerY: number
  centerZ: number
  /** Unit normal of the wall face that looks INTO the room, in world XZ. */
  normalX: number
  normalZ: number
  widthIn: number
  heightIn: number
}

/**
 * Where the camera stands to read a wall as a straight-on elevation: on that
 * wall's room-facing normal, at mid-wall height, looking at the wall centre.
 *
 * A wall panel's local +Z is its front face, which becomes (sin r, cos r) in
 * world XZ. That face does NOT always point inward — in the `square` layout the
 * far wall's front points away from the room — so the normal is flipped when it
 * points away from the room centroid.
 *
 * Derived from the SAME getWallTransformResolved the geometry uses, so
 * custom-positioned walls are handled without duplicating layout math.
 */
export function wallStation(wallConfig: WallLike, index: number, centroidX: number, centroidZ: number): WallStation {
  const t = getWallTransformResolved(wallConfig, index)
  let nx = Math.sin(t.rotationY)
  let nz = Math.cos(t.rotationY)
  if ((centroidX - t.x) * nx + (centroidZ - t.z) * nz < 0) {
    nx = -nx
    nz = -nz
  }
  return {
    centerX: t.x,
    // The wall group sits at height/2 and the panel spans the full height, so
    // its centre is at half height — eye level for a true elevation.
    centerY: t.height / 2,
    centerZ: t.z,
    normalX: nx,
    normalZ: nz,
    widthIn: t.width,
    heightIn: t.height,
  }
}

/** Orbit azimuth that places the camera on a wall's room-facing normal. */
export function wallFacingAzimuth(wallConfig: WallLike, index: number, centroidX = 0, centroidZ = 0): number {
  const s = wallStation(wallConfig, index, centroidX, centroidZ)
  return Math.atan2(s.normalX, s.normalZ)
}

/** Index of the wall whose facing azimuth is closest to the current one. */
export function nearestWallIndex(
  wallConfig: WallLike,
  azimuth: number,
  centroidX = 0,
  centroidZ = 0,
): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < wallConfig.walls.length; i++) {
    const dist = Math.abs(angleDelta(azimuth, wallFacingAzimuth(wallConfig, i, centroidX, centroidZ)))
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

function getControls(ref: React.RefObject<unknown> | null | undefined): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

interface RoomCameraRigProps {
  mode: RoomCameraMode
  wallConfig: WallLike
  orbitControlsRef: React.RefObject<unknown>
  /** Inert while a wall is being edited — CameraController owns the camera then. */
  active: boolean
  /** Bumped by the chevrons to request an explicit wall; null means "nearest". */
  requestedWall: number | null
  requestNonce: number
  /** Reports the wall currently faced, for the chevrons and (later) the minimap. */
  onFacingWallChange?: (wallIndex: number) => void
  /**
   * Live camera orientation for the minimap. Written to a ref every frame rather
   * than pushed through state on purpose: the view cone updates continuously
   * during a drag, and re-rendering React 60 times a second for it would be
   * wasteful. The minimap reads this ref from its own rAF loop.
   */
  cameraPlanRef?: React.MutableRefObject<{ azimuth: number; distance: number }>
}

/**
 * Constrains OrbitControls per camera mode.
 *
 * Walk reads a wall as a straight-on ELEVATION: the camera stands on that
 * wall's room-facing normal, at mid-wall height, looking at the wall centre,
 * far enough back to frame the whole panel. Dragging orbits; releasing re-seats
 * at whichever wall the view ended up nearest. The chevrons and the roster
 * request a specific wall.
 *
 * That requires moving the orbit target to the wall centre — orbiting around
 * the ROOM centre (the previous behaviour) leaves the wall off-axis and
 * off-centre, which is what stopped it reading as an elevation. Damping, mouse
 * buttons, the edit-mode fly-to and presenter follow are still untouched, and
 * Overview only ever has its pitch clamped.
 */
export function RoomCameraRig({
  mode,
  wallConfig,
  orbitControlsRef,
  active,
  requestedWall,
  requestNonce,
  onFacingWallChange,
  cameraPlanRef,
}: RoomCameraRigProps) {
  const { camera, size } = useThree()

  /** Wall the camera is stationed at. -1 until the first snap resolves one. */
  const stationWallRef = useRef<number>(-1)
  /** True while easing into a station; cleared once seated. */
  const snappingRef = useRef(false)
  const listenerBoundRef = useRef(false)
  const facingRef = useRef<number>(-1)
  const lastNonceRef = useRef(requestNonce)

  // Pre-allocated so the frame loop never allocates, matching DraggableBoard.
  const goalPos = useRef(new THREE.Vector3())
  const goalTarget = useRef(new THREE.Vector3())
  /**
   * Orbit target as it was before Walk moved it onto a wall. Snapshotting it is
   * how Overview gets its original behaviour back without this file having to
   * duplicate SceneContent's targetHeight formula.
   */
  const preWalkTarget = useRef<THREE.Vector3 | null>(null)

  const centroid = useMemo(() => {
    const b = planBounds(wallSegments(wallConfig), 0)
    return { x: b.centerX, z: b.centerZ }
  }, [wallConfig])

  // Chevron / roster request: station at that wall regardless of the drag.
  useEffect(() => {
    if (requestNonce === lastNonceRef.current) return
    lastNonceRef.current = requestNonce
    if (!active || mode !== 'walk' || requestedWall == null) return
    if (!wallConfig.walls.length) return
    stationWallRef.current = requestedWall
    snappingRef.current = true
  }, [requestNonce, requestedWall, active, mode, wallConfig])

  // Entering Walk seats the camera at a wall; leaving abandons the motion so
  // Overview never inherits a half-finished snap.
  useEffect(() => {
    if (mode === 'walk') snappingRef.current = true
    else snappingRef.current = false
  }, [mode])

  useFrame((_state, delta) => {
    const controls = getControls(orbitControlsRef)
    if (!controls) return

    if (!active) return

    if (mode === 'walk') {
      // Pin the pitch level. Written every frame for the same reason the
      // existing CrispOrbitRestore rewrites mouseButtons — OrbitControls is
      // re-created on some prop changes and would otherwise drift back.
      controls.minPolarAngle = WALK_POLAR
      controls.maxPolarAngle = WALK_POLAR

      if (!wallConfig.walls.length) return

      // Remember where Overview was looking before the first wall seat.
      if (!preWalkTarget.current) preWalkTarget.current = controls.target.clone()

      if (!listenerBoundRef.current) {
        listenerBoundRef.current = true
        // Releasing a drag re-seats at whichever wall the view ended up nearest.
        controls.addEventListener('end', () => {
          stationWallRef.current = nearestWallIndex(
            wallConfig,
            controls.getAzimuthalAngle(),
            centroid.x,
            centroid.z,
          )
          snappingRef.current = true
        })
      }

      if (stationWallRef.current < 0) {
        stationWallRef.current = nearestWallIndex(
          wallConfig, controls.getAzimuthalAngle(), centroid.x, centroid.z,
        )
      }

      const station = wallStation(wallConfig, stationWallRef.current, centroid.x, centroid.z)

      // Stand back far enough to frame the whole wall. Vertical fit uses the
      // camera's own fov; horizontal fit divides by aspect. The larger wins so
      // neither dimension is cropped.
      const persp = camera as THREE.PerspectiveCamera
      const fov = (persp.isPerspectiveCamera ? persp.fov : ROOM_FALLBACK_FOV) * DEG
      const aspect = persp.isPerspectiveCamera ? persp.aspect : size.width / Math.max(size.height, 1)
      const halfFov = Math.tan(fov / 2)
      const fitV = (station.heightIn / 2) * WALL_FRAMING_MARGIN / halfFov
      const fitH = (station.widthIn / 2) * WALL_FRAMING_MARGIN / (halfFov * Math.max(aspect, 0.1))
      const dist = THREE.MathUtils.clamp(
        Math.max(fitV, fitH),
        controls.minDistance ?? 1,
        controls.maxDistance ?? Infinity,
      )

      goalTarget.current.set(station.centerX, station.centerY, station.centerZ)
      goalPos.current.set(
        station.centerX + station.normalX * dist,
        station.centerY,
        station.centerZ + station.normalZ * dist,
      )

      if (snappingRef.current) {
        // Frame-rate independent ease toward the station.
        const alpha = 1 - Math.exp(-delta * SNAP_EASE)
        camera.position.lerp(goalPos.current, alpha)
        controls.target.lerp(goalTarget.current, alpha)
        if (
          camera.position.distanceTo(goalPos.current) < SNAP_EPSILON_IN &&
          controls.target.distanceTo(goalTarget.current) < SNAP_EPSILON_IN
        ) {
          camera.position.copy(goalPos.current)
          controls.target.copy(goalTarget.current)
          snappingRef.current = false
        }
        controls.update()
      } else {
        // Seated: hold the look-at on the wall centre so a React re-render
        // re-applying OrbitControls' `target` prop cannot yank it back to the
        // room centre mid-session. Camera position is left alone so the user
        // can still orbit and zoom freely.
        controls.target.copy(goalTarget.current)
      }
    } else {
      controls.minPolarAngle = OVERVIEW_POLAR_MIN
      controls.maxPolarAngle = OVERVIEW_POLAR_MAX

      // Hand the orbit target back to wherever Overview had it before Walk
      // borrowed it, so Overview keeps its original behaviour.
      const restore = preWalkTarget.current
      if (restore) {
        const alpha = 1 - Math.exp(-delta * SNAP_EASE)
        controls.target.lerp(restore, alpha)
        if (controls.target.distanceTo(restore) < SNAP_EPSILON_IN) {
          controls.target.copy(restore)
          preWalkTarget.current = null
        }
        controls.update()
      }
    }

    if (cameraPlanRef) {
      cameraPlanRef.current.azimuth = controls.getAzimuthalAngle()
      cameraPlanRef.current.distance = controls.getDistance()
    }

    if (onFacingWallChange && wallConfig.walls.length) {
      const facing = nearestWallIndex(wallConfig, controls.getAzimuthalAngle())
      if (facing !== facingRef.current) {
        facingRef.current = facing
        onFacingWallChange(facing)
      }
    }
  })

  return null
}
