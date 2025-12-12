import { useThree, useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'

interface CameraControllerProps {
  editingWall: number | null
  wallPosition: THREE.Vector3 | null
  wallRotation: number
  wallDimensions?: { width: number; height: number } | null // Wall dimensions in feet
  onTransitionComplete?: () => void
}

export function CameraController({ 
  editingWall, 
  wallPosition, 
  wallRotation,
  wallDimensions,
  onTransitionComplete 
}: CameraControllerProps) {
  const { camera, gl } = useThree()
  const controlsRef = useRef<OrbitControls>()
  
  // Store the camera position before entering edit mode (so we can return to it)
  const savedCameraPosition = useRef<THREE.Vector3 | null>(null)
  const savedCameraTarget = useRef<THREE.Vector3 | null>(null)
  
  // Store default camera settings (used only on initial load if no saved position)
  // With 1 unit = 1 inch scale, need much larger initial position
  // These will be scaled based on wall dimensions when wallConfig is available
  const defaultPosition = useRef(new THREE.Vector3(0, 60, 120)) // 60" high, 120" away (5ft high, 10ft away) - baseline for 8ft walls
  const defaultTarget = useRef(new THREE.Vector3(0, 60, 0))
  
  // Track previous editingWall to detect transitions
  const prevEditingWall = useRef<number | null>(null)
  
  

  // Animation state
  const isAnimating = useRef(false)
  const animationProgress = useRef(0)
  const startPosition = useRef(new THREE.Vector3())
  const startTarget = useRef(new THREE.Vector3())
  const targetPosition = useRef(new THREE.Vector3())
  const targetTarget = useRef(new THREE.Vector3())

  useEffect(() => {
    // Detect transition: null -> wallIndex (entering edit mode)
    const enteringEditMode = prevEditingWall.current === null && editingWall !== null
    // Detect transition: wallIndex -> null (exiting edit mode)
    const exitingEditMode = prevEditingWall.current !== null && editingWall === null
    
    if (enteringEditMode && wallPosition) {
      // About to enter edit mode - save current camera position
      savedCameraPosition.current = camera.position.clone()
      if (controlsRef.current) {
        savedCameraTarget.current = controlsRef.current.target.clone()
      }
      console.log('📷 [Camera] Saved position before entering edit mode')
    }
    
    if (editingWall !== null && wallPosition) {
      // Entering/editing a wall - animate camera to wall
      console.log('📷 [Camera] Animating to wall', editingWall)
      isAnimating.current = true
      animationProgress.current = 0
      
      // Current position is our start position
      startPosition.current.copy(camera.position)
      if (controlsRef.current) {
        startTarget.current.copy(controlsRef.current.target)
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
      let distance = 400 // Default: 400 inches (~33ft) for 8ft walls
      if (wallDimensions) {
        const wallWidthInches = wallDimensions.width * 12
        const wallHeightInches = wallDimensions.height * 12
        const maxDimension = Math.max(wallWidthInches, wallHeightInches)
        // Base calculation: distance = maxDimension / (2 * tan(22.5°)) ≈ maxDimension / 0.828
        // Use minimal margin (1.05x) to keep camera close for better 2D editing experience
        // This ensures the camera scales proportionally with wall size but stays as close as possible
        const baseDistance = maxDimension / 0.828
        distance = baseDistance * 1.05 // Only 5% margin for very close view in 2D edit mode
        console.log(`📷 [Camera] Wall dimensions: ${wallWidthInches}" × ${wallHeightInches}", calculated distance: ${distance.toFixed(0)}" (${(distance/12).toFixed(1)}ft)`)
      }
      // Calculate the forward direction of the wall (pointing away from the wall's front face)
      // The wall's front face normal is the direction we want to position the camera
      const wallForward = new THREE.Vector3(
        Math.sin(wallRotation),
        0,
        Math.cos(wallRotation)
      ).normalize()
      
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

    } else if (exitingEditMode) {
      // Exiting edit mode - return to saved position (or default if none saved)
      console.log('📷 [Camera] Exiting edit mode, animating back to 3D view')
      const returnPosition = savedCameraPosition.current || defaultPosition.current
      const returnTarget = savedCameraTarget.current || defaultTarget.current
      
      // Always reset and start animation when exiting, even if one was in progress
      isAnimating.current = true
      animationProgress.current = 0
      
      // Current position is our start position (capture it fresh)
      startPosition.current.copy(camera.position)
      if (controlsRef.current) {
        startTarget.current.copy(controlsRef.current.target)
      }
      
      // Return to the saved position (where we were before entering edit mode)
      targetPosition.current.copy(returnPosition)
      targetTarget.current.copy(returnTarget)
      console.log('📷 [Camera] Animating from', startPosition.current, 'to', returnPosition)
    }
    
    // Update previous value AFTER handling transitions
    prevEditingWall.current = editingWall
  }, [editingWall, wallPosition, wallRotation, camera])

  useFrame((state, delta) => {
    if (!controlsRef.current) {
      controlsRef.current = new OrbitControls(camera, gl.domElement)
      controlsRef.current.enableDamping = true
      controlsRef.current.dampingFactor = 0.05
    }

    if (isAnimating.current) {
      // Speed up exit animation significantly (5x faster) for instant feel
      // Check if we're exiting (editingWall is null but we were animating)
      const isExiting = editingWall === null && prevEditingWall.current !== null
      const animationSpeed = isExiting ? 7.5 : 1.5 // Much faster when exiting
      animationProgress.current = Math.min(animationProgress.current + delta * animationSpeed, 1)
      
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
      controlsRef.current.target.copy(newTarget)
      
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

    // Disable controls during animation and in edit mode
    if (controlsRef.current) {
      controlsRef.current.enabled = !isAnimating.current && editingWall === null
      controlsRef.current.update()
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