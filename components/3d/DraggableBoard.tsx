'use client'

const isDev = process.env.NODE_ENV === 'development'
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args) }

import { useRef, useState, useEffect, useCallback } from 'react'
import { useThree, ThreeEvent } from '@react-three/fiber'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
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
  /** Same wall-local rotation for pointer→(x,y) so front and back use same coords (avoids inversion). */
  wallBaseRotationForCoords?: number
  wallDimensions: { width: number; height: number }
  side?: 'front' | 'back'
  initialLocalPosition?: { x: number; y: number; width?: number; height?: number }
  onDragEnd: (boardId: string, localX: number, localY: number, width?: number, height?: number, side?: 'front' | 'back') => void
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
  
  // Use Suspense for texture loading - this handles the loading state properly
  const texture = useTexture(imageUrl)
  
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
  
  return <meshStandardMaterial map={texture} side={THREE.DoubleSide} />
}

export function DraggableBoard({
  board,
  wallIndex,
  wallPosition,
  wallRotation,
  wallBaseRotationForCoords,
  wallDimensions,
  side = 'front',
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
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
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
  const innerGroupRef = useRef<THREE.Group>(null)
  const [localPosition, setLocalPosition] = useState(initialLocalPosition)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef<{
    anchorX: number
    anchorY: number
    initialCornerX: number
    initialCornerY: number
    initialWidth: number
    initialHeight: number
  } | null>(null)
  
  // Debug logging for delete button visibility
  useEffect(() => {
    if (isHovered) {
      devLog('🔍 [DraggableBoard] Hover state:', {
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
  const lastPointerRef = useRef<{ clientX: number; normalizedX: number }>({ clientX: 0, normalizedX: initialLocalPosition.x })
  
  // Track if we just finished dragging to avoid resetting position
  const justFinishedDragging = useRef(false)
  
 // Sync position when props change (but not right after we finished dragging)
useEffect(() => {
  if (justFinishedDragging.current) {
    // 🎯 Keep the flag set for 2 seconds to give save time to complete
    const timer = setTimeout(() => {
      justFinishedDragging.current = false
      devLog('📍 [DraggableBoard] Re-enabled position sync after drag')
    }, 2000)
    return () => clearTimeout(timer)
  }
  if (isResizing) return
  
  if (!isDragging) {
    // Only sync if position actually changed from external source
    const propsPos = initialLocalPosition
    const currentPos = positionRef.current
    
    // Use a small epsilon for comparison (floating point tolerance)
    const epsilon = 0.001
    const xChanged = Math.abs(propsPos.x - currentPos.x) > epsilon
    const yChanged = Math.abs(propsPos.y - currentPos.y) > epsilon
    
    if (xChanged || yChanged) {
      devLog('📍 Syncing position from props:', propsPos)
      positionRef.current = propsPos
      setLocalPosition(propsPos)
    }
  }
}, [initialLocalPosition.x, initialLocalPosition.y, isDragging, isResizing])
  
  devLog('🎨 [DraggableBoard] Rendering board:', board.id, 'at position:', localPosition)
  
  const { camera, gl, raycaster } = useThree()
  
  // Scene scale: 1 unit = 1 inch
  // So an 8ft × 10ft wall = 96 × 120 units
  const SCALE = 12 // Convert feet to inches (1 ft = 12 inches)
  const scaledWallWidth = wallDimensions.width * SCALE
  const scaledWallHeight = wallDimensions.height * SCALE
  const isBackSide = side === 'back'
  const renderXSign = isBackSide ? -1 : 1
  
  // Calculate board size: prefer saved resize (width/height %) so corner resize is visible; else physical dimensions or defaults
  const wallWidthInches = wallDimensions.width * 12
  const wallHeightInches = wallDimensions.height * 12
  let boardWidth: number | undefined
  let boardHeight: number | undefined

  // Prefer saved percentage dimensions when present (user has resized or we have placement data)
  if (localPosition.width != null && localPosition.height != null && localPosition.width > 0 && localPosition.height > 0) {
    boardWidth = localPosition.width * wallWidthInches
    boardHeight = localPosition.height * wallHeightInches
    devLog(`📐 [DraggableBoard] Using saved percentage dimensions: ${(localPosition.width * 100).toFixed(1)}% x ${(localPosition.height * 100).toFixed(1)}% = ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)} units`)
  }
  // Else use physical dimensions if available
  if ((boardWidth === undefined || boardHeight === undefined) && board.physicalWidth && board.physicalHeight) {
    boardWidth = board.physicalWidth
    boardHeight = board.physicalHeight
    boardWidth = Math.min(boardWidth, wallWidthInches)
    boardHeight = Math.min(boardHeight, wallHeightInches)
    devLog(`📐 [DraggableBoard] Using physical dimensions: ${board.physicalWidth}" x ${board.physicalHeight}" = ${boardWidth.toFixed(2)} x ${boardHeight.toFixed(2)} units`)
  }
  // Fallback for existing boards without physical dimensions: default to 8.5×11 inches
  if (boardWidth === undefined || boardHeight === undefined) {
    const DEFAULT_WIDTH_INCHES = 8.5
    const DEFAULT_HEIGHT_INCHES = 11
    boardWidth = DEFAULT_WIDTH_INCHES
    boardHeight = DEFAULT_HEIGHT_INCHES
    devLog(`📐 [DraggableBoard] No dimensions found - using default: ${DEFAULT_WIDTH_INCHES}" x ${DEFAULT_HEIGHT_INCHES}" = ${boardWidth} x ${boardHeight} units`)
  }
  
  // Ensure we have valid dimensions
  if (boardWidth === undefined || boardHeight === undefined || boardWidth <= 0 || boardHeight <= 0) {
    // Final safety fallback
    boardWidth = 8.5
    boardHeight = 11
    console.warn(`⚠️ [DraggableBoard] Invalid dimensions for board ${board.id} - using default 8.5×11"`)
  }

  const updatePosition = (clientX: number, clientY: number) => {
    const rotationForCoords = wallBaseRotationForCoords ?? wallRotation
    const wallNormal = new THREE.Vector3(-Math.sin(rotationForCoords), 0, -Math.cos(rotationForCoords)).normalize()
    const renderRightWorld = new THREE.Vector3(renderXSign, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), wallRotation).normalize()
    const renderUpWorld = new THREE.Vector3(0, 1, 0)
    const plane = new THREE.Plane(wallNormal, 0)
    plane.constant = -wallNormal.dot(wallPosition)

    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
    const intersectionPoint = new THREE.Vector3()

    if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
      const pointOnWall = intersectionPoint.clone().sub(wallPosition)
      const pointerRenderX = pointOnWall.dot(renderRightWorld)
      const pointerRenderY = pointOnWall.dot(renderUpWorld)

      const offsetX = dragOffset.current ? dragOffset.current.x : 0
      const offsetY = dragOffset.current ? dragOffset.current.y : 0
      const nextRenderX = pointerRenderX - offsetX
      const nextRenderY = pointerRenderY - offsetY

      const stateX = nextRenderX
      const stateY = nextRenderY

      const normalizedX = THREE.MathUtils.clamp(stateX / scaledWallWidth, -0.5, 0.5)
      const normalizedY = THREE.MathUtils.clamp(stateY / scaledWallHeight, -0.5, 0.5)

      const dxPixels = clientX - lastPointerRef.current.clientX
      const dNorm = normalizedX - lastPointerRef.current.normalizedX
      lastPointerRef.current = { clientX, normalizedX }

      const newPos = {
        x: normalizedX,
        y: normalizedY,
        width: positionRef.current.width,
        height: positionRef.current.height,
      }

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
  // Track the offset from click point to board center (pure wall-local space)
  const dragOffset = useRef<{ x: number; y: number } | null>(null)
  
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    const rotationForCoords = wallBaseRotationForCoords ?? wallRotation
    devLog('🖱️ POINTER DOWN on board:', board.id)
    devLog('🖱️ onDragEnd function exists:', typeof onDragEnd === 'function')
    e.stopPropagation()
    
    // Store initial position to detect if this is a drag or just a click
    dragStartPosition.current = { x: e.clientX, y: e.clientY }
    lastPointerRef.current = { clientX: e.clientX, normalizedX: positionRef.current.x }
    
      justFinishedDragging.current = false
    // Calculate offset from click point to board center (in local board space)
if (e.intersections && e.intersections.length > 0) {
  const intersection = e.intersections[0]
  const worldClickPoint = intersection.point
  
  // Calculate current board position in world space
  const currentBoardX = localPosition.x * scaledWallWidth
  const currentBoardY = localPosition.y * scaledWallHeight
  // Same Z as render: always 3.2 in edit view (group +Z is toward camera)
  const currentBoardZ = 3.2
  
  // Transform to board's local space (accounting for wall rotation and position)
  const boardWorldPosition = new THREE.Vector3(
    wallPosition.x + currentBoardX,
    wallPosition.y + currentBoardY,
    wallPosition.z + currentBoardZ
  )

  // Compute rotated board center in world space to validate against actual mesh position
  const boardOffset = new THREE.Vector3(currentBoardX, currentBoardY, currentBoardZ)
  const meshWorldCenter = new THREE.Vector3()
  if (meshRef.current) {
    meshRef.current.getWorldPosition(meshWorldCenter)
  }
  const rotatedBoardOffset = boardOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationForCoords)
  const rotatedBoardWorldPosition = rotatedBoardOffset.clone().add(wallPosition)
  const boardCenterWorld = meshRef.current
    ? meshWorldCenter.clone() // use actual mesh center when available
    : rotatedBoardWorldPosition

  // Get the offset from board center to click point in world space
  const offset = new THREE.Vector3()
  offset.copy(worldClickPoint).sub(boardCenterWorld)
  
  // Rotate offset to board's local space (inverse of wall rotation)
  const cosR = Math.cos(-rotationForCoords)
  const sinR = Math.sin(-rotationForCoords)
  const localOffsetX = offset.x * cosR - offset.z * sinR
  const localOffsetY = offset.y
  const renderLocalOffsetX = isBackSide ? -localOffsetX : localOffsetX
  const renderRightWorld = new THREE.Vector3(renderXSign, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), wallRotation).normalize()
  const renderUpWorld = new THREE.Vector3(0, 1, 0)

  // If click is near a corner and board is selected, start resize (proportional) instead of drag
  if (isSelected && canEdit && !isLocked) {
    const cornerMargin = 0.15 * Math.min(boardWidth, boardHeight)
    const inCorner =
      Math.abs(renderLocalOffsetX) > boardWidth / 2 - cornerMargin &&
      Math.abs(localOffsetY) > boardHeight / 2 - cornerMargin
    if (inCorner) {
      const cornerIndex = localOffsetY > 0 ? (renderLocalOffsetX > 0 ? 0 : 1) : (renderLocalOffsetX > 0 ? 3 : 2)
      handleCornerPointerDown(e, cornerIndex)
      return
    }
  }
  
  // Store offset in render-space so click anchor and drag use identical coordinates.
  const clickOnWall = worldClickPoint.clone().sub(wallPosition)
  const pointerRenderX = clickOnWall.dot(renderRightWorld)
  const pointerRenderY = clickOnWall.dot(renderUpWorld)
  const boardCenterOnWall = boardCenterWorld.clone().sub(wallPosition)
  const boardRenderX = boardCenterOnWall.dot(renderRightWorld)
  const boardRenderY = boardCenterOnWall.dot(renderUpWorld)
  dragOffset.current = {
    x: pointerRenderX - boardRenderX,
    y: pointerRenderY - boardRenderY
  }
  
  devLog('📍 Drag offset calculated (render-space):', dragOffset.current)
      
      devLog('📍 Drag offset calculated:', dragOffset.current, 'board size:', boardWidth, boardHeight)
    } else {
      // Fallback: no offset if we can't calculate it
      dragOffset.current = { x: 0, y: 0 }
    }
    
    // Prevent dragging if board is locked
    if (isLocked) {
      devLog('🔒 Board is locked - cannot drag')
      return
    }
    
    // Deselect board when starting to drag
    if (onDeselect && isSelected) {
      devLog('🖱️ [DraggableBoard] Deselecting board because drag started')
      onDeselect()
    }
    
    setIsDragging(true)
    gl.domElement.style.cursor = 'grabbing'
    devLog('🖱️ isDragging set to true, attaching global listeners...')
    
    // Start listening to window events
    const handleMove = (e: PointerEvent) => {
      updatePosition(e.clientX, e.clientY)
    }
    
    const handleUp = (e: PointerEvent) => {
      devLog('🖱️🖱️🖱️ POINTER UP FIRED! board:', board.id)
      devLog('🖱️🖱️🖱️ Current positionRef:', JSON.stringify(positionRef.current))
      gl.domElement.style.cursor = 'grab'
      
      // Check if this was a click (no significant movement) or a drag
      const wasClick = dragStartPosition.current && 
        Math.abs(e.clientX - dragStartPosition.current.x) < 5 && 
        Math.abs(e.clientY - dragStartPosition.current.y) < 5
      
      devLog('🖱️ [DraggableBoard] Pointer up - wasClick:', wasClick, 'onSelect exists:', !!onSelect, 'movement:', dragStartPosition.current ? {
        x: Math.abs(e.clientX - dragStartPosition.current.x),
        y: Math.abs(e.clientY - dragStartPosition.current.y)
      } : 'no start pos')
      
      // If it was just a click (no significant movement), select the board
      // wasClick being true means there was minimal movement, so it's a click, not a drag
      if (wasClick && onSelect) {
        devLog('🖱️ Click detected (not drag) - selecting board:', board.id)
        onSelect()
      }
      
      // Mark that we just finished dragging to prevent sync from resetting position
      justFinishedDragging.current = true
      
      // Call onDragEnd with ref value (NOT state)
      const finalPos = positionRef.current
      const persistedPos = finalPos
      devLog('🎯🎯🎯 DRAG END - Calling onDragEnd with:', {
        boardId: board.id,
        x: persistedPos.x,
        y: persistedPos.y,
        width: persistedPos.width,
        height: persistedPos.height,
        side
      })
      
      // Update parent state - use REF to get latest callback (avoids stale closure)
      try {
        devLog('🎯🎯🎯 Calling onDragEndRef.current...')
        onDragEndRef.current(board.id, persistedPos.x, persistedPos.y, persistedPos.width, persistedPos.height, side)
        devLog('🎯🎯🎯 onDragEnd called successfully!')

         // 🎯 CRITICAL: Update local state immediately to prevent reset
    setLocalPosition(finalPos)
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
  
  // In edit mode the group is always oriented so +Z points toward the camera (front uses wallRotation, back uses wallRotation+π).
  // Place boards at +3.2 so they sit in front of the wall center and are visible.
  const boardZ = 3.2
  // Back side edit view is camera-mirrored relative to wall-local X; flip only render X in edit mode.
  const boardXRender = boardSide === 'back' ? -boardX : boardX

  const coordRotation = wallBaseRotationForCoords ?? wallRotation

  // Get pointer position on the wall plane (world space) for corner resize – use coordRotation so (x,y) is consistent for front/back
  const getPointerOnWallPlane = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    const wallNormal = new THREE.Vector3(-Math.sin(coordRotation), 0, -Math.cos(coordRotation)).normalize()
    const plane = new THREE.Plane(wallNormal, 0)
    plane.constant = -wallNormal.dot(wallPosition)
    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
    const point = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, point) ? point : null
  }, [camera, gl, raycaster, wallPosition, coordRotation])

  // Convert world point on wall plane to wall-local 2D (inches from wall origin) – use coordRotation so front/back share same coords
  const worldToWallLocal = useCallback((worldPoint: THREE.Vector3): { x: number; y: number } => {
    const offset = worldPoint.clone().sub(wallPosition)
    const wallRight = new THREE.Vector3(Math.cos(coordRotation), 0, -Math.sin(coordRotation))
    const wallUp = new THREE.Vector3(0, 1, 0)
    return { x: offset.dot(wallRight), y: offset.dot(wallUp) }
  }, [wallPosition, coordRotation])

  const handleCornerPointerDown = useCallback((e: ThreeEvent<PointerEvent>, cornerIndex: number) => {
    e.stopPropagation()
    if (isLocked) return
    const ptr = getPointerOnWallPlane(e.clientX, e.clientY)
    if (!ptr) return
    const cx = positionRef.current.x * scaledWallWidth
    const cy = positionRef.current.y * scaledWallHeight
    const w = positionRef.current.width ?? 0.3
    const h = positionRef.current.height ?? 0.3
    const halfW = (w * wallWidthInches) / 2
    const halfH = (h * wallHeightInches) / 2
    // Corner positions in wall-local: 0=TR, 1=TL, 2=BL, 3=BR
    const corners: { x: number; y: number }[] = [
      { x: cx + halfW, y: cy + halfH },
      { x: cx - halfW, y: cy + halfH },
      { x: cx - halfW, y: cy - halfH },
      { x: cx + halfW, y: cy - halfH },
    ]
    const anchorIndex = (cornerIndex + 2) % 4
    const anchor = corners[anchorIndex]
    const initialCorner = corners[cornerIndex]
    const initialDiagonal = Math.hypot(initialCorner.x - anchor.x, initialCorner.y - anchor.y)
    if (initialDiagonal < 1) return
    const MIN_SIZE = 0.05
    const MAX_SIZE = 1
    resizeStartRef.current = { anchorX: anchor.x, anchorY: anchor.y, initialCornerX: initialCorner.x, initialCornerY: initialCorner.y, initialWidth: w, initialHeight: h }
    setIsResizing(true)
    gl.domElement.style.cursor = cornerIndex % 2 === 0 ? 'nwse-resize' : 'nesw-resize'
    const onMove = (ev: PointerEvent) => {
      const p = getPointerOnWallPlane(ev.clientX, ev.clientY)
      if (!p || !resizeStartRef.current) return
      const newCorner = worldToWallLocal(p)
      const ax = resizeStartRef.current.anchorX
      const ay = resizeStartRef.current.anchorY
      const dx = newCorner.x - ax
      const dy = newCorner.y - ay
      const dirX = (initialCorner.x - ax) / initialDiagonal
      const dirY = (initialCorner.y - ay) / initialDiagonal
      const projectedLength = dx * dirX + dy * dirY
      const scale = Math.max(0.01, projectedLength / initialDiagonal)
      let newW = resizeStartRef.current.initialWidth * scale
      let newH = resizeStartRef.current.initialHeight * scale
      newW = THREE.MathUtils.clamp(newW, MIN_SIZE, MAX_SIZE)
      newH = THREE.MathUtils.clamp(newH, MIN_SIZE, MAX_SIZE)
      const newCornerX = ax + dirX * initialDiagonal * scale
      const newCornerY = ay + dirY * initialDiagonal * scale
      const newCenterX = (ax + newCornerX) / 2
      const newCenterY = (ay + newCornerY) / 2
      const newX = newCenterX / wallWidthInches
      const newY = newCenterY / wallHeightInches
      positionRef.current = { ...positionRef.current, x: newX, y: newY, width: newW, height: newH }
      setLocalPosition(prev => ({ ...prev, x: newX, y: newY, width: newW, height: newH }))
    }
    const onUp = () => {
      gl.domElement.style.cursor = 'default'
      const ref = positionRef.current
      justFinishedDragging.current = true
      setLocalPosition({ x: ref.x, y: ref.y, width: ref.width, height: ref.height })
      onDragEnd(board.id, ref.x, ref.y, ref.width, ref.height, side)
      resizeStartRef.current = null
      setIsResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [board.id, getPointerOnWallPlane, gl, isLocked, onDragEnd, scaledWallHeight, scaledWallWidth, side, wallHeightInches, wallWidthInches, worldToWallLocal])
  
  devLog(`🧱 DraggableBoard on wall: rotation=${wallRotation.toFixed(2)}, side=${boardSide}, boardZ=${boardZ}`)
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
      devLog('🖼️ [DraggableBoard] Rendering board with image:', board.id, imageUrl)
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
      <group ref={innerGroupRef} position={[boardXRender, boardY, boardZ]}>
        <mesh
          ref={meshRef}
          onPointerDown={handlePointerDown}
          onClick={(e) => {
            // Stop propagation so the invisible wall plane doesn't get the click
            e.stopPropagation()
            
            // Select the board when clicked
            if (onSelect) {
              onSelect()
            }
          }}
          // Make sure boards render in front of the invisible wall plane
          renderOrder={1}
          onPointerOver={(e) => {
            e.stopPropagation()
            setIsHovered(true)
            if (!isDragging && !isResizing) {
              gl.domElement.style.cursor = isLocked ? 'not-allowed' : 'grab'
            }
          }}
          onPointerMove={(e) => {
            e.stopPropagation()
            if (!e.intersections?.length || isDragging || isResizing) return
            const rotationForCoords = wallBaseRotationForCoords ?? wallRotation
            const worldPoint = e.intersections[0].point
            const center = new THREE.Vector3()
            meshRef.current?.getWorldPosition(center)
            const offset = worldPoint.clone().sub(center)
            const cosR = Math.cos(-rotationForCoords)
            const sinR = Math.sin(-rotationForCoords)
            const localX = offset.x * cosR - offset.z * sinR
            const localY = offset.y
            const renderLocalX = isBackSide ? -localX : localX
            const cornerMargin = 0.15 * Math.min(boardWidth, boardHeight)
            const nearCorner =
              Math.abs(renderLocalX) > boardWidth / 2 - cornerMargin &&
              Math.abs(localY) > boardHeight / 2 - cornerMargin
            if (isSelected && canEdit && nearCorner) {
              // Use different diagonal cursors so left/right corners feel correct
              // Right-side corners → ↘↖ (nwse-resize), left-side corners → ↙↗ (nesw-resize)
              const isRightSide = renderLocalX > 0
              gl.domElement.style.cursor = isRightSide ? 'nwse-resize' : 'nesw-resize'
            } else if (!isDragging) {
              gl.domElement.style.cursor = isLocked ? 'not-allowed' : 'grab'
            }
          }}
          onPointerOut={(e) => {
            e.stopPropagation()
            setIsHovered(false)
            if (!isDragging && !isResizing) gl.domElement.style.cursor = 'default'
          }}
        >
          {/* Use boxGeometry instead of planeGeometry to give boards thickness */}
          <boxGeometry args={[boardWidth, boardHeight, BOARD_THICKNESS]} />
          {isPDF ? (
            <Suspense fallback={<meshStandardMaterial color="#f3f4f6" />}>
              <PDFTextureMaterial pdfUrl={imageUrl} hovered={isHovered} />
            </Suspense>
          ) : hasImage ? (
            <Suspense fallback={<meshStandardMaterial color="#94a3b8" opacity={0.9} transparent />}>
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

        {/* Border edges for the box geometry - no raycast so mesh gets pointer events at edges/corners */}
        <lineSegments position={[0, 0, 0]} raycast={() => null}>
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
        
        {/* Additional thicker border for selected state - no raycast so mesh gets pointer events */}
        {isSelected && (
          <lineSegments position={[0, 0, 0]} raycast={() => null}>
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
              ��
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
                devLog('💬 [Comment Bubble] Clicked for board:', board.id)
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