'use client'

import { Canvas, useThree } from '@react-three/fiber'
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
import { generateOwnerColor } from '@/lib/ownerColors'

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
  onBoardUpdate: () => void
  onEditModeChange?: (isEditing: boolean) => void
}

function SceneContent({ 
  studioId, 
  boards, 
  wallConfig,
  onBoardUpdate,
  onWallClick,
  editingWall,
  editingWallSide,
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
  isWorkspaceMember
}: StudioRoomProps & { 
  onWallClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number, isBackFace?: boolean) => void
  editingWall: number | null
  editingWallSide: 'front' | 'back'
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
}) {
  return (
    <>
      <color attach="background" args={['#f5f5f5']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} castShadow />
      <directionalLight position={[-10, 10, -5]} intensity={0.4} />
      
      <WallSystem 
  boards={boards} 
  wallConfig={wallConfig}
  onWallClick={onWallClick}
  editingWall={editingWall}
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
            console.log('🎨 [SceneContent] Rendering', entries.length, 'draggable boards for wall', editingWall, 'side:', editingWallSide)
            return entries.map(([boardId, localPos]) => {
              const board = boards.find(b => b.id === boardId)
              if (!board) {
                console.warn(`❌ [SceneContent] Board ${boardId} not found in boards list`)
                return null
              }
              
              // Verify board is on the correct side
              const boardSide = board.position?.side || 'front'
              if (boardSide !== editingWallSide) {
                console.warn(`⚠️ [SceneContent] Board ${boardId} is on ${boardSide} side but we're editing ${editingWallSide} side`)
              }
              
              console.log(`🎨 [SceneContent] Rendering board ${boardId} on ${boardSide} side`)
              
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
        // Find the largest wall dimension to scale camera controls
        const maxWallWidth = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.width)) : 8
        const maxWallHeight = wallConfig?.walls ? Math.max(...wallConfig.walls.map(w => w.height)) : 10
        const maxDimension = Math.max(maxWallWidth, maxWallHeight) // in feet
        
        // Scale camera controls based on wall size
        // Base scale: for 8ft walls, we use 50-800 inches
        // For larger walls, scale proportionally
        const scaleFactor = maxDimension / 8 // 8ft is our baseline
        const minDistance = 50 * scaleFactor   // Scale minimum zoom
        const maxDistance = 800 * scaleFactor  // Scale maximum zoom
        const targetHeight = 50 * scaleFactor  // Scale target height
        const cameraHeight = 50 * scaleFactor  // Scale camera height
        const cameraDistance = 80 * scaleFactor // Scale camera distance
        
        return (
          <>
            <OrbitControls 
              enableDamping
              dampingFactor={0.05}
              minDistance={minDistance}   // Scaled minimum zoom
              maxDistance={maxDistance}   // Scaled maximum zoom
              maxPolarAngle={Math.PI / 2}
              minPolarAngle={Math.PI / 6}  // Prevent looking from too high above (30 degrees minimum)
              enabled={editingWall === null}
              enablePan={editingWall === null}
              enableRotate={editingWall === null}
              enableZoom={editingWall === null}
              target={[0, targetHeight, 0]}  // Scaled target height
            />
            
            <PerspectiveCamera 
              makeDefault 
              position={[0, cameraHeight, cameraDistance]}  // Scaled camera position
              fov={50}  // Wider FOV to see more of the room
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
    })
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
  const [editingWallSide, setEditingWallSide] = useState<'front' | 'back'>('front')
  const [editingWallDimensions, setEditingWallDimensions] = useState<WallDimensions | null>(null)
  const [editingWallPosition, setEditingWallPosition] = useState<THREE.Vector3 | null>(null)
  const [editingWallRotation, setEditingWallRotation] = useState<number>(0)
  const [showEditUI, setShowEditUI] = useState(false)
  const [placedBoards3D, setPlacedBoards3D] = useState<Map<string, { 
    x: number; 
    y: number; 
    width?: number; 
    height?: number 
  }>>(new Map())
  
  // Keep a ref to the latest placedBoards3D to avoid stale closure issues
  const placedBoards3DRef = useRef(placedBoards3D)
  useEffect(() => {
    placedBoards3DRef.current = placedBoards3D
  }, [placedBoards3D])
  const [draggingFromSidebar, setDraggingFromSidebar] = useState<Board | null>(null)
  const [commentPanelBoard, setCommentPanelBoard] = useState<Board | null>(null)
  // Local boards state to include newly uploaded boards immediately
  const [localBoards, setLocalBoards] = useState<Board[]>(props.boards)
  
  // Sync with props.boards when they change (e.g., after refresh)
  useEffect(() => {
    setLocalBoards(prev => {
      // Merge: keep any local boards that aren't in props yet, add new ones from props
      const localBoardIds = new Set(prev.map(b => b.id))
      const propsBoardIds = new Set(props.boards.map(b => b.id))
      
      // Keep local boards that aren't in props yet (just uploaded)
      // BUT: if a board was deleted (not in props.boards), remove it from localBoards
      const localOnly = prev.filter(b => !propsBoardIds.has(b.id) && props.boards.length > 0)
      // Add/update boards from props
      return [...localOnly, ...props.boards]
    })
  }, [props.boards])

  const handleWallClick = (
    wallIndex: number,
    wallDimensions: WallDimensions,
    position: THREE.Vector3,
    rotation: number,
    isBackFace?: boolean
  ) => {
    const side: 'front' | 'back' = isBackFace ? 'back' : 'front'
    console.log('🖼️ [StudioRoom] Wall clicked:', wallIndex, 'side:', side, 'rotation:', rotation)
    
    // If we're already editing this exact wall and side, don't reinitialize
    if (editingWall === wallIndex && editingWallSide === side) {
      console.log('🖼️ [StudioRoom] Already editing this wall side, keeping current positions')
      return
    }
    
    // Hide edit UI first, let camera animation play, then show UI
    setShowEditUI(false)
    props.onEditModeChange?.(false)
    
    setEditingWall(wallIndex)
    setEditingWallSide(side)
    setEditingWallDimensions(wallDimensions)
    setEditingWallPosition(position)
    // Use the adjusted rotation (flipped 180° if back face was clicked)
    setEditingWallRotation(rotation)

    // Load all boards that have positions on this wall AND side
    const newMap = new Map<string, { x: number; y: number; width?: number; height?: number }>()
    
    const boardsOnThisWall = localBoards.filter(b => 
      b.position?.wallIndex === wallIndex && (b.position?.side || 'front') === side
    )
    console.log('🖼️ [StudioRoom] Boards on wall', wallIndex, ':', boardsOnThisWall.length, boardsOnThisWall.map(b => ({ id: b.id, pos: b.position })))
    
    boardsOnThisWall.forEach(board => {
      if (board.position) {
        // Convert position from percentage (0-100) to normalized (-0.5 to 0.5) if needed
        // Positions saved from upload API are percentages, but 3D editor uses normalized coordinates
        let normalizedX = board.position.x
        let normalizedY = board.position.y
        
        // If position is > 1, it's likely a percentage (0-100), convert to normalized
        if (Math.abs(normalizedX) > 1 || Math.abs(normalizedY) > 1) {
          normalizedX = (normalizedX / 100) - 0.5
          normalizedY = (normalizedY / 100) - 0.5
          console.log(`🔄 [StudioRoom] Converted position for ${board.id} from percentage (${board.position.x}, ${board.position.y}) to normalized (${normalizedX.toFixed(3)}, ${normalizedY.toFixed(3)})`)
        }
        
        // Prioritize: physical dimensions > saved dimensions > aspect ratio > defaults
        // Always use physical dimensions if available (they represent the actual board size)
        let widthPercent: number | undefined
        let heightPercent: number | undefined
        
        // First, try to calculate from physical dimensions if available
        if (board.physicalWidth && board.physicalHeight && wallDimensions) {
          const wallWidthInches = wallDimensions.width * 12 // 8 ft = 96 inches
          const wallHeightInches = wallDimensions.height * 12 // 10 ft = 120 inches
          
          widthPercent = board.physicalWidth / wallWidthInches
          heightPercent = board.physicalHeight / wallHeightInches
          
          // Clamp to ensure board doesn't exceed wall size
          widthPercent = Math.min(widthPercent, 1.0)
          heightPercent = Math.min(heightPercent, 1.0)
          
          console.log(`📐 [StudioRoom] Calculated dimensions for ${board.id} from physical size (${board.physicalWidth}" x ${board.physicalHeight}"):`, {
            width: `${(widthPercent * 100).toFixed(1)}%`,
            height: `${(heightPercent * 100).toFixed(1)}%`
          })
        }
        
        // If no physical dimensions, fall back to saved dimensions
        if (widthPercent === undefined || heightPercent === undefined) {
          // Convert saved dimensions from percentage to normalized if needed
          let savedWidth = board.position.width
          let savedHeight = board.position.height
          
          if (savedWidth !== undefined && savedWidth > 1) {
            savedWidth = savedWidth / 100
          }
          if (savedHeight !== undefined && savedHeight > 1) {
            savedHeight = savedHeight / 100
          }
          
          widthPercent = savedWidth
          heightPercent = savedHeight
        }
        
        // If still no dimensions, try aspect ratio
        if ((widthPercent === undefined || heightPercent === undefined) && board.aspectRatio && wallDimensions) {
          // Fallback: calculate from aspect ratio
          const baseHeightPercent = 0.35
          heightPercent = baseHeightPercent
          
          // Calculate width to maintain aspect ratio
          const wallAspectRatio = wallDimensions.width / wallDimensions.height
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
          
          // Ensure minimum size
          const minSize = 0.15
          widthPercent = Math.max(minSize, widthPercent)
          heightPercent = Math.max(minSize, heightPercent)
          
          console.log(`📐 [StudioRoom] Calculated dimensions for ${board.id} using aspect ratio ${board.aspectRatio.toFixed(3)}:`, {
            width: `${(widthPercent * 100).toFixed(1)}%`,
            height: `${(heightPercent * 100).toFixed(1)}%`
          })
        } else if (widthPercent === undefined || heightPercent === undefined) {
          // Default fallback
          widthPercent = widthPercent ?? 0.30
          heightPercent = heightPercent ?? 0.30
          console.log(`⚠️ [StudioRoom] Board ${board.id} has no dimensions, using defaults`)
        }
        
        // Use normalized positions
        newMap.set(board.id, {
          x: normalizedX,
          y: normalizedY,
          width: widthPercent,
          height: heightPercent,
        })
        console.log('🖼️ [StudioRoom] Loading board', board.id, 'at:', { 
          x: board.position.x, 
          y: board.position.y, 
          w: widthPercent, 
          h: heightPercent
        })
      }
    })

    console.log('🖼️ [StudioRoom] Total boards to render:', newMap.size)
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

    // Use ref to get the LATEST placedBoards3D (avoids stale closure)
    const currentBoards = placedBoards3DRef.current
    const wallToSave = editingWall
    const sideToSave = editingWallSide

    console.log('💾 [StudioRoom] ========== SAVE & EXIT CLICKED ==========')
    console.log('💾 [StudioRoom] Editing wall:', wallToSave)
    console.log('💾 [StudioRoom] placedBoards3D (from ref) has', currentBoards.size, 'boards')
    console.log('💾 [StudioRoom] Board positions:', Array.from(currentBoards.entries()))
    
    // Hide UI and exit edit mode IMMEDIATELY to trigger camera animation
    setShowEditUI(false)
    props.onEditModeChange?.(false)
    
    // Exit edit mode immediately - this triggers the camera swoosh animation
    setEditingWall(null)
    setEditingWallPosition(null)

    // Save in the background (non-blocking)
    if (currentBoards.size === 0) {
      console.warn('⚠️ [StudioRoom] No boards to save! placedBoards3D is empty!')
    }

    // Run save operation in background without blocking
    ;(async () => {
      try {
        // Save all board positions
        // First, get fresh boards list to ensure we don't save positions for deleted boards
        let freshBoards = props.boards
        try {
          const refreshResponse = await fetch(`/api/boards?workspaceId=${props.studioId}`)
          if (refreshResponse.ok) {
            const refreshData = await refreshResponse.json()
            freshBoards = refreshData.boards || props.boards
            console.log('🔄 [StudioRoom] Refreshed boards list before save:', freshBoards.length, 'boards')
          }
        } catch (error) {
          console.warn('⚠️ [StudioRoom] Failed to refresh boards before save, using props.boards:', error)
        }
        
        // Filter out temporary boards (those with temp- IDs that weren't successfully saved)
        // Temp boards should have been replaced with real IDs after upload, so any remaining
        // temp IDs are orphaned and should be skipped
        const validBoards = Array.from(currentBoards.entries()).filter(([boardId]) => {
          // Skip all temporary IDs - they should have been replaced with real IDs after upload
          if (boardId.startsWith('temp-')) {
            const existsInFresh = freshBoards.some(b => b.id === boardId)
            if (!existsInFresh) {
              console.log('🧹 [StudioRoom] Skipping temporary board that was never saved:', boardId)
              return false
            }
            // Even if it exists in fresh list, it's still a temp ID which shouldn't be saved
            // (should have been replaced with real ID)
            console.log('🧹 [StudioRoom] Skipping temporary board ID (should have been replaced):', boardId)
            return false
          }
          return true
        })
        
        console.log(`💾 [StudioRoom] Saving ${validBoards.length} valid boards (filtered ${currentBoards.size - validBoards.length} temp boards)`)
        
        for (const [boardId, localPos] of validBoards) {
          const board = freshBoards.find(b => b.id === boardId)
          if (!board) {
            // Only warn if it's not a temp ID (temp IDs are expected to be filtered out above)
            if (!boardId.startsWith('temp-')) {
              console.warn('⚠️ [StudioRoom] Board not found in fresh list (may have been deleted):', boardId)
            }
            continue
          }

          const updatedBoard = {
            ...board,
            position: {
              wallIndex: wallToSave,
              x: localPos.x,
              y: localPos.y,
              width: localPos.width || 0.2,
              height: localPos.height || 0.2,
              side: sideToSave, // Save which side this board is on
            },
          }

          console.log('💾 [StudioRoom] Saving board', board.id, ':', updatedBoard.position)

          const response = await fetch('/api/boards', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedBoard),
          })

          if (!response.ok) {
            console.error('❌ [StudioRoom] Failed to save board', board.id, '- HTTP', response.status)
          } else {
            console.log('✅ [StudioRoom] Successfully saved board', board.id)
          }
        }

        // Remove boards that were removed from this wall side
        const boardIdsOnWall = Array.from(currentBoards.keys())
        const boardsToRemove = props.boards.filter(
          b => b.position?.wallIndex === wallToSave 
            && (b.position?.side || 'front') === sideToSave
            && !boardIdsOnWall.includes(b.id)
        )

        if (boardsToRemove.length > 0) {
          console.log('🗑️ [StudioRoom] Removing', boardsToRemove.length, 'boards from wall')
        }

        for (const board of boardsToRemove) {
          await fetch('/api/boards', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...board, position: undefined }),
          })
        }

        console.log('🔄 [StudioRoom] Calling onBoardUpdate to reload data...')
        await props.onBoardUpdate()
        console.log('✅ [StudioRoom] Save complete! Data reloaded.')
      } catch (error) {
        console.error('❌ [StudioRoom] Error saving boards:', error)
        alert('Failed to save board positions')
      }
    })()
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
    }
    
    setDraggingFromSidebar(null)
  }

  const handleDragCancel = () => {
    setDraggingFromSidebar(null)
  }

  const handleBoardPositionChange = useCallback((boardId: string, localX: number, localY: number, width?: number, height?: number) => {
    console.log('🔁 [StudioRoom] handleBoardPositionChange CALLED:', { boardId, localX, localY, width, height })
    setPlacedBoards3D(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(boardId)
      const finalPosition = { 
        x: localX, 
        y: localY,
        width: width || existing?.width || 0.2,
        height: height || existing?.height || 0.2
      }
      newMap.set(boardId, finalPosition)
      console.log('🔁 [StudioRoom] ✅ Updated placedBoards3D for', boardId, ':', finalPosition)
      console.log('🔁 [StudioRoom] Total boards in placedBoards3D:', newMap.size)
      
      // Also update the ref immediately
      placedBoards3DRef.current = newMap
      
      return newMap
    })
  }, [])

  const handleBoardDelete = useCallback(async (boardId: string) => {
    try {
      // Call DELETE API with ownership check
      const response = await fetch(`/api/boards?boardId=${boardId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 403) {
          // Permission denied - show error message
          alert(`You can only delete boards in workspaces you're a member of${data.ownerName ? `. This board belongs to ${data.ownerName}.` : '.'}`)
        } else if (response.status === 401) {
          alert('You must be signed in to delete boards')
        } else {
          alert(data.error || 'Failed to delete board')
        }
        return
      }

      // Success - remove from local state
      console.log('✅ Board deleted successfully:', boardId)
      
      // Remove from placedBoards3D
      setPlacedBoards3D(prev => {
        const newMap = new Map(prev)
        newMap.delete(boardId)
        placedBoards3DRef.current = newMap // Also update ref
        return newMap
      })
      
      // Remove from localBoards
      setLocalBoards(prev => prev.filter(b => b.id !== boardId))

      // Refresh boards from server
      if (props.onBoardUpdate) {
        await props.onBoardUpdate()
      }
    } catch (error) {
      console.error('Error deleting board:', error)
      alert('Failed to delete board')
    }
  }, [props.onBoardUpdate])

  // Handle keyboard shortcuts (backspace to delete selected board)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle backspace if we're in edit mode and a board is selected
      // Don't prevent default if user is typing in an input field
      if (e.key === 'Backspace' && selectedBoardId && editingWall !== null) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return // Let the input handle backspace normally
        }
        
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
      
      // Escape key to deselect
      if (e.key === 'Escape' && selectedBoardId) {
        setSelectedBoardId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedBoardId, editingWall, localBoards, user, handleBoardDelete])

  const handleUpload = () => {
    // Helper function to upload a single file/board
    const uploadSingleFile = async (
      uploadFile: File,
      title: string,
      width: number,
      height: number,
      aspectRatio: number,
      isPDF: boolean,
      widthPercent?: number,
      heightPercent?: number,
      physicalWidth?: number,  // in inches
      physicalHeight?: number  // in inches
    ): Promise<Board | null> => {
      const formData = new FormData()
      formData.append('image', uploadFile)
      formData.append('studioId', props.studioId)
      formData.append('title', title)
      formData.append('studentName', user?.fullName || user?.firstName || 'Uploaded Board')
      formData.append('description', isPDF ? 'PDF Document' : '')
      formData.append('tags', isPDF ? 'pdf' : '')
      formData.append('originalWidth', width.toString())
      formData.append('originalHeight', height.toString())
      formData.append('aspectRatio', aspectRatio.toString())
      
      // Add physical dimensions if available
      if (physicalWidth && physicalHeight) {
        formData.append('physicalWidth', physicalWidth.toString())
        formData.append('physicalHeight', physicalHeight.toString())
        console.log(`📐 [Upload] Physical dimensions: ${physicalWidth.toFixed(2)}" x ${physicalHeight.toFixed(2)}"`)
      }
      
      // If editing a wall, automatically position the board on that wall (centered)
      if (editingWall !== null && editingWallDimensions) {
        formData.append('position_wall_index', editingWall.toString())
        formData.append('position_x', '0') // Center horizontally
        formData.append('position_y', '0') // Center vertically
        formData.append('position_width', widthPercent!.toString())
        formData.append('position_height', heightPercent!.toString())
      }
      
      if (user) {
        formData.append('ownerId', user.id)
        formData.append('ownerName', user.fullName || user.firstName || 'Anonymous')
        formData.append('ownerColor', generateOwnerColor(user.id))
      }
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        const error = await response.text()
        throw new Error(error || 'Upload failed')
      }
      
      const data = await response.json()
      return data.board as Board
    }
    
    // Create a file input element
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.jpg,.jpeg,.png,.pdf'
    input.multiple = true  // Allow multiple file selection
    
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length === 0) return
      
      console.log(`📤 Uploading ${files.length} file(s)...`)
      
      let successCount = 0
      let failCount = 0
      
      // Process each file
      for (const file of files) {
        
        // Validate file type
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
        if (!validTypes.includes(file.type)) {
          console.warn(`⚠️ Skipping invalid file type: ${file.name}`)
          failCount++
          continue
        }
        
        try {
        const isPDF = file.type === 'application/pdf'
        let uploadedBoard: Board | null = null
        
        // Handle multi-page PDFs
        if (isPDF) {
          console.log('🔄 Converting PDF (multi-page support)...')
          const { convertPDFToImages } = await import('@/lib/pdfToImage')
          const pages = await convertPDFToImages(file)
          
          console.log(`✅ PDF converted to ${pages.length} image(s)`)
          
          // Calculate grid layout for all pages
          const cols = Math.ceil(Math.sqrt(pages.length))
          const rows = Math.ceil(pages.length / cols)
          const spacingX = 0.15 // 15% spacing horizontally (as decimal)
          const spacingY = 0.15 // 15% spacing vertically (as decimal)
          
          // Upload each page as a separate board
          for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            const page = pages[pageIndex]
            const pageTitle = pages.length > 1 
              ? `${file.name.replace('.pdf', '')} - Page ${page.pageNumber}`
              : file.name.replace('.pdf', '')
            
            // Calculate dimensions and percentages if editing a wall
            let widthPercent = 0.30
            let heightPercent = 0.30
            if (editingWall !== null && editingWallDimensions) {
              const defaultHeightPercent = 0.30
              const wallAspectRatio = editingWallDimensions.width / editingWallDimensions.height
              widthPercent = defaultHeightPercent * page.aspectRatio / wallAspectRatio
              
              const maxWidth = 0.50
              if (widthPercent > maxWidth) {
                widthPercent = maxWidth
              }
            }
            
            // Calculate grid position for this page
            const col = pageIndex % cols
            const row = Math.floor(pageIndex / cols)
            // Calculate board size per grid cell (accounting for spacing)
            const boardWidth = (1.0 - spacingX * (cols + 1)) / cols
            const boardHeight = (1.0 - spacingY * (rows + 1)) / rows
            // Position: spacing + (col * (boardWidth + spacing)) + boardWidth/2 (center of cell)
            const gridX = spacingX + col * (boardWidth + spacingX) + boardWidth / 2 - 0.5 // Center at 0
            const gridY = spacingY + row * (boardHeight + spacingY) + boardHeight / 2 - 0.5 // Center at 0
            
            // OPTIMISTIC UPDATE: Create temporary board with blob URL immediately
            let tempBoardId: string | null = null
            if (editingWall !== null && editingWallDimensions) {
              const blobUrl = URL.createObjectURL(page.imageFile)
              tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
              
              const tempBoard: Board = {
                id: tempBoardId,
                studioId: props.studioId,
                title: pageTitle,
                studentName: user?.fullName || user?.firstName || 'Uploaded Board',
                ownerId: user?.id,
                ownerName: user?.fullName || user?.firstName || 'Anonymous',
                thumbnailUrl: blobUrl,
                fullImageUrl: blobUrl,
                uploadedAt: new Date(),
                tags: ['pdf'],
                originalWidth: page.width,
                originalHeight: page.height,
                aspectRatio: page.aspectRatio,
                physicalWidth: page.physicalWidth,
                physicalHeight: page.physicalHeight,
                position: {
                  wallIndex: editingWall,
                  x: gridX,
                  y: gridY,
                  width: widthPercent,
                  height: heightPercent,
                  side: editingWallSide // Include which side this board is on
                }
              }
              
              // Add temporary board immediately with blob URL
              console.log(`📤 [Upload PDF] Adding temp board ${pageIndex + 1}/${pages.length} at grid position (${col}, ${row}):`, tempBoardId, tempBoard)
              setLocalBoards(prev => {
                const updated = [...prev, tempBoard]
                console.log('📤 [Upload PDF] localBoards now has', updated.length, 'boards')
                return updated
              })
              setPlacedBoards3D(prev => {
                const newMap = new Map(prev)
                newMap.set(tempBoardId!, {
                  x: gridX,
                  y: gridY,
                  width: widthPercent,
                  height: heightPercent
                })
                console.log('📤 [Upload PDF] placedBoards3D now has', newMap.size, 'boards')
                placedBoards3DRef.current = newMap
                return newMap
              })
            }
            
            // Upload in background (with physical dimensions from PDF)
            // Note: We need to pass grid position, but uploadSingleFile always uses (0, 0)
            // So we'll create formData directly with the grid position
            console.log(`📤 [Upload PDF] Uploading page ${pageIndex + 1}/${pages.length} with physical dimensions: ${page.physicalWidth?.toFixed(2)}" x ${page.physicalHeight?.toFixed(2)}" at grid position (${gridX.toFixed(3)}, ${gridY.toFixed(3)})`)
            
            const formData = new FormData()
            formData.append('image', page.imageFile)
            formData.append('studioId', props.studioId)
            formData.append('title', pageTitle)
            formData.append('studentName', user?.fullName || user?.firstName || 'Uploaded Board')
            formData.append('description', 'PDF Document')
            formData.append('tags', 'pdf')
            formData.append('originalWidth', page.width.toString())
            formData.append('originalHeight', page.height.toString())
            formData.append('aspectRatio', page.aspectRatio.toString())
            
            if (page.physicalWidth && page.physicalHeight) {
              formData.append('physicalWidth', page.physicalWidth.toString())
              formData.append('physicalHeight', page.physicalHeight.toString())
            }
            
            if (editingWall !== null && editingWallDimensions) {
              formData.append('position_wall_index', editingWall.toString())
              // Convert grid position (-0.5 to 0.5) to percentage (0 to 100)
              formData.append('position_x', ((gridX + 0.5) * 100).toString())
              formData.append('position_y', ((gridY + 0.5) * 100).toString())
              formData.append('position_width', (widthPercent * 100).toString())
              formData.append('position_height', (heightPercent * 100).toString())
            }
            
            if (user) {
              formData.append('ownerId', user.id)
              formData.append('ownerName', user.fullName || user.firstName || 'Anonymous')
              formData.append('ownerColor', generateOwnerColor(user.id))
            }
            
            const response = await fetch('/api/upload', {
              method: 'POST',
              body: formData
            })
            
            let board: Board | null = null
            if (response.ok) {
              const data = await response.json()
              board = data.board as Board
            } else {
              const error = await response.text()
              console.error(`❌ [Upload PDF] Failed to upload page ${pageIndex + 1}:`, error)
            }
            
            if (board && page.physicalWidth && page.physicalHeight) {
              console.log(`✅ [Upload PDF] Board uploaded with physical dimensions: ${board.physicalWidth}" x ${board.physicalHeight}"`)
            }
            
            // Replace temporary board with real uploaded board
            if (board && tempBoardId && editingWall !== null && board.position?.wallIndex === editingWall) {
              // Replace temp board with real board and revoke blob URL
              setLocalBoards(prev => {
                const tempBoard = prev.find(b => b.id === tempBoardId)
                if (tempBoard?.thumbnailUrl?.startsWith('blob:')) {
                  URL.revokeObjectURL(tempBoard.thumbnailUrl)
                }
                // Preserve the side property from temp board (not stored in DB yet)
                const updatedBoard = {
                  ...board,
                  position: board.position ? {
                    ...board.position,
                    side: tempBoard?.position?.side || editingWallSide
                  } : undefined
                }
                return prev.map(b => b.id === tempBoardId ? updatedBoard : b)
              })
              
              // Update placedBoards3D with real board ID
              setPlacedBoards3D(prev => {
                const newMap = new Map(prev)
                const position = newMap.get(tempBoardId!)
                if (position) {
                  newMap.delete(tempBoardId!)
                  newMap.set(board.id, position)
                  placedBoards3DRef.current = newMap // Update ref immediately
                  console.log(`✅ [Upload PDF] Replaced temp board ${tempBoardId} with real board ${board.id}`)
                } else {
                  console.warn(`⚠️ [Upload PDF] Temp board ${tempBoardId} not found in placedBoards3D`)
                }
                return newMap
              })
            } else if (tempBoardId && (!board || board.position?.wallIndex !== editingWall)) {
              // Upload failed or board wasn't placed on current wall - clean up temp board
              console.log(`🧹 [Upload PDF] Cleaning up temp board ${tempBoardId} (upload failed or wrong wall)`)
              setLocalBoards(prev => {
                const tempBoard = prev.find(b => b.id === tempBoardId)
                if (tempBoard?.thumbnailUrl?.startsWith('blob:')) {
                  URL.revokeObjectURL(tempBoard.thumbnailUrl)
                }
                return prev.filter(b => b.id !== tempBoardId)
              })
              setPlacedBoards3D(prev => {
                const newMap = new Map(prev)
                if (newMap.has(tempBoardId)) {
                  newMap.delete(tempBoardId)
                  placedBoards3DRef.current = newMap
                  console.log(`🧹 [Upload PDF] Removed temp board ${tempBoardId} from placedBoards3D`)
                }
                return newMap
              })
            }
          }
          
          successCount += pages.length
          continue // Skip the regular upload below
        }
        
        // Handle regular images
        const { getImageDimensions } = await import('@/lib/getImageDimensions')
        const { extractImagePhysicalDimensions } = await import('@/lib/extractPhysicalDimensions')
        const dims = await getImageDimensions(file)
        
        // Extract physical dimensions from image (like InDesign)
        let physicalWidth: number | undefined
        let physicalHeight: number | undefined
        try {
          const physicalDims = await extractImagePhysicalDimensions(file)
          physicalWidth = physicalDims.physicalWidth
          physicalHeight = physicalDims.physicalHeight
          console.log(`📐 [Upload] Image physical dimensions extracted: ${physicalWidth.toFixed(2)}" x ${physicalHeight.toFixed(2)}" @ ${physicalDims.dpi} DPI`)
        } catch (error) {
          console.warn('⚠️ Could not extract physical dimensions from image:', error)
          // Continue without physical dimensions (will use aspect ratio fallback)
        }
        
        // Calculate dimensions and percentages if editing a wall
        let widthPercent = 0.30
        let heightPercent = 0.30
        if (editingWall !== null && editingWallDimensions) {
          const defaultHeightPercent = 0.30
          const wallAspectRatio = editingWallDimensions.width / editingWallDimensions.height
          widthPercent = defaultHeightPercent * dims.aspectRatio / wallAspectRatio
          
          const maxWidth = 0.50
          if (widthPercent > maxWidth) {
            widthPercent = maxWidth
          }
        }
        
        // OPTIMISTIC UPDATE: Create temporary board with blob URL immediately
        let tempBoardId: string | null = null
        if (editingWall !== null && editingWallDimensions) {
          const blobUrl = URL.createObjectURL(file)
          tempBoardId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          
          const tempBoard: Board = {
            id: tempBoardId,
            studioId: props.studioId,
            title: file.name.replace(/\.[^/.]+$/, ''),
            studentName: user?.fullName || user?.firstName || 'Uploaded Board',
            ownerId: user?.id,
            ownerName: user?.fullName || user?.firstName || 'Anonymous',
            thumbnailUrl: blobUrl,
            fullImageUrl: blobUrl,
            uploadedAt: new Date(),
            tags: [],
            originalWidth: dims.width,
            originalHeight: dims.height,
            aspectRatio: dims.aspectRatio,
            physicalWidth: physicalWidth,
            physicalHeight: physicalHeight,
            position: {
              wallIndex: editingWall,
              x: 0,
              y: 0,
              width: widthPercent,
              height: heightPercent,
              side: editingWallSide // Include which side this board is on
            }
          }
          
          // Add temporary board immediately with blob URL
          console.log('📤 [Upload] Adding temp board:', tempBoardId, tempBoard)
          setLocalBoards(prev => {
            const updated = [...prev, tempBoard]
            console.log('📤 [Upload] localBoards now has', updated.length, 'boards')
            return updated
          })
          setPlacedBoards3D(prev => {
            const newMap = new Map(prev)
            newMap.set(tempBoardId!, {
              x: 0,
              y: 0,
              width: widthPercent,
              height: heightPercent
            })
            console.log('📤 [Upload] placedBoards3D now has', newMap.size, 'boards, editingWall:', editingWall)
            placedBoards3DRef.current = newMap
            return newMap
          })
        }
        
        // Upload in background (with extracted physical dimensions)
        uploadedBoard = await uploadSingleFile(
          file,
          file.name.replace(/\.[^/.]+$/, ''),
          dims.width,
          dims.height,
          dims.aspectRatio,
          false,
          widthPercent,
          heightPercent,
          physicalWidth,   // Extracted physical dimensions in inches
          physicalHeight
        )
        
        // Replace temporary board with real uploaded board
        if (uploadedBoard && tempBoardId && editingWall !== null && uploadedBoard.position?.wallIndex === editingWall) {
          // Replace temp board with real board and revoke blob URL
          setLocalBoards(prev => {
            const tempBoard = prev.find(b => b.id === tempBoardId)
            if (tempBoard?.thumbnailUrl?.startsWith('blob:')) {
              URL.revokeObjectURL(tempBoard.thumbnailUrl)
            }
            // Preserve the side property from temp board (not stored in DB yet)
            const updatedBoard = {
              ...uploadedBoard,
              position: uploadedBoard.position ? {
                ...uploadedBoard.position,
                side: tempBoard?.position?.side || editingWallSide
              } : undefined
            }
            return prev.map(b => b.id === tempBoardId ? updatedBoard : b)
          })
          
          // Update placedBoards3D with real board ID
          setPlacedBoards3D(prev => {
            const newMap = new Map(prev)
            const position = newMap.get(tempBoardId!)
            if (position) {
              newMap.delete(tempBoardId!)
              newMap.set(uploadedBoard!.id, position)
              placedBoards3DRef.current = newMap // Update ref immediately
              console.log(`✅ [Upload] Replaced temp board ${tempBoardId} with real board ${uploadedBoard.id}`)
            } else {
              console.warn(`⚠️ [Upload] Temp board ${tempBoardId} not found in placedBoards3D`)
            }
            return newMap
          })
        } else if (tempBoardId && (!uploadedBoard || uploadedBoard.position?.wallIndex !== editingWall)) {
          // Upload failed or board wasn't placed on current wall - clean up temp board
          console.log(`🧹 [Upload] Cleaning up temp board ${tempBoardId} (upload failed or wrong wall)`)
          setLocalBoards(prev => {
            const tempBoard = prev.find(b => b.id === tempBoardId)
            if (tempBoard?.thumbnailUrl?.startsWith('blob:')) {
              URL.revokeObjectURL(tempBoard.thumbnailUrl)
            }
            return prev.filter(b => b.id !== tempBoardId)
          })
          setPlacedBoards3D(prev => {
            const newMap = new Map(prev)
            if (newMap.has(tempBoardId)) {
              newMap.delete(tempBoardId)
              placedBoards3DRef.current = newMap
              console.log(`🧹 [Upload] Removed temp board ${tempBoardId} from placedBoards3D`)
            }
            return newMap
          })
        }
        
        console.log(`✅ Successfully uploaded: ${file.name}`)
        successCount++
        } catch (error) {
          console.error(`❌ Failed to upload ${file.name}:`, error)
          failCount++
        }
      }
      
      // Refresh boards list once after all uploads
      await props.onBoardUpdate()
      
      // Upload complete - no alert needed, boards will appear on the wall automatically
    }
    
    // Trigger file picker
    input.click()
  }

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
        <Canvas shadows>
          <CameraController
            editingWall={editingWall}
            wallPosition={editingWallPosition}
            wallRotation={editingWallRotation}
            wallDimensions={editingWallDimensions}
            onTransitionComplete={handleCameraTransitionComplete}
          />
          <SceneContent 
            {...props}
            boards={localBoards}
            onWallClick={handleWallClick}
            editingWall={editingWall}
            editingWallSide={editingWallSide}
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
              console.log('💬 [Edit Mode] Opening comments for:', board.id)
              setCommentPanelBoard(board)
            }}
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
    </>
  )
}