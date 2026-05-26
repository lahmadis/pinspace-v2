'use client'

const isDev = process.env.NODE_ENV === 'development'
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args) }

import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { supabase } from '@/lib/supabase/client'
import { Board, FloorTable } from '@/types'
import WallSystem from './WallSystem'
import { useState, useCallback, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { CameraController } from './CameraController'
import { EditModeOverlay } from './EditModeOverlay'
import { DraggableBoard } from './DraggableBoard'
import { WallDropZone } from '@/components/3d/WallDropZone'
import RightCommentPanel from '@/components/RightCommentPanel'
import LightboxModal from '@/components/LightboxModal'
import { useBoardState } from './useBoardState'
import { loadTexture } from './useBoardTexture'
import { useBoardUpload } from '@/hooks/useBoardUpload'
import FloorEditorOverlay from './FloorEditorOverlay'
import TableWithModel from './TableWithModel'
import ModelViewer from './ModelViewer'
import type { Session, AuthChangeEvent, User } from '@supabase/supabase-js'
import { toast } from '@/lib/toast'


interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallTransformOverride {
  x: number
  z: number
  rotationY: number
}

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
  customTransforms?: WallTransformOverride[]
}

interface StudioRoomProps {
  /**
   * URL `[id]` segment. **Post-Phase-6.2b URL flip this is a room id**, not a
   * workspace id. Kept named `studioId` because the prop is referenced in
   * many places; rename has wider blast radius. Use `workspaceId` (below) for
   * any workspace-scoped operation.
   */
  studioId: string
  /**
   * Phase 6.1 room id (resolved by /api/boards). Forwarded to upload /
   * duplicate so new boards land on the correct room. Same value as studioId
   * post-6.2b, but keeping both makes intent explicit at call sites.
   */
  roomId?: string | null
  /**
   * Workspace id resolved from /api/boards' room → workspace lookup. Used for
   * everything that's workspace-scoped: membership check, wall-config
   * (per-workspace), board duplicate, board upload's `workspaceId` form field,
   * floor editor passthrough. Optional/null until the studio page resolves it.
   */
  workspaceId?: string | null
  boards: Board[]
  wallConfig: WallConfig
  onBoardUpdate: () => Promise<void>
  onEditModeChange?: (isEditing: boolean) => void
  /**
   * Fires with the wall index the local user is editing (0-based) or null when
   * they exit. Lets the studio page broadcast the active wall over presence.
   * Additive to onEditModeChange — both fire on enter/exit.
   */
  onEditingWallChange?: (wallIndex: number | null) => void
  /**
   * Wall indices currently being edited by OTHER users (from presence). Walls in
   * this set get a faint highlight in the 3D view. Excludes the local user.
   */
  othersEditingWalls?: Set<number>
  /** When provided, floor editor open state is controlled by the parent (e.g. header button). */
  floorEditorOpen?: boolean
  onFloorEditorOpenChange?: (open: boolean) => void
  /** 'tables' = place tables/models, 'walls' = move/rotate walls. */
  floorEditorMode?: 'tables' | 'walls'
  /** Called when user updates wall positions/rotations in floor editor (walls mode). */
  onWallConfigChange?: (config: WallConfig) => void
  /** When true, upload and editing are disabled (view-only mode). */
  isArchived?: boolean
  /** Increments on any realtime comment change so open panels refetch. */
  commentNonce?: number
  /** Current authenticated user's role in this workspace. */
  currentUserRole?: 'instructor' | 'student' | null
  /**
   * Tier 2 optimistic-concurrency: shared mutable base version the wall-config
   * blob is based on. Read when POSTing a floor/wall save; bumped on success.
   * Owned by the studio page so the geometry-drag path and the floor-editor
   * path share one version.
   */
  wallVersionRef?: React.MutableRefObject<number>
  /**
   * Called with the server's latest config (incl. embedded `version`) when a
   * wall-config save is rejected as stale (409). The parent reloads local state
   * and shows the conflict toast.
   */
  onWallConfigConflict?: (latest: Record<string, unknown> & { version?: number }) => void
}

