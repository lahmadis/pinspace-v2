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
import { getBoardSizeInches } from '@/lib/boardDimensions'

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
  /**
   * Pushed on every rotate-handle pointer-move so the parent can mirror the
   * current rotation into placedBoards3D — that's where Save & Exit reads
   * from when bulk-saving the wall (handleEditComplete in StudioRoom).
   * Without this, the rotate-end PATCH (the only fetch that sends rotation)
   * is the sole source of persistence and there's no fallback.
   */
  onRotationChange?: (boardId: string, rotation: number) => void
  /**
   * Pushed on rotate-handle / corner-resize PATCH success so the parent can
   * mirror the server-acked rotation into useBoardState.boards. That's the
   * array WallSystem reads from once edit mode exits — without this, the
   * scene re-reads the pre-rotation value and visually reverts the rotation
   * even though the DB has the new value.
   */
  onRotationPersisted?: (boardId: string, rotation: number) => void
  /**
   * Pushed on corner-resize PATCH success so the parent can mirror the
   * server-acked absolute size (inches) into useBoardState.boards. That's the
   * array WallSystem reads from once edit mode exits — without this, the scene
   * re-reads the pre-resize size and visually reverts the resize. Symmetric
   * with onRotationPersisted.
   */
  onSizePersisted?: (boardId: string, widthIn: number, heightIn: number) => void
  onDelete: (boardId: string) => void
  onCommentClick?: (board: Board) => void
  onSelect?: () => void
  onDeselect?: () => void
  isSelected?: boolean
  workspaceId?: string // Workspace/studio ID to check membership
  isWorkspaceMember?: boolean // Whether user is a member of the workspace
}

/**
 * CSS cursor for the rotate handles. There's no built-in rotate cursor, so we
 * inline a small SVG (curved arrow) as a data URL. Hotspot is the center (12 12)
 * of the 24x24 image so the curve sits where the user is pointing.
 */
const ROTATE_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21 12a9 9 0 1 1-3-6.7'/><polyline points='21,3 21,9 15,9'/></svg>\") 12 12, auto"

type ResizeCursor = 'ns-resize' | 'ew-resize' | 'nwse-resize' | 'nesw-resize'

/**
 * Pick the resize cursor that matches a rotated corner's actual screen-space diagonal.
 * `localDirX`/`localDirY` are the unrotated corner direction signs (TR = +1,+1 etc.);
 * `rotation` is the board's rotation in radians (matches the value applied as rotation.z).
 * The corner direction is rotated, then snapped to the nearest 45° to pick a cursor.
 */
function pickResizeCursorForRotatedCorner(
  localDirX: number,
  localDirY: number,
  rotation: number
): ResizeCursor {
  const cosR = Math.cos(rotation)
  const sinR = Math.sin(rotation)
  const worldX = cosR * localDirX - sinR * localDirY
  const worldY = sinR * localDirX + cosR * localDirY
  const angle = Math.atan2(worldY, worldX)
  const norm = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  // 0=E, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE
  const snapped = Math.round(norm / (Math.PI / 4)) % 8
  switch (snapped) {
    case 0:
    case 4:
      return 'ew-resize'
    case 2:
    case 6:
      return 'ns-resize'
    case 1:
    case 5:
      return 'nesw-resize'
    case 3:
    case 7:
      return 'nwse-resize'
    default:
      return 'nwse-resize'
  }
}

