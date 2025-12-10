import { useThree, useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'

interface CameraControllerProps {
  editingWall: number | null
  wallPosition: THREE.Vector3 | null
  wallRotation: number
  onTransitionComplete?: () => void
}

export function CameraController({ 
  editingWall, 
  wallPosition, 
  wallRotation,
  onTransitionComplete 
}: CameraControllerProps) {
  const { camera, gl } = useThree()
  const controlsRef = useRef<OrbitControls>()
  
  // Store original camera settings
  const originalSettings = useRef({
    position: new THREE.Vector3(0, 3.2, 7),
    target: new THREE.Vector3(0, 3.2, 0),
    isPerspective: true,
  })
  
  

  // Animation state
  const isAnimating = useRef(false)
  const animationProgress = useRef(0)
  const startPosition = useRef(new THREE.Vector3())
  const startTarget = useRef(new THREE.Vector3())
  const targetPosition = useRef(new THREE.Vector3())
  const targetTarget = useRef(new THREE.Vector3())

  useEffect(() => {
    if (editingWall !== null && wallPosition) {
      // Start animation to wall
      isAnimating.current = true
      animationProgress.current = 0
      
      // Store current position
      startPosition.current.copy(camera.position)
      if (controlsRef.current) {
        startTarget.current.copy(controlsRef.current.target)
      }

      // Calculate target position (in front of wall)
      const distance = 12 // Distance from wall (increased to see full wall)
      const offset = new THREE.Vector3(
        Math.sin(wallRotation) * distance,
        0,
        Math.cos(wallRotation) * distance
      )
      
      targetPosition.current.copy(wallPosition).add(offset)
      targetTarget.current.copy(wallPosition)

    } else if (editingWall === null && isAnimating.current === false) {
      // Return to original view
      isAnimating.current = true
      animationProgress.current = 0
      
      startPosition.current.copy(camera.position)
      if (controlsRef.current) {
        startTarget.current.copy(controlsRef.current.target)
      }
      
      targetPosition.current.copy(originalSettings.current.position)
      targetTarget.current.copy(originalSettings.current.target)
    }
  }, [editingWall, wallPosition, wallRotation, camera])

  useFrame((state, delta) => {
    if (!controlsRef.current) {
      controlsRef.current = new OrbitControls(camera, gl.domElement)
      controlsRef.current.enableDamping = true
      controlsRef.current.dampingFactor = 0.05
    }

    if (isAnimating.current) {
      animationProgress.current = Math.min(animationProgress.current + delta * 1.5, 1)
      
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

      // Switch to orthographic when close to wall
      if (editingWall !== null && easeProgress > 0.7) {
        // TODO: Transition to orthographic camera
      }

      if (animationProgress.current >= 1) {
        isAnimating.current = false
        onTransitionComplete?.()
      }
    }

    // Disable controls during animation
    if (controlsRef.current) {
      controlsRef.current.enabled = !isAnimating.current && editingWall === null
      controlsRef.current.update()
    }
  })

  return null
}