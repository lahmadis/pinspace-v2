'use client'

import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { supabase } from '@/lib/supabase/client'
import { Board } from '@/types'
import WallSystem from './WallSystem'
import { useState, useCallback, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { CameraController } from './CameraController'
import { EditModeOverlay } from './EditModeOverlay'
import { DraggableBoard } from './DraggableBoard'
import { WallDropZone } from '@/components/3d/WallDropZone'
import RightCommentPanel from '@/components/RightCommentPanel'
import LightboxModal from '@/components/LightboxModal'
import { generateOwnerColor } from '@/lib/ownerColors'
import { useBoardState } from './useBoardState'
import { useBoardUpload } from '@/hooks/useBoardUpload'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'


interface WallDimensions {
  height: number
  width: number
}

type LayoutType = 'zigzag' | 'square' | 'linear' | 'lshape'

interface WallConfig {
  walls: WallDimensions[]
  layoutType: LayoutType
}

interface StudioRoomProps {
  studioId: string
  boards: Board[]
  wallConfig: WallConfig
  onBoardUpdate: () => Promise<void>
  onEditModeChange?: (isEditing: boolean) => void
}

function SceneContent({ 
  studioId, 
  boards, 
  wallConfig,
  onBoardUpdate,
  onWallClick,
  editingWall,
  placedBoards3D,
  editingWallPosition,
  editingWallRotation,
  editingWallDimensions,
  onBoardPositionChange,
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
  onBoardClick
}: StudioRoomProps & {
  onWallClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number, side: 'front' | 'back') => void
  editingWall: number | null
  placedBoards3D: Map<string, { x: number; y: number; width?: number; height?: number }>
  editingWallPosition: THREE.Vector3 | null
  editingWallRotation: number
  editingWallDimensions: WallDimensions | null
  onBoardPositionChange: (boardId: string, localX: number, localY: number, width?: number, height?: number) => void
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
}) {
  const orbitControlsRef = useRef<any>(null)
  const { camera, gl } = useThree()
  const maxWallHeightRef = useRef<number>(96)
  const [targetY, setTargetY] = useState<number>(48) // inches; focus point for zoom
  const shiftDownRef = useRef(false)
  
  // Configure mouse buttons for Rhino-like feel: Right = orbit, Shift+Right = pan, Middle = pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftDownRef.current = true }
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftDownRef.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame(() => {
    const controlsObj = orbitControlsRef.current?.get ? orbitControlsRef.current.get() : orbitControlsRef.current
    if (controlsObj && controlsObj.mouseButtons) {
      const shift = shiftDownRef.current
      controlsObj.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: shift ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
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
      <color attach="background" args={['#f9fafb']} />
      <ambientLight intensity={0.7} />
      <directionalLight 
        position={[10, 15, 5]} 
        intensity={1.0} 
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={500}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
      />
      <directionalLight position={[-10, 10, -5]} intensity={0.4} />
      <directionalLight position={[0, 20, 0]} intensity={0.3} />
      {/* Rim lighting for wall edges */}
      <directionalLight position={[-5, 8, -10]} intensity={0.2} color="#ffffff" />
      <directionalLight position={[5, 8, 10]} intensity={0.2} color="#ffffff" />
      <hemisphereLight args={['#ffffff', '#e5e7eb', 0.4]} />
      
      {/* Floor plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[2000, 2000]} />
        <meshStandardMaterial 
          color="#f3f4f6" 
          roughness={0.8}
          metalness={0.0}
        />
      </mesh>
      
      <WallSystem 
        boards={localBoards} 
        wallConfig={wallConfig}
        onWallClick={onWallClick}
        editingWall={editingWall}
        onBoardClick={onBoardClick || onCommentClick}
        highlightedBoardId={hoveredBoardId}
        onBoardHover={onBoardHover}
      />

      
      {/* Drop zone for dragging from sidebar */}
      {editingWall !== null && editingWallPosition && editingWallDimensions && draggingFromSidebar && (
        <WallDropZone
          wallPosition={editingWallPosition}
          wallRotation={editingWallRotation}
          wallDimensions={editingWallDimensions}
          onDrop={onBoardDrop}
          onDragCancel={onDragCancel}
        />
      )}
      
      {/* Render draggable boards when in edit mode */}
      {editingWall !== null && editingWallPosition && editingWallDimensions && (
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
                console.log('🖱️ [SceneContent] Pointer down on empty wall space - deselecting')
                onDeselect()
              }
            }}
            onClick={(e) => {
              // Also handle onClick as backup
              e.stopPropagation()
              if (onDeselect) {
                console.log('🖱️ [SceneContent] onClick on empty wall space - deselecting')
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
            console.log('🎨 [SceneContent] Rendering', entries.length, 'draggable boards for wall', editingWall)
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
              
              console.log(`🎨 [SceneContent] Rendering board ${boardId}`)
              
              return (
                <DraggableBoard
                  key={boardId}
                  board={board}
                  wallIndex={editingWall}
                  wallPosition={editingWallPosition}
                  wallRotation={editingWallRotation}
                  wallDimensions={editingWallDimensions}
                  initialLocalPosition={localPos}
                  onDragEnd={onBoardPositionChange}
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
        const baseHeightInches = 8 * 12

        // Scale distance primarily with room width so wider rooms push the camera back,
        // but keep camera/target height tied to wall height so the viewing angle stays consistent.
        const distanceScale = maxWallWidthInches / baseWidthInches || 1
        const heightScale = maxWallHeightInches / baseHeightInches || 1

        const minDistance = 50 * distanceScale       // Scale minimum zoom by width
        const maxDistance = 800 * distanceScale      // Scale maximum zoom by width

        // Aim slightly above mid-wall (where boards typically sit) so zoom goes toward the walls, not the floor.
        const targetHeight = Math.max(60, Math.min(maxWallHeightInches * 0.65, maxWallHeightInches)) || 60
        // Keep the camera at (or just slightly above) the target height so wheel zoom moves straight in
        const cameraHeight = targetHeight * 1.02
        const cameraDistance = 80 * distanceScale    // Base distance scaled by width
        maxWallHeightRef.current = maxWallHeightInches

        // Keep target in sync for OrbitControls updates
        if (targetY !== targetHeight) {
          setTargetY(targetHeight)
        }
        
        return (
          <>
            <OrbitControls 
              ref={orbitControlsRef}
              enableDamping
              dampingFactor={0.05}
              minDistance={minDistance}
              maxDistance={maxDistance}
              maxPolarAngle={Math.PI / 2}
              // Keep a slightly steeper minimum angle so zoom aims forward, not downward
              minPolarAngle={0.45}
              enabled={editingWall === null}
              enablePan={editingWall === null}
              enableRotate={editingWall === null}
              enableZoom={editingWall === null}
            zoomToCursor
              target={[0, targetHeight, 0]}
            />
            
            <PerspectiveCamera 
              makeDefault 
              position={[0, cameraHeight, cameraDistance]}
              fov={50}
            />
          </>
        )
      })()}


    </>
  )
}

export default function StudioRoom(props: StudioRoomProps) {
  const [user, setUser] = useState<any>(null)
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null)
  const [isWorkspaceMember, setIsWorkspaceMember] = useState<boolean>(false)
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user || null)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user || null)
    })
    
    return () => subscription.unsubscribe()
  }, [])
  
  // Check if user is a member of this workspace
  useEffect(() => {
    const checkMembership = async () => {
      if (!user || !props.studioId) {
        setIsWorkspaceMember(false)
        return
      }
      
      try {
        // Check if user is workspace owner or member
        const response = await fetch(`/api/workspaces/${props.studioId}`)
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
  }, [user, props.studioId])
  const [editingWall, setEditingWall] = useState<number | null>(null)
  const [editingWallDimensions, setEditingWallDimensions] = useState<WallDimensions | null>(null)
  const [editingWallPosition, setEditingWallPosition] = useState<THREE.Vector3 | null>(null)
  const [editingWallRotation, setEditingWallRotation] = useState<number>(0)
  const [editingWallSide, setEditingWallSide] = useState<'front' | 'back'>('front')
  const [showEditUI, setShowEditUI] = useState(false)
  const [placedBoards3D, setPlacedBoards3D] = useState<Map<string, { 
    x: number; 
    y: number; 
    width?: number; 
    height?: number 
  }>>(new Map())
const [lightboxBoard, setLightboxBoard] = useState<Board | null>(null)
  
  // Keep a ref to the latest placedBoards3D to avoid stale closure issues
  const placedBoards3DRef = useRef(placedBoards3D)
  useEffect(() => {
    placedBoards3DRef.current = placedBoards3D
  }, [placedBoards3D])
  const [draggingFromSidebar, setDraggingFromSidebar] = useState<Board | null>(null)
  const [commentPanelBoard, setCommentPanelBoard] = useState<Board | null>(null)
  const [hoveredBoardId, setHoveredBoardId] = useState<string | null>(null)
  const {
    boards: localBoards,
    boardPositions,
    loadWallPositions,
    updateBoardPosition,
    deleteBoard,
    addTempBoard,
    replaceTempBoard,
    removeTempBoard,
  } = useBoardState(props.boards, props.studioId, async () => { await Promise.resolve(); props.onBoardUpdate() })
  

  const handleWallClick = (
    wallIndex: number,
    wallDimensions: WallDimensions,
    position: THREE.Vector3,
    rotation: number,
    side: 'front' | 'back'
  ) => {
    console.log('🖼️ [StudioRoom] Wall clicked:', wallIndex, 'rotation:', rotation, 'side:', side)
    
    // If we're already editing this wall and side, don't reinitialize
    if (editingWall === wallIndex && editingWallSide === side) {
      console.log('🖼️ [StudioRoom] Already editing this wall side, keeping current positions')
      return
    }
    
    // Hide edit UI first, let camera animation play, then show UI
    setShowEditUI(false)
    props.onEditModeChange?.(false)
    
    setEditingWall(wallIndex)
    setEditingWallDimensions(wallDimensions)
    setEditingWallPosition(position)
    setEditingWallRotation(rotation)
    setEditingWallSide(side)

    // Load positions from central hook (API → normalized + size)
    const wallPositions = loadWallPositions(wallIndex, wallDimensions)

    // Copy all boards on this wall AND this side into placedBoards3D
    const newMap = new Map<string, { x: number; y: number; width: number; height: number }>()
    localBoards
      .filter(b => {
        if (b.position?.wallIndex !== wallIndex) return false
        const boardSide = b.position?.side || 'front'
        return boardSide === side
      })
      .forEach(board => {
        const pos = wallPositions.get(board.id)
        if (pos) {
          newMap.set(board.id, pos)
        }
      })

    console.log('🖼️ [StudioRoom] Total boards to render on', side, 'side:', newMap.size)
    setPlacedBoards3D(newMap)
  }


  const handleCameraTransitionComplete = () => {
    if (editingWall !== null) {
      setShowEditUI(true)
      props.onEditModeChange?.(true)
    }
  }

  const handleEditComplete = async () => {
    if (editingWall === null || !editingWallDimensions || !editingWallPosition) return

    const currentBoards = placedBoards3DRef.current
    const wallToSave = editingWall
    
    console.log('💾 [StudioRoom] Save & Exit clicked - saving all board positions...')

    // Save all current board positions explicitly before exiting
    // This ensures all position changes are persisted even if some async saves from dragging didn't complete
    const savePromises: Promise<void>[] = []
    currentBoards.forEach((position, boardId) => {
      const board = localBoards.find(b => b.id === boardId)
      if (board && editingWall !== null) {
        const savePromise = updateBoardPosition(
          boardId,
          editingWall,
          position.x,      // normalized -0.5..0.5
          position.y,      // normalized -0.5..0.5
          position.width,  // 0..1
          position.height  // 0..1
        ).catch(err => {
          console.error(`❌ [StudioRoom] Failed to save position for board ${boardId}:`, err)
        })
        if (savePromise) {
          savePromises.push(savePromise)
        }
      }
    })

    // Wait for all position saves to complete
    if (savePromises.length > 0) {
      await Promise.all(savePromises)
      console.log('✅ [StudioRoom] All positions saved - boards array already updated by updateBoardPosition')
    }

    // Remove boards that were removed from this wall side
    const boardIdsOnWall = Array.from(currentBoards.keys())
    const boardsToRemove = localBoards.filter(
      b =>
        b.position?.wallIndex === wallToSave &&
        !boardIdsOnWall.includes(b.id)
    )

    if (boardsToRemove.length > 0) {
      console.log('🗑️ [StudioRoom] Removing', boardsToRemove.length, 'boards from wall')
      for (const board of boardsToRemove) {
        await fetch('/api/boards', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...board, position: undefined }),
        })
      }
      // Refresh after removing boards to update the list
      await props.onBoardUpdate()
    }

    // NO REFRESH NEEDED - updateBoardPosition already updated the boards array!
    // The 3D view will show the updated positions from localBoards immediately
    
    setShowEditUI(false)
    props.onEditModeChange?.(false)
    setEditingWall(null)
    setEditingWallPosition(null)
    console.log('✅ [StudioRoom] Exited edit mode')
  }

  const handleLightboxOpen = (board: Board) => {
    setCommentPanelBoard(null)
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


  

  const handleBoardSelect = (board: Board) => {
    if (editingWall === null || !editingWallPosition || !editingWallDimensions) return
    
    if (placedBoards3D.has(board.id)) {
      alert('This board is already on the wall')
      return
    }
    
    const imageUrl = board.fullImageUrl || board.thumbnailUrl || ''
    if (!imageUrl || imageUrl.includes('placeholder')) {
      alert('This board cannot be displayed (no valid file)')
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
      console.log('Drop failed: no board dragging or no wall selected')
      return
    }
    
    // Check if already on wall
    if (placedBoards3D.has(draggingFromSidebar.id)) {
      alert('This board is already on the wall')
      setDraggingFromSidebar(null)
      return
    }
    
    try {
      let imageAspectRatio: number = 1 // Default to 1:1 if we can't determine
      
      // Use stored aspect ratio if available, otherwise load image
      let img: HTMLImageElement | null = null
      if (draggingFromSidebar.aspectRatio) {
        imageAspectRatio = draggingFromSidebar.aspectRatio
        console.log('📐 Using stored aspect ratio:', imageAspectRatio.toFixed(3))
      } else {
        console.log('📐 Loading image to calculate aspect ratio...')
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
          console.log(`📐 Image dimensions: ${img.naturalWidth}x${img.naturalHeight}, aspect: ${imageAspectRatio.toFixed(2)}`)
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
        console.log(`📐 Image dimensions: ${img.naturalWidth}x${img.naturalHeight}, aspect: ${imageAspectRatio.toFixed(2)}`)
      }
      console.log(`📏 Board size on wall: ${(boardWidth * 100).toFixed(1)}% x ${(boardHeight * 100).toFixed(1)}%`)
      console.log(`✅ Dropping board ${draggingFromSidebar.id} at position:`, { x: localX, y: localY })
      
      setPlacedBoards3D(prev => {
        const newMap = new Map(prev)
        newMap.set(draggingFromSidebar.id, { 
          x: localX, 
          y: localY,
          width: boardWidth,
          height: boardHeight
        })
        console.log('📍 Total boards on wall:', newMap.size)
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
          0.2               // fallback height
        )
      }
    }
    
    setDraggingFromSidebar(null)
  }

  const handleDragCancel = () => {
    setDraggingFromSidebar(null)
  }

  const handleBoardPositionChange = useCallback(
    (boardId: string, localX: number, localY: number, width?: number, height?: number) => {
      console.log('🔁 [StudioRoom] handleBoardPositionChange CALLED:', { boardId, localX, localY, width, height })

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

      // 3) save to the DB using the central hook function
      if (editingWall !== null) {
        updateBoardPosition(
          boardId,
          editingWall,          // wallIndex
          finalPosition.x,      // normalized -0.5..0.5
          finalPosition.y,      // normalized -0.5..0.5
          finalPosition.width,  // 0..1
          finalPosition.height  // 0..1
        )
      }
    },
    [editingWall, updateBoardPosition]
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
      alert('Failed to delete board')
    }
  }, [deleteBoard])

  // Handle keyboard shortcuts (backspace to delete selected board, E to open comments)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keys if user is typing in an input field
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // Only handle backspace if we're in edit mode and a board is selected
      if (e.key === 'Backspace' && selectedBoardId && editingWall !== null) {
        e.preventDefault()
        e.stopPropagation()
        
        // Allow delete if user is workspace member (API will enforce permissions)
        const selectedBoard = localBoards.find(b => b.id === selectedBoardId)
        if (selectedBoard) {
          console.log('⌨️ [Keyboard] Backspace pressed - deleting board:', selectedBoardId)
          handleBoardDelete(selectedBoardId)
          setSelectedBoardId(null) // Clear selection after delete
        }
      }
      
      // Escape key to deselect or close comment panel
      if (e.key === 'Escape') {
        if (selectedBoardId) {
          setSelectedBoardId(null)
        }
        if (commentPanelBoard) {
          setCommentPanelBoard(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedBoardId, editingWall, localBoards, user, handleBoardDelete, hoveredBoardId, commentPanelBoard])

  const { handleUpload } = useBoardUpload({
    studioId: props.studioId,
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

  return (
    <>
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
        onBoardSelect={handleBoardSelect}
        onBoardDragStart={handleBoardDragStart}
      />
      
      <div className="w-full h-screen">
        <Canvas shadows gl={{ shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap } } as any}>
          <CameraController
            editingWall={editingWall}
            wallPosition={editingWallPosition}
            wallRotation={editingWallRotation}
            wallDimensions={editingWallDimensions}
            onTransitionComplete={handleCameraTransitionComplete}
          />
          <SceneContent
            {...props}
            localBoards={localBoards}
            onWallClick={handleWallClick}
            editingWall={editingWall}
            placedBoards3D={placedBoards3D}
            editingWallPosition={editingWallPosition}
            editingWallRotation={editingWallRotation}
            editingWallDimensions={editingWallDimensions}
            onBoardPositionChange={handleBoardPositionChange}
            onBoardDelete={handleBoardDelete}
            draggingFromSidebar={draggingFromSidebar}
            onBoardDrop={handleBoardDrop}
            onDragCancel={handleDragCancel}
          onCommentClick={(board) => {
            console.log('💬 [Lightbox] Opening for:', board.id)
            handleLightboxOpen(board)
          }}
          onBoardClick={handleLightboxOpen}
            selectedBoardId={selectedBoardId}
            setSelectedBoardId={setSelectedBoardId}
            onDeselect={() => setSelectedBoardId(null)}
            isWorkspaceMember={isWorkspaceMember}
          />
        </Canvas>
      </div>

      {/* Right Comment Panel */}
      <RightCommentPanel 
        board={commentPanelBoard}
        onClose={() => setCommentPanelBoard(null)}
      />

    <LightboxModal
      board={lightboxBoard}
      allBoards={localBoards}
      onClose={() => setLightboxBoard(null)}
      onNavigate={handleLightboxNavigate}
    />
    </>
  )
}