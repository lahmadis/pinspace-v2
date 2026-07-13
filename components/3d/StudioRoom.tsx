'use client'

const isDev = process.env.NODE_ENV === 'development'
const devLog = (...args: unknown[]) => { if (isDev) console.log(...args) }

// TEMP diagnostic — always-on (NOT devLog-gated) tracing of placedBoards3D
// rebuilds and the lightbox link read/write path. Remove once root-caused.
const postrace = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.log('[POSTRACE]', new Date().toISOString(), ...args)
}

import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, ContactShadows } from '@react-three/drei'
import { supabase } from '@/lib/supabase/client'
import { Board, FloorTable } from '@/types'
import WallSystem from './WallSystem'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { CameraController, ROOM_DEFAULT_FOV, type FollowPose, type LaserState, type LbViewport, type LbCursorState, type CritDirtySignal, type TraceStreamEntry } from './CameraController'
import { LaserPointer } from './LaserPointer'
import { EditModeOverlay } from './EditModeOverlay'
import { DraggableBoard } from './DraggableBoard'
import { DraggableText } from './DraggableText'
import { WallDropZone } from '@/components/3d/WallDropZone'
import type { WallTextItem } from '@/lib/wallLayout'
import { calculateFloorBounds } from '@/lib/wallLayout'
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
import { getBoardSizeInches } from '@/lib/boardDimensions'


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
  /**
   * Phase B.2: follow-presenter camera sync (ephemeral broadcast). The page owns
   * the studio-live channel + state and threads these through.
   */
  /** Live broadcast channel for presenter camera packets. */
  liveChannelRef?: React.MutableRefObject<ReturnType<typeof supabase.channel> | null>
  /** True when the local user is the active presenter (broadcasts its camera). */
  isPresenter?: boolean
  /** True when the local user is following the presenter's camera. */
  isFollowing?: boolean
  /** Latest received presenter camera pose (written per broadcast message). */
  followPoseRef?: React.MutableRefObject<FollowPose | null>
  /**
   * Phase B.3.1: presenter cursor. laserRef = latest received cursor world
   * position for followers to render; laserColor = the presenter's deterministic
   * dot color. (Broadcast is always-on while presenting — no activation flag.)
   */
  laserRef?: React.MutableRefObject<LaserState | null>
  laserColor?: string
  /**
   * Phase B.3.1: lightbox follow. followLightboxBoardId = the board the presenter
   * currently has open in the lightbox (null = closed), driving the follower's
   * lightbox while in follow mode. lbViewportRef = latest received presenter
   * lightbox viewport (written per "lbv" message; smooth-applied by LightboxModal).
   */
  followLightboxBoardId?: string | null
  lbViewportRef?: React.MutableRefObject<LbViewport | null>
  /** Phase B.3.2: latest received presenter pointer-over-image (forwarded to LightboxModal). */
  lbCursorRef?: React.MutableRefObject<LbCursorState | null>
  /** Phase B.5: debounced peer trace/callout-edit signal (forwarded to LightboxModal). */
  critDirty?: CritDirtySignal | null
  /** Phase B.5.1: shared ephemeral trace-stream map (forwarded to LightboxModal). */
  traceStreamRef?: React.MutableRefObject<Map<string, TraceStreamEntry>>
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
  onBoardSizePersisted,
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
  textItems,
  selectedTextId,
  onTextSelect,
  onTextDragEnd,
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
  /** Mirrors a confirmed (server-acked) absolute size (inches) back into useBoardState.boards so post-edit-mode rendering sees it. */
  onBoardSizePersisted: (boardId: string, widthIn: number, heightIn: number) => void
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
  textItems: WallTextItem[]
  selectedTextId: string | null
  onTextSelect: (id: string | null) => void
  onTextDragEnd: (id: string, x: number, y: number) => void
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
  
  // Contact-shadow footprint: derived from the same floor bounds WallSystem
  // uses, so the grounding shadow tracks the room's size/position. Baked once
  // (frames=1) and re-baked only when the wall geometry changes (via key), so
  // it stays cheap while the camera orbits.
  const groundBounds = calculateFloorBounds(wallConfig)
  const groundShadowSpan = Math.max(groundBounds.floorWidth, groundBounds.floorDepth) * 1.6
  const groundShadowKey = `${wallConfig.layoutType}|${wallConfig.walls
    .map((w) => `${w.width}x${w.height}`)
    .join(',')}|${(wallConfig.customTransforms ?? [])
    .map((t) => `${Math.round(t.x)}_${Math.round(t.z)}_${t.rotationY.toFixed(2)}`)
    .join(';')}`

  return (
    <>
      {/* No scene.background: the <Canvas> is transparent (alpha), so the page's
          neutral radial-vignette backdrop shows through as one seam-free surface. */}

      {/* Calm gallery rig: one soft ambient base fill + one gentle directional
          key angled from above-front for soft falloff down the walls. No shadow
          map (kept cheap) — grounding comes from <ContactShadows> and the
          per-surface value separation in WallSystem. */}
      <ambientLight intensity={0.62} />
      <directionalLight position={[18, 26, 14]} intensity={0.8} color="#ffffff" />

      {/* Soft contact shadow so the room sits on a surface instead of floating.
          Renders its own shadow pass (independent of the WebGL shadow map). */}
      <ContactShadows
        key={groundShadowKey}
        position={[groundBounds.floorCenterX, -0.05, groundBounds.floorCenterZ]}
        scale={groundShadowSpan}
        resolution={512}
        blur={2.6}
        opacity={0.32}
        far={200}
        color="#2b2926"
        frames={1}
      />

      {/* Floor is now created dynamically in WallSystem based on wall configuration */}

      <WallSystem
        boards={localBoards}
        // Merge live text items into the config so saved labels render in the
        // normal 3D room (WallSystem reads wallConfig.textItems).
        wallConfig={{ ...wallConfig, textItems }}
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
            // Smart-guide geometry for every board currently on this wall +
            // side. Centers are in wall-local INCHES with origin at wall
            // center (matches DraggableBoard's `localPosition * scaledWall*`
            // math). Sizes come from absolute board_width_in/board_height_in
            // via getBoardSizeInches so guides reflect the actual rendered
            // size, not the legacy normalized fraction in placedBoards3D.
            // Each board renders this same array as a prop and filters out
            // itself by id during the drag scan.
            const wallWInches = editingWallDimensions.width * 12
            const wallHInches = editingWallDimensions.height * 12
            const guideGeometry = entries.flatMap(([id, pos]) => {
              const b = localBoards.find(lb => lb.id === id)
              if (!b) return []
              const { widthIn, heightIn } = getBoardSizeInches(b)
              return [{
                id,
                centerInchesX: (pos.x ?? 0) * wallWInches,
                centerInchesY: (pos.y ?? 0) * wallHInches,
                widthInches: widthIn,
                heightInches: heightIn,
              }]
            })
            return entries.map(([boardId, localPos]) => {
              const board = localBoards.find(b => b.id === boardId)
              if (!board) {
                console.warn(`❌ [SceneContent] Board ${boardId} not found in localBoards list`)
                return null
              }

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
                  onSizePersisted={onBoardSizePersisted}
                  onDelete={onBoardDelete}
                  onCommentClick={onCommentClick}
                  onSelect={() => setSelectedBoardId(board.id)}
                  onDeselect={onDeselect}
                  isSelected={selectedBoardId === board.id}
                  workspaceId={studioId}
                  isWorkspaceMember={isWorkspaceMember}
                  otherBoardsOnWall={guideGeometry}
                />
              )
            })
          })()}

          {/* Free-floating wall text labels for the wall being edited. Drag to
              reposition; the parent commits (x,y) into the blob on pointer-up.
              Other walls' labels render statically via WallSystem. */}
          {textItems
            .filter((t) => t.wallIndex === editingWall && (t.side ?? 'front') === editingWallSide)
            .map((t) => (
              <DraggableText
                key={t.id}
                item={t}
                wallPosition={editingWallPosition}
                wallRotation={editingWallRotation}
                wallBaseRotationForCoords={editingWallBaseRotation}
                wallDimensions={editingWallDimensions}
                side={editingWallSide}
                isSelected={selectedTextId === t.id}
                onSelect={onTextSelect}
                onDragEnd={onTextDragEnd}
              />
            ))}
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
        // Zoom-out cap, scaled to room size like minDistance so a board's
        // on-screen size at full zoom-out stays ~constant across rooms. ~5.5x
        // the initial framing distance (110 * distanceScale): far enough for a
        // whole-room overview, close enough that boards stay comfortably
        // visible instead of shrinking to specks. Previously 1200 * — far
        // enough that large rooms overran the camera's far plane and boards
        // vanished on zoom-out (see cameraFar below).
        const maxDistance = 600 * distanceScale
        // Far clip plane must clear the farthest board when fully dollied out:
        // the camera sits maxDistance from the target and the farthest wall can
        // be up to the room's footprint (maxWallWidthInches * layoutFactor)
        // beyond it. The camera previously set no far, falling back to the
        // three.js default (2000), which maxDistance overran in larger rooms —
        // that clipping is exactly what made boards disappear on zoom-out. The
        // +1000 buffers vertical extent and diagonal slack. minDistance / pan /
        // zoom intensity are unchanged; this only widens the frustum's far end.
        const cameraFar = maxDistance + maxWallWidthInches * layoutFactor + 1000

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
              fov={ROOM_DEFAULT_FOV}
              far={cameraFar}
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

