'use client'

const isDev = process.env.NODE_ENV === 'development'
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args) }

import { useRef, useState, useEffect, useCallback } from 'react'
import { useThree, ThreeEvent } from '@react-three/fiber'
import { supabase } from '@/lib/supabase/client'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import * as THREE from 'three'
import type { Board } from '@/types'
import { Suspense } from 'react'
import { Text, Html } from '@react-three/drei'
import { PDFTextureMaterial } from './PDFTexture'
import { useBoardTexture } from './useBoardTexture'
import { toast } from '@/lib/toast'

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

function BoardTextureMaterial({ imageUrl }: { imageUrl: string }) {
  // Hold the previous texture in state until the new URL resolves — no gray flash on URL swap.
  const { texture, isInitialLoad } = useBoardTexture(imageUrl)
  if (texture) {
    return <meshStandardMaterial map={texture} side={THREE.DoubleSide} />
  }
  if (isInitialLoad) {
    return <meshStandardMaterial color="#eef0f8" roughness={0.85} side={THREE.DoubleSide} />
  }
  return <meshStandardMaterial color="#ffffff" side={THREE.DoubleSide} />
}

export function DraggableBoard({
  board,
  wallIndex: _wallIndex,
  wallPosition,
  wallRotation,
  wallBaseRotationForCoords,
  wallDimensions,
  side = 'front',
  initialLocalPosition = { x: 0, y: 0 },
  onDragEnd,
  onDelete: _onDelete,
  onCommentClick,
  onSelect,
  onDeselect,
  isSelected = false,
  workspaceId: _workspaceId,
  isWorkspaceMember = false
}: DraggableBoardProps) {
  const [user, setUser] = useState<User | null>(null)
  
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

  // Pre-allocated scratch objects for updatePosition — avoids per-event allocation at 60fps
  const _wallNormal = useRef(new THREE.Vector3())
  const _renderRightWorld = useRef(new THREE.Vector3())
  const _plane = useRef(new THREE.Plane())
  const _ndcVec = useRef(new THREE.Vector2())
  const _intersectionPoint = useRef(new THREE.Vector3())
  const _axisY = useRef(new THREE.Vector3(0, 1, 0))
  const _pointOnWall = useRef(new THREE.Vector3())

  // Track active drag/resize window listeners so we can remove them on unmount
  const dragListenersRef = useRef<{
    move: ((e: PointerEvent) => void) | null
    up: ((e: PointerEvent) => void) | null
  }>({ move: null, up: null })
  const resizeListenersRef = useRef<{
    move: ((e: PointerEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })

  // Remove any lingering window listeners when the component unmounts mid-drag/resize
  useEffect(() => {
    return () => {
      if (dragListenersRef.current.move) window.removeEventListener('pointermove', dragListenersRef.current.move)
      if (dragListenersRef.current.up) window.removeEventListener('pointerup', dragListenersRef.current.up)
      if (resizeListenersRef.current.move) window.removeEventListener('pointermove', resizeListenersRef.current.move)
      if (resizeListenersRef.current.up) window.removeEventListener('pointerup', resizeListenersRef.current.up)
    }
  }, [])

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
    const rawWidth = board.physicalWidth
    const rawHeight = board.physicalHeight
    const fitScale = Math.min(wallWidthInches / rawWidth, wallHeightInches / rawHeight, 1)
    boardWidth = rawWidth * fitScale
    boardHeight = rawHeight * fitScale
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

    // Reuse pre-allocated scratch objects — no heap allocation on the hot drag path
    _wallNormal.current.set(-Math.sin(rotationForCoords), 0, -Math.cos(rotationForCoords)).normalize()
    _renderRightWorld.current.set(renderXSign, 0, 0).applyAxisAngle(_axisY.current, wallRotation).normalize()
    _plane.current.setFromNormalAndCoplanarPoint(_wallNormal.current, wallPosition)

    const rect = gl.domElement.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    _ndcVec.current.set(ndcX, ndcY)
    raycaster.setFromCamera(_ndcVec.current, camera)

    if (raycaster.ray.intersectPlane(_plane.current, _intersectionPoint.current)) {
      _pointOnWall.current.copy(_intersectionPoint.current).sub(wallPosition)
      const pointerRenderX = _pointOnWall.current.dot(_renderRightWorld.current)
      const pointerRenderY = _pointOnWall.current.y

      const offsetX = dragOffset.current ? dragOffset.current.x : 0
      const offsetY = dragOffset.current ? dragOffset.current.y : 0

      const normalizedX = THREE.MathUtils.clamp((pointerRenderX - offsetX) / scaledWallWidth, -0.5, 0.5)
      const normalizedY = THREE.MathUtils.clamp((pointerRenderY - offsetY) / scaledWallHeight, -0.5, 0.5)

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

  // World-space basis vectors used to project the click point into the same render-space as drag updates.
  const renderRightWorld = new THREE.Vector3(renderXSign, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), wallRotation).normalize()
  const renderUpWorld = new THREE.Vector3(0, 1, 0)

  // Corner resize is now handled by dedicated invisible handle meshes (rendered below);
  // clicks on the board body always start a drag-to-move.

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
      dragListenersRef.current = { move: null, up: null }
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    
    dragListenersRef.current = { move: handleMove, up: handleUp }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
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

  // Corner indexing: 0=TR, 1=TL, 2=BL, 3=BR. Anchor = opposite corner ((i+2) % 4).
  // Default behaviour is proportional resize (locks the image aspect ratio via diagonal projection);
  // holding Shift switches to free resize (independent width/height).
  // Persists via PATCH /api/boards/[id]/position on pointer-up; rolls back local state if the request fails.
  const handleCornerPointerDown = useCallback((
    e: ThreeEvent<PointerEvent>,
    cornerIndex: number,
    resizeCursor: 'nwse-resize' | 'nesw-resize'
  ) => {
    e.stopPropagation()
    if (isLocked) return
    const ptr = getPointerOnWallPlane(e.clientX, e.clientY)
    if (!ptr) return
    const cx = positionRef.current.x * scaledWallWidth
    const cy = positionRef.current.y * scaledWallHeight
    const w0 = positionRef.current.width ?? 0.3
    const h0 = positionRef.current.height ?? 0.3
    const halfW = (w0 * wallWidthInches) / 2
    const halfH = (h0 * wallHeightInches) / 2
    const corners: { x: number; y: number }[] = [
      { x: cx + halfW, y: cy + halfH }, // 0 TR
      { x: cx - halfW, y: cy + halfH }, // 1 TL
      { x: cx - halfW, y: cy - halfH }, // 2 BL
      { x: cx + halfW, y: cy - halfH }, // 3 BR
    ]
    const anchorIndex = (cornerIndex + 2) % 4
    const anchor = corners[anchorIndex]
    const initialCorner = corners[cornerIndex]
    const initialDiagonal = Math.hypot(initialCorner.x - anchor.x, initialCorner.y - anchor.y)
    if (initialDiagonal < 1) return
    const dirSignX = Math.sign(initialCorner.x - anchor.x) || 1
    const dirSignY = Math.sign(initialCorner.y - anchor.y) || 1
    const dirNormX = (initialCorner.x - anchor.x) / initialDiagonal
    const dirNormY = (initialCorner.y - anchor.y) / initialDiagonal

    const MIN_PCT = 0.05
    const MAX_PCT = 1
    const MIN_INCHES_W = MIN_PCT * wallWidthInches
    const MIN_INCHES_H = MIN_PCT * wallHeightInches
    const MAX_INCHES_W = MAX_PCT * wallWidthInches
    const MAX_INCHES_H = MAX_PCT * wallHeightInches

    // Snapshot for rollback if the API save fails.
    const priorPosition = { x: positionRef.current.x, y: positionRef.current.y, width: w0, height: h0 }

    resizeStartRef.current = { anchorX: anchor.x, anchorY: anchor.y, initialCornerX: initialCorner.x, initialCornerY: initialCorner.y, initialWidth: w0, initialHeight: h0 }
    setIsResizing(true)
    // Cursor is set on the WebGL canvas element — document.body's cursor is overridden by the canvas's own
    // computed style, so it never shows up over the 3D scene.
    gl.domElement.style.cursor = resizeCursor

    // Track shift mid-drag so the user can toggle the resize mode without restarting.
    // Default = proportional (locks aspect ratio). Shift held = free resize.
    const shiftHeldRef = { current: e.shiftKey }
    const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === 'Shift') shiftHeldRef.current = true }
    const onKeyUp = (ev: KeyboardEvent) => { if (ev.key === 'Shift') shiftHeldRef.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const onMove = (ev: PointerEvent) => {
      const p = getPointerOnWallPlane(ev.clientX, ev.clientY)
      if (!p || !resizeStartRef.current) return
      const pointerWall = worldToWallLocal(p)
      const ax = resizeStartRef.current.anchorX
      const ay = resizeStartRef.current.anchorY

      let newW: number
      let newH: number
      let newCornerX: number
      let newCornerY: number

      if (shiftHeldRef.current) {
        // Shift held = free resize: width and height move independently with the pointer.
        const dxInches = (pointerWall.x - ax) * dirSignX
        const dyInches = (pointerWall.y - ay) * dirSignY
        const widthInches = THREE.MathUtils.clamp(dxInches, MIN_INCHES_W, MAX_INCHES_W)
        const heightInches = THREE.MathUtils.clamp(dyInches, MIN_INCHES_H, MAX_INCHES_H)
        newW = widthInches / wallWidthInches
        newH = heightInches / wallHeightInches
        newCornerX = ax + dirSignX * widthInches
        newCornerY = ay + dirSignY * heightInches
      } else {
        // Default = locked aspect ratio: project pointer displacement onto the diagonal, scale both axes equally.
        const dx = pointerWall.x - ax
        const dy = pointerWall.y - ay
        const projectedLength = dx * dirNormX + dy * dirNormY
        const rawScale = Math.max(0.01, projectedLength / initialDiagonal)
        const initialW = resizeStartRef.current.initialWidth
        const initialH = resizeStartRef.current.initialHeight
        const minScale = Math.max(MIN_PCT / initialW, MIN_PCT / initialH)
        const maxScale = Math.min(MAX_PCT / initialW, MAX_PCT / initialH)
        const scale = THREE.MathUtils.clamp(rawScale, minScale, maxScale)
        newW = initialW * scale
        newH = initialH * scale
        newCornerX = ax + dirNormX * initialDiagonal * scale
        newCornerY = ay + dirNormY * initialDiagonal * scale
      }

      const newCenterX = (ax + newCornerX) / 2
      const newCenterY = (ay + newCornerY) / 2
      const newX = newCenterX / wallWidthInches
      const newY = newCenterY / wallHeightInches
      positionRef.current = { ...positionRef.current, x: newX, y: newY, width: newW, height: newH }
      setLocalPosition(prev => ({ ...prev, x: newX, y: newY, width: newW, height: newH }))
    }

    const onUp = () => {
      // Reset both possible cursor targets in case pointer-up fires off-handle.
      document.body.style.cursor = ''
      gl.domElement.style.cursor = ''
      const ref = positionRef.current
      justFinishedDragging.current = true
      setLocalPosition({ x: ref.x, y: ref.y, width: ref.width, height: ref.height })

      // Persist via PATCH on the dedicated position endpoint.
      const apiX = (ref.x + 0.5) * 100
      const apiY = (ref.y + 0.5) * 100
      const apiWidth = (ref.width ?? 0.3) * 100
      const apiHeight = (ref.height ?? 0.3) * 100
      const isMockBoard =
        board.id.startsWith('temp-') ||
        board.id.startsWith('demo-') ||
        board.id.startsWith('sample-')
      if (!isMockBoard) {
        fetch(`/api/boards/${board.id}/position`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallIndex: _wallIndex,
            x: apiX,
            y: apiY,
            width: apiWidth,
            height: apiHeight,
            side,
          }),
        })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
          })
          .catch(err => {
            console.error('❌ [DraggableBoard] Resize PATCH failed:', err)
            // Roll back to the position the board had before this resize started.
            positionRef.current = { ...positionRef.current, ...priorPosition }
            setLocalPosition(prev => ({ ...prev, ...priorPosition }))
            toast.error('Failed to save board size. Please try again.')
          })
      }

      resizeStartRef.current = null
      setIsResizing(false)
      resizeListenersRef.current = { move: null, up: null }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }

    resizeListenersRef.current = { move: onMove, up: onUp }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [board.id, _wallIndex, getPointerOnWallPlane, gl, isLocked, scaledWallHeight, scaledWallWidth, side, wallHeightInches, wallWidthInches, worldToWallLocal])
  
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
            if (isDragging || isResizing) return
            // Corner resize cursors are owned by the dedicated handle meshes; the board body
            // shows the move cursor whenever the pointer is over it.
            gl.domElement.style.cursor = isLocked ? 'not-allowed' : 'grab'
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
            <BoardTextureMaterial imageUrl={imageUrl} />
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

        {/*
         * Corner resize handles. Invisible meshes at each corner; pointer-active.
         * Set document.body.style.cursor on hover; on pointer-down start a resize drag.
         * Render only when this user can edit (locked boards have no handles).
         * The board body still owns drag-to-move; these handles intercept their own pointer events.
         */}
        {canEdit && !isLocked && (() => {
          const handleSize = Math.max(2, Math.min(boardWidth, boardHeight) * 0.12)
          // 0=TR, 1=TL, 2=BL, 3=BR — must match the indexing in handleCornerPointerDown.
          // Local-mesh X axis. On the back side the inner group is camera-mirrored, so the handle
          // meshes need to mirror too — flip render X using the same renderXSign as the board.
          const corners: Array<{ index: number; localX: number; y: number; cursor: 'nwse-resize' | 'nesw-resize' }> = [
            // TR: top-right in wall-local; render flips for back side.
            { index: 0, localX: boardWidth / 2, y: boardHeight / 2, cursor: 'nesw-resize' },
            // TL
            { index: 1, localX: -boardWidth / 2, y: boardHeight / 2, cursor: 'nwse-resize' },
            // BL
            { index: 2, localX: -boardWidth / 2, y: -boardHeight / 2, cursor: 'nesw-resize' },
            // BR
            { index: 3, localX: boardWidth / 2, y: -boardHeight / 2, cursor: 'nwse-resize' },
          ]
          return corners.map(({ index, localX, y, cursor }) => (
            <mesh
              key={`corner-${index}`}
              position={[isBackSide ? -localX : localX, y, BOARD_THICKNESS / 2 + 0.01]}
              renderOrder={2}
              onPointerOver={(e) => {
                e.stopPropagation()
                gl.domElement.style.cursor = cursor
              }}
              // R3F dispatches pointermove to every intersected object front-to-back; without this,
              // the board mesh's own onPointerMove fires next and overwrites the cursor with 'grab'.
              onPointerMove={(e) => {
                e.stopPropagation()
                gl.domElement.style.cursor = cursor
              }}
              onPointerOut={(e) => {
                e.stopPropagation()
                if (!isResizing) gl.domElement.style.cursor = ''
              }}
              onPointerDown={(e) => {
                handleCornerPointerDown(e, index, cursor)
              }}
            >
              <boxGeometry args={[handleSize, handleSize, BOARD_THICKNESS + 0.02]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          ))
        })()}

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