import { useThree, useFrame } from '@react-three/fiber'
import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

const isDev = process.env.NODE_ENV === 'development'
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args) }
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'

function getControls(ref: React.RefObject<unknown> | null | undefined): OrbitControlsType | null {
  const r = ref?.current
  if (!r) return null
  if (typeof (r as { get?: () => OrbitControlsType }).get === 'function') {
    return (r as { get: () => OrbitControlsType }).get()
  }
  return r as OrbitControlsType
}

interface CameraControllerProps {
  orbitControlsRef?: React.RefObject<unknown> | null
  editingWall: number | null
  wallPosition: THREE.Vector3 | null
  wallRotation: number
  wallDimensions?: { width: number; height: number } | null // Wall dimensions in feet
  transitionKey?: number
  onTransitionComplete?: () => void
}

export function CameraController({ 
  orbitControlsRef,
  editingWall, 
  wallPosition, 
  wallRotation,
  wallDimensions,
  transitionKey = 0,
  onTransitionComplete 
}: CameraControllerProps) {
  const { camera } = useThree()
  const SWOOSH_DURATION_SECONDS = 1.1
  const EDIT_VIEW_DISTANCE_INCHES = 400
  
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
  
  // Track previous editingWall to detect transitions
  const prevEditingWall = useRef<number | null>(null)
  const lastHandledTransitionKey = useRef<number>(-1)
  // Track if we need to animate once wallPosition is ready
  const pendingAnimation = useRef<boolean>(false)
  
  // Animation state
  const isAnimating = useRef(false)
  const animationProgress = useRef(0)
  const animationDuration = useRef(SWOOSH_DURATION_SECONDS)
  const startPosition = useRef(new THREE.Vector3())
  const startTarget = useRef(new THREE.Vector3())
  const targetPosition = useRef(new THREE.Vector3())
  const targetTarget = useRef(new THREE.Vector3())
  // Snapshot the live camera pose while in edit mode so exit animation
  // can always start from the true wall-view position.
  const lastEditCameraPosition = useRef(new THREE.Vector3())
  const lastEditCameraTarget = useRef(new THREE.Vector3())
  const hasLastEditPose = useRef(false)

  // When user releases mouse, OrbitControls still applies one frame of leftover delta. Restore position next frame so orbit stops instantly.
  const restoreOnNextFrame = useRef(false)
  const positionOnEnd = useRef(new THREE.Vector3())
  const targetOnEnd = useRef(new THREE.Vector3())
  const endListenerAdded = useRef(false)
  const editingWallRef = useRef(editingWall)
  editingWallRef.current = editingWall

  useEffect(() => {
    devLog('📷 [Camera] Effect run - editingWall:', editingWall, 'wallPosition:', wallPosition ? 'exists' : 'null', 'prev:', prevEditingWall.current, 'wallDimensions:', wallDimensions)
    
    const enteringEditMode = prevEditingWall.current === null && editingWall !== null
    const transitionRequested = transitionKey !== lastHandledTransitionKey.current

    const switchingWalls = prevEditingWall.current !== null && 
                          editingWall !== null && 
                          prevEditingWall.current !== editingWall
    const exitingEditMode = prevEditingWall.current !== null && editingWall === null
    
    devLog('📷 [Camera] Transition detection:', { 
      enteringEditMode, 
      switchingWalls, 
      exitingEditMode,
      pendingAnimation: pendingAnimation.current,
      hasWallPosition: !!wallPosition,
      conditionMet: (enteringEditMode || switchingWalls || pendingAnimation.current) && editingWall !== null && wallPosition
    })
    
    // Save camera position exactly when entering/switching walls (before animating to edit)
    if (enteringEditMode || switchingWalls) {
      savedCameraPosition.current = camera.position.clone()
      const controls = getControls(orbitControlsRef)
      if (controls) {
        savedCameraTarget.current = controls.target.clone()
      }
      devLog('📷 [Camera] Saved position before entering/switching edit mode, wall:', editingWall)
      pendingAnimation.current = true
    }

    if (editingWall !== null && wallPosition) {
      const shouldAnimateToWall =
        transitionRequested ||
        pendingAnimation.current ||
        enteringEditMode ||
        switchingWalls

      if (shouldAnimateToWall) {
        pendingAnimation.current = false

      // Entering/editing a wall - animate camera to wall
      devLog('📷 [Camera] Animating to wall', editingWall, 'prev:', prevEditingWall.current, 'entering:', enteringEditMode, 'switching:', switchingWalls)
      isAnimating.current = true
      animationProgress.current = 0
      animationDuration.current = SWOOSH_DURATION_SECONDS
      
      // Current position is our start position
      startPosition.current.copy(camera.position)
      const controlsStart = getControls(orbitControlsRef)
      if (controlsStart) {
        startTarget.current.copy(controlsStart.target)
      }

      // Calculate target position (in front of wall)
      // Boards are positioned at z=0.06 in wall's local space (positive Z = front)
      // To get the front direction in world space, transform local +Z axis
      // Local +Z in world space = (sin(rotation), 0, cos(rotation))
      // With 1 unit = 1 inch scale, walls are much larger (8ft × 10ft = 96" × 120")
      // Calculate optimal distance based on wall dimensions
      // To see full wall: distance >= max(width, height) / (2 * tan(FOV/2))
      // Using FOV (45°) for edit mode: tan(22.5°) ≈ 0.414
      // Scale distance proportionally to wall size, but keep it closer for better 2D editing
      // Keep wall entry framing consistent across all walls.
      const distance = EDIT_VIEW_DISTANCE_INCHES
      
      // 🎯 Use the wallRotation directly - it's already adjusted by WallSystem to account for which face was clicked
      // The wallRotation passed here is the adjustedRotation from WallSystem, which points toward the clicked face
      // Calculate the normal vector pointing outward from the clicked face
      // In the wall's local space, +Z is the front face, so the normal is (0, 0, 1)
      // Transform this to world space using the wall's rotation
      const wallForward = new THREE.Vector3(
        Math.sin(wallRotation),
        0,
        Math.cos(wallRotation)
      ).normalize()

      devLog(`📷 [Camera] Using wallRotation: ${(wallRotation * 180 / Math.PI).toFixed(0)}° (already adjusted for clicked face)`)

      // Position camera directly in front of the wall, perpendicular to it
      const offset = wallForward.multiplyScalar(distance)
      targetPosition.current.copy(wallPosition).add(offset)
      // Position camera at wall center height (wallPosition.y is already at center)
      targetPosition.current.y = wallPosition.y
      
      // Look directly at the center of the wall for head-on view
      targetTarget.current.copy(wallPosition)
      
      // Ensure camera is perfectly aligned: position -> wall center
      // The camera will be positioned along the wall's front normal, looking at the wall center
      // This gives us a true head-on 2D view
      }
    } else if (editingWall !== null && !wallPosition) {
      // Wall was selected but transform hasn't arrived yet; animate once it does.
      pendingAnimation.current = true
    } else if (exitingEditMode || (transitionRequested && editingWall === null)) {
      // Exiting edit mode - return to saved position (or default if none saved)
      devLog('📷 [Camera] Exiting edit mode, animating back to 3D view')
      const returnPosition = savedCameraPosition.current || defaultPosition.current
      const returnTarget = savedCameraTarget.current || defaultTarget.current
      pendingAnimation.current = false
      
      // Always reset and start animation when exiting, even if one was in progress
      isAnimating.current = true
      animationProgress.current = 0
      animationDuration.current = SWOOSH_DURATION_SECONDS
      
      // Start from the last known edit-view pose to avoid any snap-to-default
      // that can happen in the same render cycle as exiting.
      if (hasLastEditPose.current) {
        startPosition.current.copy(lastEditCameraPosition.current)
      } else {
        startPosition.current.copy(camera.position)
      }
      const controlsExit = getControls(orbitControlsRef)
      if (controlsExit) {
        if (hasLastEditPose.current) {
          startTarget.current.copy(lastEditCameraTarget.current)
        } else {
          startTarget.current.copy(controlsExit.target)
        }
      }
      
      // Return to the saved position (where we were before entering edit mode)
      targetPosition.current.copy(returnPosition)
      targetTarget.current.copy(returnTarget)
      devLog('📷 [Camera] Animating from', startPosition.current, 'to', returnPosition)
    }
    
    // Update previous value AFTER handling transitions
    prevEditingWall.current = editingWall
    lastHandledTransitionKey.current = transitionKey
  }, [editingWall, wallPosition, wallRotation, wallDimensions, camera, transitionKey])

  useFrame((state, delta) => {
    // Use the single OrbitControls from parent (drei ref)
    const controls = getControls(orbitControlsRef)
    if (!controls) return

    // Attach 'end' listener once when controls are available (ref may not be set when useEffect runs)
    if (!endListenerAdded.current) {
      endListenerAdded.current = true
      controls.addEventListener('end', () => {
        if (editingWallRef.current !== null) return // only restore when in 3D orbit mode
        positionOnEnd.current.copy(camera.position)
        targetOnEnd.current.copy(controls.target)
        restoreOnNextFrame.current = true
      })
    }

    if (isAnimating.current) {
      animationProgress.current = Math.min(
        animationProgress.current + delta / animationDuration.current,
        1
      )
      
      // Ease in-out function
      const easeProgress = animationProgress.current < 0.5
        ? 2 * animationProgress.current * animationProgress.current
        : 1 - Math.pow(-2 * animationProgress.current + 2, 2) / 2

      // Interpolate camera position
      camera.position.lerpVectors(
        startPosition.current,
        targetPosition.current,
        easeProgress
      )

      // Interpolate controls target
      const newTarget = new THREE.Vector3().lerpVectors(
        startTarget.current,
        targetTarget.current,
        easeProgress
      )
      controls.target.copy(newTarget)
      
      // When in edit mode, ensure camera is looking directly at the wall (head-on view)
      if (editingWall !== null) {
        // Force camera to look directly at wall center for perfect head-on view
        // Do this throughout the animation and after it completes
        camera.lookAt(newTarget)
        // Ensure camera's up vector is correct (Y-up) for proper orientation
        camera.up.set(0, 1, 0)
        camera.updateProjectionMatrix()
      }

      // Adjust FOV when entering edit mode for wider view
      if (editingWall !== null && easeProgress > 0.5) {
        // Use moderately wider FOV (45°) in edit mode to see full wall without too much distortion
        const targetFov = 45
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1)
          camera.updateProjectionMatrix()
        }
      } else if (editingWall === null && easeProgress > 0.5) {
        // Return to normal FOV (35°) when exiting edit mode
        const targetFov = 35
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1)
          camera.updateProjectionMatrix()
        }
      }

      if (animationProgress.current >= 1) {
        isAnimating.current = false
        onTransitionComplete?.()
      }
    }

    // Continuously remember the wall-view camera pose while editing.
    if (editingWall !== null && !isAnimating.current) {
      lastEditCameraPosition.current.copy(camera.position)
      lastEditCameraTarget.current.copy(controls.target)
      hasLastEditPose.current = true
    }

    // Disable controls during animation and in edit mode
    controls.enabled = !isAnimating.current && editingWall === null
    // Force damping off so rotation stops the instant the user releases the mouse
    const c = controls as { enableDamping?: boolean }
    c.enableDamping = false
    controls.update()

    // Undo the one-frame lingering rotation that update() just applied so orbit stops the instant the user releases the mouse
    if (restoreOnNextFrame.current) {
      camera.position.copy(positionOnEnd.current)
      controls.target.copy(targetOnEnd.current)
      restoreOnNextFrame.current = false
    }

    // When in edit mode (not animating), ensure camera stays head-on to the wall
    if (editingWall !== null && !isAnimating.current && targetTarget.current) {
      // Continuously ensure camera is looking directly at wall center for perfect head-on view
      camera.lookAt(targetTarget.current)
      camera.up.set(0, 1, 0)
      camera.updateProjectionMatrix()
    }
  })

  return null
}
