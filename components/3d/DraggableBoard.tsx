'use client'

const isDev = process.env.NODE_ENV === 'development'
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args) }

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
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
import { getBoardSizeInches, boardSizeInchesFromSource } from '@/lib/boardDimensions'
import VideoBadge from './VideoBadge'
import { useDisposableGeometry } from './useDisposableGeometry'
import {
  snapCenter,
  snapEdges,
  isAxisAlignedForSnap,
  type ActiveGuides,
  type SizeMatch,
  type SnapTarget,
} from './boardSnapping'
import { enqueueBoardWrite } from '@/lib/boardPositionWriteQueue'

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
   * Pushed on corner-resize PATCH success so the parent can mirror the
   * server-acked absolute size (inches) into useBoardState.boards. That's the
   * array WallSystem reads from once edit mode exits — without this, the scene
   * re-reads the pre-resize size and visually reverts the resize.
   */
  onSizePersisted?: (boardId: string, widthIn: number, heightIn: number) => void
  onDelete: (boardId: string) => void
  onCommentClick?: (board: Board) => void
  /**
   * `additive` is true for a shift-click: toggle this board in the selection
   * instead of replacing it. Plain click stays "select only this one".
   */
  onSelect?: (opts?: { additive?: boolean }) => void
  onDeselect?: () => void
  /** In the selection set — drives the highlight only. */
  isSelected?: boolean
  /**
   * The ONLY board selected. Gates single-board actions that must not become
   * group actions when several boards are selected: with a multi-selection the
   * reset-to-true-scale button would appear on every member, which is a group
   * resize affordance. Selection is only for copy; when exactly one board is
   * selected this is `isSelected` and behavior is unchanged.
   */
  isSoleSelection?: boolean
  workspaceId?: string // Workspace/studio ID to check membership
  isWorkspaceMember?: boolean // Whether user is a member of the workspace
  /**
   * Every board on the SAME wall + side as this one (this board included is
   * fine — it's filtered out by id during the smart-guide scan). Centers are
   * in wall-local inches with origin at wall center, matching this board's
   * own `localPosition * scaledWall*` math. Used only for alignment guides;
   * `undefined` or `[]` disables guides for this drag.
   */
  otherBoardsOnWall?: ReadonlyArray<{
    id: string
    centerInchesX: number
    centerInchesY: number
    widthInches: number
    heightInches: number
    /**
     * The neighbour's own rotation in radians. The snap math ignores it — it
     * treats every rectangle as axis-aligned, as it always has — but the
     * size-match outline is drawn ON the matched board, so without this it
     * would render an unrotated box floating over a rotated neighbour.
     */
    rotationRad?: number
  }>
}

type ResizeCursor = 'nwse-resize' | 'nesw-resize'

/** Sentinel id for the wall-as-snap-target. Never collides with a board id. */
const WALL_SNAP_TARGET_ID = '__wall__'
/** Stable empties so a no-snap pointer sample doesn't allocate every frame. */
const EMPTY_GUIDES: ActiveGuides = { vertical: [], horizontal: [] }
const EMPTY_SIZE_MATCHES: SizeMatch[] = []
/** Pink shared with the alignment guides. */
const SNAP_ACCENT = '#ec4899'
/** Thickness of guide lines and the size-match outline, in wall inches. */
const SNAP_LINE_THICKNESS_IN = 0.5

/**
 * Corner→cursor lookup, keyed on the corner index (and the back-side X-mirror,
 * which swaps TR↔TL and BL↔BR, and thus which diagonal each corner sits on).
 *   TR (0) / BL (2) → NE↔SW diagonal → 'nesw-resize'
 *   TL (1) / BR (3) → NW↔SE diagonal → 'nwse-resize'
 * The cursor is not adjusted for board rotation — on a turned board it may not
 * match the visual diagonal exactly (cosmetic only; the resize math itself is
 * rotation-aware).
 */
