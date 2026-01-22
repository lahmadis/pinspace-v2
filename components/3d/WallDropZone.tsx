'use client'

import { useRef, useState, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { throttle } from '@/lib/throttleDebounce'

interface WallDropZoneProps {
  wallPosition: THREE.Vector3
  wallRotation: number
  wallDimensions: { width: number; height: number }
  onDrop: (localX: number, localY: number) => void
  onDragCancel: () => void
}

export function WallDropZone({
  wallPosition,
  wallRotation,
  wallDimensions,
  onDrop,
  onDragCancel
}: WallDropZoneProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const { camera, raycaster, gl } = useThree()
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  
  const SCALE = 0.5
  const scaledWidth = wallDimensions.width * SCALE
  const scaledHeight = wallDimensions.height * SCALE

  // Convert mouse screen position to world coordinates on wall
  const updateHoverPosition = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect()
    
    // Convert to normalized device coordinates (-1 to +1)
    const x = ((clientX - rect.left) / rect.width) * 2 - 1
    const y = -((clientY - rect.top) / rect.height) * 2 + 1
    
    // Create wall plane
    const wallNormal = new THREE.Vector3(
      -Math.sin(wallRotation),
      0,
      -Math.cos(wallRotation)
    ).normalize()
    
    const plane = new THREE.Plane(wallNormal, 0)
    plane.constant = -wallNormal.dot(wallPosition)
    
    // Raycast from camera through mouse position
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const intersectionPoint = new THREE.Vector3()
    
    if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
      // Convert world position to local wall coordinates
      const localOffset = intersectionPoint.clone().sub(wallPosition)
      
      // Rotate to wall's local coordinate system
      const cosR = Math.cos(-wallRotation)
      const sinR = Math.sin(-wallRotation)
      const localX = (localOffset.x * cosR - localOffset.z * sinR) / scaledWidth
      const localY = localOffset.y / scaledHeight

      // Match DraggableBoard behavior: invert X on vertical walls so drag direction feels natural
      const normalizedRotation = ((wallRotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      const isVerticalWall = (
        (normalizedRotation > Math.PI / 4 && normalizedRotation < (3 * Math.PI) / 4) ||
        (normalizedRotation > (5 * Math.PI) / 4 && normalizedRotation < (7 * Math.PI) / 4)
      )
      const adjustedLocalX = isVerticalWall ? -localX : localX

      // Clamp to full wall range (-0.5 to 0.5), matching DraggableBoard
      const clampedX = THREE.MathUtils.clamp(adjustedLocalX, -0.5, 0.5)
      const clampedY = THREE.MathUtils.clamp(localY, -0.5, 0.5)

      console.log('[WallDropZone] Cursor position:', { clientX, clientY })
      console.log('[WallDropZone] Intersection point:', intersectionPoint)
      console.log('[WallDropZone] Local coordinates:', { localX: adjustedLocalX, localY })
      console.log('[WallDropZone] Clamped coordinates:', { clampedX, clampedY })

      setHoverPosition({ x: clampedX, y: clampedY })

    }
  }

  // PERF: Throttle dragover handler to 50ms for smooth but efficient UI updates
  // This limits hover position updates to ~20fps during drag, reducing React re-renders
  // while maintaining smooth visual feedback. UI responsiveness improvement.
  // Recreate throttled function when dependencies change
  const throttledUpdateHoverPosition = useMemo(
    () => throttle((clientX: number, clientY: number) => {
      updateHoverPosition(clientX, clientY)
    }, 50),
    [gl, camera, raycaster, wallPosition, wallRotation, scaledWidth, scaledHeight]
  )

  // Listen for HTML drag events
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      setIsDragging(true)
      
      // Update hover position during drag (throttled)
      throttledUpdateHoverPosition(e.clientX, e.clientY)
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      
      console.log('🎯 Drop detected, hover position:', hoverPosition)
      
      if (!hoverPosition) {
        console.warn('No hover position - canceling drop')
        onDragCancel()
        setHoverPosition(null)
        return
      }
      
            // Clamp to full wall range (-0.5 to 0.5), matching DraggableBoard
            const clampedX = THREE.MathUtils.clamp(hoverPosition.x, -0.5, 0.5)
            const clampedY = THREE.MathUtils.clamp(hoverPosition.y, -0.5, 0.5)
      
            console.log('📍 Final drop position:', { x: clampedX, y: clampedY })
      
            onDrop(clampedX, clampedY)
      
      setHoverPosition(null)
    }

    const handleDragLeave = (e: DragEvent) => {
      // Only clear if we're leaving the canvas entirely
      const rect = gl.domElement.getBoundingClientRect()
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        setHoverPosition(null)
        setIsDragging(false)
      }
    }

    gl.domElement.addEventListener('dragover', handleDragOver)
    gl.domElement.addEventListener('drop', handleDrop)
    gl.domElement.addEventListener('dragleave', handleDragLeave)

    return () => {
      gl.domElement.removeEventListener('dragover', handleDragOver)
      gl.domElement.removeEventListener('drop', handleDrop)
      gl.domElement.removeEventListener('dragleave', handleDragLeave)
    }
  }, [hoverPosition, onDrop, onDragCancel, gl, throttledUpdateHoverPosition])

  // Calculate preview position in world space (MUST match DraggableBoard's getWorldPosition exactly)
  const getPreviewPosition = () => {
    if (!hoverPosition) return wallPosition.clone()
    
    // Use exact same calculation as DraggableBoard
    const offsetX = hoverPosition.x * scaledWidth
    const offsetY = hoverPosition.y * scaledHeight
    const offsetZ = 0.09 // Slightly closer than board (0.1) to show preview in front
    
    // Apply rotation to offset (exact same as DraggableBoard)
    const localOffset = new THREE.Vector3(offsetX, offsetY, offsetZ)
    localOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), wallRotation)
    
    const previewPos = wallPosition.clone().add(localOffset)
    
    console.log('[WallDropZone] Preview position calculation:')
    console.log('  Local coords:', hoverPosition)
    console.log('  Offsets (scaled):', { offsetX, offsetY, offsetZ })
    console.log('  World position:', previewPos)
    
    return previewPos
  }

  return (
    <>
      {/* Invisible plane for detecting pointer position */}
      <mesh
        ref={meshRef}
        position={wallPosition}
        rotation={[0, wallRotation, 0]}
      >
        <planeGeometry args={[scaledWidth, scaledHeight]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Preview indicator */}
      {hoverPosition && (
        <mesh position={getPreviewPosition()} rotation={[0, wallRotation, 0]}>
          <planeGeometry args={[scaledWidth * 0.2, scaledHeight * 0.2]} />
          <meshBasicMaterial 
            color="#4444ff" 
            transparent 
            opacity={0.4} 
            side={THREE.DoubleSide}
          />
          <lineSegments>
            <edgesGeometry args={[new THREE.PlaneGeometry(scaledWidth * 0.2, scaledHeight * 0.2)]} />
            <lineBasicMaterial color="#0000ff" linewidth={2} />
          </lineSegments>
        </mesh>
      )}
    </>
  )
}