import { useThree, useFrame } from '@react-three/fiber'
import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'

function getControls(ref: React.RefObject<unknown> | null | undefined): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

/** Phase B.2: presenter camera pose, broadcast over the studio-live channel. */
export interface FollowPose {
  /** Camera world position [x, y, z]. */
  p: [number, number, number]
  /** OrbitControls target [x, y, z]. */
  t: [number, number, number]
}

/**
 * Phase B.3: latest laser-pointer world position for followers to render. `seq`
 * bumps per received packet so the renderer can detect staleness via frame
 * deltas (no Date.now in the frame loop). Null = laser off / never started.
 */
export interface LaserState {
  p: [number, number, number]
  seq: number
}

interface CameraControllerProps {
  orbitControlsRef?: React.RefObject<unknown> | null
  editingWall: number | null
  wallPosition: THREE.Vector3 | null
  wallRotation: number
  wallDimensions?: { width: number; height: number } | null // Wall dimensions in feet
  transitionKey?: number
  onTransitionComplete?: () => void
  /** Phase B.2: when true, the local user follows the presenter's camera. */
  isFollowing?: boolean
  /** Phase B.2: latest received presenter pose (read in the frame loop, never via state). */
  followPoseRef?: React.MutableRefObject<FollowPose | null>
  /** Phase B.3: presenter is actively laser-pointing — suspend their orbit ("pointing mode"). */
  isLaserPointing?: boolean
}