function resizeCursorForCorner(cornerIndex: number, isBackSide: boolean): ResizeCursor {
  const effective = isBackSide ? (cornerIndex === 0 ? 1 : cornerIndex === 1 ? 0 : cornerIndex === 2 ? 3 : 2) : cornerIndex
  return effective === 0 || effective === 2 ? 'nesw-resize' : 'nwse-resize'
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
  onSizePersisted,
  onDelete: _onDelete,
  onCommentClick,
  onSelect,
  onDeselect,
  isSelected = false,
  isSoleSelection = false,
  workspaceId: _workspaceId,
  isWorkspaceMember = false,
  otherBoardsOnWall,
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
  const [isRotating, setIsRotating] = useState(false)
  // Board rotation (radians), applied as rotation.z about the board center — 0 =
  // unrotated, positive = CCW (migration 012). Re-enabled after Phase 6: the
  // column, the position PATCH route, and the 2D lightbox transform were all kept
  // intact, so this is a render + gesture re-enable, not a new column. `state`
  // drives the render; `rotationRef` lets the gesture read/write without a stale
  // closure and lets the resize math read the current angle.
  const [boardRotation, setBoardRotation] = useState<number>(() => board.position?.rotation ?? 0)
  const rotationRef = useRef(boardRotation)
  const isRotatingRef = useRef(false)

  // Re-sync rotation from props when it changes externally (server ack, another
  // user's rotate via realtime) and we're not mid-rotate — mirrors the size sync.
  useEffect(() => {
    if (isRotatingRef.current) return
    const r = board.position?.rotation ?? 0
    rotationRef.current = r
    setBoardRotation(r)
  }, [board.position?.rotation])

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
  const rotateListenersRef = useRef<{
    move: ((e: PointerEvent) => void) | null
    up: (() => void) | null
  }>({ move: null, up: null })

  // Remove any lingering window listeners when the component unmounts mid-drag/resize/rotate
  useEffect(() => {
    return () => {
      if (dragListenersRef.current.move) window.removeEventListener('pointermove', dragListenersRef.current.move)
      if (dragListenersRef.current.up) window.removeEventListener('pointerup', dragListenersRef.current.up)
      if (resizeListenersRef.current.move) window.removeEventListener('pointermove', resizeListenersRef.current.move)
      if (resizeListenersRef.current.up) window.removeEventListener('pointerup', resizeListenersRef.current.up)
      if (rotateListenersRef.current.move) window.removeEventListener('pointermove', rotateListenersRef.current.move)
      if (rotateListenersRef.current.up) window.removeEventListener('pointerup', rotateListenersRef.current.up)
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

  // Active alignment guides for the current pointer sample. Cleared on
  // pointer-up. Each entry is a wall-local inch coordinate along its axis.
  // The snap math itself lives in ./boardSnapping so move and resize share it.
  const [activeGuides, setActiveGuides] = useState<ActiveGuides>({
    vertical: [],
    horizontal: [],
  })

  // Boards whose width or height the in-progress resize currently matches.
  // Rendered as a pink outline on the matched board rather than a guide line —
  // a shared dimension is not a spatial alignment, so a line between the two
  // would imply an edge relationship that isn't there. Cleared on pointer-up.
  const [sizeMatches, setSizeMatches] = useState<SizeMatch[]>(EMPTY_SIZE_MATCHES)

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

      // Board center in wall-local inches (anchor = CENTER). Free movement —
      // no grid snap. Smart guides may still nudge by up to
      // GUIDE_SNAP_THRESHOLD_IN if a neighbor alignment is in range.
      let centerInchesX = pointerRenderX - offsetX
      let centerInchesY = pointerRenderY - offsetY

      // Smart guide / soft snap. Find the closest neighbor alignment along
      // each axis independently and shift the dragged center onto it if
      // within threshold. After snapping, collect every neighbor line the
      // dragged board now coincides with so we can draw a guide for each.
      // Targets are boards only — the wall is not a move-snap target.
      const snapped = snapCenter({
        centerX: centerInchesX,
        centerY: centerInchesY,
        halfWidth: boardWidth / 2,
        halfHeight: boardHeight / 2,
        targets: otherBoardsOnWall ?? [],
        excludeId: board.id,
      })
      centerInchesX = snapped.centerX
      centerInchesY = snapped.centerY
      setActiveGuides(snapped.guides)

      const normalizedX = THREE.MathUtils.clamp(centerInchesX / scaledWallWidth, -0.5, 0.5)
      const normalizedY = THREE.MathUtils.clamp(centerInchesY / scaledWallHeight, -0.5, 0.5)

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
    
    // Deselect board when starting to drag.
    //
    // NOT on a shift-click: onDeselect clears the ENTIRE selection, and shift is
    // a selection gesture rather than the start of a drag. Without this guard,
    // shift-clicking an already-selected board wiped the set here and the toggle
    // then re-added the board — so "remove this one from the selection" came out
    // as "select only this one". Plain clicks still clear-then-select exactly as
    // before, which is the same end state as the old single-selection code.
    if (onDeselect && isSelected && !e.shiftKey) {
      devLog('🖱️ [DraggableBoard] Deselecting board because drag started')
      onDeselect()
    }
    
    setIsDragging(true)
    gl.domElement.style.cursor = 'grabbing'
    devLog('🖱️ isDragging set to true, attaching global listeners...')
    
    // Start listening to window events. Board movement is FREE / continuous;
    // only the smart-guide soft-snap inside updatePosition can nudge the
    // dragged center onto a neighbor's edge or center.
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
      
      devLog('🖱️ [DraggableBoard] Pointer up - wasClick:', wasClick, 'movement:', dragStartPosition.current ? {
        x: Math.abs(e.clientX - dragStartPosition.current.x),
        y: Math.abs(e.clientY - dragStartPosition.current.y)
      } : 'no start pos')

      // Selection is NOT dispatched here — the mesh's onClick below owns it.
      //
      // Both used to fire for one click on an unlocked board. That was invisible
      // while selecting meant `setSelectedBoardId(id)`, because running it twice
      // is the same as once; a shift-click TOGGLE applied twice is the identity,
      // so the selection could never grow. Dropping this one rather than onClick
      // is what keeps every case identical: onClick is the only dispatcher a
      // locked board or a corner-handle click ever had (both bypass this
      // handler — handleCornerPointerDown stopPropagation()s before we attach),
      // so onClick still fires everywhere it used to, unchanged.

      // Mark that we just finished dragging to prevent sync from resetting position
      justFinishedDragging.current = true

      // Smart guides are transient — only visible during the drag.
      setActiveGuides({ vertical: [], horizontal: [] })

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

    // Board-local corner directions. 0=TR(+,+), 1=TL(-,+), 2=BL(-,-), 3=BR(+,-).
    const cornerDirsLocal: Array<{ x: number; y: number }> = [
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 },
    ]
    // Rotation-aware corner geometry. The board's local axes are rotated by its
    // stored rotation; in the wall-local coord basis that appears as effRot —
    // negated on the back, whose edit view is X-mirrored (same dirSign the rotate
    // gesture uses). At rotation 0 rot2 is the identity, so this is byte-for-byte
    // the previous axis-aligned math (no regression on unrotated boards).
    const effRot = (isBackSide ? -1 : 1) * rotationRef.current
    const cosR = Math.cos(effRot)
    const sinR = Math.sin(effRot)
    const rot2 = (vx: number, vy: number) => ({ x: vx * cosR - vy * sinR, y: vx * sinR + vy * cosR })
    // Board-local unit axes expressed in wall-local coords (for the free-resize
    // projection below).
    const bAxisX = rot2(1, 0)
    const bAxisY = rot2(0, 1)
    const corners = cornerDirsLocal.map(d => {
      const off = rot2(d.x * halfW, d.y * halfH)
      return { x: cx + off.x, y: cy + off.y }
    })

    const anchorIndex = (cornerIndex + 2) % 4
    const anchor = corners[anchorIndex]
    const initialCorner = corners[cornerIndex]
    const initialDiagonal = Math.hypot(initialCorner.x - anchor.x, initialCorner.y - anchor.y)
    if (initialDiagonal < 1) return
    // Direction of the diagonal in WALL-LOCAL space (already rotated via corners).
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
    // Alt suppresses snapping for fine manual control. Shift is already taken
    // by the free/proportional toggle above, hence Alt.
    const altHeldRef = { current: e.altKey }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift') shiftHeldRef.current = true
      if (ev.key === 'Alt') altHeldRef.current = true
    }
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift') shiftHeldRef.current = false
      if (ev.key === 'Alt') altHeldRef.current = false
    }
    // Alt+Tab (and any other focus loss) swallows the keyup, which would leave
    // the modifier stuck on for the rest of the gesture — snapping dead, or the
    // resize stuck in free mode. Treat losing the window as releasing both.
    const onWindowBlur = () => {
      shiftHeldRef.current = false
      altHeldRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    // Snap geometry, fixed for the gesture. Edge alignment may snap to other
    // boards AND to the wall's own edges/center; size matching only ever
    // considers boards (there is nothing sensible to outline for the wall).
    const sizeTargets = otherBoardsOnWall ?? []
    const alignTargets: SnapTarget[] = [
      ...sizeTargets,
      {
        id: WALL_SNAP_TARGET_ID,
        centerInchesX: 0,
        centerInchesY: 0,
        widthInches: wallWidthInches,
        heightInches: wallHeightInches,
      },
    ]
    // Direction from the anchor to the moving corner on each wall axis, taken
    // from the actual geometry rather than the board-local sign so the
    // back-side X mirror needs no special case.
    const dirX = Math.sign(initialCorner.x - anchor.x) || 1
    const dirY = Math.sign(initialCorner.y - anchor.y) || 1
    const allowEdgeAlign = isAxisAlignedForSnap(rotationRef.current)

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

      // Both modes are RELATIVE — they apply the pointer's displacement
      // *from the initial corner position*, not the pointer's absolute
      // distance from the anchor. The free-mode code used to be absolute
      // (`width = deltaFromAnchor * sign`), which made the board jump on
      // gesture start whenever the user clicked the handle off-center.
      // Now both modes start at the initial size and grow/shrink by the
      // pointer's drag delta, so the same gesture produces the same result
      // regardless of where on the handle pointer-down landed.
      const initialW = resizeStartRef.current.initialWidth
      const initialH = resizeStartRef.current.initialHeight
      const initialCornerX = resizeStartRef.current.initialCornerX
      const initialCornerY = resizeStartRef.current.initialCornerY
      const dragDX = pointerWall.x - initialCornerX
      const dragDY = pointerWall.y - initialCornerY

      const isFree = shiftHeldRef.current
      if (isFree) {
        // Shift held = FREE resize: width and height move independently. Project
        // the drag delta onto the board's own (rotated) axes so width tracks the
        // board-local X and height the board-local Y even when the board is turned.
        const dragAlongX = dragDX * bAxisX.x + dragDY * bAxisX.y
        const dragAlongY = dragDX * bAxisY.x + dragDY * bAxisY.y
        const widthDelta = dragAlongX * cornerLocalDirX
        const heightDelta = dragAlongY * cornerLocalDirY
        newW = THREE.MathUtils.clamp(initialW + widthDelta, MIN_INCHES_W, MAX_INCHES_W)
        newH = THREE.MathUtils.clamp(initialH + heightDelta, MIN_INCHES_H, MAX_INCHES_H)
      } else {
        // Default = PROPORTIONAL: project drag delta onto the anchor→corner
        // diagonal direction, grow the diagonal by that scalar, scale both
        // axes by the same ratio. Aspect ratio is locked.
        const projectedDelta = dragDX * dirNormX + dragDY * dirNormY
        const newDiagonal = Math.max(0.01, initialDiagonal + projectedDelta)
        const rawScale = newDiagonal / initialDiagonal
        const minScale = Math.max(MIN_INCHES_W / initialW, MIN_INCHES_H / initialH)
        const maxScale = Math.min(MAX_INCHES_W / initialW, MAX_INCHES_H / initialH)
        const scale = THREE.MathUtils.clamp(rawScale, minScale, maxScale)
        newW = initialW * scale
        newH = initialH * scale
      }

      // Snap the raw size before deriving the corner, so the snapped value is
      // what renders AND what the pointer-up PATCH persists. Alt suppresses.
      if (altHeldRef.current) {
        setActiveGuides(EMPTY_GUIDES)
        setSizeMatches(EMPTY_SIZE_MATCHES)
      } else {
        const snapped = snapEdges({
          width: newW,
          height: newH,
          anchorX: ax,
          anchorY: ay,
          dirX,
          dirY,
          minWidth: MIN_INCHES_W,
          minHeight: MIN_INCHES_H,
          maxWidth: MAX_INCHES_W,
          maxHeight: MAX_INCHES_H,
          alignTargets,
          sizeTargets,
          excludeId: board.id,
          allowEdgeAlign,
          mode: isFree ? 'free' : 'proportional',
        })
        newW = snapped.width
        newH = snapped.height
        setActiveGuides(snapped.guides)
        setSizeMatches(snapped.sizeMatches)
      }

      // Derive the moving corner from the FINAL size, so a snap moves the board
      // rather than just the guide.
      if (isFree) {
        // The active corner sits at anchor + signed extents along the board's
        // rotated axes.
        newCornerX = ax + cornerLocalDirX * newW * bAxisX.x + cornerLocalDirY * newH * bAxisY.x
        newCornerY = ay + cornerLocalDirX * newW * bAxisX.y + cornerLocalDirY * newH * bAxisY.y
      } else {
        // Proportional keeps the aspect locked, so either axis recovers the
        // scale; width is used for both.
        const finalScale = newW / initialW
        newCornerX = ax + dirNormX * initialDiagonal * finalScale
        newCornerY = ay + dirNormY * initialDiagonal * finalScale
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
      // Snap affordances are transient — same lifecycle as the move gesture's.
      setActiveGuides(EMPTY_GUIDES)
      setSizeMatches(EMPTY_SIZE_MATCHES)
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
        // Serialize per board (shared chain with the move PUT) so a resize and a
        // move for the same board can't commit out of order. keepalive lets the
        // save survive a navigation right after the gesture.
        enqueueBoardWrite(board.id, () => fetch(`/api/boards/${board.id}/position`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            wallIndex: _wallIndex,
            x: apiX,
            y: apiY,
            // Absolute board size in inches — independent of the wall.
            boardWidthIn: sz.width,
            boardHeightIn: sz.height,
            side,
          }),
        }))
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            // Size was applied optimistically above (Phase 5), so success is
            // a no-op here — applyBoardSizeLocal bails on value equality.
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
      window.removeEventListener('blur', onWindowBlur)
    }

    resizeListenersRef.current = { move: onMove, up: onUp }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // otherBoardsOnWall is captured for the snap target lists — without it the
    // gesture would snap against a stale set of neighbors after any add/delete.
  }, [board.id, _wallIndex, getPointerOnWallPlane, gl, isLocked, scaledWallHeight, scaledWallWidth, side, wallHeightInches, wallWidthInches, worldToWallLocal, onSizePersisted, otherBoardsOnWall])

  /**
   * Rotate gesture. A dedicated handle (rendered above the board's top edge)
   * rotates the board about its center. We track the pointer's angle around the
   * center in wall-local space and accumulate the UNWRAPPED delta, so a spin past
   * ±180° never jumps. Holding Shift snaps to the nearest 90° — the INVERSE
   * polarity of corner-resize (there Shift = free) — tracked mid-gesture with the
   * same window keydown/keyup pattern so press/release works without restarting
   * the drag. The stored value is front-canonical (matches the lightbox rotate());
   * the back side's X-mirrored edit view is handled by dirSign so the knob still
   * follows the pointer. Persists via the same position PATCH the resize uses.
   */
  const handleRotatePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (isLocked) return
    const startPtWorld = getPointerOnWallPlane(e.clientX, e.clientY)
    if (!startPtWorld) return
    const bcx = positionRef.current.x * scaledWallWidth
    const bcy = positionRef.current.y * scaledWallHeight
    const dirSign = isBackSide ? -1 : 1
    const startWall = worldToWallLocal(startPtWorld)
    let lastAngle = Math.atan2(startWall.y - bcy, startWall.x - bcx)
    let accum = rotationRef.current
    const priorRotation = rotationRef.current

    isRotatingRef.current = true
    setIsRotating(true)
    gl.domElement.style.cursor = 'grabbing'

    const SNAP = Math.PI / 2
    // Shift held = snap to 90°. Same mid-gesture tracking pattern as resize.
    const shiftHeldRef = { current: e.shiftKey }
    // Apply the accumulated angle to state, snapping to 90° while Shift is held.
    // Called on every move AND on Shift keydown/keyup so toggling snaps/unsnaps
    // live without restarting the gesture. `accum` stays the raw (unsnapped)
    // value, so releasing Shift returns to free rotation.
    const applyFromAccum = () => {
      const next = shiftHeldRef.current ? Math.round(accum / SNAP) * SNAP : accum
      rotationRef.current = next
      setBoardRotation(next)
    }

    const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === 'Shift') { shiftHeldRef.current = true; applyFromAccum() } }
    const onKeyUp = (ev: KeyboardEvent) => { if (ev.key === 'Shift') { shiftHeldRef.current = false; applyFromAccum() } }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const onMove = (ev: PointerEvent) => {
      const p = getPointerOnWallPlane(ev.clientX, ev.clientY)
      if (!p) return
      const pw = worldToWallLocal(p)
      const a = Math.atan2(pw.y - bcy, pw.x - bcx)
      let d = a - lastAngle
      // Unwrap into [-π, π] so crossing the ±180° seam doesn't spin the board.
      if (d > Math.PI) d -= 2 * Math.PI
      else if (d < -Math.PI) d += 2 * Math.PI
      lastAngle = a
      accum += dirSign * d
      applyFromAccum()
    }

    const onUp = () => {
      gl.domElement.style.cursor = ''
      const finalRot = rotationRef.current // snapped if Shift was down at release
      isRotatingRef.current = false
      setIsRotating(false)
      rotateListenersRef.current = { move: null, up: null }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)

      const isMockBoard =
        board.id.startsWith('temp-') || board.id.startsWith('demo-') || board.id.startsWith('sample-')
      if (isMockBoard) return
      // Persist through the SAME serialized queue + endpoint as move/resize. The
      // route requires wallIndex/x/y and conditionally writes position_rotation;
      // no size fields are sent, so board_width_in/board_height_in are preserved.
      const apiX = (positionRef.current.x + 0.5) * 100
      const apiY = (positionRef.current.y + 0.5) * 100
      enqueueBoardWrite(board.id, () => fetch(`/api/boards/${board.id}/position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          wallIndex: _wallIndex,
          x: apiX,
          y: apiY,
          rotation: finalRot,
          side,
        }),
      }))
        .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`) })
        .catch((err) => {
          console.error('❌ [DraggableBoard] Rotate PATCH failed:', err)
          rotationRef.current = priorRotation
          setBoardRotation(priorRotation)
          toast.error('Failed to save rotation. Please try again.')
        })
    }

    rotateListenersRef.current = { move: onMove, up: onUp }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [board.id, _wallIndex, getPointerOnWallPlane, worldToWallLocal, gl, isLocked, isBackSide, scaledWallWidth, scaledWallHeight, side])

  // True (measured) physical size exists only when the upload captured it — PDFs
  // (points/72). Gates the "Reset to true scale" escape hatch below.
  const hasPhysicalSize =
    board.physicalWidth != null && board.physicalHeight != null &&
    board.physicalWidth > 0 && board.physicalHeight > 0

  // Reset a manually-resized board back to its true physical size. Recomputes
  // from physical dims via the SAME helper the upload path used, applies it
  // optimistically (mirrors the corner-resize onUp), and persists board_width_in/
  // board_height_in through the existing position PATCH. Manual resize stays an
  // override — this is just the escape hatch back to measured scale.
  const handleResetToTrueScale = useCallback(() => {
    if (isLocked || !hasPhysicalSize) return
    const src = boardSizeInchesFromSource({
      aspectRatio: board.aspectRatio,
      physicalWidth: board.physicalWidth,
      physicalHeight: board.physicalHeight,
    })
    const next = { width: src.widthIn, height: src.heightIn }
    const prior = sizeRef.current
    if (Math.abs(prior.width - next.width) < 1e-3 && Math.abs(prior.height - next.height) < 1e-3) return
    sizeRef.current = next
    setSizeIn(next)
    onSizePersisted?.(board.id, next.width, next.height)

    const apiX = (positionRef.current.x + 0.5) * 100
    const apiY = (positionRef.current.y + 0.5) * 100
    const isMockBoard =
      board.id.startsWith('temp-') || board.id.startsWith('demo-') || board.id.startsWith('sample-')
    if (isMockBoard) return
    enqueueBoardWrite(board.id, () => fetch(`/api/boards/${board.id}/position`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        wallIndex: _wallIndex,
        x: apiX,
        y: apiY,
        boardWidthIn: next.width,
        boardHeightIn: next.height,
        side,
      }),
    }))
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`) })
      .catch((err) => {
        console.error('❌ [DraggableBoard] Reset-to-true-scale PATCH failed:', err)
        sizeRef.current = prior
        setSizeIn(prior)
        onSizePersisted?.(board.id, prior.width, prior.height)
        toast.error('Failed to reset board size. Please try again.')
      })
  }, [isLocked, hasPhysicalSize, board.id, board.aspectRatio, board.physicalWidth, board.physicalHeight, _wallIndex, side, onSizePersisted])

  devLog(`🧱 DraggableBoard on wall: wallRotation=${wallRotation.toFixed(2)}, side=${boardSide}, boardZ=${boardZ}`)
  const BOARD_THICKNESS = 0.08 // Give boards some thickness so they don't appear paper-thin
  // Source geometries for the outline edges, memoized on size and disposed when
  // the size changes / on unmount. Building these inline in <edgesGeometry args>
  // leaked one geometry per pointer-move during a corner resize.
  const boardEdgeGeometry = useDisposableGeometry(
    () => new THREE.BoxGeometry(boardWidth, boardHeight, BOARD_THICKNESS),
    [boardWidth, boardHeight],
  )
  const selectedEdgeGeometry = useDisposableGeometry(
    () => new THREE.BoxGeometry(boardWidth + 0.3, boardHeight + 0.3, BOARD_THICKNESS + 0.02),
    [boardWidth, boardHeight],
  )
  // Resolve size matches to drawable geometry. De-duplicated by target so a
  // board matching on BOTH axes gets one outline, not two stacked on each other.
  const sizeMatchHighlights = useMemo(() => {
    if (sizeMatches.length === 0) return []
    const out: Array<{
      id: string
      halfW: number
      halfH: number
      centerX: number
      centerY: number
      width: number
      height: number
      rotation: number
    }> = []
    for (const id of new Set(sizeMatches.map((m) => m.targetId))) {
      const target = otherBoardsOnWall?.find((b) => b.id === id)
      if (!target) continue
      out.push({
        id,
        centerX: target.centerInchesX,
        centerY: target.centerInchesY,
        width: target.widthInches,
        height: target.heightInches,
        halfW: target.widthInches / 2,
        halfH: target.heightInches / 2,
        // Raw, unmirrored — matches how each board renders its own inner group
        // (rotation is applied directly; only position is X-mirrored on the back).
        rotation: target.rotationRad ?? 0,
      })
    }
    return out
  }, [sizeMatches, otherBoardsOnWall])

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

  // Board rotation is applied as rotation.z on the inner group below (about the
  // board center). The outer group carries only the wall position/orientation.

  // Position the group at the wall position, then position board within group's local space
  return (
    <group position={wallPosition} rotation={[0, wallRotation, 0]}>
      {(isDragging || isResizing) && activeGuides.vertical.map((gx) => (
        <mesh
          key={`vg-${gx}`}
          position={[isBackSide ? -gx : gx, 0, boardZ + 0.01]}
          raycast={() => null}
        >
          <planeGeometry args={[SNAP_LINE_THICKNESS_IN, scaledWallHeight]} />
          <meshBasicMaterial color={SNAP_ACCENT} transparent opacity={0.95} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
      {(isDragging || isResizing) && activeGuides.horizontal.map((gy) => (
        <mesh
          key={`hg-${gy}`}
          position={[0, gy, boardZ + 0.01]}
          raycast={() => null}
        >
          <planeGeometry args={[scaledWallWidth, SNAP_LINE_THICKNESS_IN]} />
          <meshBasicMaterial color={SNAP_ACCENT} transparent opacity={0.95} depthTest={false} depthWrite={false} />
        </mesh>
      ))}

      {/*
       * Size-match highlight. A shared width/height is not a spatial
       * alignment, so this deliberately draws NO line between the two boards —
       * it outlines the matched board instead. The outline is the whole
       * signal: no dimension readout, since the numbers are not something the
       * editor should be putting on screen mid-gesture.
       */}
      {isResizing && sizeMatchHighlights.map((hl) => (
        <group
          key={`sm-${hl.id}`}
          position={[isBackSide ? -hl.centerX : hl.centerX, hl.centerY, boardZ + 0.02]}
          rotation={[0, 0, hl.rotation]}
        >
          {[
            { key: 'top', pos: [0, hl.halfH, 0], size: [hl.width, SNAP_LINE_THICKNESS_IN] },
            { key: 'bottom', pos: [0, -hl.halfH, 0], size: [hl.width, SNAP_LINE_THICKNESS_IN] },
            { key: 'left', pos: [-hl.halfW, 0, 0], size: [SNAP_LINE_THICKNESS_IN, hl.height] },
            { key: 'right', pos: [hl.halfW, 0, 0], size: [SNAP_LINE_THICKNESS_IN, hl.height] },
          ].map((edge) => (
            <mesh
              key={edge.key}
              position={edge.pos as [number, number, number]}
              raycast={() => null}
            >
              <planeGeometry args={edge.size as [number, number]} />
              <meshBasicMaterial color={SNAP_ACCENT} transparent opacity={0.95} depthTest={false} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={innerGroupRef} position={[boardXRender, boardY, boardZ]} rotation={[0, 0, boardRotation]}>
        <mesh
          ref={meshRef}
          onPointerDown={handlePointerDown}
          onClick={(e) => {
            // Stop propagation so the invisible wall plane doesn't get the click
            e.stopPropagation()

            // The SOLE selection dispatcher — see the note in handleUp above.
            // Shift toggles set membership; the modifier rides on nativeEvent,
            // not on the R3F synthetic event.
            if (onSelect) {
              onSelect({ additive: e.nativeEvent?.shiftKey === true })
            }
          }}
          // Same shield as onClick above, for the other event name: the wall
          // plane opens edit mode on double click, and R3F only stops the walk
          // on objects carrying that named handler — so without this a double
          // click on a board overhanging the wall edge could reach an ADJACENT
          // wall's plane and jump edit mode mid-edit.
          onDoubleClick={(e) => e.stopPropagation()}
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
          <edgesGeometry args={[boardEdgeGeometry]} />
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
            <edgesGeometry args={[selectedEdgeGeometry]} />
            <lineBasicMaterial color="#4444ff" linewidth={3} />
          </lineSegments>
        )}

        {/* Reset to true scale — escape hatch back to the board's measured
            physical size (PDFs). Shown only when the board is selected, editable,
            and true dimensions exist; manual resize otherwise stays an override. */}
        {isSoleSelection && canEdit && hasPhysicalSize && (
          <Html position={[0, boardHeight / 2 + 2, 0.1]} center distanceFactor={10} style={{ pointerEvents: 'auto' }}>
            <button
              onClick={(e) => { e.stopPropagation(); handleResetToTrueScale() }}
              onPointerDown={(e) => e.stopPropagation()}
              title="Resize this board back to its measured (PDF) real-world size"
              style={{
                whiteSpace: 'nowrap',
                background: 'rgba(15,23,42,0.85)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: '9999px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
              }}
            >
              Reset to true scale
            </button>
          </Html>
        )}

        {/*
         * Corner resize handles, rendered only in edit mode for boards this
         * user can edit. The board body still owns drag-to-move; the handles
         * intercept their own pointer events. The rotate handle is separate (just
         * below). All handles live in this rotation.z-rotated inner group, so they
         * ride the board's rotation and stay on the visual corners/top edge.
         */}
        {canEdit && !isLocked && (() => {
          const resizeHandleSize = Math.max(2, Math.min(boardWidth, boardHeight) * 0.12)
          // 0=TR, 1=TL, 2=BL, 3=BR — must match the indexing in handleCornerPointerDown.
          const corners: Array<{ index: number; localX: number; y: number }> = [
            { index: 0, localX: boardWidth / 2, y: boardHeight / 2 },
            { index: 1, localX: -boardWidth / 2, y: boardHeight / 2 },
            { index: 2, localX: -boardWidth / 2, y: -boardHeight / 2 },
            { index: 3, localX: boardWidth / 2, y: -boardHeight / 2 },
          ]

          return corners.map(({ index, localX, y }) => {
            const handleX = isBackSide ? -localX : localX
            const cursor = resizeCursorForCorner(index, isBackSide)
            return (
              <mesh
                key={`resize-${index}`}
                position={[handleX, y, BOARD_THICKNESS / 2 + 0.02]}
                renderOrder={3}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  gl.domElement.style.cursor = cursor
                }}
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
                <boxGeometry args={[resizeHandleSize, resizeHandleSize, BOARD_THICKNESS + 0.02]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )
          })
        })()}

        {/*
         * Rotate handle — a small knob on a short stalk just above the top edge.
         * Native to the resize pattern (same edit-mode gate, world-unit mesh so it
         * scales with camera distance, lives in the rotated inner group so it stays
         * glued to the board's top). Dragging it spins the board about its center;
         * Shift snaps to 90°.
         *
         * The DRAWN knob/stalk are deliberately small; the pointer hit target is a
         * SEPARATE, generous invisible disc (knob + stalk carry no raycast), so the
         * handle stays easy to grab on the first click without floating large over
         * the board.
         */}
        {canEdit && !isLocked && (() => {
          const knobR = Math.max(0.5, Math.min(boardWidth, boardHeight) * 0.02)   // drawn knob (~1/3 of prior)
          const stem = Math.max(1.5, Math.min(boardWidth, boardHeight) * 0.07)    // stalk (~1/3 of prior)
          const hitR = Math.max(3.5, Math.min(boardWidth, boardHeight) * 0.12)    // generous invisible grab area
          const topY = boardHeight / 2
          const knobY = topY + stem
          return (
            <group>
              {/* Stalk (visual only — no raycast). */}
              <mesh position={[0, topY + stem / 2, BOARD_THICKNESS / 2 + 0.01]} raycast={() => null}>
                <planeGeometry args={[Math.max(0.2, knobR * 0.5), stem]} />
                <meshBasicMaterial color="#4444ff" transparent opacity={0.7} depthTest={false} depthWrite={false} />
              </mesh>
              {/* Visible knob (small, no raycast — the hit disc below owns events). */}
              <mesh position={[0, knobY, BOARD_THICKNESS / 2 + 0.02]} renderOrder={3} raycast={() => null}>
                <circleGeometry args={[knobR, 24]} />
                <meshBasicMaterial color="#4444ff" transparent opacity={0.9} depthTest={false} depthWrite={false} />
              </mesh>
              {/* Invisible generous hit target. Biased UPWARD so its bottom sits
                  at the top edge (center = topY + max(stem,hitR) ⇒ bottom ≈ topY),
                  keeping it off the board body — a pointer-down on the board's
                  top-center still starts a drag-to-move, not a rotate — while the
                  disc still covers the knob and extends generously above it. */}
              <mesh
                position={[0, topY + Math.max(stem, hitR), BOARD_THICKNESS / 2 + 0.03]}
                renderOrder={3}
                onPointerOver={(e) => { e.stopPropagation(); gl.domElement.style.cursor = 'grab' }}
                onPointerMove={(e) => { e.stopPropagation(); gl.domElement.style.cursor = 'grab' }}
                onPointerOut={(e) => { e.stopPropagation(); if (!isRotating) gl.domElement.style.cursor = '' }}
                onPointerDown={(e) => { handleRotatePointerDown(e) }}
              >
                <circleGeometry args={[hitR, 24]} />
                <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
              </mesh>
            </group>
          )
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

        {/* Video link badge — opens the attached video in a new tab. Hidden
            while dragging so it doesn't capture the gesture. */}
        {board.linkUrl && !isDragging && (
          <VideoBadge url={board.linkUrl} width={boardWidth} height={boardHeight} />
        )}

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