/**
 * Phase B.2: presenter camera broadcaster. Rendered inside <Canvas> as a sibling
 * of CameraController. When the local user is the presenter AND not in edit mode,
 * it sends the camera pose + OrbitControls target (~10Hz) over the live broadcast
 * channel. Pure side-effect in useFrame — no state, no logging. self:false on the
 * channel means the presenter never receives (or follows) its own packets.
 */
function PresenterCamBroadcast({
  liveChannelRef,
  isPresenter,
  editingWall,
  orbitControlsRef,
}: {
  liveChannelRef?: React.MutableRefObject<ReturnType<typeof supabase.channel> | null>
  isPresenter: boolean
  editingWall: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orbitControlsRef: React.RefObject<any>
}) {
  const { camera } = useThree()
  const sinceLastSend = useRef(0)
  useFrame((_state, delta) => {
    if (!isPresenter || editingWall !== null) return
    const channel = liveChannelRef?.current
    if (!channel) return
    sinceLastSend.current += delta
    if (sinceLastSend.current < 0.1) return
    sinceLastSend.current = 0
    const controls = orbitControlsRef.current?.get
      ? orbitControlsRef.current.get()
      : orbitControlsRef.current
    const target = controls?.target
    const r = (n: number) => Math.round(n * 1000) / 1000
    channel.send({
      type: 'broadcast',
      event: 'cam',
      payload: {
        p: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
        t: target ? [r(target.x), r(target.y), r(target.z)] : [0, 0, 0],
      },
    })
  })
  return null
}