function BoardTextureMaterial({ imageUrl }: { imageUrl: string }) {
  // Hold the previous texture in state until the new URL resolves — no gray flash on URL swap.
  const { texture, isInitialLoad } = useBoardTexture(imageUrl)
  if (texture) {
    return <meshStandardMaterial map={texture} side={THREE.DoubleSide} />
  }
  if (isInitialLoad) {
    // Subtle "loading" placeholder: transparent + low opacity so the wall shows through. The
    // existing edges geometry on the board mesh provides the outline; this material is just a
    // faint plate. Avoid a pulsing animation here — the edit-mode view is busy enough already.
    return (
      <meshStandardMaterial
        color="#ffffff"
        transparent
        opacity={0.22}
        roughness={0.85}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    )
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
  onRotationChange,
  onRotationPersisted,
  onSizePersisted,
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
  // Absolute board size in inches — the source of truth for size, independent
  // of the wall. Seeded from the board's stored size (board_width_in /
  // board_height_in, with a derived fallback) and updated optimistically during
  // corner-resize. localPosition.width/height still flow through the legacy
  // drag/persist channel but no longer drive rendered size.
  const [sizeIn, setSizeIn] = useState<{ width: number; height: number }>(() => {
    const s = getBoardSizeInches(board)
    return { width: s.widthIn, height: s.heightIn }
  })
  const sizeRef = useRef(sizeIn)
  const isResizingRef = useRef(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  // Rotation in radians around the board's center (rotation.z). Mirrors board.position.rotation
  // when not actively rotating; updated optimistically during rotate-drag.
  const propsRotation = board.position?.rotation ?? board.position_rotation ?? 0
  const [localRotation, setLocalRotation] = useState<number>(propsRotation)
  const rotationRef = useRef<number>(propsRotation)
  const isRotatingRef = useRef(false)
  const [isRotating, setIsRotating] = useState(false)
  // Sync from props when not actively rotating (e.g. another user updated rotation, or initial load).
  useEffect(() => {
    if (!isRotatingRef.current) {
      rotationRef.current = propsRotation
      setLocalRotation(propsRotation)
    }
  }, [propsRotation])

  // Re-sync absolute size from props when the board's stored size changes
  // externally (server ack, another user's resize) and we're not mid-resize.
  useEffect(() => {
    if (isResizingRef.current) return
    const s = getBoardSizeInches(board)
    const next = { width: s.widthIn, height: s.heightIn }
    sizeRef.current = next
    setSizeIn(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.boardWidthIn, board.boardHeightIn, board.physicalWidth, board.physicalHeight, board.aspectRatio])

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
  
  // Wall inches are still used for POSITION (x/y are wall-relative) and as the
  // upper clamp for corner-resize. Board SIZE is absolute (sizeIn), NOT derived
  // from the wall — resizing the wall must not stretch the board.
  const wallWidthInches = wallDimensions.width * 12
  const wallHeightInches = wallDimensions.height * 12
  const boardWidth = sizeIn.width
  const boardHeight = sizeIn.height

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
    resizeCursor: ResizeCursor
  ) => {
    e.stopPropagation()
    if (isLocked) return
    const ptr = getPointerOnWallPlane(e.clientX, e.clientY)
    if (!ptr) return
    const cx = positionRef.current.x * scaledWallWidth
    const cy = positionRef.current.y * scaledWallHeight
    // Size is absolute inches (sizeRef), not a fraction of the wall.
    const w0 = sizeRef.current.width
    const h0 = sizeRef.current.height
    const halfW = w0 / 2
    const halfH = h0 / 2

    // Board-local corner directions (constant per cornerIndex; not affected by rotation).
    // 0=TR(+,+), 1=TL(-,+), 2=BL(-,-), 3=BR(+,-).
    const cornerDirsLocal: Array<{ x: number; y: number }> = [
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 },
    ]

    // Compute the rotated corner positions in wall-local space.
    // The board itself is rotated by `rotationRef.current` around (cx, cy).
    const rot = rotationRef.current
    const cosR = Math.cos(rot)
    const sinR = Math.sin(rot)
    const rotateAroundCenter = (lx: number, ly: number) => ({
      x: cx + cosR * lx - sinR * ly,
      y: cy + sinR * lx + cosR * ly,
    })
    const corners = cornerDirsLocal.map(d => rotateAroundCenter(d.x * halfW, d.y * halfH))

    const anchorIndex = (cornerIndex + 2) % 4
    const anchor = corners[anchorIndex]
    const initialCorner = corners[cornerIndex]
    const initialDiagonal = Math.hypot(initialCorner.x - anchor.x, initialCorner.y - anchor.y)
    if (initialDiagonal < 1) return
    // Direction of the diagonal in WALL-LOCAL space (already rotated).
    const dirNormX = (initialCorner.x - anchor.x) / initialDiagonal
    const dirNormY = (initialCorner.y - anchor.y) / initialDiagonal
    // Board-local sign for this corner (used to project pointer delta into board-local axes).
    const cornerLocalDirX = cornerDirsLocal[cornerIndex].x
    const cornerLocalDirY = cornerDirsLocal[cornerIndex].y

    // Size is absolute inches: floor at 2", cap at the wall's own dimensions.
    const MIN_INCHES_W = 2
    const MIN_INCHES_H = 2
    const MAX_INCHES_W = wallWidthInches
    const MAX_INCHES_H = wallHeightInches

    // Snapshots for rollback if the API save fails: x/y (wall-relative) and
    // size (absolute inches) roll back independently.
    const priorXY = { x: positionRef.current.x, y: positionRef.current.y }
    const priorSize = { width: w0, height: h0 }

    resizeStartRef.current = { anchorX: anchor.x, anchorY: anchor.y, initialCornerX: initialCorner.x, initialCornerY: initialCorner.y, initialWidth: w0, initialHeight: h0 }
    isResizingRef.current = true
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
        // Shift held = free resize: width/height move independently along the BOARD-LOCAL axes
        // (so a rotated board still resizes "horizontally" along its own width axis, not screen-X).
        const deltaWX = pointerWall.x - ax
        const deltaWY = pointerWall.y - ay
        // Project wall-local delta into the board's rotated frame:
        // board-local x-axis = (cosR, sinR); board-local y-axis = (-sinR, cosR).
        const deltaBX = deltaWX * cosR + deltaWY * sinR
        const deltaBY = -deltaWX * sinR + deltaWY * cosR
        const widthInches = THREE.MathUtils.clamp(deltaBX * cornerLocalDirX, MIN_INCHES_W, MAX_INCHES_W)
        const heightInches = THREE.MathUtils.clamp(deltaBY * cornerLocalDirY, MIN_INCHES_H, MAX_INCHES_H)
        newW = widthInches
        newH = heightInches
        // Active corner in wall-local: anchor + R(rotation) * (sign * inches in board-local).
        const cornerBX = cornerLocalDirX * widthInches
        const cornerBY = cornerLocalDirY * heightInches
        newCornerX = ax + cosR * cornerBX - sinR * cornerBY
        newCornerY = ay + sinR * cornerBX + cosR * cornerBY
      } else {
        // Default = locked aspect ratio: project pointer displacement onto the diagonal, scale both axes equally.
        const dx = pointerWall.x - ax
        const dy = pointerWall.y - ay
        const projectedLength = dx * dirNormX + dy * dirNormY
        const rawScale = Math.max(0.01, projectedLength / initialDiagonal)
        const initialW = resizeStartRef.current.initialWidth
        const initialH = resizeStartRef.current.initialHeight
        const minScale = Math.max(MIN_INCHES_W / initialW, MIN_INCHES_H / initialH)
        const maxScale = Math.min(MAX_INCHES_W / initialW, MAX_INCHES_H / initialH)
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
      // x/y are wall-relative (legacy channel); size is absolute inches.
      positionRef.current = { ...positionRef.current, x: newX, y: newY }
      setLocalPosition(prev => ({ ...prev, x: newX, y: newY }))
      sizeRef.current = { width: newW, height: newH }
      setSizeIn({ width: newW, height: newH })
    }

    const onUp = () => {
      // Reset both possible cursor targets in case pointer-up fires off-handle.
      document.body.style.cursor = ''
      gl.domElement.style.cursor = ''
      const ref = positionRef.current
      const sz = sizeRef.current
      justFinishedDragging.current = true
      setLocalPosition(prev => ({ ...prev, x: ref.x, y: ref.y }))

      // Mirror the post-resize x/y back into the parent's placedBoards3D Map
      // (corner-resize drifts x/y via the centering math). Size is mirrored
      // separately via onSizePersisted, just below. Fires regardless of PATCH
      // outcome — Save & Exit acts as the retry path on network failure.
      onDragEndRef.current(board.id, ref.x, ref.y, ref.width, ref.height, side)

      // Apply the size to useBoardState.boards SYNCHRONOUSLY here, before the
      // PATCH fires. The bulk Save & Exit reads boardWidthIn/boardHeightIn
      // from boardsRef.current at click time; doing this on PATCH success
      // (the previous behavior) raced the user's Save & Exit and frequently
      // lost — the bulk PUT sent the pre-resize size and overwrote the
      // in-flight PATCH. applyBoardSizeLocal also updates boardsRef
      // synchronously so a same-tick read by updateBoardPosition sees the
      // new values without waiting for React's next render.
      onSizePersisted?.(board.id, sz.width, sz.height)

      // Persist via PATCH on the dedicated position endpoint.
      const apiX = (ref.x + 0.5) * 100
      const apiY = (ref.y + 0.5) * 100
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
            // Absolute board size in inches — independent of the wall.
            boardWidthIn: sz.width,
            boardHeightIn: sz.height,
            side,
            // Send the current rotation so resize doesn't drop it. Reading
            // from the ref (not localRotation state) avoids a stale-closure
            // capture inside this pointer-up handler — same pattern the
            // rotate-end PATCH uses below.
            rotation: rotationRef.current,
          }),
        })
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            // Mirror server-acked rotation into useBoardState.boards. Size
            // was applied optimistically above, so no second size write is
            // needed on success (applyBoardSizeLocal bails on value equality).
            onRotationPersisted?.(board.id, rotationRef.current)
          })
          .catch(err => {
            console.error('❌ [DraggableBoard] Resize PATCH failed:', err)
            // Roll back x/y (wall-relative) and size (inches) to pre-resize,
            // including the optimistic boards update applied above so the
            // canonical state stays consistent with the user-visible board.
            positionRef.current = { ...positionRef.current, x: priorXY.x, y: priorXY.y }
            setLocalPosition(prev => ({ ...prev, x: priorXY.x, y: priorXY.y }))
            sizeRef.current = priorSize
            setSizeIn(priorSize)
            onSizePersisted?.(board.id, priorSize.width, priorSize.height)
            toast.error('Failed to save board size. Please try again.')
          })
      }

      resizeStartRef.current = null
      isResizingRef.current = false
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
  }, [board.id, _wallIndex, getPointerOnWallPlane, gl, isLocked, scaledWallHeight, scaledWallWidth, side, wallHeightInches, wallWidthInches, worldToWallLocal, onSizePersisted, onRotationPersisted])

  /**
   * Rotate-handle pointer-down. Starts an angle-tracking drag around the board's center.
   * Pivot is the board's center in wall-local space; pointer angle is computed in wall-local 2D.
   * Hold Shift to snap to 15° (π/12) increments. Persists via PATCH on pointer-up; rolls back on failure.
   */
  const handleRotatePointerDown = useCallback((
    e: ThreeEvent<PointerEvent>
  ) => {
    e.stopPropagation()
    if (isLocked) return
    const pointerPlanePoint = getPointerOnWallPlane(e.clientX, e.clientY)
    if (!pointerPlanePoint) return

    const cx = positionRef.current.x * scaledWallWidth
    const cy = positionRef.current.y * scaledWallHeight
    const pointerWall0 = worldToWallLocal(pointerPlanePoint)
    const startPointerAngle = Math.atan2(pointerWall0.y - cy, pointerWall0.x - cx)
    const startRotation = rotationRef.current
    const priorRotation = startRotation

    isRotatingRef.current = true
    setIsRotating(true)
    gl.domElement.style.cursor = ROTATE_CURSOR

    const shiftHeldRef = { current: e.shiftKey }
    const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === 'Shift') shiftHeldRef.current = true }
    const onKeyUp = (ev: KeyboardEvent) => { if (ev.key === 'Shift') shiftHeldRef.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const SNAP_INCREMENT = Math.PI / 12 // 15°

    const onMove = (ev: PointerEvent) => {
      const p = getPointerOnWallPlane(ev.clientX, ev.clientY)
      if (!p) return
      const pointerWall = worldToWallLocal(p)
      const currentAngle = Math.atan2(pointerWall.y - cy, pointerWall.x - cx)
      let next = startRotation + (currentAngle - startPointerAngle)
      if (shiftHeldRef.current) {
        next = Math.round(next / SNAP_INCREMENT) * SNAP_INCREMENT
      }
      rotationRef.current = next
      setLocalRotation(next)
      // Mirror to parent's placedBoards3D so handleEditComplete can read the
      // current rotation when bulk-saving on Save & Exit.
      onRotationChange?.(board.id, next)
    }

    const onUp = () => {
      gl.domElement.style.cursor = ''
      const finalRotation = rotationRef.current
      isRotatingRef.current = false
      setIsRotating(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)

      const isMockBoard =
        board.id.startsWith('temp-') ||
        board.id.startsWith('demo-') ||
        board.id.startsWith('sample-')
      if (isMockBoard) return

      // Persist via PATCH on the dedicated position endpoint.
      // We need to send wallIndex/x/y because the route requires them — reuse current values.
      const ref = positionRef.current
      fetch(`/api/boards/${board.id}/position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallIndex: _wallIndex,
          x: (ref.x + 0.5) * 100,
          y: (ref.y + 0.5) * 100,
          width: (ref.width ?? 0.3) * 100,
          height: (ref.height ?? 0.3) * 100,
          side,
          rotation: finalRotation,
        }),
      })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          // Mirror server-acked rotation into useBoardState.boards so the
          // post-edit-mode WallSystem render reads the new value instead of
          // the stale pre-rotation rotation from board.position.
          onRotationPersisted?.(board.id, finalRotation)
        })
        .catch(err => {
          console.error('❌ [DraggableBoard] Rotation PATCH failed:', err)
          rotationRef.current = priorRotation
          setLocalRotation(priorRotation)
          // Roll back the parent state too so placedBoards3D matches the DB.
          onRotationChange?.(board.id, priorRotation)
          toast.error('Failed to save board rotation. Please try again.')
        })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [board.id, _wallIndex, getPointerOnWallPlane, gl, isLocked, scaledWallHeight, scaledWallWidth, side, worldToWallLocal])

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

  // Render rotation derived from local state so optimistic updates (during rotate-drag) take effect immediately.
  // Back side mirrors the rotation so the displayed direction matches the front-side intuition.
  const renderRotationZ = isBackSide ? -localRotation : localRotation

  // Position the group at the wall position, then position board within group's local space
  return (
    <group position={wallPosition} rotation={[0, wallRotation, 0]}>
      <group ref={innerGroupRef} position={[boardXRender, boardY, boardZ]} rotation={[0, 0, renderRotationZ]}>
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
         * Corner handles, rendered only in edit mode for boards this user can edit.
         * Two stacked invisible meshes per corner:
         *   - Resize handle: smaller, in front (z higher) so it takes pointer priority on the corner itself.
         *   - Rotate handle: larger, behind the resize handle. Only the "donut" outside the resize handle picks
         *     up rotate hover events; the inner area belongs to resize.
         *
         * Cursor for resize is rotation-aware (snaps the diagonal direction to the nearest 45°).
         * Cursor for rotate is a custom curved-arrow SVG.
         * The board body still owns drag-to-move; both handles intercept their own pointer events.
         */}
        {canEdit && !isLocked && (() => {
          const resizeHandleSize = Math.max(2, Math.min(boardWidth, boardHeight) * 0.12)
          // Rotate handle is ~1.7x larger so the "outside the corner" zone is comfortably discoverable.
          const rotateHandleSize = resizeHandleSize * 1.7
          // 0=TR, 1=TL, 2=BL, 3=BR — must match the indexing in handleCornerPointerDown.
          const corners: Array<{ index: number; localX: number; y: number; localDirX: number; localDirY: number }> = [
            { index: 0, localX: boardWidth / 2, y: boardHeight / 2, localDirX: 1, localDirY: 1 },
            { index: 1, localX: -boardWidth / 2, y: boardHeight / 2, localDirX: -1, localDirY: 1 },
            { index: 2, localX: -boardWidth / 2, y: -boardHeight / 2, localDirX: -1, localDirY: -1 },
            { index: 3, localX: boardWidth / 2, y: -boardHeight / 2, localDirX: 1, localDirY: -1 },
          ]
          // Mirror the corner local direction for back-side boards (matches the position mirroring).
          const effectiveDir = (dx: number) => (isBackSide ? -dx : dx)

          return corners.flatMap(({ index, localX, y, localDirX, localDirY }) => {
            const handleX = isBackSide ? -localX : localX
            // Compute the cursor live each pointer-event from the current renderRotationZ so a rotated
            // board still shows the right resize cursor at each corner.
            const cursorForNow = (): ResizeCursor =>
              pickResizeCursorForRotatedCorner(effectiveDir(localDirX), localDirY, renderRotationZ)
            return [
              // ROTATE handle: behind the resize handle, picks up the "outside corner" donut zone.
              <mesh
                key={`rotate-${index}`}
                position={[handleX, y, BOARD_THICKNESS / 2 + 0.005]}
                renderOrder={2}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  gl.domElement.style.cursor = ROTATE_CURSOR
                }}
                onPointerMove={(e) => {
                  e.stopPropagation()
                  gl.domElement.style.cursor = ROTATE_CURSOR
                }}
                onPointerOut={(e) => {
                  e.stopPropagation()
                  if (!isResizing && !isRotating) gl.domElement.style.cursor = ''
                }}
                onPointerDown={(e) => {
                  handleRotatePointerDown(e)
                }}
              >
                <boxGeometry args={[rotateHandleSize, rotateHandleSize, BOARD_THICKNESS + 0.01]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>,
              // RESIZE handle: in front so it wins the inner corner area.
              <mesh
                key={`resize-${index}`}
                position={[handleX, y, BOARD_THICKNESS / 2 + 0.02]}
                renderOrder={3}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  gl.domElement.style.cursor = cursorForNow()
                }}
                onPointerMove={(e) => {
                  e.stopPropagation()
                  gl.domElement.style.cursor = cursorForNow()
                }}
                onPointerOut={(e) => {
                  e.stopPropagation()
                  if (!isResizing && !isRotating) gl.domElement.style.cursor = ''
                }}
                onPointerDown={(e) => {
                  handleCornerPointerDown(e, index, cursorForNow())
                }}
              >
                <boxGeometry args={[resizeHandleSize, resizeHandleSize, BOARD_THICKNESS + 0.02]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>,
            ]
          })
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