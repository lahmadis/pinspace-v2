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
  onSelect?: () => void
  onDeselect?: () => void
  isSelected?: boolean
  workspaceId?: string // Workspace/studio ID to check membership
  isWorkspaceMember?: boolean // Whether user is a member of the workspace
}

function BoardTexture({ imageUrl }: { imageUrl: string }) {
  // Don't try to load PDFs as textures
  if (imageUrl.toLowerCase().endsWith('.pdf')) {
    return <meshStandardMaterial color="#ff4444" side={THREE.DoubleSide} />
  }
  
  // Lazy load texture to avoid blocking initial render
  const [textureUrl, setTextureUrl] = useState<string | null>(null)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setTextureUrl(imageUrl)
    }, 50) // Small delay for better performance
    return () => clearTimeout(timer)
  }, [imageUrl])
  
  // Always call useTexture (hooks rule), but use placeholder if not ready
  const texture = useTexture(textureUrl || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
  
  // Configure texture for performance
  useEffect(() => {
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      // Limit anisotropy to 2 for better performance on Vercel
      texture.anisotropy = 2
      texture.needsUpdate = true
    }
  }, [texture])
  
  const usePlaceholder = textureUrl === null
  
  return <meshStandardMaterial 
    map={usePlaceholder ? undefined : texture} 
    color={usePlaceholder ? '#e5e7eb' : undefined}
    side={THREE.DoubleSide} 
  />
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
  onCommentClick,
  onSelect,
  onDeselect,
  isSelected = false,
  workspaceId,
  isWorkspaceMember = false
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
  
  // Check if current user can edit this board
  // Can edit if: owns the board OR is a member of the workspace
  const isOwner = !board.ownerId || (user && board.ownerId === user.id)
  const canEdit = isOwner || isWorkspaceMember
  const isLocked = !canEdit
  
  const meshRef = useRef<THREE.Mesh>(null)
  const [localPosition, setLocalPosition] = useState(initialLocalPosition)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  
  // Debug logging for delete button visibility
  useEffect(() => {
    if (isHovered) {
      console.log('🔍 [DraggableBoard] Hover state:', {
        boardId: board.id,
        isHovered,
        isDragging,
        isOwner,
        isLocked,
        hasOwnerId: !!board.ownerId,
        userId: user?.id,
        boardOwnerId: board.ownerId
      })
    }
  }, [isHovered, isDragging, isOwner, isLocked, board.id, board.ownerId, user?.id])
  
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
  
  // Scene scale: 1 unit = 1 inch
  // So an 8ft × 10ft wall = 96 × 120 units
  const SCALE = 12 // Convert feet to inches (1 ft = 12 inches)
  const scaledWallWidth = wallDimensions.width * SCALE
  const scaledWallHeight = wallDimensions.height * SCALE
  
  // Calculate board size using physical dimensions directly in inches
  // With 1 unit = 1 inch, physical dimensions map directly to 3D units
  let boardWidth: number | undefined
  let boardHeight: number | undefined
  
  // First, try to use physical dimensions if available (they represent the actual board size)
  if (board.physicalWidth && board.physicalHeight) {
    boardWidth = board.physicalWidth  // Direct: inches → units
    boardHeight = board.physicalHeight // Direct: inches → units
    
    // Clamp to ensure board doesn't exceed wall size
    const wallWidthInches = wallDimensions.width * 12
    const wallHeightInches = wallDimensions.height * 12
    boardWidth = Math.min(boardWidth, wallWidthInches)
    boardHeight = Math.min(boardHeight, wallHeightInches)
    
    console.log(`📐 [DraggableBoard] Using physical dimensions: ${board.physicalWidth}" x ${board.physicalHeight}" = ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)} units`)
  }
  
  // Fallback for existing boards without physical dimensions: default to 8.5×11 inches (standard letter size)
  if (boardWidth === undefined || boardHeight === undefined) {
    const DEFAULT_WIDTH_INCHES = 8.5
    const DEFAULT_HEIGHT_INCHES = 11
    
    // Try to use saved percentage dimensions if available
    if (localPosition.width && localPosition.height) {
      const wallWidthInches = wallDimensions.width * 12
      const wallHeightInches = wallDimensions.height * 12
      boardWidth = localPosition.width * wallWidthInches
      boardHeight = localPosition.height * wallHeightInches
      console.log(`📐 [DraggableBoard] Using saved percentage dimensions: ${(localPosition.width * 100).toFixed(1)}% x ${(localPosition.height * 100).toFixed(1)}% = ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)} units`)
    } else {
      // Final fallback: use default 8.5×11 inches
      boardWidth = DEFAULT_WIDTH_INCHES
      boardHeight = DEFAULT_HEIGHT_INCHES
      console.log(`📐 [DraggableBoard] No dimensions found - using default: ${DEFAULT_WIDTH_INCHES}" x ${DEFAULT_HEIGHT_INCHES}" = ${boardWidth} x ${boardHeight} units`)
    }
  }
  
  // Ensure we have valid dimensions
  if (boardWidth === undefined || boardHeight === undefined || boardWidth <= 0 || boardHeight <= 0) {
    // Final safety fallback
    boardWidth = 8.5
    boardHeight = 11
    console.warn(`⚠️ [DraggableBoard] Invalid dimensions for board ${board.id} - using default 8.5×11"`)
  }

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
      
      // Apply drag offset so board follows cursor from where it was clicked
      // The offset is stored in wall space (inches), so we can subtract directly
      const offsetX = dragOffset.current ? dragOffset.current.x : 0
      const offsetY = dragOffset.current ? dragOffset.current.y : 0
      
      // Subtract offset so the click point stays under the cursor
      const adjustedX = localX - offsetX
      const adjustedY = localY - offsetY
      
      let normalizedX = THREE.MathUtils.clamp(adjustedX / scaledWallWidth, -0.5, 0.5)
      let normalizedY = THREE.MathUtils.clamp(adjustedY / scaledWallHeight, -0.5, 0.5)

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
  
  // Track if we actually dragged (to distinguish click from drag)
  const dragStartPosition = useRef<{ x: number; y: number } | null>(null)
  // Track the offset from click point to board center (in local board space)
  const dragOffset = useRef<{ x: number; y: number } | null>(null)
  
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    console.log('🖱️ POINTER DOWN on board:', board.id)
    console.log('🖱️ onDragEnd function exists:', typeof onDragEnd === 'function')
    e.stopPropagation()
    
    // Store initial position to detect if this is a drag or just a click
    dragStartPosition.current = { x: e.clientX, y: e.clientY }
    
    // Calculate offset from click point to board center (in local board space)
    // The intersection point is in world space, we need to convert to local board space
    if (e.intersections && e.intersections.length > 0) {
      const intersection = e.intersections[0]
      const worldClickPoint = intersection.point
      
      // Calculate current board position in world space
      const currentBoardX = localPosition.x * scaledWallWidth
      const currentBoardY = localPosition.y * scaledWallHeight
      const currentBoardZ = 2.2 // Board is clearly in front of wall (wall depth is 4 inches)
      
      // Transform to board's local space (accounting for wall rotation and position)
      const boardWorldPosition = new THREE.Vector3(
        wallPosition.x + currentBoardX,
        wallPosition.y + currentBoardY,
        wallPosition.z + currentBoardZ
      )
      
      // Get the offset from board center to click point in world space
      const offset = new THREE.Vector3()
      offset.copy(worldClickPoint).sub(boardWorldPosition)
      
      // Rotate offset to board's local space (inverse of wall rotation)
      const cosR = Math.cos(-wallRotation)
      const sinR = Math.sin(-wallRotation)
      const localOffsetX = offset.x * cosR - offset.z * sinR
      const localOffsetY = offset.y
      
      // Store offset in wall space (inches), not normalized
      dragOffset.current = {
        x: localOffsetX,
        y: localOffsetY
      }
      
      console.log('📍 Drag offset calculated:', dragOffset.current, 'board size:', boardWidth, boardHeight)
    } else {
      // Fallback: no offset if we can't calculate it
      dragOffset.current = { x: 0, y: 0 }
    }
    
    // Prevent dragging if board is locked
    if (isLocked) {
      console.log('🔒 Board is locked - cannot drag')
      return
    }
    
    // Deselect board when starting to drag
    if (onDeselect && isSelected) {
      console.log('🖱️ [DraggableBoard] Deselecting board because drag started')
      onDeselect()
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
      
      // Check if this was a click (no significant movement) or a drag
      const wasClick = dragStartPosition.current && 
        Math.abs(e.clientX - dragStartPosition.current.x) < 5 && 
        Math.abs(e.clientY - dragStartPosition.current.y) < 5
      
      console.log('🖱️ [DraggableBoard] Pointer up - wasClick:', wasClick, 'onSelect exists:', !!onSelect, 'movement:', dragStartPosition.current ? {
        x: Math.abs(e.clientX - dragStartPosition.current.x),
        y: Math.abs(e.clientY - dragStartPosition.current.y)
      } : 'no start pos')
      
      // If it was just a click (no significant movement), select the board
      // wasClick being true means there was minimal movement, so it's a click, not a drag
      if (wasClick && onSelect) {
        console.log('🖱️ Click detected (not drag) - selecting board:', board.id)
        onSelect()
      }
      
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
      dragStartPosition.current = null
      dragOffset.current = null // Clear drag offset
      
      // Clean up listeners
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const handleDeleteClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onDelete(board.id)
  }

  // Calculate board position in wall's local space (matching WallSystem approach)
  // Boards are positioned in a group that's rotated with the wall
  const boardX = localPosition.x * scaledWallWidth
  const boardY = localPosition.y * scaledWallHeight
  // Check board's side property to determine which side of wall to place it on
  // If no side specified, default to front (for backwards compatibility)
  const boardSide = board.position?.side || 'front'
  // Wall depth is 4 inches, so place boards at 2.2 (half wall depth + small offset) to be clearly in front
  const boardZ = boardSide === 'back' ? -2.2 : 2.2
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  const hasImage = board.fullImageUrl || board.thumbnailUrl
  const imageUrl = board.fullImageUrl || board.thumbnailUrl || ''
  const isPDF = imageUrl.toLowerCase().endsWith('.pdf')
  
  // Debug: Log image URL for newly uploaded boards
  useEffect(() => {
    if (!hasImage) {
      console.warn('⚠️ [DraggableBoard] Board has no image URL:', board.id, {
        fullImageUrl: board.fullImageUrl,
        thumbnailUrl: board.thumbnailUrl
      })
    } else {
      console.log('🖼️ [DraggableBoard] Rendering board with image:', board.id, imageUrl)
    }
  }, [board.id, hasImage, imageUrl, board.fullImageUrl, board.thumbnailUrl])

  // Calculate delete button size and position
  // With 1 unit = 1 inch scale, boards are much larger, so button should scale appropriately
  const deleteButtonSize = Math.min(boardWidth, boardHeight) * 0.12 // Slightly smaller relative size
  const deleteButtonX = boardWidth / 2 - deleteButtonSize / 2 - deleteButtonSize * 0.3
  const deleteButtonY = boardHeight / 2 - deleteButtonSize / 2 - deleteButtonSize * 0.3

  // Position the group at the wall position, then position board within group's local space
  return (
    <group position={wallPosition} rotation={[0, wallRotation, 0]}>
      <group position={[boardX, boardY, boardZ]}>
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
        onClick={(e) => {
          // Stop propagation so the invisible wall plane doesn't get the click
          e.stopPropagation()
        }}
        // Make sure boards render in front of the invisible wall plane
        renderOrder={1}
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
        {/* Use boxGeometry instead of planeGeometry to give boards thickness */}
        <boxGeometry args={[boardWidth, boardHeight, BOARD_THICKNESS]} />
        {isPDF ? (
          <Suspense fallback={<meshStandardMaterial color="#f3f4f6" />}>
            <PDFTextureMaterial pdfUrl={imageUrl} hovered={isHovered} />
          </Suspense>
        ) : hasImage ? (
          <Suspense fallback={<meshStandardMaterial color="#cccccc" />}>
            <BoardTexture imageUrl={imageUrl} />
          </Suspense>
        ) : (
          <meshStandardMaterial 
            color={isHovered ? "#f8f8f8" : "#ffffff"} 
            emissive={isHovered ? "#444444" : "#000000"}
            emissiveIntensity={0.1}
          />
        )}
      </mesh>
      
      {/* Border edges for the box geometry */}
      <lineSegments position={[0, 0, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(boardWidth, boardHeight, BOARD_THICKNESS)]} />
        <lineBasicMaterial 
          color={
            isSelected
              ? "#4444ff"  // Blue border when selected (indicates it can be deleted with backspace)
              : isLocked 
                ? (isHovered ? "#999999" : "#666666")  // Gray for locked boards
                : (isHovered ? "#4444ff" : "#333333")  // Blue for owned boards
          } 
          linewidth={isSelected ? 5 : 2} 
        />
      </lineSegments>
      
      {/* Additional thicker border for selected state */}
      {isSelected && (
        <lineSegments position={[0, 0, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(boardWidth + 0.3, boardHeight + 0.3, BOARD_THICKNESS + 0.02)]} />
          <lineBasicMaterial color="#4444ff" linewidth={3} />
        </lineSegments>
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
      {(() => {
        // Get the display name: prefer studentName, fallback to ownerName
        // Only show if we have a valid name (not empty, "Anonymous", or "Uploaded Board")
        const displayName = (board.studentName && board.studentName !== 'Anonymous' && board.studentName !== 'Uploaded Board'
          ? board.studentName 
          : (board.ownerName && board.ownerName !== 'Anonymous' && board.ownerName !== 'Uploaded Board' ? board.ownerName : null))
        
        return isHovered && displayName && !isDragging ? (
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
              {displayName}
            </div>
          </Html>
        ) : null
      })()}

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
    </group>
  )
}