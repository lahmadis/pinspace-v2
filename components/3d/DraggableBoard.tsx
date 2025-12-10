'use client'

import { useRef, useState, useEffect } from 'react'
import { useThree, ThreeEvent } from '@react-three/fiber'
import { supabase } from '@/lib/supabase/client'
import * as THREE from 'three'
import type { Board } from '@/types'
import { Suspense } from 'react'
import { useTexture, Text, Html } from '@react-three/drei'
import { PDFTextureMaterial } from './PDFTexture'

interface DraggableBoardProps {
  board: Board
  wallIndex: number
  wallPosition: THREE.Vector3
  wallRotation: number
  wallDimensions: { width: number; height: number }
  initialLocalPosition?: { x: number; y: number; width?: number; height?: number }
  onDragEnd: (boardId: string, localX: number, localY: number, width?: number, height?: number) => void
  onDelete: (boardId: string) => void
  onCommentClick?: (board: Board) => void
}

function BoardTexture({ imageUrl }: { imageUrl: string }) {
  // Don't try to load PDFs as textures
  if (imageUrl.toLowerCase().endsWith('.pdf')) {
    return <meshStandardMaterial color="#ff4444" side={THREE.DoubleSide} />
  }
  
  try {
    const texture = useTexture(imageUrl)
    texture.colorSpace = THREE.SRGBColorSpace
    return <meshStandardMaterial map={texture} side={THREE.DoubleSide} />
  } catch (error) {
    return <meshStandardMaterial color="#e0e0e0" side={THREE.DoubleSide} />
  }
}

