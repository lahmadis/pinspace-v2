'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { getWallTransformResolved } from '@/lib/wallLayout'

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
const SNAP_SPEED = 4.5
/** Below this the snap is considered finished and the rig stops writing. */
const SNAP_EPSILON = 0.0015

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

/**
 * Orbit azimuth that puts the camera square-on to a wall.
 *
 * OrbitControls orbits the camera around `target` (room centre). A wall sits at
 * some direction d from that centre, so viewing it head-on means standing on
 * the opposite side and looking back through the centre — azimuth of -d.
 *
 * Deliberately derived from the SAME getWallTransformResolved the geometry uses,
 * so custom-positioned walls snap correctly and nothing here duplicates layout
 * math.
 */
export function wallFacingAzimuth(wallConfig: WallLike, index: number): number {
  const t = getWallTransformResolved(wallConfig, index)
  // A wall sitting exactly on the orbit centre has no meaningful direction;
  // fall back to its own facing so the snap is still deterministic.
  if (Math.abs(t.x) < 1e-6 && Math.abs(t.z) < 1e-6) return t.rotationY
  return Math.atan2(-t.x, -t.z)
}

/** Index of the wall whose facing azimuth is closest to the current one. */
export function nearestWallIndex(wallConfig: WallLike, azimuth: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < wallConfig.walls.length; i++) {
    const dist = Math.abs(angleDelta(azimuth, wallFacingAzimuth(wallConfig, i)))
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
}

/**
 * Constrains OrbitControls per camera mode and, in Walk, snaps to face a wall
 * square-on when the user lets go of the drag.
 *
 * Writes only to the polar clamps and the azimuth. Distance, target, damping,
 * mouse buttons and the edit-mode fly-to are all left exactly as they were.
 */
export function RoomCameraRig({
  mode,
  wallConfig,
  orbitControlsRef,
  active,
  requestedWall,
  requestNonce,
  onFacingWallChange,
}: RoomCameraRigProps) {
  // Target azimuth while a snap is running; null means "not snapping".
  const snapTargetRef = useRef<number | null>(null)
  const listenerBoundRef = useRef(false)
  const facingRef = useRef<number>(-1)
  const lastNonceRef = useRef(requestNonce)

  // Chevron request: snap to that wall regardless of where the drag ended.
  useEffect(() => {
    if (requestNonce === lastNonceRef.current) return
    lastNonceRef.current = requestNonce
    if (!active || mode !== 'walk' || requestedWall == null) return
    if (!wallConfig.walls.length) return
    snapTargetRef.current = wallFacingAzimuth(wallConfig, requestedWall)
  }, [requestNonce, requestedWall, active, mode, wallConfig])

  // Leaving Walk abandons any in-flight snap so Overview never inherits it.
  useEffect(() => {
    if (mode !== 'walk') snapTargetRef.current = null
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

      if (!listenerBoundRef.current) {
        listenerBoundRef.current = true
        controls.addEventListener('end', () => {
          const current = controls.getAzimuthalAngle()
          if (!wallConfig.walls.length) return
          snapTargetRef.current = wallFacingAzimuth(
            wallConfig,
            nearestWallIndex(wallConfig, current),
          )
        })
      }

      const goal = snapTargetRef.current
      if (goal != null) {
        const current = controls.getAzimuthalAngle()
        const diff = angleDelta(current, goal)
        if (Math.abs(diff) < SNAP_EPSILON) {
          controls.setAzimuthalAngle(goal)
          snapTargetRef.current = null
        } else {
          const step = Math.sign(diff) * Math.min(Math.abs(diff), SNAP_SPEED * delta)
          controls.setAzimuthalAngle(current + step)
        }
        controls.update()
      }
    } else {
      controls.minPolarAngle = OVERVIEW_POLAR_MIN
      controls.maxPolarAngle = OVERVIEW_POLAR_MAX
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
