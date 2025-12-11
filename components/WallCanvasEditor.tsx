'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Board } from '@/types'
import PDFRenderer from './PDFRenderer'

interface WallDimensions {
  height: number
  width: number
}

interface WallCanvasEditorProps {
  wallIndex: number
  studioId: string
  allBoards: Board[]
  wallDimensions: WallDimensions
  onSave: (wallIndex: number, boardPositions: Array<{ boardId: string, x: number, y: number, width?: number, height?: number }>) => void
  onExit: () => void
}

interface PlacedBoard {
  board: Board
  x: number
  y: number
}

export default function WallCanvasEditor({ 
  wallIndex, 
  studioId, 
  allBoards, 
  wallDimensions,
  onSave, 
  onExit 
}: WallCanvasEditorProps) {
  const wallAspectRatio = wallDimensions.width / wallDimensions.height
  
  // Log aspect ratio on mount and when dimensions change
  useEffect(() => {
    console.log('═══════════════════════════════════════')
    console.log('🖼️  2D CANVAS ASPECT RATIO')
    console.log('═══════════════════════════════════════')
    console.log(`Wall dimensions: ${wallDimensions.width}ft × ${wallDimensions.height}ft`)
    console.log(`Aspect ratio: ${wallAspectRatio.toFixed(4)} (${wallDimensions.width}/${wallDimensions.height})`)
    console.log('═══════════════════════════════════════')
  }, [wallDimensions.width, wallDimensions.height, wallAspectRatio])
  
  const existingWallBoards = allBoards.filter(b => b.position?.wallIndex === wallIndex)
  
  useEffect(() => {
    const baseAvailableBoards = allBoards.filter(b => 
      b.studioId === studioId && (!b.position || b.position.wallIndex === wallIndex)
    )
    setAvailableBoardsState(baseAvailableBoards)
  }, [allBoards, studioId, wallIndex])

  const [placedBoards, setPlacedBoards] = useState<PlacedBoard[]>(
    existingWallBoards.map(b => ({
      board: b,
      // Convert from centered coordinates (-0.5 to +0.5) to CSS percentages (0-100)
      x: (b.position!.x + 0.5) * 100,
      y: (b.position!.y + 0.5) * 100
    }))
  )

  const [draggingBoard, setDraggingBoard] = useState<Board | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 })
  const [isUploading, setIsUploading] = useState(false)
  const [availableBoardsState, setAvailableBoardsState] = useState<Board[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (board: Board, e: React.MouseEvent) => {
    e.preventDefault()
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const canvasRect = canvas.getBoundingClientRect()
    const placedBoard = placedBoards.find(pb => pb.board.id === board.id)
    
    if (placedBoard) {
      const boardElement = e.currentTarget as HTMLElement
      const boardRect = boardElement.getBoundingClientRect()
      const offsetX = e.clientX - boardRect.left
      const offsetY = e.clientY - boardRect.top
      setDragOffset({ x: offsetX, y: offsetY })
    } else {
      setDragOffset({ x: 120, y: 90 })
    }
    
    setDraggingBoard(board)
    setDragPosition({
      x: e.clientX - canvasRect.left,
      y: e.clientY - canvasRect.top
    })
  }

  const handleDrop = (e: React.MouseEvent) => {
    if (!draggingBoard) return
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left - dragOffset.x) / rect.width) * 100
    const y = ((e.clientY - rect.top - dragOffset.y) / rect.height) * 100

    const clampedX = Math.max(5, Math.min(95, x))
    const clampedY = Math.max(5, Math.min(95, y))

    const existingIndex = placedBoards.findIndex(pb => pb.board.id === draggingBoard.id)
    
    if (existingIndex >= 0) {
      const updated = [...placedBoards]
      updated[existingIndex] = { board: draggingBoard, x: clampedX, y: clampedY }
      setPlacedBoards(updated)
    } else {
      setPlacedBoards([...placedBoards, { board: draggingBoard, x: clampedX, y: clampedY }])
    }

    setDraggingBoard(null)
    setDragOffset({ x: 0, y: 0 })
  }

  const handleRemoveBoard = (boardId: string) => {
    setPlacedBoards(placedBoards.filter(pb => pb.board.id !== boardId))
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
    if (!validTypes.includes(file.type)) {
      alert('Please select a valid image file (.jpg, .jpeg, .png, or .pdf)')
      return
    }

    setIsUploading(true)

    try {
      let uploadFile = file
      let width = 0
      let height = 0
      let aspectRatio = 1
      const isPDF = file.type === 'application/pdf'
      
      // Convert PDF to image before uploading
      if (isPDF) {
        console.log('🔄 Converting PDF to image for display...')
        const { convertPDFToImages } = await import('@/lib/pdfToImage')
        const results = await convertPDFToImages(file)
        const result = results[0] // Use first page
        uploadFile = result.imageFile
        width = result.width
        height = result.height
        aspectRatio = result.aspectRatio
        console.log('✅ PDF converted to image:', result.imageFile.name)
      } else {
        // Get image dimensions
        const { getImageDimensions } = await import('@/lib/getImageDimensions')
        const dims = await getImageDimensions(file)
        width = dims.width
        height = dims.height
        aspectRatio = dims.aspectRatio
      }
      
      const formData = new FormData()
      formData.append('image', uploadFile)
      formData.append('studioId', studioId)
      formData.append('title', file.name.replace(/\.[^/.]+$/, ''))
      formData.append('studentName', 'Uploaded Board')
      formData.append('description', isPDF ? 'PDF Document' : '')
      formData.append('tags', isPDF ? 'pdf' : '')
      
      // Add dimensions
      formData.append('originalWidth', width.toString())
      formData.append('originalHeight', height.toString())
      formData.append('aspectRatio', aspectRatio.toString())

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        const newBoard = data.board as Board
        setAvailableBoardsState((prev: Board[]) => [...prev, newBoard])
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        if (isPDF) {
          alert('PDF converted to image and uploaded successfully!')
        }
      } else {
        const error = await response.text()
        alert('Upload failed: ' + error)
      }
    } catch (error) {
      console.error('Upload error:', error)
      alert('Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleSave = () => {
    console.log('=== SAVING BOARD POSITIONS ===')
    console.log(`Wall: ${wallIndex + 1}, Boards: ${placedBoards.length}`)
    console.log(`Wall dimensions: ${wallDimensions.width}ft × ${wallDimensions.height}ft`)
    
    const boardPositions = placedBoards.map(pb => {
      // Convert CSS percentages (0-100) to wall-centered coordinates (-0.5 to +0.5)
      const centerX = (pb.x / 100) - 0.5  // 50% → 0, 0% → -0.5, 100% → +0.5
      const centerY = (pb.y / 100) - 0.5  // 50% → 0, 0% → -0.5, 100% → +0.5
      
      // Calculate dimensions based on aspect ratio
      let widthPercent = 0.30  // Default: 30% of wall width
      let heightPercent = 0.30 // Default: 30% of wall height
      
      if (pb.board.aspectRatio) {
        // Base the size on height (30% of wall height)
        const baseHeightPercent = 0.35
        heightPercent = baseHeightPercent
        
        // Calculate width to maintain aspect ratio
        // Account for wall aspect ratio (wallWidth/wallHeight)
        const wallAspectRatio = wallDimensions.width / wallDimensions.height
        widthPercent = baseHeightPercent * pb.board.aspectRatio / wallAspectRatio
        
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
      }
      
      console.log(`📌 ${pb.board.title}:`)
      console.log(`   Position: (${centerX.toFixed(3)}, ${centerY.toFixed(3)})`)
      console.log(`   Aspect ratio: ${pb.board.aspectRatio?.toFixed(3) || 'N/A'}`)
      console.log(`   Size: ${(widthPercent * 100).toFixed(1)}% × ${(heightPercent * 100).toFixed(1)}%`)
      
      return {
        boardId: pb.board.id,
        x: centerX,
        y: centerY,
        width: widthPercent,
        height: heightPercent
      }
    })
    
    console.log(`✅ Saving ${boardPositions.length} boards`)
    console.log('==============================\n')
    
    onSave(wallIndex, boardPositions)
  }

  const isPDF = (board: Board) => {
    const url = board.fullImageUrl || board.thumbnailUrl || ''
    return url.toLowerCase().endsWith('.pdf')
  }


  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="bg-white border-b border-border shadow-md p-5"
      >
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-1">
              Edit Wall {wallIndex + 1}
            </h1>
            <p className="text-sm text-text-muted font-medium">
              Drag and drop boards to arrange them on the wall
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onExit}
              className="px-5 py-2.5 bg-background-lighter hover:bg-background-light text-text-primary rounded-lg transition-all duration-200 border border-border font-medium hover:shadow-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg transition-all duration-200 font-semibold shadow-md hover:shadow-lg"
            >
              Save & Exit
            </button>
          </div>
        </div>
      </motion.header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <motion.aside
          initial={{ x: -300 }}
          animate={{ x: 0 }}
          className="w-80 bg-white border-r border-border shadow-lg overflow-hidden flex flex-col"
        >
          <div className="p-4 bg-gradient-to-br from-background-lighter to-white border-b border-border">
            <h2 className="text-base font-bold text-text-primary mb-3 uppercase tracking-wider">
              Available Boards
            </h2>
            
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="w-full px-4 py-3 bg-primary hover:bg-primary-dark text-white rounded-lg transition-all duration-200 flex items-center justify-center gap-2 font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span>Add Your Board</span>
                </>
              )}
            </button>
            
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            <p className="text-xs text-text-muted mt-2 text-center">
              You can only move and delete your own boards
            </p>
            <p className="text-xs text-text-muted mt-3 text-center font-medium">
              {availableBoardsState.length} board{availableBoardsState.length !== 1 ? 's' : ''} available
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {availableBoardsState.map((board: Board) => {
              const isPlaced = placedBoards.some(pb => pb.board.id === board.id)
              
              return (
                <motion.div
                  key={board.id}
                  className={`bg-white rounded-xl p-3 cursor-move transition-all duration-200 border-2 shadow-sm hover:shadow-lg ${
                    isPlaced ? 'border-primary opacity-60' : 'border-gray-200 hover:border-primary/50'
                  }`}
                  onMouseDown={(e) => handleDragStart(board, e)}
                  whileHover={{ scale: 1.03, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-center gap-3">
                    {isPDF(board) ? (
                      <div className="w-16 h-20 rounded-lg shadow-md overflow-hidden bg-white flex-shrink-0">
                        <PDFRenderer 
                          pdfUrl={board.fullImageUrl || board.thumbnailUrl || ''} 
                          className="w-full h-full"
                          scale={0.5}
                        />
                      </div>
                    ) : board.thumbnailUrl && board.thumbnailUrl.startsWith('/uploads/') ? (
                      <img
                        src={board.thumbnailUrl}
                        alt={board.title}
                        className="w-16 h-16 object-cover rounded-lg shadow-md flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-gradient-to-br from-background-lighter to-background-light rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                        <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-text-primary truncate">
                        {board.title}
                      </p>
                      <p className="text-xs text-text-muted truncate mt-0.5">
                        {board.studentName}
                      </p>
                      {isPlaced && (
                        <span className="inline-block mt-1 text-xs text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">On wall</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
            
            {availableBoardsState.length === 0 && (
              <div className="text-center py-12">
                <svg className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-text-muted text-sm">
                  No boards available
                </p>
                <p className="text-text-muted text-xs mt-1">
                  Upload an image to get started
                </p>
              </div>
            )}
          </div>
        </motion.aside>

        {/* Canvas */}
        <div className="flex-1 p-8 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
          <motion.div
            ref={canvasRef}
            id="wall-canvas"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative bg-[#e8e4dc] rounded-2xl shadow-2xl border-4 border-[#d4d4d4] overflow-hidden mx-auto"
            onMouseMove={(e) => {
              if (draggingBoard) {
                const canvas = e.currentTarget
                const rect = canvas.getBoundingClientRect()
                setDragPosition({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top
                })
              }
            }}
            onMouseUp={handleDrop}
            style={{ 
              aspectRatio: wallAspectRatio,
              width: '100%',
              maxWidth: '90vw',
              maxHeight: 'calc(100vh - 180px)', // Account for header padding
              height: 'auto'
            }}
          >
              {/* Corkboard texture */}
              <div 
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
              />
              
              {/* Grid pattern */}
              <div className="absolute inset-0 opacity-15">
                <svg width="100%" height="100%">
                  <defs>
                    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#8b7355" strokeWidth="0.5"/>
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
              </div>

              {/* Placed boards */}
              {placedBoards.map((placedBoard) => {
                const boardIsPDF = isPDF(placedBoard.board)
                // US Letter paper aspect ratio (8.5 x 11 inches = 0.773 portrait)
                const pdfAspectRatio = 8.5 / 11
                
                return (
                  <motion.div
                    key={placedBoard.board.id}
                    data-board-id={placedBoard.board.id}
                    className="absolute group cursor-move"
                    style={{
                      left: `${placedBoard.x}%`,
                      top: `${placedBoard.y}%`,
                      maxWidth: '40%',
                      maxHeight: '60%',
                      transform: 'translate(-50%, -50%)',
                      filter: 'drop-shadow(2px 4px 8px rgba(0,0,0,0.25))'
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    onMouseDown={(e) => handleDragStart(placedBoard.board, e)}
                    whileHover={{ scale: 1.03, zIndex: 10 }}
                  >
                    {/* Paper/page container */}
                    <div className="relative bg-white" style={{ 
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1), inset 0 0 1px rgba(0,0,0,0.1)',
                      ...(boardIsPDF ? { 
                        width: '240px',
                        aspectRatio: `${pdfAspectRatio}`,
                      } : {})
                    }}>
                      {boardIsPDF ? (
                        <div className="relative w-full h-full overflow-hidden bg-white">
                          <PDFRenderer 
                            pdfUrl={placedBoard.board.fullImageUrl || placedBoard.board.thumbnailUrl || ''} 
                            className="w-full h-full"
                            scale={1.2}
                          />
                        </div>
                      ) : (
                        <img
                          src={placedBoard.board.fullImageUrl || placedBoard.board.thumbnailUrl || ''}
                          alt={placedBoard.board.title}
                          style={{
                            display: 'block',
                            width: 'auto',
                            height: 'auto',
                            maxWidth: '100%',
                            maxHeight: '100%',
                          }}
                          draggable={false}
                        />
                      )}
                    </div>

                    {/* Remove button - appears on hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveBoard(placedBoard.board.id)
                      }}
                      className="absolute -top-2 -right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg hover:scale-110 z-30"
                      title="Remove from wall"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </motion.div>
                )
              })}

              {/* Drag preview */}
              {draggingBoard && (
                <motion.div
                  className="absolute pointer-events-none z-30 opacity-70"
                  style={{
                    left: `${dragPosition.x}px`,
                    top: `${dragPosition.y}px`,
                    maxWidth: '40%',
                    maxHeight: '60%',
                    transform: `translate(-${dragOffset.x}px, -${dragOffset.y}px)`,
                    filter: 'drop-shadow(4px 6px 12px rgba(0,0,0,0.3))'
                  }}
                >
                  <div className="border-2 border-dashed border-primary bg-white overflow-hidden" style={{ 
                    boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                    ...(isPDF(draggingBoard) ? { width: '180px', aspectRatio: '8.5/11' } : {})
                  }}>
                    {isPDF(draggingBoard) ? (
                      <PDFRenderer 
                        pdfUrl={draggingBoard.fullImageUrl || draggingBoard.thumbnailUrl || ''} 
                        className="w-full h-full"
                        scale={0.8}
                      />
                    ) : (draggingBoard.fullImageUrl || draggingBoard.thumbnailUrl) ? (
                      <img
                        src={draggingBoard.fullImageUrl || draggingBoard.thumbnailUrl}
                        alt={draggingBoard.title}
                        style={{
                          display: 'block',
                          width: 'auto',
                          height: 'auto',
                          maxWidth: '100%',
                          maxHeight: '100%',
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center p-4" style={{ minWidth: '200px', minHeight: '150px' }}>
                        <p className="text-xs font-medium text-gray-700">{draggingBoard.title}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Empty state */}
              {placedBoards.length === 0 && !draggingBoard && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-text-muted">
                    <svg className="w-20 h-20 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-xl font-bold text-text-primary">Drag boards here to arrange them</p>
                    <p className="text-sm mt-2 text-text-muted">Click and drag from the sidebar</p>
                  </div>
                </div>
              )}
            </motion.div>
        </div>
      </div>
    </div>
  )
}