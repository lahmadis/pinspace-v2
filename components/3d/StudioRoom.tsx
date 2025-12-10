'use client'

import { Canvas } from '@react-three/fiber'
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
  onCommentClick
}: StudioRoomProps & { 
  onWallClick: (wallIndex: number, wallDimensions: WallDimensions, position: THREE.Vector3, rotation: number) => void
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
          {(() => {
            const entries = Array.from(placedBoards3D.entries())
            console.log('🎨 [SceneContent] Rendering', entries.length, 'draggable boards for wall', editingWall)
            return entries.map(([boardId, localPos]) => {
              const board = boards.find(b => b.id === boardId)
              if (!board) {
                console.warn(`❌ [SceneContent] Board ${boardId} not found in boards list`)
                return null
              }
              
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
                />
              )
            })
          })()}
        </>
      )}
      
      <OrbitControls 
        enableDamping
        dampingFactor={0.05}
        minDistance={3}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2}
        enabled={editingWall === null}
        enablePan={editingWall === null}
        enableRotate={editingWall === null}
        enableZoom={editingWall === null}
      />
      
      <PerspectiveCamera 
  makeDefault 
  position={[0, 3.2, 7]} 
  fov={35}
/>


    </>
  )
}

export default function StudioRoom(props: StudioRoomProps) {
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
  const [editingWall, setEditingWall] = useState<number | null>(null)
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

  const handleWallClick = (
    wallIndex: number,
    wallDimensions: WallDimensions,
    position: THREE.Vector3,
    rotation: number
  ) => {
    console.log('🖼️ [StudioRoom] Wall clicked:', wallIndex)
    
    // If we're already editing this wall, DON'T reinitialize positions!
    if (editingWall === wallIndex) {
      console.log('🖼️ [StudioRoom] Already editing this wall, keeping current positions')
      return
    }
    
    setEditingWall(wallIndex)
    setEditingWallDimensions(wallDimensions)
    setEditingWallPosition(position)
    setEditingWallRotation(rotation)

    // Load all boards that have positions on this wall
    const newMap = new Map<string, { x: number; y: number; width?: number; height?: number }>()
    
    const boardsOnThisWall = props.boards.filter(b => b.position?.wallIndex === wallIndex)
    console.log('🖼️ [StudioRoom] Boards on wall', wallIndex, ':', boardsOnThisWall.length, boardsOnThisWall.map(b => ({ id: b.id, pos: b.position })))
    
    boardsOnThisWall.forEach(board => {
      if (board.position) {
        let widthPercent = board.position.width || 0.30
        let heightPercent = board.position.height || 0.30
        
        // ALWAYS recalculate from aspect ratio if available (overrides saved dimensions)
        if (board.aspectRatio && wallDimensions) {
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
        } else if (!board.position.width || !board.position.height) {
          console.log(`⚠️ [StudioRoom] Board ${board.id} has no aspect ratio and no dimensions, using defaults`)
        }
        
        newMap.set(board.id, {
          x: board.position.x,
          y: board.position.y,
          width: widthPercent,
          height: heightPercent,
        })
        console.log('🖼️ [StudioRoom] Loading board', board.id, 'at:', { x: board.position.x, y: board.position.y, w: widthPercent, h: heightPercent })
      }
    })

    console.log('🖼️ [StudioRoom] Total boards to render:', newMap.size)
    setPlacedBoards3D(newMap)
  }


  const handleCameraTransitionComplete = () => {
    if (editingWall !== null) {
      setShowEditUI(true)
    }
  }

  const handleEditComplete = async () => {
    if (editingWall === null || !editingWallDimensions || !editingWallPosition) return

    // Use ref to get the LATEST placedBoards3D (avoids stale closure)
    const currentBoards = placedBoards3DRef.current

    console.log('💾 [StudioRoom] ========== SAVE & EXIT CLICKED ==========')
    console.log('💾 [StudioRoom] Editing wall:', editingWall)
    console.log('💾 [StudioRoom] placedBoards3D (from ref) has', currentBoards.size, 'boards')
    console.log('💾 [StudioRoom] Board positions:', Array.from(currentBoards.entries()))

    setShowEditUI(false)

    if (currentBoards.size === 0) {
      console.warn('⚠️ [StudioRoom] No boards to save! placedBoards3D is empty!')
    }

    try {
      // Save all board positions
      for (const [boardId, localPos] of currentBoards.entries()) {
        const board = props.boards.find(b => b.id === boardId)
        if (!board) {
          console.error('❌ [StudioRoom] Board not found:', boardId)
          continue
        }

        const updatedBoard = {
          ...board,
          position: {
            wallIndex: editingWall,
            x: localPos.x,
            y: localPos.y,
            width: localPos.width || 0.2,
            height: localPos.height || 0.2,
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

      // Remove boards that were removed from this wall
      const boardIdsOnWall = Array.from(currentBoards.keys())
      const boardsToRemove = props.boards.filter(
        b => b.position?.wallIndex === editingWall && !boardIdsOnWall.includes(b.id)
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

    setEditingWall(null)
    setEditingWallPosition(null)
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
      let imageAspectRatio: number
      
      // Use stored aspect ratio if available, otherwise load image
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
        
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = imageUrl
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Failed to load image'))
          // Timeout after 5 seconds
          setTimeout(() => reject(new Error('Image load timeout')), 5000)
        })
        
        imageAspectRatio = img.naturalWidth / img.naturalHeight
        console.log(`📐 Image dimensions: ${img.naturalWidth}x${img.naturalHeight}, aspect: ${imageAspectRatio.toFixed(2)}`)
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
      
      console.log(`📐 Image dimensions: ${img.naturalWidth}x${img.naturalHeight}, aspect: ${imageAspectRatio.toFixed(2)}`)
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
          alert(`You can only delete your own boards${data.ownerName ? `. This board belongs to ${data.ownerName}.` : '.'}`)
        } else if (response.status === 401) {
          alert('You must be signed in to delete boards')
        } else {
          alert(data.error || 'Failed to delete board')
        }
        return
      }

      // Success - remove from local state
      console.log('✅ Board deleted successfully:', boardId)
      setPlacedBoards3D(prev => {
        const newMap = new Map(prev)
        newMap.delete(boardId)
        return newMap
      })

      // Also remove from boards array if needed
      if (props.onBoardUpdate) {
        props.onBoardUpdate()
      }
    } catch (error) {
      console.error('Error deleting board:', error)
      alert('Failed to delete board')
    }
  }, [props.onBoardUpdate])

  const handleUpload = () => {
    // Helper function to upload a single file/board
    const uploadSingleFile = async (
      uploadFile: File,
      title: string,
      width: number,
      height: number,
      aspectRatio: number,
      isPDF: boolean
    ) => {
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
        
        // Handle multi-page PDFs
        if (isPDF) {
          console.log('🔄 Converting PDF (multi-page support)...')
          const { convertPDFToImages } = await import('@/lib/pdfToImage')
          const pages = await convertPDFToImages(file)
          
          console.log(`✅ PDF converted to ${pages.length} image(s)`)
          
          // Upload each page as a separate board
          for (const page of pages) {
            const pageTitle = pages.length > 1 
              ? `${file.name.replace('.pdf', '')} - Page ${page.pageNumber}`
              : file.name.replace('.pdf', '')
            
            await uploadSingleFile(
              page.imageFile,
              pageTitle,
              page.width,
              page.height,
              page.aspectRatio,
              true // isPDF
            )
          }
          
          successCount += pages.length - 1 // Already counted one above
          continue // Skip the regular upload below
        }
        
        // Handle regular images
        const { getImageDimensions } = await import('@/lib/getImageDimensions')
        const dims = await getImageDimensions(file)
        
        await uploadSingleFile(
          file,
          file.name.replace(/\.[^/.]+$/, ''),
          dims.width,
          dims.height,
          dims.aspectRatio,
          false
        )
        
          console.log(`✅ Successfully uploaded: ${file.name}`)
          successCount++
        } catch (error) {
          console.error(`❌ Failed to upload ${file.name}:`, error)
          failCount++
        }
      }
      
      // Refresh boards list once after all uploads
      await props.onBoardUpdate()
      
      // Show summary
      const message = []
      if (successCount > 0) message.push(`✅ ${successCount} file(s) uploaded successfully`)
      if (failCount > 0) message.push(`❌ ${failCount} file(s) failed`)
      alert(message.join('\n'))
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
        availableBoards={props.boards.filter(b => {
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
            onTransitionComplete={handleCameraTransitionComplete}
          />
          <SceneContent 
            {...props} 
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
              console.log('💬 [Edit Mode] Opening comments for:', board.id)
              setCommentPanelBoard(board)
            }}
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