/**
 * Phase B.3.1: presenter cursor broadcaster (replaces the B.3 hold-L laser).
 * Lives inside <Canvas>. While presenting and NOT in edit mode, it passively
 * raycasts the live pointer against the scene and broadcasts the world hit point
 * over the "laser" event at ≤15Hz (throttled). It does NOT gate on any key and
 * does NOT suppress the presenter's own orbit/clicks — it is pure observation.
 * Sends a single { off:true } when the pointer leaves the canvas (incl. when the
 * presenter opens the lightbox, whose DOM overlay steals the pointer — so the 3D
 * dot is never shown over the lightbox) or when presenting stops. Read-only
 * raycast against existing meshes; no state, no logging. (The dot mesh sets
 * raycast=null so it's skipped.)
 */
function PresenterCursorBroadcast({
  liveChannelRef,
  isPresenter,
  editingWall,
}: {
  liveChannelRef?: React.MutableRefObject<ReturnType<typeof supabase.channel> | null>
  isPresenter: boolean
  editingWall: number | null
}) {
  const { camera, scene, raycaster, pointer, gl } = useThree()
  const sinceLastSend = useRef(0)
  const wasActive = useRef(false)
  const pointerOverRef = useRef(false)
  // Track whether the pointer is over the canvas so we can stop broadcasting (and
  // emit one {off}) the moment it leaves — e.g. onto the lightbox/toolbar overlay.
  useEffect(() => {
    const el = gl.domElement
    const onEnter = () => { pointerOverRef.current = true }
    const onLeave = () => { pointerOverRef.current = false }
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [gl])
  useFrame((_state, delta) => {
    const channel = liveChannelRef?.current
    const active = isPresenter && editingWall === null && pointerOverRef.current
    if (active && channel) {
      sinceLastSend.current += delta
      if (sinceLastSend.current >= 1 / 15) {
        sinceLastSend.current = 0
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects(scene.children, true)[0]
        if (hit) {
          const r = (n: number) => Math.round(n * 1000) / 1000
          channel.send({
            type: 'broadcast',
            event: 'laser',
            payload: { p: [r(hit.point.x), r(hit.point.y), r(hit.point.z)] },
          })
        }
      }
    }
    if (!active && wasActive.current && channel) {
      channel.send({ type: 'broadcast', event: 'laser', payload: { off: true } })
    }
    wasActive.current = active
  })
  return null
}

// Phase B.4: LaserPointer (the presenter cursor dot) moved to
// components/3d/LaserPointer.tsx so the guest /crit page renders an identical dot
// without importing this heavy module. Behavior unchanged; imported at the top.

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
  // Free-floating wall text labels (blob-persisted, mirror the `tables` shape).
  const [textItems, setTextItems] = useState<WallTextItem[]>(() => {
    const raw = (props.wallConfig as { textItems?: WallTextItem[] }).textItems
    return Array.isArray(raw) ? raw : []
  })
  // Ref mirror so persist helpers read the latest items without a stale closure.
  const textItemsRef = useRef<WallTextItem[]>(textItems)
  useEffect(() => { textItemsRef.current = textItems }, [textItems])
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  // Debounce timer for text-content typing (coalesces keystrokes into one save).
  const textPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [placedBoards3D, setPlacedBoards3D] = useState<Map<string, {
    x: number;
    y: number;
    width?: number;
    height?: number;
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
  /**
   * How many times the current `copiedBoardRef` has been pasted. Reset on
   * every copy so the first paste of a fresh source lands at +1 grid step,
   * not stacked on the previous run. Used by handlePaste to cascade
   * successive pastes diagonally so they don't overlap exactly.
   */
  const pasteCountRef = useRef(0)
  const {
    boards: localBoards,
    boardPositions,
    loadWallPositions,
    updateBoardPosition,
    resolveBoardId,
    applyBoardSizeLocal,
    applyBoardLinkLocal,
    deleteBoard,
    addTempBoard,
    replaceTempBoard,
    removeTempBoard,
    undo,
    redo,
  } = useBoardState(
    props.boards,
    props.studioId,
    async () => { await Promise.resolve(); props.onBoardUpdate() },
    // Single-ownership context: while a wall is being edited in 2D, the hook's
    // parent-sync leaves position for that wall's boards under local control.
    { wall: editingWall, side: editingWallSide },
  )

  // Sync tables when wall config loads or studio changes (strip blob URLs so GLTF never sees them)
  useEffect(() => {
    const configTables = (props.wallConfig as { tables?: FloorTable[] }).tables
    setTables(sanitizeTables(configTables))
  }, [props.studioId, props.wallConfig, sanitizeTables])

  // Sync text items when the wall config loads or studio changes (mirror
  // tables). On a 409 reload the parent hands back the server blob, which flows
  // through here — last-writer-wins, same coarse behavior as tables.
  useEffect(() => {
    const raw = (props.wallConfig as { textItems?: WallTextItem[] }).textItems
    setTextItems(Array.isArray(raw) ? raw : [])
  }, [props.studioId, props.wallConfig])

  // Clear text selection when leaving wall-edit mode.
  useEffect(() => {
    if (editingWall === null) setSelectedTextId(null)
  }, [editingWall])

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
    // Include textItems so a floor/geometry save writes the FULL blob and never
    // drops the wall text (the POST replaces the stored object wholesale).
    const payload = { ...props.wallConfig, tables: tablesToSave, textItems }
    // Phase 2a: wall-config is per-room. The endpoint path segment still uses
    // the workspace id (the route's auth check loads `workspaces.owner_id` by
    // that id); the room id is appended as a query param so the route reads
    // and writes the per-room blob. studioId here IS the room id.
    const wsKey = props.workspaceId ?? props.studioId
    const roomId = props.studioId
    const savedConfigKey = `studio-${roomId}-wall-config`
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
      const res = await fetch(`/api/studios/${wsKey}/wall-config?roomId=${encodeURIComponent(roomId)}`, {
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
  }, [props.studioId, props.workspaceId, props.wallConfig, props.wallVersionRef, props.onWallConfigConflict, tables, textItems])

  /**
   * Wall indices for the floor editor's board-safety guard. Just the indices —
   * not full Board objects — so the prop is cheap and the editor stays
   * decoupled from the board shape.
   */
  const boardWallIndices = useMemo(
    () => localBoards.map((b) => b.position?.wallIndex ?? null),
    [localBoards]
  )

  /**
   * Re-index boards on walls past `deletedIndex` so they stay pinned to the
   * correct physical wall after the floor editor pops the wall at
   * `deletedIndex`. The editor's board-safety guard refuses to delete a wall
   * that has any boards on it, so we never have to handle boards on the
   * deleted index.
   *
   * Returns `{ ok }` so the editor can sequence this atomically with the
   * geometry POST: on failure the editor leaves the wall in place and the
   * room stays consistent. onBoardUpdate refreshes localBoards on success so
   * the 3D view picks up the new indices.
   */
  const handleWallRemoved = useCallback(
    async (deletedIndex: number): Promise<{ ok: boolean }> => {
      const roomId = props.studioId
      try {
        const res = await fetch('/api/boards/reindex-after-wall-delete', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, deletedWallIndex: deletedIndex }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({} as { error?: string }))
          console.error('reindex-after-wall-delete failed', { status: res.status, data })
          return { ok: false }
        }
        // Refetch boards so local state picks up the new wall_index values.
        await props.onBoardUpdate()
        return { ok: true }
      } catch (err) {
        console.error('Failed to reindex boards after wall delete', err)
        return { ok: false }
      }
    },
    [props.studioId, props.onBoardUpdate]
  )

  /**
   * Persist a wall config snapshot through the same endpoint Save & Exit
   * uses (POST /api/studios/[wsId]/wall-config?roomId=...), updating the
   * local version counter from the response. Used by the floor editor to
   * commit the geometry half of an atomic wall delete: deleting a wall
   * decrements board indices in the DB right away, so the wall config has
   * to land in the same logical transaction (best-effort here — a separate
   * tx isn't available). Returns `{ ok: false }` on any non-2xx response
   * including 409; a 409 also bubbles up through onWallConfigConflict.
   */
  const handlePersistWallConfig = useCallback(
    async (nextConfig: WallConfig): Promise<{ ok: boolean }> => {
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
      // Include textItems so this wall-delete persist writes the FULL blob and
      // never drops the wall text.
      const payload = { ...nextConfig, tables: tablesToSave, textItems }
      const wsKey = props.workspaceId ?? props.studioId
      const roomId = props.studioId
      const body = JSON.stringify({
        baseVersion: props.wallVersionRef?.current ?? 0,
        config: payload,
      })
      try {
        const res = await fetch(
          `/api/studios/${wsKey}/wall-config?roomId=${encodeURIComponent(roomId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          }
        )
        if (res.status === 409) {
          const data = await res
            .json()
            .catch(() => ({} as { latest?: Record<string, unknown> & { version?: number } }))
          if (data.latest && props.onWallConfigConflict) props.onWallConfigConflict(data.latest)
          return { ok: false }
        }
        if (!res.ok) {
          console.error('persist wall config failed', { status: res.status })
          return { ok: false }
        }
        const data = await res.json().catch(() => ({} as { version?: number }))
        if (typeof data.version === 'number' && props.wallVersionRef) {
          props.wallVersionRef.current = data.version
        }
        return { ok: true }
      } catch (err) {
        console.error('persist wall config threw', err)
        return { ok: false }
      }
    },
    [tables, textItems, props.studioId, props.workspaceId, props.wallVersionRef, props.onWallConfigConflict]
  )

  /**
   * Persist the CURRENT blob with the given text items, through the SAME
   * versioned wall-config POST tables/geometry use (baseVersion → 409 →
   * onWallConfigConflict). keepalive so a save survives a navigation right
   * after the gesture — this is the write DELETE/remove goes through, so it is
   * naturally safe (it does NOT copy the non-keepalive un-place clear at the
   * boards path). We include `tables` too so a text save never wipes tables.
   */
  const persistTextItemsNow = useCallback(
    (items: WallTextItem[]) => {
      if (textPersistTimer.current) {
        clearTimeout(textPersistTimer.current)
        textPersistTimer.current = null
      }
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
      const payload = { ...props.wallConfig, tables: tablesToSave, textItems: items }
      const wsKey = props.workspaceId ?? props.studioId
      const roomId = props.studioId
      const body = JSON.stringify({ baseVersion: props.wallVersionRef?.current ?? 0, config: payload })
      const saveOnce = async (): Promise<'ok' | 'conflict'> => {
        const res = await fetch(`/api/studios/${wsKey}/wall-config?roomId=${encodeURIComponent(roomId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body,
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
            console.error('Failed to save wall text', { firstError, secondError })
            toast.error('Could not save text. Please try again.')
          }
        }
      })()
    },
    [tables, props.wallConfig, props.workspaceId, props.studioId, props.wallVersionRef, props.onWallConfigConflict]
  )

  // Debounced variant for content typing — coalesces keystrokes into one POST.
  const persistTextItemsDebounced = useCallback(
    (items: WallTextItem[]) => {
      if (textPersistTimer.current) clearTimeout(textPersistTimer.current)
      textPersistTimer.current = setTimeout(() => persistTextItemsNow(items), 500)
    },
    [persistTextItemsNow]
  )

  const genTextId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `text-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  // Drop a new label at the center of the wall being edited, select it, persist.
  const handleAddText = useCallback(() => {
    if (editingWall === null) return
    const item: WallTextItem = {
      id: genTextId(),
      wallIndex: editingWall,
      x: 0,
      y: 0,
      text: 'Text',
      fontSize: 12,
      side: editingWallSide ?? 'front',
    }
    const next = [...textItemsRef.current, item]
    textItemsRef.current = next
    setTextItems(next)
    setSelectedTextId(item.id)
    persistTextItemsNow(next)
  }, [editingWall, editingWallSide, persistTextItemsNow])

  const handleTextPositionChange = useCallback(
    (id: string, x: number, y: number) => {
      const next = textItemsRef.current.map((t) => (t.id === id ? { ...t, x, y } : t))
      textItemsRef.current = next
      setTextItems(next)
      persistTextItemsNow(next)
    },
    [persistTextItemsNow]
  )

  const handleTextContentChange = useCallback(
    (id: string, text: string) => {
      const next = textItemsRef.current.map((t) => (t.id === id ? { ...t, text } : t))
      textItemsRef.current = next
      setTextItems(next)
      persistTextItemsDebounced(next)
    },
    [persistTextItemsDebounced]
  )

  const handleTextFontSizeChange = useCallback(
    (id: string, fontSize: number) => {
      const next = textItemsRef.current.map((t) => (t.id === id ? { ...t, fontSize } : t))
      textItemsRef.current = next
      setTextItems(next)
      persistTextItemsNow(next)
    },
    [persistTextItemsNow]
  )

  // Remove = drop from textItems and save the blob via the keepalive POST above
  // (NOT a bespoke fetch, and NOT the non-keepalive un-place clear pattern).
  const handleRemoveText = useCallback(
    (id: string) => {
      const next = textItemsRef.current.filter((t) => t.id !== id)
      textItemsRef.current = next
      setTextItems(next)
      setSelectedTextId((prev) => (prev === id ? null : prev))
      persistTextItemsNow(next)
    },
    [persistTextItemsNow]
  )

  // Keep placedBoards3D in sync with boardPositions (e.g. after undo/redo)
  useEffect(() => {
    if (editingWall === null || editingWallSide == null) return
    const currentPlaced = placedBoards3DRef.current
    const newMap = new Map<string, { x: number; y: number; width?: number; height?: number }>()
    const wallBoards = localBoards.filter(b => b.position?.wallIndex === editingWall && (b.position?.side || 'front') === editingWallSide)
    postrace('placedBoards3D REBUILD FIRED', `wall=${editingWall}/${editingWallSide}`, `wallBoards=${wallBoards.length}`, `boardPositions.size=${boardPositions.size}`)
    wallBoards.forEach(board => {
        const isTemp = board.id.startsWith('temp-')
        const pos = boardPositions.get(board.id)
        const existing = currentPlaced.get(board.id)
        const branch = pos ? 'USE_boardPositions' : existing ? 'KEEP_existing' : isTemp ? 'NEW_temp_center' : 'DROP'
        const used = pos ?? existing ?? (isTemp ? { x: 0, y: 0, width: 0.3, height: 0.3 } : null)
        postrace('  rebuild board', board.id, `isTemp=${isTemp}`, `branch=${branch}`, `existing=${existing ? `(${existing.x.toFixed(3)},${existing.y.toFixed(3)})` : 'none'}`, `boardPos=${pos ? `(${pos.x.toFixed(3)},${pos.y.toFixed(3)})` : 'none'}`, `USED=${used ? `(${used.x.toFixed(3)},${used.y.toFixed(3)})[${(used.width ?? 0).toFixed(3)}x${(used.height ?? 0).toFixed(3)}]` : 'none'}`)
        if (pos) {
          // boardPositions is the single source of truth for the live edit
          // session — for temp boards too. The old code force-pinned temp x/y
          // to center here, which snapped a fresh upload back to the middle the
          // instant it was dragged while its upload was still in flight (the
          // move/scale lived in boardPositions, this rebuild overwrote it).
          // A freshly added temp is seeded at center in boardPositions
          // (addTempBoard), so honoring pos still shows new uploads centered;
          // a dragged temp now keeps the user's placement.
          newMap.set(board.id, pos)
        } else if (existing) {
          // Not in boardPositions yet (async batching right after add/swap, or
          // a refetch race): keep the current on-screen placement so the board
          // never disappears or jumps.
          newMap.set(board.id, existing)
        } else if (isTemp) {
          // Brand-new temp with no position tracked anywhere yet; show at center
          // so the upload appears immediately.
          newMap.set(board.id, { x: 0, y: 0, width: 0.3, height: 0.3 })
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
    const newMap = new Map<string, { x: number; y: number; width: number; height: number }>()
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
                // Explicit null (not undefined) so the PUT route actually clears
                // the position columns; undefined/absent still means "don't touch".
                body: JSON.stringify({ ...board, position: null }),
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
    // Phase B.3.1: while in follow mode the lightbox is presenter-driven, so a
    // follower can't manually open one (it would fight the follow stream). They
    // break away (Escape / Stop following) first to regain control. Only
    // followers have isFollowing; the presenter and detached viewers open freely.
    if (props.isFollowing) return
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
    // [POSTRACE] what board object the lightbox reads on open — note whether
    // the passed board and the current localBoards entry agree on linkUrl.
    const fromArray = localBoards.find(b => b.id === board.id)
    postrace('lightbox OPEN', board.id, `passedBoard.linkUrl=${JSON.stringify(board.linkUrl)}`, `localBoards[].linkUrl=${JSON.stringify(fromArray?.linkUrl)}`, `sameRef=${fromArray === board}`)
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

  // Phase B.3.1: presenter broadcasts lightbox open/close/navigate as "lb" so
  // followers mirror it. { boardId } on open/switch, { off:true } on close. Only
  // the presenter sends; self:false stops any echo. Discrete UI event (not a
  // per-frame stream), so a setState-free ref dedupe is all that's needed.
  const prevLbBroadcastRef = useRef<string | null>(null)
  useEffect(() => {
    if (!props.isPresenter) return
    const channel = props.liveChannelRef?.current
    if (!channel) return
    const id = lightboxBoard?.id ?? null
    if (id === prevLbBroadcastRef.current) return
    prevLbBroadcastRef.current = id
    channel.send({
      type: 'broadcast',
      event: 'lb',
      payload: id ? { boardId: id } : { off: true },
    })
  }, [props.isPresenter, props.liveChannelRef, lightboxBoard])

  // Phase B.3.1: follower mirror — while in follow mode, the presenter's open
  // board (followLightboxBoardId, from the page's "lb" handler) drives the local
  // lightbox: open/switch to it, or close when the presenter closes. Manual open
  // is blocked while following (handleLightboxOpen), so this is authoritative.
  // When follow ends (break-away), this effect early-returns and leaves whatever
  // is open under the user's own control — restoring normal interaction.
  useEffect(() => {
    if (!props.isFollowing) return
    const id = props.followLightboxBoardId ?? null
    if (!id) { setLightboxBoard(null); return }
    setLightboxBoard((prev) => {
      if (prev?.id === id) return prev
      const next = localBoards.find((b) => b.id === id)
      return next ?? prev
    })
  }, [props.isFollowing, props.followLightboxBoardId, localBoards])

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
    (rawBoardId: string, localX: number, localY: number, width?: number, height?: number, side?: 'front' | 'back') => {
      // FIX 2b: a pointer-up can fire after the temp→real swap still carrying the
      // temp id. Resolve to the real id up front so the placedBoards3D write and
      // the persisted updateBoardPosition both target the real board — otherwise
      // the write lands under a dead temp key and the board visibly reverts.
      const boardId = resolveBoardId(rawBoardId)
      devLog('🔁 [StudioRoom] handleBoardPositionChange CALLED:', { boardId, localX, localY, width, height, side })

      // 1) compute finalPosition from the drag values + any existing values
      const currentMap = placedBoards3DRef.current
      const existing = currentMap.get(boardId) ?? currentMap.get(rawBoardId)

      const finalPosition = {
        x: localX,
        y: localY,
        width: width ?? existing?.width ?? 0.2,
        height: height ?? existing?.height ?? 0.2,
      }

      postrace('handleBoardPositionChange (drag/resize write)', `${rawBoardId}${boardId !== rawBoardId ? ` (aliased -> ${boardId})` : ''}`, `isTemp=${rawBoardId.startsWith('temp-')}`, `existing=${existing ? `(${existing.x.toFixed(3)},${existing.y.toFixed(3)})` : 'none'} -> final(${finalPosition.x.toFixed(3)},${finalPosition.y.toFixed(3)})[${finalPosition.width.toFixed(3)}x${finalPosition.height.toFixed(3)}]`)

      // 2) update the Map, the ref, and the React state. FIX 2c: if a stale temp
      // key for this board is still present (e.g. the swap's carry hasn't run in
      // this map yet), delete it so the temp key can't be resurrected.
      const newMap = new Map(currentMap)
      if (boardId !== rawBoardId) newMap.delete(rawBoardId)
      newMap.set(boardId, finalPosition)
      placedBoards3DRef.current = newMap
      setPlacedBoards3D(newMap)

      // 3) save to the DB (no x inversion: API 0–100 matches wall-local; DraggableBoard + WallSystem use same convention)
      if (editingWall !== null) {
        const sideForSave = side ?? editingWallSide ?? 'front'
        const saveX = finalPosition.x
        updateBoardPosition(
          boardId,
          editingWall,
          saveX,
          finalPosition.y,
          finalPosition.width,
          finalPosition.height,
          sideForSave,
        )
      }
    },
    [editingWall, editingWallSide, updateBoardPosition, resolveBoardId]
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

    // Cascade pastes so successive Cmd+V's don't stack exactly on each other.
    // Each paste shifts the source position by N × 5% of wall width/height.
    // Free placement (no grid snap) — board movement itself is free since
    // Phase 7 was reverted, so paste shouldn't impose a grid the user can't
    // see. Source position is reused as the base regardless of which wall
    // the source was on; wall-local API coords (0–100) are the same shape
    // on every wall, so "the same spot" pastes to "the same spot" on the
    // target wall.
    pasteCountRef.current += 1
    const offsetCount = pasteCountRef.current
    const PASTE_OFFSET_API = 5 // % of wall per paste — small enough to keep the new board near the source
    const srcAPIx = copied.position?.x ?? 50
    const srcAPIy = copied.position?.y ?? 50
    const apiX = Math.max(0, Math.min(100, srcAPIx + PASTE_OFFSET_API * offsetCount))
    const apiY = Math.max(0, Math.min(100, srcAPIy + PASTE_OFFSET_API * offsetCount))
    // The placedBoards3D map uses wall-local NORMALIZED coords (-0.5..+0.5).
    const normX = (apiX / 100) - 0.5
    const normY = (apiY / 100) - 0.5

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
        x: apiX,
        y: apiY,
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
      boardWidthIn: copied.boardWidthIn,
      boardHeightIn: copied.boardHeightIn,
    }
    addTempBoard(tempBoard, copied.fullImageUrl ?? copied.thumbnailUrl)
    const normW = (apiWidth / 100) || 0.3
    const normH = (apiHeight / 100) || 0.3
    setPlacedBoards3D(prev => {
      const m = new Map(prev)
      m.set(tempId, { x: normX, y: normY, width: normW, height: normH })
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
          position_x: apiX,
          position_y: apiY,
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
            position: { wallIndex: editingWall, x: apiX, y: apiY, width: apiWidth, height: apiHeight, side },
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
    if (board) {
      copiedBoardRef.current = board
      pasteCountRef.current = 0
    }
  }, [selectedBoardId, localBoards])

  // Keyboard shortcuts: Backspace/Delete = delete selected board, Ctrl+Z = undo, Ctrl+Y = redo, Ctrl+C/V = copy/paste, Escape = deselect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y = redo, Ctrl/Cmd+C = copy, Ctrl/Cmd+V
      // = paste. metaKey covers Cmd on macOS; the browser's native `paste`
      // event already fires on Cmd+V, so Cmd+V is handled by the window
      // listener below — we only handle Cmd+C here.
      if (e.ctrlKey || e.metaKey) {
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
            if (board) {
              copiedBoardRef.current = board
              pasteCountRef.current = 0
            }
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
          boardWallIndices={boardWallIndices}
          onWallRemoved={handleWallRemoved}
          onPersistWallConfig={handlePersistWallConfig}
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
            <p className="text-indigo-400 text-sm">JPG, PNG, or PDF · max 75 MB each</p>
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

      {/* Wall text controls — additive overlay (does NOT modify
          EditModeOverlay). Sits under the "Add Your Board" button while a wall
          is being edited. "Add text" drops a label at wall center; selecting a
          label reveals its content field, font-size stepper, and Remove. */}
      {showEditUI && editingWall !== null && (
        <div className="fixed left-6 top-48 z-50 flex flex-col gap-2 w-56">
          <button
            onClick={handleAddText}
            className="px-4 py-2 bg-white text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-lg text-sm font-medium flex items-center justify-center gap-2"
          >
            <span className="text-lg leading-none text-indigo-600">＋</span>
            Add text
          </button>

          {(() => {
            const sel = textItems.find((t) => t.id === selectedTextId && t.wallIndex === editingWall)
            if (!sel) return null
            return (
              <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3 flex flex-col gap-2">
                <label className="text-xs font-medium text-gray-500">Text</label>
                <input
                  value={sel.text}
                  onChange={(e) => handleTextContentChange(sel.id, e.target.value)}
                  placeholder="Label text"
                  maxLength={200}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <label className="text-xs font-medium text-gray-500 mt-1">Font size (in)</label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleTextFontSizeChange(sel.id, Math.max(2, Math.round(sel.fontSize) - 2))}
                    className="px-2 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                    aria-label="Decrease font size"
                  >
                    −
                  </button>
                  <span className="w-9 text-center text-sm tabular-nums">{Math.round(sel.fontSize)}</span>
                  <button
                    onClick={() => handleTextFontSizeChange(sel.id, Math.min(96, Math.round(sel.fontSize) + 2))}
                    className="px-2 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
                    aria-label="Increase font size"
                  >
                    ＋
                  </button>
                  <div className="flex gap-1 ml-1">
                    {[6, 12, 24, 48].map((sz) => (
                      <button
                        key={sz}
                        onClick={() => handleTextFontSizeChange(sel.id, sz)}
                        className={`px-1.5 py-1 rounded text-xs border ${
                          Math.round(sel.fontSize) === sz
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveText(sel.id)}
                  className="mt-1 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded text-sm hover:bg-red-100 transition-colors"
                >
                  Remove text
                </button>
              </div>
            )
          })()}
        </div>
      )}

      <div className="w-full h-screen">
        <Canvas
          gl={{ alpha: true, premultipliedAlpha: false }}
          style={{ background: 'transparent' }}
        >
          <CameraController
            orbitControlsRef={orbitControlsRef}
            editingWall={editingWall}
            wallPosition={editingWallPosition}
            wallRotation={editingWallRotation}
            wallDimensions={editingWallDimensions}
            transitionKey={cameraTransitionKey}
            onTransitionComplete={handleCameraTransitionComplete}
            isFollowing={props.isFollowing}
            followPoseRef={props.followPoseRef}
          />
          <PresenterCamBroadcast
            liveChannelRef={props.liveChannelRef}
            isPresenter={!!props.isPresenter}
            editingWall={editingWall}
            orbitControlsRef={orbitControlsRef}
          />
          <PresenterCursorBroadcast
            liveChannelRef={props.liveChannelRef}
            isPresenter={!!props.isPresenter}
            editingWall={editingWall}
          />
          <LaserPointer laserRef={props.laserRef} color={props.laserColor ?? '#22d3ee'} />
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
            onBoardSizePersisted={applyBoardSizeLocal}
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
            onDeselect={() => { setSelectedBoardId(null); setSelectedTextId(null) }}
            isWorkspaceMember={isWorkspaceMember}
            editingWallSide={editingWallSide}
            tables={tables}
            textItems={textItems}
            selectedTextId={selectedTextId}
            onTextSelect={setSelectedTextId}
            onTextDragEnd={handleTextPositionChange}
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
      liveChannelRef={props.liveChannelRef}
      isPresenter={!!props.isPresenter}
      viewportDriven={!!props.isFollowing && lightboxBoard !== null}
      viewportTargetRef={props.lbViewportRef}
      lbCursorRef={props.lbCursorRef}
      cursorColor={props.laserColor ?? '#22d3ee'}
      critDirty={props.critDirty}
      traceStreamRef={props.traceStreamRef}
      onLinkSaved={(boardId, linkUrl) => {
        // Persisted server-side already; mirror into the local boards cache so
        // a later reopen reads the fresh link, and into the open snapshot so
        // navigation within the lightbox stays consistent this session.
        postrace('onLinkSaved (StudioRoom)', boardId, `linkUrl=${JSON.stringify(linkUrl)}`)
        applyBoardLinkLocal(boardId, linkUrl)
        setLightboxBoard((prev) =>
          prev && prev.id === boardId ? { ...prev, linkUrl: linkUrl || undefined } : prev
        )
      }}
      onBoardSizeSaved={(boardId, widthIn, heightIn) => {
        // Persisted server-side already (position PATCH). Mirror the absolute
        // inches into the local boards cache so the 3D room re-renders at the
        // new size, and into the open snapshot so lightbox navigation stays
        // consistent this session. Same pattern as onLinkSaved.
        applyBoardSizeLocal(boardId, widthIn, heightIn)
        setLightboxBoard((prev) =>
          prev && prev.id === boardId ? { ...prev, boardWidthIn: widthIn, boardHeightIn: heightIn } : prev
        )
      }}
    />
    </>
  )
}