export function DraggableBoard({
  board,
  wallIndex,
  wallPosition,
  wallRotation,
  wallDimensions,
  initialLocalPosition = { x: 0, y: 0 },
  onDragEnd,
  onDelete,
  onCommentClick
}: DraggableBoardProps) {
  const [user, setUser] = useState<any>(null)
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
    })
    
    return () => subscription.unsubscribe()
  }, [])
  
  // Check if current user owns this board
  const isOwner = !board.ownerId || (user && board.ownerId === user.id)
  const isLocked = !isOwner
  const meshRef = useRef<THREE.Mesh>(null)
  const [localPosition, setLocalPosition] = useState(initialLocalPosition)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  
  // Store position in ref for immediate access during drag
  const positionRef = useRef(initialLocalPosition)
  
  // Track if we just finished dragging to avoid resetting position
  const justFinishedDragging = useRef(false)
  
  // Sync position when props change (but not right after we finished dragging)
  useEffect(() => {
    if (justFinishedDragging.current) {
      justFinishedDragging.current = false
      return
    }
    
    if (!isDragging) {
      // Only sync if position actually changed from external source
      const propsPos = initialLocalPosition
      const currentPos = positionRef.current
      
      if (propsPos.x !== currentPos.x || propsPos.y !== currentPos.y) {
        console.log('📍 Syncing position from props:', propsPos)
        positionRef.current = propsPos
        setLocalPosition(propsPos)
      }
    }
  }, [initialLocalPosition.x, initialLocalPosition.y, isDragging])
  
  console.log('🎨 [DraggableBoard] Rendering board:', board.id, 'at position:', localPosition)
  
  const { camera, gl, raycaster } = useThree()
  
  const SCALE = 0.5
  const scaledWallWidth = wallDimensions.width * SCALE
  const scaledWallHeight = wallDimensions.height * SCALE
  
  // Calculate board size based on aspect ratio
  let boardWidthPercent = localPosition.width ?? 0.25
  let boardHeightPercent = localPosition.height ?? 0.25
  
  // If board has aspect ratio, calculate proper dimensions
  if (board.aspectRatio && !localPosition.width) {
    // Start with a base size (e.g., 25% of wall height)
    const baseHeightPercent = 0.30 // 30% of wall height as base
    boardHeightPercent = baseHeightPercent
    boardWidthPercent = baseHeightPercent * board.aspectRatio * (wallDimensions.height / wallDimensions.width)
    
    // Clamp to reasonable sizes
    const maxWidthPercent = 0.45
    const maxHeightPercent = 0.50
    if (boardWidthPercent > maxWidthPercent) {
      const scale = maxWidthPercent / boardWidthPercent
      boardWidthPercent = maxWidthPercent
      boardHeightPercent = boardHeightPercent * scale
    }
    if (boardHeightPercent > maxHeightPercent) {
      const scale = maxHeightPercent / boardHeightPercent
      boardHeightPercent = maxHeightPercent
      boardWidthPercent = boardWidthPercent * scale
    }
  }
  
  const boardWidth = scaledWallWidth * boardWidthPercent
  const boardHeight = scaledWallHeight * boardHeightPercent

  const updatePosition = (clientX: number, clientY: number) => {
    const wallNormal = new THREE.Vector3(
      -Math.sin(wallRotation),
      0,
      -Math.cos(wallRotation)
    ).normalize()
    
    const plane = new THREE.Plane(wallNormal, 0)
    plane.constant = -wallNormal.dot(wallPosition)

    const rect = gl.domElement.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 2 - 1
    const y = -((clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
    const intersectionPoint = new THREE.Vector3()
    
    if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
      const localOffset = intersectionPoint.clone().sub(wallPosition)
      
      const cosR = Math.cos(-wallRotation)
      const sinR = Math.sin(-wallRotation)
      const localX = localOffset.x * cosR - localOffset.z * sinR
      const localY = localOffset.y
      
      let normalizedX = THREE.MathUtils.clamp(localX / scaledWallWidth, -0.5, 0.5)
      let normalizedY = THREE.MathUtils.clamp(localY / scaledWallHeight, -0.5, 0.5)

      const newPos = {
        x: normalizedX,
        y: normalizedY,
        width: positionRef.current.width,
        height: positionRef.current.height,
      }
      
      // Update BOTH ref and state
      positionRef.current = newPos
      setLocalPosition(newPos)
    }
  }

  // Store onDragEnd in a ref to avoid stale closure issues
  const onDragEndRef = useRef(onDragEnd)
  useEffect(() => {
    onDragEndRef.current = onDragEnd
  }, [onDragEnd])
  
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    console.log('🖱️ POINTER DOWN on board:', board.id)
    console.log('🖱️ onDragEnd function exists:', typeof onDragEnd === 'function')
    e.stopPropagation()
    
    // Prevent dragging if board is locked
    if (isLocked) {
      console.log('🔒 Board is locked - cannot drag')
      return
    }
    
    setIsDragging(true)
    gl.domElement.style.cursor = 'grabbing'
    console.log('🖱️ isDragging set to true, attaching global listeners...')
    
    // Start listening to window events
    const handleMove = (e: PointerEvent) => {
      updatePosition(e.clientX, e.clientY)
    }
    
    const handleUp = (e: PointerEvent) => {
      console.log('🖱️🖱️🖱️ POINTER UP FIRED! board:', board.id)
      console.log('🖱️🖱️🖱️ Current positionRef:', JSON.stringify(positionRef.current))
      gl.domElement.style.cursor = 'grab'
      
      // Mark that we just finished dragging to prevent sync from resetting position
      justFinishedDragging.current = true
      
      // Call onDragEnd with ref value (NOT state)
      const finalPos = positionRef.current
      console.log('🎯🎯🎯 DRAG END - Calling onDragEnd with:', {
        boardId: board.id,
        x: finalPos.x,
        y: finalPos.y,
        width: finalPos.width,
        height: finalPos.height
      })
      
      // Update parent state - use REF to get latest callback (avoids stale closure)
      try {
        console.log('🎯🎯🎯 Calling onDragEndRef.current...')
        onDragEndRef.current(board.id, finalPos.x, finalPos.y, finalPos.width, finalPos.height)
        console.log('🎯🎯🎯 onDragEnd called successfully!')
      } catch (err) {
        console.error('❌❌❌ onDragEnd FAILED:', err)
      }
      
      // Then update local dragging state
      setIsDragging(false)
      
      // Clean up listeners
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const handleDeleteClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const confirmed = window.confirm('Remove this board from the wall?')
    if (confirmed) {
      onDelete(board.id)
    }
  }

  const getWorldPosition = (localX: number, localY: number): THREE.Vector3 => {
    const offsetX = localX * scaledWallWidth
    const offsetY = localY * scaledWallHeight
    const offsetZ = 0.1
    
    const localOffset = new THREE.Vector3(offsetX, offsetY, offsetZ)
    localOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), wallRotation)
    
    return wallPosition.clone().add(localOffset)
  }

  const worldPosition = getWorldPosition(localPosition.x, localPosition.y)
  const hasImage = board.fullImageUrl || board.thumbnailUrl
  const imageUrl = board.fullImageUrl || board.thumbnailUrl || ''
  const isPDF = imageUrl.toLowerCase().endsWith('.pdf')

  const deleteButtonSize = Math.min(boardWidth, boardHeight) * 0.15
  const deleteButtonX = boardWidth / 2 - deleteButtonSize / 2 - deleteButtonSize * 0.3
  const deleteButtonY = boardHeight / 2 - deleteButtonSize / 2 - deleteButtonSize * 0.3

  return (
    <group position={worldPosition} rotation={[0, wallRotation, 0]}>
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onPointerOver={(e) => {
          console.log('🖱️ HOVER detected on board:', board.id)
          e.stopPropagation()
          setIsHovered(true)
          if (!isDragging) {
            gl.domElement.style.cursor = isLocked ? 'not-allowed' : 'grab'
          }
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setIsHovered(false)
          if (!isDragging) gl.domElement.style.cursor = 'default'
        }}
      >
        <planeGeometry args={[boardWidth, boardHeight]} />
        {isPDF ? (
          <Suspense fallback={<meshStandardMaterial color="#f3f4f6" side={THREE.DoubleSide} />}>
            <PDFTextureMaterial pdfUrl={imageUrl} hovered={isHovered} />
          </Suspense>
        ) : hasImage ? (
          <Suspense fallback={<meshStandardMaterial color="#cccccc" side={THREE.DoubleSide} />}>
            <BoardTexture imageUrl={imageUrl} />
          </Suspense>
        ) : (
          <meshStandardMaterial 
            color={isHovered ? "#f8f8f8" : "#ffffff"} 
            side={THREE.DoubleSide}
            emissive={isHovered ? "#444444" : "#000000"}
            emissiveIntensity={0.1}
          />
        )}
      </mesh>
      
      <lineSegments position={[0, 0, 0.001]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(boardWidth, boardHeight)]} />
        <lineBasicMaterial 
          color={
            isLocked 
              ? (isHovered ? "#999999" : "#666666")  // Gray for locked boards
              : (isHovered ? "#4444ff" : "#333333")  // Blue for owned boards
          } 
          linewidth={2} 
        />
      </lineSegments>

      {/* Delete button - Only show for owned boards */}
      {isHovered && !isDragging && isOwner && (
        <Html
          position={[deleteButtonX, deleteButtonY, 0.1]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'auto' }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              const confirmed = window.confirm('Remove this board from the wall?')
              if (confirmed) {
                onDelete(board.id)
              }
            }}
            onMouseEnter={() => {
              gl.domElement.style.cursor = 'pointer'
            }}
            onMouseLeave={() => {
              gl.domElement.style.cursor = 'grab'
            }}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: '#ef4444',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              transition: 'transform 0.1s',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            ×
          </button>
        </Html>
      )}

      {/* Lock icon - Show for boards not owned by current user */}
      {isHovered && !isDragging && isLocked && (
        <group position={[deleteButtonX, deleteButtonY, 0.002]}>
          {/* Lock icon background */}
          <mesh>
            <circleGeometry args={[deleteButtonSize / 2, 32]} />
            <meshBasicMaterial color="#666666" transparent opacity={0.9} />
          </mesh>

          {/* Lock icon using HTML emoji */}
          <Html
            center
            distanceFactor={10}
            style={{
              pointerEvents: 'none',
              userSelect: 'none',
              fontSize: `${deleteButtonSize * 8}px`,
              transform: 'translate(-50%, -50%)'
            }}
          >
            🔒
          </Html>

          {/* Tooltip */}
          {board.ownerName && (
            <Html
              position={[0, deleteButtonSize * 0.8, 0]}
              center
              distanceFactor={10}
              style={{
                pointerEvents: 'none',
                userSelect: 'none',
                background: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                whiteSpace: 'nowrap'
              }}
            >
              This board belongs to {board.ownerName}
            </Html>
          )}
        </group>
      )}

      {/* Owner name tooltip - only show on hover */}
      {isHovered && board.ownerName && !isDragging && (
        <Html
          position={[0, -boardHeight / 2 - 0.05, 0.01]}
          center
          distanceFactor={10}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}>
            {board.ownerName}
          </div>
        </Html>
      )}

      {/* Comment Count Bubble - Clean minimal design */}
      {board.comments && board.comments.length > 0 && onCommentClick && !isDragging && (
        <group position={[boardWidth / 2 - boardWidth * 0.12, boardHeight / 2 - boardHeight * 0.12, 0.003]}>
          {/* Blue circular badge */}
          <mesh
            onClick={(e) => {
              e.stopPropagation()
              console.log('💬 [Comment Bubble] Clicked for board:', board.id)
              onCommentClick(board)
            }}
            onPointerOver={(e) => {
              e.stopPropagation()
              gl.domElement.style.cursor = 'pointer'
            }}
            onPointerOut={(e) => {
              e.stopPropagation()
              if (!isDragging) gl.domElement.style.cursor = isHovered ? 'grab' : 'default'
            }}
          >
            <circleGeometry args={[Math.min(boardWidth, boardHeight) * 0.08, 32]} />
            <meshBasicMaterial color="#4444ff" transparent opacity={0.95} />
          </mesh>

          {/* Comment count text */}
          <Text
            position={[0, 0, 0.002]}
            fontSize={Math.min(boardWidth, boardHeight) * 0.06}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            fontWeight={700}
          >
            {board.comments.length}
          </Text>
        </group>
      )}
    </group>
  )
}