export function CameraController({ 
  orbitControlsRef,
  editingWall, 
  wallPosition, 
  wallRotation,
  wallDimensions,
  transitionKey = 0,
  onTransitionComplete,
  isFollowing = false,
  followPoseRef,
  isLaserPointing = false,
}: CameraControllerProps) {
  const { camera } = useThree()
  const SWOOSH_DURATION_SECONDS = 0.95
  const MAX_SWOOSH_STEP_SECONDS = 1 / 45
  // Keep edit view close enough to comfortably place boards.
  // Scale with wall width so large walls still frame well.
  const MIN_EDIT_VIEW_DISTANCE_INCHES = 140
  const MAX_EDIT_VIEW_DISTANCE_INCHES = 240
  
  // Store the camera position before entering edit mode (so we can return to it)
  const savedCameraPosition = useRef<THREE.Vector3 | null>(null)
  const savedCameraTarget = useRef<THREE.Vector3 | null>(null)
  
  // Store default camera settings (used only on initial load if no saved position)
  // With 1 unit = 1 inch scale, need much larger initial position
  // Axonometric view: 35 degree elevation, 45 degree azimuth (diagonal view)
  // This provides a clear view of all walls immediately
  const baseDistance = 120 // 10ft away
  const elevationAngle = 35 * (Math.PI / 180) // 35 degrees elevation
  const azimuthAngle = 45 * (Math.PI / 180)   // 45 degrees around (diagonal view)
  const horizontalDistance = baseDistance * Math.cos(elevationAngle)
  const cameraHeight = 60 + (baseDistance * Math.sin(elevationAngle)) // ~129" high
  const cameraX = horizontalDistance * Math.sin(azimuthAngle)
  const cameraZ = horizontalDistance * Math.cos(azimuthAngle)
  const defaultPosition = useRef(new THREE.Vector3(cameraX, cameraHeight, cameraZ))
  const defaultTarget = useRef(new THREE.Vector3(0, 60, 0))
  
  // Track previous editing wall to detect enter/exit.
  const prevEditingWall = useRef<number | null>(null)
  const lastHandledTransitionKey = useRef<number>(-1)
  const pendingAnimation = useRef(false)
  const targetTarget = useRef(new THREE.Vector3())
  const shouldNotifyOnComplete = useRef(false)

  // Uniform swoosh animation state (same model for every wall).
  const isAnimating = useRef(false)
  const animationElapsedSeconds = useRef(0)
  const startPosition = useRef(new THREE.Vector3())
  const startTarget = useRef(new THREE.Vector3())
  const endPosition = useRef(new THREE.Vector3())
  const endTarget = useRef(new THREE.Vector3())
  const startFov = useRef(35)
  const endFov = useRef(35)

  // When user releases mouse, OrbitControls still applies one frame of leftover delta.
  const restoreOnNextFrame = useRef(false)
  const positionOnEnd = useRef(new THREE.Vector3())
  const targetOnEnd = useRef(new THREE.Vector3())

  // Phase B.2: reusable scratch vectors for the follow lerp (no per-frame alloc).
  const followPosVec = useRef(new THREE.Vector3())
  const followTargetVec = useRef(new THREE.Vector3())
  const editingWallRef = useRef(editingWall)
  editingWallRef.current = editingWall

  // Track the controls instance we registered the 'end' listener on so we
  // can remove it if the instance changes or the component unmounts.
  const listenerControlsRef = useRef<OrbitControlsType | null>(null)
  const endHandlerRef = useRef<(() => void) | null>(null)

  const beginSwoosh = (
    fromPosition: THREE.Vector3,
    fromTarget: THREE.Vector3,
    toPosition: THREE.Vector3,
    toTarget: THREE.Vector3,
    fromFov: number,
    toFov: number,
    notifyOnComplete: boolean
  ) => {
    startPosition.current.copy(fromPosition)
    startTarget.current.copy(fromTarget)
    endPosition.current.copy(toPosition)
    endTarget.current.copy(toTarget)
    startFov.current = fromFov
    endFov.current = toFov
    animationElapsedSeconds.current = 0
    shouldNotifyOnComplete.current = notifyOnComplete
    isAnimating.current = true
  }

  useEffect(() => {
    const enteringEditMode = prevEditingWall.current === null && editingWall !== null
    const switchingWalls =
      prevEditingWall.current !== null &&
      editingWall !== null &&
      prevEditingWall.current !== editingWall
    const exitingEditMode = prevEditingWall.current !== null && editingWall === null
    const transitionRequested = transitionKey !== lastHandledTransitionKey.current

    // Save camera pose before entering edit mode.
    if (enteringEditMode) {
      savedCameraPosition.current = camera.position.clone()
      const controls = getControls(orbitControlsRef)
      if (controls) {
        savedCameraTarget.current = controls.target.clone()
      }
    }
    if (enteringEditMode || switchingWalls || (transitionRequested && editingWall !== null)) {
      pendingAnimation.current = true
    }

    if (editingWall !== null && wallPosition) {
      const shouldAnimateToWall =
        pendingAnimation.current ||
        enteringEditMode ||
        switchingWalls ||
        transitionRequested

      if (!shouldAnimateToWall) {
        prevEditingWall.current = editingWall
        lastHandledTransitionKey.current = transitionKey
        return
      }
      pendingAnimation.current = false

      const wallWidthInches = (wallDimensions?.width ?? 8) * 12
      const distance = THREE.MathUtils.clamp(
        wallWidthInches * 1.35,
        MIN_EDIT_VIEW_DISTANCE_INCHES,
        MAX_EDIT_VIEW_DISTANCE_INCHES
      )
      const wallForward = new THREE.Vector3(
        Math.sin(wallRotation),
        0,
        Math.cos(wallRotation)
      ).normalize()
      const offset = wallForward.multiplyScalar(distance)

      const nextPosition = wallPosition.clone().add(offset)
      nextPosition.y = wallPosition.y
      const nextTarget = wallPosition.clone()
      targetTarget.current.copy(wallPosition)

      const controls = getControls(orbitControlsRef)
      const fromTarget = controls ? controls.target.clone() : targetTarget.current.clone()
      const fromFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 35
      beginSwoosh(
        camera.position.clone(),
        fromTarget,
        nextPosition,
        nextTarget,
        fromFov,
        45,
        true
      )
    } else if (exitingEditMode) {
      pendingAnimation.current = false
      const returnPosition = savedCameraPosition.current || defaultPosition.current
      const returnTarget = savedCameraTarget.current || defaultTarget.current
      const controls = getControls(orbitControlsRef)
      const fromTarget = controls ? controls.target.clone() : defaultTarget.current.clone()
      const fromFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 45
      beginSwoosh(
        camera.position.clone(),
        fromTarget,
        returnPosition.clone(),
        returnTarget.clone(),
        fromFov,
        35,
        false
      )
    }

    prevEditingWall.current = editingWall
    lastHandledTransitionKey.current = transitionKey
  }, [editingWall, wallPosition, wallRotation, wallDimensions, camera, transitionKey])

  // Remove the 'end' listener when the component unmounts
  useEffect(() => {
    return () => {
      if (listenerControlsRef.current && endHandlerRef.current) {
        listenerControlsRef.current.removeEventListener('end', endHandlerRef.current)
      }
    }
  }, [])

  // Register/re-register the 'end' listener whenever the controls instance changes.
  // Runs inside useFrame so we pick up the controls as soon as they're available,
  // but we avoid the anti-pattern of addEventListener inside the hot frame path by
  // guarding on instance identity rather than a boolean flag.
  useFrame((_state, delta) => {
    const controls = getControls(orbitControlsRef)
    if (!controls) return

    if (listenerControlsRef.current !== controls) {
      // Remove from old instance if there was one
      if (listenerControlsRef.current && endHandlerRef.current) {
        listenerControlsRef.current.removeEventListener('end', endHandlerRef.current)
      }
      // Create a stable handler that reads from refs so it never goes stale
      endHandlerRef.current = () => {
        if (editingWallRef.current !== null) return
        positionOnEnd.current.copy(camera.position)
        targetOnEnd.current.copy(controls.target)
        restoreOnNextFrame.current = true
      }
      controls.addEventListener('end', endHandlerRef.current)
      listenerControlsRef.current = controls
    }

    if (isAnimating.current) {
      // Cap per-frame progression so transient stalls (e.g. save/exit work)
      // can't skip the entire swoosh in one frame.
      const steppedDelta = Math.min(delta, MAX_SWOOSH_STEP_SECONDS)
      animationElapsedSeconds.current = Math.min(
        animationElapsedSeconds.current + steppedDelta,
        SWOOSH_DURATION_SECONDS
      )
      const t = Math.min(animationElapsedSeconds.current / SWOOSH_DURATION_SECONDS, 1)
      const easeT = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2

      camera.position.lerpVectors(startPosition.current, endPosition.current, easeT)
      const currentTarget = new THREE.Vector3().lerpVectors(startTarget.current, endTarget.current, easeT)
      controls.target.copy(currentTarget)
      camera.lookAt(currentTarget)
      camera.up.set(0, 1, 0)

      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = THREE.MathUtils.lerp(startFov.current, endFov.current, easeT)
        camera.updateProjectionMatrix()
      }

      if (t >= 1) {
        isAnimating.current = false
        camera.position.copy(endPosition.current)
        controls.target.copy(endTarget.current)
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = endFov.current
          camera.updateProjectionMatrix()
        }
        if (shouldNotifyOnComplete.current) {
          onTransitionComplete?.()
        }
      }
    }

    // Phase B.2: follow the presenter's broadcast camera. Editing and the swoosh
    // animation take priority (gated below), so following resumes after a swoosh
    // and never overrides edit framing. Lerp toward the latest pose so ~10Hz
    // packets render continuously instead of snapping.
    const followingNow = isFollowing && editingWall === null && !isAnimating.current
    const pose = followPoseRef?.current
    if (followingNow && pose) {
      const alpha = 1 - Math.exp(-delta * 10)
      followPosVec.current.set(pose.p[0], pose.p[1], pose.p[2])
      followTargetVec.current.set(pose.t[0], pose.t[1], pose.t[2])
      camera.position.lerp(followPosVec.current, alpha)
      controls.target.lerp(followTargetVec.current, alpha)
      camera.lookAt(controls.target)
      camera.up.set(0, 1, 0)
    }

    // Control arbitration: editing wins over following; the swoosh suspends both;
    // and the presenter's laser "pointing mode" (B.3) also suspends orbit so a
    // point-drag doesn't rotate the camera. While following, OrbitControls input
    // is disabled so the user can't fight the followed camera. Escape / "Stop
    // following" (follow) and releasing L (laser) flip their flags and re-enable
    // input on the next frame — so there is no way to get stuck disabled.
    controls.enabled =
      editingWall === null && !isAnimating.current && !isFollowing && !isLaserPointing
    const c = controls as { enableDamping?: boolean }
    c.enableDamping = false
    controls.update()

    if (restoreOnNextFrame.current) {
      camera.position.copy(positionOnEnd.current)
      controls.target.copy(targetOnEnd.current)
      restoreOnNextFrame.current = false
    }

    if (editingWall !== null && !isAnimating.current) {
      camera.lookAt(targetTarget.current)
      camera.up.set(0, 1, 0)
      camera.updateProjectionMatrix()
    }
  })

  return null
}