function SceneContent({
  studioId,
  boards: _boards,
  wallConfig,
  othersEditingWalls,
  onBoardUpdate: _onBoardUpdate,
  onWallClick,
  onWallHover,
  editingWall,
  placedBoards3D,
  editingWallPosition,
  editingWallRotation,
  editingWallBaseRotation,
  editingWallDimensions,
  onBoardPositionChange,
  onBoardRotationChange,
  onBoardRotationPersisted,
  onBoardDelete,
  draggingFromSidebar,
  onBoardDrop,
  onDragCancel,
  onCommentClick,
  selectedBoardId,
  setSelectedBoardId,
  onDeselect,
  isWorkspaceMember,
  localBoards,
  hoveredBoardId,
  onBoardHover,
  onBoardClick,
  editingWallSide,
  tables,
  onFloorClick,
  onTableModelClick,
  orbitControlsRef,
  showEditUI,
}: StudioRoomProps & {
  onWallClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number, side: 'front' | 'back') => void
  /** Pointer-over on a wall surface. Used to fire-and-forget pre-warm board textures. */
  onWallHover?: (wallIndex: number, side: 'front' | 'back') => void
  editingWall: number | null
  placedBoards3D: Map<string, { x: number; y: number; width?: number; height?: number }>
  editingWallPosition: THREE.Vector3 | null
  editingWallRotation: number
  editingWallBaseRotation: number
  editingWallDimensions: WallDimensions | null
  onBoardPositionChange: (boardId: string, localX: number, localY: number, width?: number, height?: number) => void
  onBoardRotationChange: (boardId: string, rotation: number) => void
  /** Mirrors a confirmed (server-acked) rotation back into useBoardState.boards so post-edit-mode rendering sees it. */
  onBoardRotationPersisted: (boardId: string, rotation: number) => void
  onBoardDelete: (boardId: string) => void
  draggingFromSidebar: Board | null
  onBoardDrop: (localX: number, localY: number) => void
  onDragCancel: () => void
  onCommentClick: (board: Board) => void
  selectedBoardId: string | null
  setSelectedBoardId: (id: string | null) => void
  onDeselect?: () => void
  isWorkspaceMember?: boolean
  localBoards: Board[]
  hoveredBoardId?: string | null
  onBoardHover?: (boardId: string | null) => void
  onBoardClick?: (board: Board) => void
  editingWallSide: 'front' | 'back'
  tables: FloorTable[]
  onFloorClick?: () => void
  onTableModelClick?: (modelUrl: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orbitControlsRef: React.RefObject<any>
  showEditUI: boolean
}) {
  useThree()
  const maxWallHeightRef = useRef<number>(96)
  const [targetY, setTargetY] = useState<number>(48) // inches; focus point for zoom
  const sceneInitLoggedRef = useRef(false)
  

  // Log initial scene mount to measure perceived open time
  useEffect(() => {
    if (sceneInitLoggedRef.current) return
    sceneInitLoggedRef.current = true
  }, [wallConfig])

  // Single mapping: Left = orbit, Right = pan, Middle = dolly (zoom). Force damping off so rotation stops when mouse is released.
  useFrame(() => {
    const controlsObj = orbitControlsRef.current?.get ? orbitControlsRef.current.get() : orbitControlsRef.current
    if (controlsObj?.mouseButtons) {
      ;(controlsObj as { enableDamping?: boolean; dampingFactor?: number }).enableDamping = false
      ;(controlsObj as { enableDamping?: boolean; dampingFactor?: number }).dampingFactor = 0
      controlsObj.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }
      controlsObj.screenSpacePanning = true
    }
  })

  // Set target height initially
  useEffect(() => {
    const controlsObj = orbitControlsRef.current?.get ? orbitControlsRef.current.get() : orbitControlsRef.current
    if (controlsObj?.target) {
      controlsObj.target.set(0, targetY, 0)
      controlsObj.update?.()
    }
  }, [targetY])

  // Removed aggressive wheel clamping; let OrbitControls zoom to cursor naturally
  
  return (
    <>
      {/* Background matches wall color */}
      <color attach="background" args={['#D8DEFF']} />
      {/* Ambient light - reduced for better shadow definition */}
      <ambientLight intensity={0.5} />
      
      {/* Main directional light - creates shadows and depth */}
      <directionalLight 
        position={[15, 20, 10]} 
        intensity={1.2} 
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={500}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
        shadow-bias={-0.0001}
      />
      
      {/* Fill light from opposite side - softens shadows */}
      <directionalLight position={[-10, 12, -8]} intensity={0.5} />
      
      {/* Top light for overall illumination */}
      <directionalLight position={[0, 25, 0]} intensity={0.4} />
      
      {/* Rim lighting for wall edges - enhances depth */}
      <directionalLight position={[-8, 10, -12]} intensity={0.3} color="#ffffff" />
      <directionalLight position={[8, 10, 12]} intensity={0.3} color="#ffffff" />
      
      {/* Hemisphere light for natural ambient */}
      <hemisphereLight args={['#ffffff', '#e5e7eb', 0.3]} />
      
      {/* Floor is now created dynamically in WallSystem based on wall configuration */}
      
      <WallSystem
        boards={localBoards}
        wallConfig={wallConfig}
        onWallClick={onWallClick}
        onWallHover={onWallHover}
        editingWall={editingWall}
        editUIActive={showEditUI}
        othersEditingWalls={othersEditingWalls}
        onBoardClick={onBoardClick || onCommentClick}
        highlightedBoardId={hoveredBoardId}
        onBoardHover={onBoardHover}
        onFloorClick={onFloorClick}
      />

      {/* Tables with optional 3D models on floor - click table to open model in viewer */}
      {tables.map((table) => (
        <TableWithModel key={table.id} table={table} onTableClick={onTableModelClick} />
      ))}

      
      {/* Drop zone for dragging from sidebar */}
      {editingWall !== null && editingWallPosition && editingWallDimensions && draggingFromSidebar && (
        <WallDropZone
          wallPosition={editingWallPosition}
          wallRotation={editingWallRotation}
          wallBaseRotationForCoords={editingWallBaseRotation}
          wallDimensions={editingWallDimensions}
          onDrop={onBoardDrop}
          onDragCancel={onDragCancel}
        />
      )}
      
      {/* Render draggable boards when in edit mode */}
      {showEditUI && editingWall !== null && editingWallPosition && editingWallDimensions && (
        <>
          {/* Invisible plane to catch clicks on empty space and deselect */}
          {/* Position it at the wall (z = 0), boards are in front at z = 0.15 */}
          <mesh
            position={[editingWallPosition.x, editingWallPosition.y, editingWallPosition.z]}
            rotation={[0, editingWallRotation, 0]}
            onPointerDown={(e) => {
              // Only deselect if clicking directly on the wall (not on a board)
              // Boards will stop propagation, so if we get here, it's empty space
              e.stopPropagation()
              // Deselect immediately
              if (onDeselect) {
                devLog('🖱️ [SceneContent] Pointer down on empty wall space - deselecting')
                onDeselect()
              }
            }}
            onClick={(e) => {
              // Also handle onClick as backup
              e.stopPropagation()
              if (onDeselect) {
                devLog('🖱️ [SceneContent] onClick on empty wall space - deselecting')
                onDeselect()
              }
            }}
            // Make sure this plane is behind boards by setting renderOrder
            renderOrder={-1}
          >
            <planeGeometry args={[editingWallDimensions.width * 12, editingWallDimensions.height * 12]} />
            <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
          </mesh>
          
          {(() => {
            const entries = Array.from(placedBoards3D.entries())
            devLog('🎨 [SceneContent] Rendering', entries.length, 'draggable boards for wall', editingWall)
            return entries.map(([boardId, localPos]) => {
              const board = localBoards.find(b => b.id === boardId)
              if (!board) {
                console.warn(`❌ [SceneContent] Board ${boardId} not found in localBoards list`)
                return null
              }
              
              // Verify board is on the correct side
              // const boardSide = board.position?.side || 'front'
              
              // REMOVE: if (boardSide !== 'front') {
              // REMOVE:   console.warn(`⚠️ [SceneContent] Board ${boardId} is on ${boardSide} side but we're editing front side`)
              // REMOVE: }
              
              devLog(`🎨 [SceneContent] Rendering board ${boardId}`)
              
              return (
                <DraggableBoard
                  // Key by localId (stable across temp→real id swap) so an
                  // in-flight drag/resize gesture survives when an upload
                  // completes mid-gesture. Falls back to board.id for boards
                  // loaded from the server without an in-session localId.
                  key={board.localId || boardId}
                  board={board}
                  wallIndex={editingWall}
                  wallPosition={editingWallPosition}
                  wallRotation={editingWallRotation}
                  wallBaseRotationForCoords={editingWallBaseRotation}
                  wallDimensions={editingWallDimensions}
                  side={editingWallSide}
                  initialLocalPosition={localPos}
                  onDragEnd={onBoardPositionChange}
                  onRotationChange={onBoardRotationChange}
                  onRotationPersisted={onBoardRotationPersisted}
                  onDelete={onBoardDelete}
                  onCommentClick={onCommentClick}
                  onSelect={() => setSelectedBoardId(board.id)}
                  onDeselect={onDeselect}
                  isSelected={selectedBoardId === board.id}
                  workspaceId={studioId}
                  isWorkspaceMember={isWorkspaceMember}
                />
              )
            })
          })()}
        </>
      )}
      
      {/* Calculate camera controls based on wall dimensions */}
      {(() => {
        // Find the largest wall dimensions (in feet)
        const maxWallWidth = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.width)) : 8
        const maxWallHeight = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.height)) : 8

        // Convert to inches (1 unit = 1 inch)
        const maxWallWidthInches = maxWallWidth * 12
        const maxWallHeightInches = maxWallHeight * 12

        // Baseline room: 8ft wide, 8ft tall
        const baseWidthInches = 8 * 12

        // Scale distance based on overall footprint, not just a single wall.
        // For zigzag / multi-wall layouts, back the camera up further so ALL walls are visible on first load.
        const wallCount = wallConfig?.walls?.length ?? 1
        const layoutType = wallConfig?.layoutType ?? 'zigzag'
        const layoutFactor =
          layoutType === 'zigzag' || layoutType === 'square' || layoutType === 'lshape'
            ? Math.max(1, wallCount / 2)
            : 1

        // Wider rooms (or more connected walls) push the camera back more.
        const distanceScale = ((maxWallWidthInches * layoutFactor) / baseWidthInches) || 1
        const minDistance = 80 * distanceScale       // Pull camera back a bit more by default
        const maxDistance = 1200 * distanceScale     // Allow zooming further out for very long rooms

        // Aim slightly above mid-wall (where boards typically sit) so zoom goes toward the walls, not the floor.
        const targetHeight = Math.max(60, Math.min(maxWallHeightInches * 0.65, maxWallHeightInches)) || 60
        // Axonometric view: position camera at diagonal angle with moderate elevation
        // For axonometric/isometric view: 30-35 degree elevation, positioned diagonally
        // Base distance scaled so that all walls fit comfortably on first load.
        const baseDistance = 110 * distanceScale
        const elevationAngle = 35 * (Math.PI / 180) // 35 degrees elevation
        const azimuthAngle = 45 * (Math.PI / 180)   // 45 degrees around (diagonal view)
        
        // Calculate axonometric camera position
        const horizontalDistance = baseDistance * Math.cos(elevationAngle)
        const cameraHeight = targetHeight + (baseDistance * Math.sin(elevationAngle))
        const cameraX = horizontalDistance * Math.sin(azimuthAngle)
        const cameraZ = horizontalDistance * Math.cos(azimuthAngle)
        
        maxWallHeightRef.current = maxWallHeightInches

        // Keep target in sync for OrbitControls updates
        if (targetY !== targetHeight) {
          setTargetY(targetHeight)
        }
        
        return (
          <>
            {/* Set up the camera first so OrbitControls always receives a valid camera instance */}
            <PerspectiveCamera 
              makeDefault 
              position={[cameraX, cameraHeight, cameraZ]}
              fov={50}
            />

            <OrbitControls 
              ref={orbitControlsRef}
              enableDamping={false}
              dampingFactor={0}
              minDistance={minDistance}
              maxDistance={maxDistance}
              maxPolarAngle={Math.PI / 2}
              // Keep a slightly steeper minimum angle so zoom aims toward the walls, not the floor
              minPolarAngle={0.45}
              enabled={editingWall === null}
              enablePan={editingWall === null}
              enableRotate={editingWall === null}
              enableZoom={editingWall === null}
              // Keep the orbit target at eye level so scroll‑zoom moves toward the center of the walls,
              // instead of following the mouse down to the floor.
              target={[0, targetHeight, 0]}
            />
          </>
        )
      })()}


    </>
  )
}

export default function StudioRoom(props: StudioRoomProps) {
  const [user, setUser] = useState<User | null>(null)
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)
  const [isWorkspaceMember, setIsWorkspaceMember] = useState<boolean>(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orbitControlsRef = useRef<any>(null)
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user || null)
    })
    
    return () => subscription.unsubscribe()
  }, [])
  
  // Check if user is a member of this workspace. Keyed on workspaceId, not
  // studioId — post-6.2b studioId is a room id, and /api/workspaces/{room_id}
  // 404s. Stays "unknown" (false) until workspaceId resolves.
  useEffect(() => {
    const checkMembership = async () => {
      if (!user || !props.workspaceId) {
        setIsWorkspaceMember(false)
        return
      }

      try {
        const response = await fetch(`/api/workspaces/${props.workspaceId}`)
        if (response.ok) {
          // If we can fetch the workspace, user is a member (API enforces this)
          setIsWorkspaceMember(true)
        } else {
          setIsWorkspaceMember(false)
        }
      } catch (error) {
        console.error('Error checking workspace membership:', error)
        setIsWorkspaceMember(false)
      }
    }

    checkMembership()
  }, [user, props.workspaceId])
  const [editingWall, setEditingWall] = useState<number | null>(null)
  const [editingWallDimensions, setEditingWallDimensions] = useState<WallDimensions | null>(null)
  const [editingWallPosition, setEditingWallPosition] = useState<THREE.Vector3 | null>(null)
  const [editingWallRotation, setEditingWallRotation] = useState<number>(0)
  const [editingWallBaseRotation, setEditingWallBaseRotation] = useState<number>(0)
  const [editingWallSide, setEditingWallSide] = useState<'front' | 'back'>('front')
  const [cameraTransitionKey, setCameraTransitionKey] = useState(0)
  const [showEditUI, setShowEditUI] = useState(false)
  const [floorEditorOpenInternal, setFloorEditorOpenInternal] = useState(false)
  const floorEditorOpen = props.floorEditorOpen !== undefined ? props.floorEditorOpen : floorEditorOpenInternal
  const setFloorEditorOpen = useCallback(
    (open: boolean) => {
      props.onFloorEditorOpenChange?.(open)
      if (props.floorEditorOpen === undefined) setFloorEditorOpenInternal(open)
    },
    [props.onFloorEditorOpenChange, props.floorEditorOpen]
  )
  const [modelViewerUrl, setModelViewerUrl] = useState<string | null>(null)
  const sanitizeTables = useCallback((raw: FloorTable[] | undefined): FloorTable[] => {
    const list = Array.isArray(raw) ? raw : []
    return list.map((t) => ({
      ...t,
      modelUrl: t.modelUrl?.startsWith('blob:') ? undefined : t.modelUrl,
    }))
  }, [])
  const [tables, setTables] = useState<FloorTable[]>(() => sanitizeTables((props.wallConfig as { tables?: FloorTable[] }).tables))
  const [placedBoards3D, setPlacedBoards3D] = useState<Map<string, {
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
  }>>(new Map())
  const [lightboxBoard, setLightboxBoard] = useState<Board | null>(null)
  const [compareBoardIds, setCompareBoardIds] = useState<string[]>([])
  const shiftPressedRef = useRef(false)
  
  // Keep a ref to the latest placedBoards3D to avoid stale closure issues
  const placedBoards3DRef = useRef(placedBoards3D)
  useEffect(() => {
    placedBoards3DRef.current = placedBoards3D
  }, [placedBoards3D])
  const [draggingFromSidebar, setDraggingFromSidebar] = useState<Board | null>(null)
  const [commentPanelBoard, setCommentPanelBoard] = useState<Board | null>(null)
  const copiedBoardRef = useRef<Board | null>(null)
  const {
    boards: localBoards,
    boardPositions,
    loadWallPositions,
    updateBoardPosition,
    applyBoardRotationLocal,
    deleteBoard,
    addTempBoard,
    replaceTempBoard,
    removeTempBoard,
    undo,
    redo,
  } = useBoardState(props.boards, props.studioId, async () => { await Promise.resolve(); props.onBoardUpdate() })

  // Sync tables when wall config loads or studio changes (strip blob URLs so GLTF never sees them)
  useEffect(() => {
    const configTables = (props.wallConfig as { tables?: FloorTable[] }).tables
    setTables(sanitizeTables(configTables))
  }, [props.studioId, props.wallConfig, sanitizeTables])

  // Floor click no longer opens editor; use header "Place 3D model" button instead

  // Open model in overlay (same page). Never pass blob URLs to viewer (they fail to fetch).
  const handleTableModelClick = useCallback((modelUrl: string) => {
    if (modelUrl.startsWith('blob:')) return
    setModelViewerUrl(modelUrl)
  }, [])

  const handleFloorEditorSave = useCallback(() => {
    setFloorEditorOpen(false)
    // Save in background so user isn't stuck if the request hangs
    const tablesToSave = tables.map((t) => {
      const url = t.modelUrl ?? ''
      const isBlob = url.startsWith('blob:')
      const isPersistable =
        !isBlob &&
        (url.startsWith('http://') ||
          url.startsWith('https://') ||
          (url.startsWith('/') && !url.startsWith('//')))
      return { ...t, modelUrl: isPersistable ? url : undefined }
    })
    const payload = { ...props.wallConfig, tables: tablesToSave }
    // Wall-config is workspace-scoped (Phase 6.2 leaves it unchanged): both the
    // localStorage key and the API path key on workspace id, NOT room id. Fall
    // back to studioId only as a brief safety net before workspaceId resolves.
    const wsKey = props.workspaceId ?? props.studioId
    const savedConfigKey = `studio-${wsKey}-wall-config`
    try {
      // Keep local fallback compact and avoid huge transient model payloads.
      localStorage.setItem(savedConfigKey, JSON.stringify(payload))
    } catch (error) {
      console.warn('Wall config local cache skipped (quota/full storage)', error)
      try {
        localStorage.setItem(
          savedConfigKey,
          JSON.stringify({
            layoutType: props.wallConfig.layoutType,
            walls: props.wallConfig.walls,
          })
        )
      } catch {
        // Local cache is best-effort only; API save remains source of truth.
      }
    }
    // Tier 2: send the version this layout is based on. A 409 means another
    // user changed the room first — don't retry (it isn't transient); hand the
    // latest back to the parent to reload + toast.
    const savePayload = JSON.stringify({ baseVersion: props.wallVersionRef?.current ?? 0, config: payload })
    const saveOnce = async (): Promise<'ok' | 'conflict'> => {
      const res = await fetch(`/api/studios/${wsKey}/wall-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: savePayload,
      })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({} as { latest?: Record<string, unknown> & { version?: number } }))
        if (data.latest && props.onWallConfigConflict) props.onWallConfigConflict(data.latest)
        return 'conflict'
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json().catch(() => ({} as { version?: number }))
      if (typeof data.version === 'number' && props.wallVersionRef) props.wallVersionRef.current = data.version
      return 'ok'
    }

    ;(async () => {
      try {
        if ((await saveOnce()) === 'conflict') return
      } catch (firstError) {
        try {
          if ((await saveOnce()) === 'conflict') return
        } catch (secondError) {
          console.error('Failed to save floor/wall config', { firstError, secondError })
          const message = secondError instanceof Error ? secondError.message : 'Please try again.'
          toast.error(`Could not save studio model layout. ${message}`)
        }
      }
    })()
  }, [props.studioId, props.workspaceId, props.wallConfig, props.wallVersionRef, props.onWallConfigConflict, tables])

  // Keep placedBoards3D in sync with boardPositions (e.g. after undo/redo)
  useEffect(() => {
    if (editingWall === null || editingWallSide == null) return
    const currentPlaced = placedBoards3DRef.current
    const newMap = new Map<string, { x: number; y: number; width?: number; height?: number; rotation?: number }>()
    const wallBoards = localBoards.filter(b => b.position?.wallIndex === editingWall && (b.position?.side || 'front') === editingWallSide)
    wallBoards.forEach(board => {
        const isTemp = board.id.startsWith('temp-')
        const pos = boardPositions.get(board.id)
        const existing = currentPlaced.get(board.id)
        // Temp boards: never overwrite center with boardPositions (avoids jump to corner from async timing)
        const alreadyAtCenter = existing && Math.abs(existing.x) < 0.01 && Math.abs(existing.y) < 0.01
        if (isTemp && existing && alreadyAtCenter) {
          newMap.set(board.id, existing)
        } else if (pos) {
          const usePos = isTemp ? { ...pos, x: 0, y: 0 } : pos
          newMap.set(board.id, usePos)
        } else if (isTemp) {
          // Temp not in boardPositions yet (async batching); keep at center so upload always shows immediately
          newMap.set(board.id, existing ?? { x: 0, y: 0, width: 0.3, height: 0.3 })
        } else if (existing) {
          // Real board not in boardPositions yet (e.g. after refetch/race); keep current placement so it doesn't disappear
          newMap.set(board.id, existing)
        }
      })
    setPlacedBoards3D(newMap)
  }, [boardPositions, editingWall, editingWallSide, localBoards])

  // Surface the wall the local user is editing (or null on exit) so the studio
  // page can broadcast it via presence. Additive — onEditModeChange is unchanged.
  useEffect(() => {
    props.onEditingWallChange?.(editingWall)
  }, [editingWall, props.onEditingWallChange])

  /**
   * Walls whose board full-image textures have been pre-warmed in this session.
   * Keyed `${wallIndex}-${side}`. Lives for the StudioRoom mount lifetime — no
   * eviction, because the underlying useBoardTexture cache is also session-long.
   */
  const prefetchedWallsRef = useRef<Set<string>>(new Set())

  /**
   * Pointer-over on a wall surface: fire-and-forget pre-warm of full-image
   * textures for boards on that wall, so the click → edit-mode transition
   * doesn't show the grey skeleton placeholder. Idempotent per (wall, side)
   * via prefetchedWallsRef; loadTexture itself also dedups in-flight and
   * resolved entries via its module-level caches.
   */
  const handleWallHover = useCallback((wallIndex: number, side: 'front' | 'back') => {
    const key = `${wallIndex}-${side}`
    if (prefetchedWallsRef.current.has(key)) return
    prefetchedWallsRef.current.add(key)
    const boardsOnWall = localBoards.filter(
      b => b.position?.wallIndex === wallIndex && (b.position?.side || 'front') === side
    )
    for (const board of boardsOnWall) {
      if (board.fullImageUrl) {
        loadTexture(board.fullImageUrl).catch(() => {})
      }
    }
  }, [localBoards])

  const handleWallClick = (
    wallIndex: number,
    wallDimensions: WallDimensions,
    position: THREE.Vector3,
    rotation: number,
    side: 'front' | 'back'
  ) => {
    if (props.isArchived) return
    // Belt-and-suspenders prefetch for users who click without hovering
    // (touch, fast clickers, keyboard). Idempotent — handleWallHover early-
    // returns for already-prefetched walls.
    handleWallHover(wallIndex, side)
    devLog('🖼️ [StudioRoom] Wall clicked:', wallIndex, 'rotation:', rotation, 'side:', side)

    // If we're already editing this wall and side, don't reinitialize
    if (editingWall === wallIndex && editingWallSide === side) {
      devLog('🖼️ [StudioRoom] Already editing this wall side, keeping current positions')
      return
    }
    
    // Hide edit UI first, let camera animation play, then show UI
    setShowEditUI(false)
    props.onEditModeChange?.(false)
    setCameraTransitionKey(prev => prev + 1)
    
    setEditingWall(wallIndex)
    setEditingWallDimensions(wallDimensions)
    setEditingWallPosition(position)
    setEditingWallRotation(rotation)
    setEditingWallSide(side)
    // Base rotation (same as wall transform) so (x,y) coords are consistent for front and back – avoids inversion
    setEditingWallBaseRotation(side === 'back' ? rotation - Math.PI : rotation)

    // Load positions from central hook (API → normalized + size)
    const wallPositions = loadWallPositions(wallIndex, wallDimensions, side)

    // Copy all boards on this wall AND this side into placedBoards3D (include fallback so boards don't disappear when pos is missing)
    const newMap = new Map<string, { x: number; y: number; width: number; height: number; rotation?: number }>()
    const wallBoardsForEdit = localBoards.filter(b => {
      if (b.position?.wallIndex !== wallIndex) return false
      const boardSide = b.position?.side || 'front'
      return boardSide === side
    })
    // No x inversion: API/wall-local convention is consistent; left = negative, right = positive in both 2D and 3D
    wallBoardsForEdit.forEach(board => {
      const pos = wallPositions.get(board.id)
      const validPos = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)
      if (validPos) {
        const displayX = pos.x
        newMap.set(board.id, { x: displayX, y: pos.y, width: pos.width ?? 0.3, height: pos.height ?? 0.3 })
      } else {
        // Fallback: board is on this wall/side but no valid pos (missing from loadWallPositions or invalid). Show at center so it doesn't disappear in 2D.
        const x = board.position?.x != null && Number.isFinite(board.position.x) ? board.position.x / 100 - 0.5 : 0
        const y = board.position?.y != null && Number.isFinite(board.position.y) ? board.position.y / 100 - 0.5 : 0
        let w = 0.3
        let h = 0.3
        if (board.position?.width != null && board.position?.height != null && board.position.width > 0 && board.position.height > 0) {
          w = board.position.width / 100
          h = board.position.height / 100
        }
        newMap.set(board.id, { x, y, width: w, height: h })
      }
    })

    devLog('🖼️ [StudioRoom] Total boards to render on', side, 'side:', newMap.size)
    setPlacedBoards3D(newMap)
  }


  const handleCameraTransitionComplete = () => {
    if (editingWall !== null) {
      setShowEditUI(true)
      props.onEditModeChange?.(true)
    }
  }

  const handleEditComplete = () => {
    if (editingWall === null) return

    const currentBoards = placedBoards3DRef.current
    const wallToSave = editingWall
    const sideToSave = editingWallSide
    // Exit to 3D immediately so the transition feels instant
    setShowEditUI(false)
    props.onEditModeChange?.(false)
    setCameraTransitionKey(prev => prev + 1)
    setEditingWall(null)
    setEditingWallPosition(null)
    setEditingWallDimensions(null)
    setEditingWallSide('front')
    setEditingWallBaseRotation(0)
    devLog('✅ [StudioRoom] Exited edit mode')

    // Persist positions in the background (no await)
    const savePromises: Promise<void>[] = []
    // No x inversion: API 0–100 matches wall-local; DraggableBoard + WallSystem use same convention for front and back
    currentBoards.forEach((position, boardId) => {
      const board = localBoards.find(b => b.id === boardId)
      if (board && wallToSave !== null) {
        const normX = position.x ?? 0
        const saveX = normX
        const p = updateBoardPosition(
          boardId,
          wallToSave,
          saveX,
          position.y ?? 0,
          position.width,
          position.height,
          sideToSave ?? 'front',
          // Forward rotation mirrored from DraggableBoard via
          // handleBoardRotationChange. undefined when the user never rotated
          // this board in the current edit session — useBoardState passes
          // through, /api/boards PUT preserves the existing column value.
          position.rotation
        ).catch(err => {
          console.error(`❌ [StudioRoom] Failed to save position for board ${boardId}:`, err)
        })
        if (p) savePromises.push(p)
      }
    })

    const boardIdsOnWall = new Set(currentBoards.keys())
    const boardsToRemove = localBoards.filter(
      b =>
        b.position?.wallIndex === wallToSave &&
        (b.position?.side || 'front') === (sideToSave ?? 'front') &&
        !boardIdsOnWall.has(b.id)
    )

    // Run position saves in background (always)
    const allSaves = savePromises.length > 0
      ? Promise.all(savePromises)
      : Promise.resolve()
    if (boardsToRemove.length > 0) {
      allSaves
        .then(() => {
          devLog('🗑️ [StudioRoom] Clearing position for', boardsToRemove.length, 'boards')
          return Promise.all(
            boardsToRemove.map(board =>
              fetch('/api/boards', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...board, position: undefined }),
              })
            )
          )
        })
        .then(() => props.onBoardUpdate())
        .catch(err => console.error('❌ [StudioRoom] Background save failed:', err))
    } else {
      allSaves.catch(err => console.error('❌ [StudioRoom] Background position save failed:', err))
    }
  }

  const handleLightboxOpen = (board: Board) => {
    setCommentPanelBoard(null)
    if (shiftPressedRef.current) {
      setCompareBoardIds((prev) =>
        prev.includes(board.id)
          ? prev.filter((id) => id !== board.id)
          : [...prev, board.id]
      )
      return
    }
    setCompareBoardIds((prev) => (
      prev.length > 1 && prev.includes(board.id) ? prev : []
    ))
    setLightboxBoard(board)
  }

  const handleLightboxNavigate = (direction: 'prev' | 'next') => {
    if (!lightboxBoard) return
    const idx = localBoards.findIndex(b => b.id === lightboxBoard.id)
    if (idx === -1) return
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1
    if (nextIdx < 0 || nextIdx >= localBoards.length) return
    setLightboxBoard(localBoards[nextIdx])
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      shiftPressedRef.current = event.shiftKey
    }
    const onKeyUp = (event: KeyboardEvent) => {
      shiftPressedRef.current = event.shiftKey
    }
    const resetShift = () => {
      shiftPressedRef.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', resetShift)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', resetShift)
    }
  }, [])


  

  const handleBoardSelect = (board: Board) => {
    if (editingWall === null || !editingWallPosition || !editingWallDimensions) return
    
    if (placedBoards3D.has(board.id)) {
      toast.error('This board is already on the wall')
      return
    }

    const imageUrl = board.fullImageUrl || board.thumbnailUrl || ''
    if (!imageUrl || imageUrl.includes('placeholder')) {
      toast.error('This board cannot be displayed (no valid file)')
      return
    }
    
    // Calculate dimensions based on aspect ratio
    let widthPercent = 0.30
    let heightPercent = 0.30
    
    if (board.aspectRatio) {
      const baseHeightPercent = 0.35
      heightPercent = baseHeightPercent
      
      const wallAspectRatio = editingWallDimensions.width / editingWallDimensions.height
      widthPercent = baseHeightPercent * board.aspectRatio / wallAspectRatio
      
      // Clamp to reasonable sizes
      const maxWidth = 0.50
      const maxHeight = 0.60
      
      if (widthPercent > maxWidth) {
        const scale = maxWidth / widthPercent
        widthPercent = maxWidth
        heightPercent = heightPercent * scale
      }
      if (heightPercent > maxHeight) {
        const scale = maxHeight / heightPercent
        heightPercent = maxHeight
        widthPercent = widthPercent * scale
      }
      
      const minSize = 0.15
      widthPercent = Math.max(minSize, widthPercent)
      heightPercent = Math.max(minSize, heightPercent)
    }
    
    // Place at center
    setPlacedBoards3D(prev => {
      const newMap = new Map(prev)
      newMap.set(board.id, { x: 0, y: 0, width: widthPercent, height: heightPercent })
      return newMap
    })
  }

  const handleBoardDragStart = (board: Board) => {
    const imageUrl = board.fullImageUrl || board.thumbnailUrl || ''
    if (!imageUrl || imageUrl.includes('placeholder')) {
      return
    }
    setDraggingFromSidebar(board)
  }

  const handleBoardDrop = async (localX: number, localY: number) => {
    if (!draggingFromSidebar || editingWall === null || !editingWallDimensions) {
      devLog('Drop failed: no board dragging or no wall selected')
      return
    }
    
    // Check if already on wall
    if (placedBoards3D.has(draggingFromSidebar.id)) {
      toast.error('This board is already on the wall')
      setDraggingFromSidebar(null)
      return
    }
    
    try {
      let imageAspectRatio: number = 1 // Default to 1:1 if we can't determine
      
      // Use stored aspect ratio if available, otherwise load image
      let img: HTMLImageElement | null = null
      if (draggingFromSidebar.aspectRatio) {
        imageAspectRatio = draggingFromSidebar.aspectRatio
        devLog('📐 Using stored aspect ratio:', imageAspectRatio.toFixed(3))
      } else {
        devLog('📐 Loading image to calculate aspect ratio...')
        // Load image to get its natural dimensions
        const imageUrl = draggingFromSidebar.fullImageUrl || draggingFromSidebar.thumbnailUrl
        if (!imageUrl) {
          setDraggingFromSidebar(null)
          return
        }
        
        img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = imageUrl
        
        await new Promise<void>((resolve, reject) => {
          if (!img) return reject(new Error('Image not initialized'))
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Failed to load image'))
          // Timeout after 5 seconds
          setTimeout(() => reject(new Error('Image load timeout')), 5000)
        })
        
        if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
          imageAspectRatio = img.naturalWidth / img.naturalHeight
          devLog(`📐 Image dimensions: ${img.naturalWidth}x${img.naturalHeight}, aspect: ${imageAspectRatio.toFixed(2)}`)
        }
      }
      
      // Scale board to be max 35% of wall dimensions while maintaining aspect ratio
      const maxWidthPercent = 0.35
      const maxHeightPercent = 0.35
      
      let boardWidth: number
      let boardHeight: number
      
      if (imageAspectRatio > 1) {
        // Landscape image (wider than tall)
        boardWidth = maxWidthPercent
        boardHeight = maxWidthPercent / imageAspectRatio * (editingWallDimensions.width / editingWallDimensions.height)
      } else {
        // Portrait image (taller than wide)
        boardHeight = maxHeightPercent
        boardWidth = maxHeightPercent * imageAspectRatio * (editingWallDimensions.height / editingWallDimensions.width)
      }
      
      if (img) {
        devLog(`📐 Image dimensions: ${img.naturalWidth}x${img.naturalHeight}, aspect: ${imageAspectRatio.toFixed(2)}`)
      }
      devLog(`📏 Board size on wall: ${(boardWidth * 100).toFixed(1)}% x ${(boardHeight * 100).toFixed(1)}%`)
      devLog(`✅ Dropping board ${draggingFromSidebar.id} at position:`, { x: localX, y: localY })
      
      setPlacedBoards3D(prev => {
        const newMap = new Map(prev)
        newMap.set(draggingFromSidebar.id, { 
          x: localX, 
          y: localY,
          width: boardWidth,
          height: boardHeight
        })
        devLog('📍 Total boards on wall:', newMap.size)
        return newMap
      })
      
      // Save position to database
      if (editingWall !== null) {
        updateBoardPosition(
          draggingFromSidebar.id,
          editingWall,
          localX,           // normalized position (-0.5 to 0.5)
          localY,           // normalized position (-0.5 to 0.5)
          boardWidth,       // decimal 0.0 to 1.0
          boardHeight       // decimal 0.0 to 1.0
        )
      }
    } catch (error) {
      console.error('Failed to load image for aspect ratio calculation:', error)
      // Fallback to square if image fails to load
      setPlacedBoards3D(prev => {
        const newMap = new Map(prev)
        newMap.set(draggingFromSidebar.id, { 
          x: localX, 
          y: localY,
          width: 0.2,
          height: 0.2
        })
        return newMap
      })
      
      // Save position to database even on error (with fallback dimensions)
      if (editingWall !== null) {
        updateBoardPosition(
          draggingFromSidebar.id,
          editingWall,
          localX,           // normalized position (-0.5 to 0.5)
          localY,           // normalized position (-0.5 to 0.5)
          0.2,              // fallback width
          0.2,              // fallback height
          editingWallSide
        )
      }
    }
    
    setDraggingFromSidebar(null)
  }

  const handleDragCancel = () => {
    setDraggingFromSidebar(null)
  }

  const handleBoardPositionChange = useCallback(
    (boardId: string, localX: number, localY: number, width?: number, height?: number, side?: 'front' | 'back') => {
      devLog('🔁 [StudioRoom] handleBoardPositionChange CALLED:', { boardId, localX, localY, width, height, side })

      // 1) compute finalPosition from the drag values + any existing values
      const currentMap = placedBoards3DRef.current
      const existing = currentMap.get(boardId)

      const finalPosition = {
        x: localX,
        y: localY,
        width: width ?? existing?.width ?? 0.2,
        height: height ?? existing?.height ?? 0.2,
      }

      // 2) update the Map, the ref, and the React state
      const newMap = new Map(currentMap)
      newMap.set(boardId, finalPosition)
      placedBoards3DRef.current = newMap
      setPlacedBoards3D(newMap)

      // 3) save to the DB (no x inversion: API 0–100 matches wall-local; DraggableBoard + WallSystem use same convention)
      if (editingWall !== null) {
        const sideForSave = side ?? editingWallSide ?? 'front'
        const saveX = finalPosition.x
        // Forward the latest known rotation (mirrored into placedBoards3D by
        // DraggableBoard.onRotationChange). Without this, drag-end loses any
        // pending rotation that hasn't yet been pushed by the rotate-handle's
        // own pointer-up PATCH.
        const rotationForSave = currentMap.get(boardId)?.rotation
        updateBoardPosition(
          boardId,
          editingWall,
          saveX,
          finalPosition.y,
          finalPosition.width,
          finalPosition.height,
          sideForSave,
          rotationForSave
        )
      }
    },
    [editingWall, editingWallSide, updateBoardPosition]
  )

  /**
   * Mirrors live rotation from a DraggableBoard's drag into placedBoards3D
   * so handleEditComplete (the Save & Exit bulk-saver) and handleBoardPositionChange
   * (drag-end) both have access to the latest rotation.
   */
  const handleBoardRotationChange = useCallback(
    (boardId: string, rotation: number) => {
      const currentMap = placedBoards3DRef.current
      const existing = currentMap.get(boardId)
      if (!existing) return
      const next = { ...existing, rotation }
      const newMap = new Map(currentMap)
      newMap.set(boardId, next)
      placedBoards3DRef.current = newMap
      setPlacedBoards3D(newMap)
    },
    []
  )


  const handleBoardDelete = useCallback(async (boardId: string) => {
    try {
      // Use centralized hook so local state + positions stay in sync
      const success = await deleteBoard(boardId)
      if (!success) return

      // Remove from placedBoards3D immediately so it disappears in 2D edit view
      setPlacedBoards3D(prev => {
        const newMap = new Map(prev)
        newMap.delete(boardId)
        placedBoards3DRef.current = newMap
        return newMap
      })
    } catch (error) {
      console.error('Error deleting board:', error)
      toast.error('Failed to delete board')
    }
  }, [deleteBoard])

  const handleClearWall = useCallback(async () => {
    if (editingWall === null || editingWallSide == null) return
    const side = editingWallSide
    const wallBoards = localBoards.filter(
      b => b.position?.wallIndex === editingWall && (b.position?.side || 'front') === side
    )
    if (wallBoards.length === 0) return
    for (const board of wallBoards) {
      const success = await deleteBoard(board.id)
      if (!success) {
        toast.error('Some boards could not be deleted. You may not have permission.')
        break
      }
      setPlacedBoards3D(prev => {
        const newMap = new Map(prev)
        newMap.delete(board.id)
        placedBoards3DRef.current = newMap
        return newMap
      })
    }
  }, [editingWall, editingWallSide, localBoards, deleteBoard])

  const handlePaste = useCallback(async () => {
    const copied = copiedBoardRef.current
    if (!copied || editingWall === null || editingWallSide == null || !editingWallDimensions) return
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const side = editingWallSide
    const apiWidth = copied.position?.width ?? 30
    const apiHeight = copied.position?.height ?? 30
    const tempBoard: Board = {
      id: tempId,
      // Stable client-side React key, carried onto the real board after
      // duplicate API responds so the rendering instance survives the id
      // swap. Matches the upload flow in useBoardUpload.createTempBoard.
      localId: tempId,
      // studioId stays as the URL param (= room id post-6.2b); workspaceId
      // is the actual workspace uuid resolved by the page.
      studioId: props.studioId,
      workspaceId: props.workspaceId ?? props.studioId,
      studentName: copied.studentName,
      title: (copied.title || 'Board').trimEnd() + ' (copy)',
      thumbnailUrl: copied.fullImageUrl ?? copied.thumbnailUrl,
      fullImageUrl: copied.fullImageUrl ?? copied.thumbnailUrl,
      uploadedAt: new Date(),
      tags: copied.tags ?? [],
      position: {
        wallIndex: editingWall,
        x: 50,
        y: 50,
        width: apiWidth,
        height: apiHeight,
        side,
      },
      ownerId: user?.id,
      ownerName: user?.user_metadata?.full_name ?? user?.email?.split('@')[0] ?? 'User',
      aspectRatio: copied.aspectRatio,
      originalWidth: copied.originalWidth,
      originalHeight: copied.originalHeight,
      physicalWidth: copied.physicalWidth,
      physicalHeight: copied.physicalHeight,
    }
    addTempBoard(tempBoard, copied.fullImageUrl ?? copied.thumbnailUrl)
    const normW = (apiWidth / 100) || 0.3
    const normH = (apiHeight / 100) || 0.3
    setPlacedBoards3D(prev => {
      const m = new Map(prev)
      m.set(tempId, { x: 0, y: 0, width: normW, height: normH })
      placedBoards3DRef.current = m
      return m
    })
    try {
      const res = await fetch('/api/boards/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId: copied.id,
          // Duplicate API expects a workspace id; post-6.2b URL flip studioId
          // is a room id, so use the resolved workspaceId.
          workspaceId: props.workspaceId ?? props.studioId,
          wallIndex: editingWall,
          position_x: 50,
          position_y: 50,
          position_side: side,
          position_width: apiWidth,
          position_height: apiHeight,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || 'Duplicate failed')
      }
      const data = await res.json()
      const newBoard = data.board as Board
      const onCurrentWall = newBoard.position?.wallIndex === editingWall && (newBoard.position?.side || 'front') === side
      // Carry the temp board's localId onto the real board so the React key
      // stays stable across the duplicate swap.
      const boardToUse: Board = onCurrentWall
        ? { ...newBoard, localId: tempId }
        : {
            ...newBoard,
            localId: tempId,
            position: { wallIndex: editingWall, x: 50, y: 50, width: apiWidth, height: apiHeight, side },
          }
      replaceTempBoard(tempId, boardToUse)
      setPlacedBoards3D(prev => {
        const m = new Map(prev)
        const pos = m.get(tempId)
        if (pos) {
          m.delete(tempId)
          m.set(boardToUse.id, pos)
        }
        placedBoards3DRef.current = m
        return m
      })
    } catch (err) {
      console.error('Paste failed:', err)
      removeTempBoard(tempId)
      setPlacedBoards3D(prev => {
        const m = new Map(prev)
        m.delete(tempId)
        placedBoards3DRef.current = m
        return m
      })
      toast.error('Could not paste board. You may need to be a member of the workspace.')
    }
  }, [editingWall, editingWallSide, editingWallDimensions, props.studioId, props.workspaceId, user, addTempBoard, replaceTempBoard, removeTempBoard, setPlacedBoards3D])

  const handleCopy = useCallback(() => {
    if (!selectedBoardId) return
    const board = localBoards.find(b => b.id === selectedBoardId)
    if (board) copiedBoardRef.current = board
  }, [selectedBoardId, localBoards])

  // Keyboard shortcuts: Backspace/Delete = delete selected board, Ctrl+Z = undo, Ctrl+Y = redo, Ctrl+C/V = copy/paste, Escape = deselect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // Ctrl+Z = undo, Ctrl+Y = redo, Ctrl+C = copy, Ctrl+V = paste
      if (e.ctrlKey) {
        if (e.key === 'z') {
          e.preventDefault()
          undo()
        } else if (e.key === 'y') {
          e.preventDefault()
          redo()
        } else if (e.key === 'c') {
          e.preventDefault()
          if (selectedBoardId && editingWall !== null) {
            const board = localBoards.find(b => b.id === selectedBoardId)
            if (board) copiedBoardRef.current = board
          }
        }
        return
      }

      // Backspace or Delete = delete selected board (when in edit mode)
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedBoardId && editingWall !== null) {
        e.preventDefault()
        e.stopPropagation()
        const selectedBoard = localBoards.find(b => b.id === selectedBoardId)
        if (selectedBoard) {
          devLog('⌨️ [Keyboard] Delete key - deleting board:', selectedBoardId)
          handleBoardDelete(selectedBoardId)
          setSelectedBoardId(null)
        }
      }

      // Escape = deselect or close comment panel
      if (e.key === 'Escape') {
        if (selectedBoardId) setSelectedBoardId(null)
        if (commentPanelBoard) setCommentPanelBoard(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedBoardId, editingWall, localBoards, handleBoardDelete, commentPanelBoard, undo, redo])

  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const showEditUIRef = useRef(showEditUI)
  useEffect(() => { showEditUIRef.current = showEditUI }, [showEditUI])

  const { handleUpload, uploadFileDirect, uploadFilesDirect } = useBoardUpload({
    studioId: props.studioId,
    roomId: props.roomId ?? null,
    workspaceId: props.workspaceId ?? null,
    user,
    editingWall,
    editingWallDimensions,
    editingWallSide,
    onBoardUpdate: props.onBoardUpdate,
    addTempBoard,
    replaceTempBoard,
    removeTempBoard,
    setPlacedBoards3D,
    placedBoards3DRef,
  })

  // Paste: image from clipboard → upload as new board; else copied board → paste duplicate
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingWall === null) return
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            e.stopPropagation()
            uploadFileDirect(file).then(ok => {
              if (!ok) toast.error('Could not add pasted image as a board.')
            })
          }
          return
        }
      }
      if (copiedBoardRef.current) {
        e.preventDefault()
        e.stopPropagation()
        handlePaste()
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [editingWall, uploadFileDirect, handlePaste])

  // Window-level drag-and-drop: only active when in wall edit mode
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!showEditUIRef.current) return
      if (!e.dataTransfer?.types.includes('Files')) return
      dragCounterRef.current++
      setIsDragOver(true)
    }
    const onDragLeave = () => {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
      if (dragCounterRef.current === 0) setIsDragOver(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (showEditUIRef.current && e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      dragCounterRef.current = 0
      setIsDragOver(false)
      if (!showEditUIRef.current) return
      const files = Array.from(e.dataTransfer?.files || [])
      if (files.length === 0) return
      await uploadFilesDirect(files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [uploadFilesDirect])

  return (
    <>
      {/* Full-screen 3D model viewer overlay (keeps blob URLs valid) */}
      {modelViewerUrl && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-white">
          <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white/95">
            <span className="text-sm font-medium text-gray-700">3D model</span>
            <button
              type="button"
              onClick={() => setModelViewerUrl(null)}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ModelViewer modelUrl={modelViewerUrl} />
          </div>
        </div>
      )}

      {floorEditorOpen && (
        <FloorEditorOverlay
          studioId={props.studioId}
          wallConfig={props.wallConfig}
          tables={tables}
          setTables={setTables}
          onSaveAndExit={handleFloorEditorSave}
          mode={props.floorEditorMode ?? 'tables'}
          onWallConfigChange={props.onWallConfigChange}
        />
      )}

      {/* Drag-and-drop overlay — only shown when user is in wall edit mode and dragging files */}
      {isDragOver && showEditUI && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
          <div className="absolute inset-4 rounded-2xl border-4 border-dashed border-indigo-400 bg-indigo-600/20" />
          <div className="relative bg-white/90 backdrop-blur-sm rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-3">
            <svg className="w-12 h-12 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-indigo-700 font-semibold text-xl">Drop to add to wall</p>
            <p className="text-indigo-400 text-sm">JPG, PNG, or PDF · max 50 MB each</p>
          </div>
        </div>
      )}

      <EditModeOverlay
        isVisible={showEditUI}
        wallIndex={editingWall ?? 0}
        wallDimensions={editingWallDimensions}
        availableBoards={localBoards.filter(b => {
          if (b.position?.wallIndex === editingWall) return false
          const url = b.fullImageUrl || b.thumbnailUrl || ''
          if (url.includes('placeholder') || url.length === 0) return false
          // PDFs are now allowed
          return true
        })}
        onClose={handleEditComplete}
        onUpload={handleUpload}
        onClearWall={handleClearWall}
        wallBoardCount={editingWall !== null && editingWallSide != null ? localBoards.filter(
          b => b.position?.wallIndex === editingWall && (b.position?.side || 'front') === editingWallSide
        ).length : 0}
        onCopy={handleCopy}
        onPaste={handlePaste}
        hasSelection={!!selectedBoardId}
        onBoardSelect={handleBoardSelect}
        onBoardDragStart={handleBoardDragStart}
      />
      
      <div className="w-full h-screen">
        <Canvas 
          shadows 
          gl={{ 
            shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
            alpha: true,
            premultipliedAlpha: false
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any}
          style={{ background: '#D8DEFF' }}
        >
          <CameraController
            orbitControlsRef={orbitControlsRef}
            editingWall={editingWall}
            wallPosition={editingWallPosition}
            wallRotation={editingWallRotation}
            wallDimensions={editingWallDimensions}
            transitionKey={cameraTransitionKey}
            onTransitionComplete={handleCameraTransitionComplete}
          />
          <SceneContent
            {...props}
            orbitControlsRef={orbitControlsRef}
            showEditUI={showEditUI}
            localBoards={localBoards}
            onWallClick={handleWallClick}
            onWallHover={handleWallHover}
            editingWall={editingWall}
            placedBoards3D={placedBoards3D}
            editingWallPosition={editingWallPosition}
            editingWallRotation={editingWallRotation}
            editingWallBaseRotation={editingWallBaseRotation}
            editingWallDimensions={editingWallDimensions}
            onBoardPositionChange={handleBoardPositionChange}
            onBoardRotationChange={handleBoardRotationChange}
            onBoardRotationPersisted={applyBoardRotationLocal}
            onBoardDelete={handleBoardDelete}
            draggingFromSidebar={draggingFromSidebar}
            onBoardDrop={handleBoardDrop}
            onDragCancel={handleDragCancel}
          onCommentClick={(board: unknown) => {
            const selected = board as Board
            devLog('💬 [Lightbox] Opening for:', selected.id)
            handleLightboxOpen(selected)
          }}
          onBoardClick={(board: unknown) => handleLightboxOpen(board as Board)}
            selectedBoardId={selectedBoardId}
            setSelectedBoardId={setSelectedBoardId}
            onDeselect={() => setSelectedBoardId(null)}
            isWorkspaceMember={isWorkspaceMember}
            editingWallSide={editingWallSide}
            tables={tables}
            onFloorClick={undefined}
            onTableModelClick={handleTableModelClick}
          />
        </Canvas>
      </div>

      {/* Right Comment Panel */}
      <RightCommentPanel
        board={commentPanelBoard}
        onClose={() => setCommentPanelBoard(null)}
        isArchived={props.isArchived}
        commentNonce={props.commentNonce}
      />

    <LightboxModal
      board={lightboxBoard}
      allBoards={localBoards}
      compareBoards={compareBoardIds
        .map((id) => localBoards.find((board) => board.id === id))
        .filter((board): board is Board => Boolean(board))}
      onClose={() => {
        setLightboxBoard(null)
        setCompareBoardIds([])
      }}
      onNavigate={handleLightboxNavigate}
      isEditMode={!props.isArchived}
      currentUserRole={props.currentUserRole ?? null}
    />
    </>
  )
}